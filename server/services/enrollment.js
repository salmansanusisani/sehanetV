const { pool } = require("../db/db");
const wellahealth = require("./wellahealthClient");
const paystack = require("./paystack");
const { resolveCreditedAmbassador, createCommissionEntry } = require("./commission");

/**
 * Shared business logic for enrollments, renewals, and bulk orders.
 * Used both by the API routes and by the verified Paystack webhook, so a
 * successful payment always lands in the database even if the browser
 * callback never runs. Every record-creation path here is idempotent.
 */

// Looks up a plan's real price server-side, rather than trusting whatever
// amount the client submits. Checks the same set of possible field names
// app.js's getPlanMeta() checks on the frontend, since WellaHealth's plan
// objects aren't 100% consistent about which key the price lives under.
async function resolvePlanPrice(planCode) {
  const plansData = await wellahealth.getHealthPlans();
  const plans = Array.isArray(plansData)
    ? plansData
    : Array.isArray(plansData?.plans) ? plansData.plans
    : Array.isArray(plansData?.items) ? plansData.items
    : Array.isArray(plansData?.data) ? plansData.data
    : Array.isArray(plansData?.result) ? plansData.result
    : Array.isArray(plansData?.results) ? plansData.results
    : [];

  const match = plans.find((p) => (p?.planCode || p?.code || p?.plan_code || p?.id) === planCode);
  if (!match) {
    const err = new Error(`Unknown plan code: ${planCode}`);
    err.status = 400;
    throw err;
  }

  const price = match?.price ?? match?.amount ?? match?.premium ?? match?.priceAmount ?? match?.monthlyPrice;
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    const err = new Error(`Could not resolve a valid price for plan ${planCode}`);
    err.status = 400;
    throw err;
  }

  return {
    price: numericPrice,
    planName: match?.planName || match?.name || match?.title || match?.displayName || planCode,
  };
}

function getCallbackUrl(req) {
  const configured = process.env.APP_BASE_URL || "";
  if (configured) {
    return `${configured.replace(/\/$/, "")}/payment/callback`;
  }

  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.get("host") || "localhost:4000";
  return `${protocol}://${host}/payment/callback`;
}

async function createEnrollmentRecord({
  userId, customerAccountId, existingCustomerId, firstName, lastName, phoneNumber,
  email, planCode, planName, location, gender, dateOfBirth, amountPaid,
  paymentReference, resolvedGroupId, wellahealthResult,
}) {
  // Idempotency: if this payment reference already produced a policy, return
  // the existing one instead of creating a duplicate (relies on the UNIQUE
  // index on policies.payment_reference as a backstop).
  if (paymentReference) {
    const [existingPolicies] = await pool.execute(
      "SELECT id FROM policies WHERE payment_reference = ? LIMIT 1",
      [paymentReference]
    );
    if (existingPolicies[0]) {
      return { customer_id: null, policy_id: existingPolicies[0].id, alreadyProcessed: true };
    }
  }

  let customerId = existingCustomerId;
  if (customerId) {
    await pool.execute(
      "UPDATE customers SET full_name = ?, phone = ?, email = ?, location = ?, dob = ?, gender = ? WHERE id = ?",
      [`${firstName} ${lastName}`.trim(), phoneNumber, email || null, location || null, dateOfBirth, gender, customerId]
    );
  } else {
    const [customerResult] = await pool.execute(
      `INSERT INTO customers (full_name, phone, email, location, dob, gender, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [`${firstName} ${lastName}`.trim(), phoneNumber, email || null, location || null, dateOfBirth, gender, resolvedGroupId]
    );
    customerId = customerResult.insertId;
  }

  let policyId;
  try {
    const [policyResult] = await pool.execute(
      `INSERT INTO policies
        (customer_id, original_agent_id, customer_account_id, plan_code, plan_name, price_at_enrollment,
         wellahealth_policy_number, status, start_date, end_date, payment_reference, amount_paid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerId, userId || null, customerAccountId || null, planCode, planName || null, Number(amountPaid),
        wellahealthResult.policyNumber || null, wellahealthResult.status || "Active",
        wellahealthResult.startDate || null, wellahealthResult.endDate || null, paymentReference, Number(amountPaid)
      ]
    );
    policyId = policyResult.insertId;
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const [existingPolicies] = await pool.execute(
        "SELECT id FROM policies WHERE payment_reference = ? LIMIT 1",
        [paymentReference]
      );
      if (existingPolicies[0]) {
        return { customer_id: customerId, policy_id: existingPolicies[0].id, alreadyProcessed: true };
      }
      if (err.sqlMessage && err.sqlMessage.includes("uniq_customers_phone")) {
        const dupErr = new Error(
          `This phone number (${phoneNumber}) already has a customer record. Use the renewal flow instead of enrolling again.`
        );
        dupErr.status = 409;
        throw dupErr;
      }
    }
    throw err;
  }

  // Snapshot the commission at sale time so later settings changes can't
  // rewrite history. Unpaid agents / self-enrolled customers produce nothing.
  const creditedAmbassadorId = await resolveCreditedAmbassador(userId);
  if (creditedAmbassadorId) {
    await createCommissionEntry({
      ambassadorId: creditedAmbassadorId,
      eventType: "enrollment",
      planPrice: Number(amountPaid),
      reference: paymentReference,
      policyId,
    });
  }

  return {
    customer_id: customerId,
    policy_id: policyId,
  };
}

/**
 * Record a renewal locally, attach it to the customer's latest policy for
 * commission tracking, and snapshot the renewal commission. Idempotent via
 * the UNIQUE index on renewals.payment_reference.
 */
async function recordRenewal({ phoneNumber, planCode, amountPaid, paymentReference, processedByAgentId, wellahealthResult }) {
  if (paymentReference) {
    const [existingRows] = await pool.execute(
      "SELECT id FROM renewals WHERE payment_reference = ? LIMIT 1",
      [paymentReference]
    );
    if (existingRows[0]) {
      return { renewalId: existingRows[0].id, warning: null, alreadyProcessed: true };
    }
  }

  const [customerRows] = await pool.execute("SELECT * FROM customers WHERE phone = ?", [phoneNumber]);
  const customer = customerRows[0];
  if (!customer) {
    return { renewalId: null, warning: "This customer isn't in the local system — renewal recorded with WellaHealth only, not tracked for commission." };
  }

  const [policyRows] = await pool.execute(
    "SELECT * FROM policies WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1",
    [customer.id]
  );
  const policy = policyRows[0];
  if (!policy) {
    return { renewalId: null, warning: "No local policy found for this customer — renewal recorded with WellaHealth only, not tracked for commission." };
  }

  let renewalId;
  try {
    const [renewalResult] = await pool.execute(
      `INSERT INTO renewals (policy_id, processed_by_agent_id, amount_paid, payment_reference, new_end_date)
       VALUES (?, ?, ?, ?, ?)`,
      [policy.id, processedByAgentId, amountPaid, paymentReference, wellahealthResult.endDate || null]
    );
    renewalId = renewalResult.insertId;
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const [existingRows] = await pool.execute(
        "SELECT id FROM renewals WHERE payment_reference = ? LIMIT 1",
        [paymentReference]
      );
      if (existingRows[0]) return { renewalId: existingRows[0].id, warning: null, alreadyProcessed: true };
    }
    throw err;
  }

  await pool.execute("UPDATE policies SET end_date = ?, status = ? WHERE id = ?", [
    wellahealthResult.endDate || policy.end_date,
    wellahealthResult.status || policy.status,
    policy.id,
  ]);

  const creditedAmbassadorId = await resolveCreditedAmbassador(processedByAgentId);
  if (creditedAmbassadorId) {
    await createCommissionEntry({
      ambassadorId: creditedAmbassadorId,
      eventType: "renewal",
      planPrice: Number(amountPaid),
      reference: paymentReference,
      policyId: policy.id,
    });
  }

  return { renewalId, warning: null };
}

// In-process lock so two simultaneous webhook/callback deliveries for the
// same bulk order can't both claim the same pending items.
const processingBulkOrders = new Set();

async function processBulkOrder(bulkOrderId) {
  if (!bulkOrderId) throw new Error("Bulk order id required");

  const [orderRows] = await pool.execute("SELECT * FROM bulk_orders WHERE id = ?", [bulkOrderId]);
  const order = orderRows[0];
  if (!order) throw new Error("Bulk order not found");
  if (["completed", "partially_completed"].includes(order.status)) return order;
  if (processingBulkOrders.has(order.id)) return order;

  processingBulkOrders.add(order.id);
  try {
    await pool.execute("UPDATE bulk_orders SET status = 'paid', paid_at = COALESCE(paid_at, NOW()) WHERE id = ?", [order.id]);
    // Retry previously-failed items too, so a transient WellaHealth error
    // doesn't permanently strand a customer.
    const [items] = await pool.execute(
      "SELECT * FROM bulk_order_items WHERE bulk_order_id = ? AND status IN ('pending', 'failed')",
      [order.id]
    );
    let failed = 0;
    for (const item of items) {
      try {
        const whResult = await wellahealth.createSubscription({
          amountPaid: item.amount, firstName: item.first_name, lastName: item.last_name,
          phoneNumber: item.phone, email: item.email || "", planCode: item.plan_code,
          location: item.location, gender: item.gender, dateOfBirth: item.date_of_birth,
          paymentReference: `${order.payment_reference}-${item.id}`,
        });
        const record = await createEnrollmentRecord({
          userId: order.ambassador_id, firstName: item.first_name, lastName: item.last_name,
          phoneNumber: item.phone, email: item.email, planCode: item.plan_code,
          planName: item.plan_name, location: item.location, gender: item.gender,
          dateOfBirth: item.date_of_birth, amountPaid: item.amount,
          paymentReference: `${order.payment_reference}-${item.id}`,
          resolvedGroupId: order.group_id, wellahealthResult: whResult,
        });
        await pool.execute("UPDATE bulk_order_items SET status = 'completed', policy_id = ?, error_message = NULL WHERE id = ?", [record.policy_id, item.id]);
      } catch (err) {
        failed += 1;
        await pool.execute("UPDATE bulk_order_items SET status = 'failed', error_message = ? WHERE id = ?", [err.message || "Enrollment failed", item.id]);
      }
    }
    const [remaining] = await pool.execute("SELECT COUNT(*) AS count FROM bulk_order_items WHERE bulk_order_id = ? AND status = 'pending'", [order.id]);
    if (!remaining[0].count) {
      await pool.execute("UPDATE bulk_orders SET status = ? WHERE id = ?", [failed ? "partially_completed" : "completed", order.id]);
    }
    return order;
  } finally {
    processingBulkOrders.delete(order.id);
  }
}

/**
 * Handle a verified successful charge. Used by both the browser callback and
 * the Paystack webhook; safe to call multiple times for the same reference.
 */
async function processChargeSuccess(metadata, reference) {
  const meta = metadata || {};
  const type = meta.type;
  const effectiveReference = meta.paymentReference || reference;

  if (type === "bulk_enrollment") {
    await processBulkOrder(meta.bulkOrderId);
    return { type };
  }

  if (type === "enrollment") {
    const whResult = await wellahealth.createSubscription({
      amountPaid: Number(meta.amountPaid || 0),
      firstName: meta.firstName,
      lastName: meta.lastName,
      phoneNumber: meta.phoneNumber,
      planCode: meta.planCode,
      email: meta.email || "",
      location: meta.location,
      gender: meta.gender,
      dateOfBirth: meta.dateOfBirth,
      paymentReference: effectiveReference,
    });
    const record = await createEnrollmentRecord({
      userId: meta.userId,
      customerAccountId: meta.customerAccountId,
      existingCustomerId: meta.existingCustomerId,
      firstName: meta.firstName,
      lastName: meta.lastName,
      phoneNumber: meta.phoneNumber,
      email: meta.email || "",
      planCode: meta.planCode,
      planName: meta.planName,
      location: meta.location,
      gender: meta.gender,
      dateOfBirth: meta.dateOfBirth,
      amountPaid: Number(meta.amountPaid || 0),
      paymentReference: effectiveReference,
      resolvedGroupId: meta.groupId || null,
      wellahealthResult: whResult,
    });
    return { type, ...record };
  }

  if (type === "renewal") {
    const whResult = await wellahealth.renewSubscription({
      phoneNumber: meta.phoneNumber,
      planCode: meta.planCode,
      amountPaid: Number(meta.amountPaid || 0),
      paymentReference: effectiveReference,
    });
    const result = await recordRenewal({
      phoneNumber: meta.phoneNumber,
      planCode: meta.planCode,
      amountPaid: Number(meta.amountPaid || 0),
      paymentReference: effectiveReference,
      processedByAgentId: meta.userId,
      wellahealthResult: whResult,
    });
    return { type, ...result };
  }

  throw new Error(`Unknown payment type: ${type}`);
}

/**
 * Reconcile a Paystack transfer event (transfer.success / transfer.failed)
 * against locally stored transfer codes.
 */
async function reconcileTransfer(transferData) {
  const transferCode = transferData?.transfer_code || transferData?.id || null;
  if (!transferCode) return;

  const succeeded = transferData?.status === "success";
  const failed = transferData?.status === "failed";

  await pool.execute(
    `UPDATE payout_requests
     SET status = ?, paid_at = CASE WHEN ? THEN NOW() ELSE paid_at END
     WHERE paystack_transfer_code = ?`,
    [succeeded ? "paid" : "approved", succeeded, transferCode]
  );

  await pool.execute(
    "UPDATE payout_line_items SET transfer_status = ? WHERE paystack_transfer_code = ?",
    [succeeded ? "success" : "failed", transferCode]
  );

  console.log(
    `[payment] Reconciled Paystack transfer ${transferCode}: ${succeeded ? "paid" : failed ? "failed" : "pending"}`
  );
}

module.exports = {
  resolvePlanPrice,
  getCallbackUrl,
  createEnrollmentRecord,
  recordRenewal,
  processBulkOrder,
  processChargeSuccess,
  reconcileTransfer,
};
