const express = require("express");
const { pool } = require("../db/db");
const wellahealth = require("../services/wellahealthClient");
const paystack = require("../services/paystack");

const router = express.Router();

async function createEnrollmentRecord({ userId, customerAccountId, existingCustomerId, firstName, lastName, phoneNumber, email, planCode, planName, location, gender, dateOfBirth, amountPaid, paymentReference, resolvedGroupId, wellahealthResult }) {
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

  return {
    customer_id: customerId,
    policy_id: policyResult.insertId,
  };
}

function handle(promise, res) {
  return promise
    .then((data) => res.status(200).json(data))
    .catch((err) => {
      console.error("WellaHealth call failed:", { status: err.status, message: err.message, body: err.body });
      res.status(err.status || 500).json({
        error: err.message || "Unexpected error",
        status: err.status || null,
        details: err.body || null,
      });
    });
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

// GET /api/plans/health
router.get("/plans/health", (req, res) => {
  handle(wellahealth.getHealthPlans(), res);
});

// GET /api/subscriptions/phone/:phoneNumber
router.get("/subscriptions/phone/:phoneNumber", (req, res) => {
  handle(wellahealth.getSubscriptionByPhone(req.params.phoneNumber), res);
});

// GET /api/subscriptions/policy/:policyNumber
router.get("/subscriptions/policy/:policyNumber", (req, res) => {
  handle(wellahealth.getSubscriptionByPolicy(req.params.policyNumber), res);
});

// POST /api/subscriptions — enroll a new customer, attributed to whoever's logged in
router.post("/subscriptions", async (req, res) => {
  const {
    firstName, lastName, phoneNumber, email, planCode, planName,
    location, gender, dateOfBirth, paymentReference, groupId, paymentMethod,
  } = req.body || {};

  const required = { firstName, lastName, phoneNumber, planCode, location, gender, dateOfBirth };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (paymentMethod !== "paystack" && !paymentReference) {
    missing.push("paymentReference");
  }
  if (missing.length) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }
  if (!["Male", "Female"].includes(gender)) {
    return res.status(400).json({ error: "gender must be 'Male' or 'Female'" });
  }
  if (req.user.role === "customer" && String(phoneNumber) !== String(req.user.phone)) {
    return res.status(403).json({ error: "You can only enroll using the phone number on your account." });
  }

  // Ambassadors must enroll under one of their own Groups
  let resolvedGroupId = null;
  if (req.user.role === "ambassador") {
    if (!groupId) {
      return res.status(400).json({ error: "groupId is required for ambassadors — create or pick a Group first" });
    }
    try {
      const [groupRows] = await pool.execute(
        "SELECT * FROM groups_ WHERE id = ? AND ambassador_id = ?",
        [groupId, req.user.id]
      );
      if (!groupRows[0]) {
        return res.status(400).json({ error: "That group does not exist or does not belong to you" });
      }
      resolvedGroupId = groupRows[0].id;
    } catch (err) {
      console.error("Group lookup failed:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  try {
    // Resolve the real price server-side — never trust a client-submitted amount.
    const { price: amountPaid, planName: resolvedPlanName } = await resolvePlanPrice(planCode);
    const effectivePlanName = planName || resolvedPlanName;

    if (paymentMethod === "paystack") {
      const reference = paymentReference || `enroll-${Date.now()}-${req.user.id}`;
      const paymentInit = await paystack.initializeTransaction({
        email: email || "customer@example.com",
        amountNaira: amountPaid,
        reference,
        callbackUrl: getCallbackUrl(req),
        metadata: {
          userId: req.user.role === "customer" ? null : req.user.id,
          customerAccountId: req.user.role === "customer" ? req.user.id : null,
          existingCustomerId: req.user.role === "customer" ? req.user.customer_id : null,
          type: "enrollment",
          email: email || "customer@example.com",
          amountPaid,
          paymentReference: reference,
          firstName,
          lastName,
          phoneNumber,
          planCode,
          planName: effectivePlanName,
          location,
          gender,
          dateOfBirth,
          groupId: resolvedGroupId,
        },
      });

      return res.status(200).json({
        paymentRequired: true,
        paymentMethod: "paystack",
        authorizationUrl: paymentInit.authorizationUrl,
        accessCode: paymentInit.accessCode,
        reference,
      });
    }

    // Prevent double-enrollment — if this phone is already a customer, block
    // rather than silently create a second WellaHealth policy for them.
    const [existingRows] = await pool.execute(
      `SELECT c.id, u.name as agent_name, u.role as agent_role
       FROM customers c
       JOIN policies p ON p.customer_id = c.id
       JOIN users u ON u.id = p.original_agent_id
       WHERE c.phone = ?
       ORDER BY p.created_at DESC LIMIT 1`,
      [phoneNumber]
    );
    const existing = existingRows[0];

    if (existing) {
      return res.status(409).json({
        error: `This phone number is already enrolled (originally by ${existing.agent_name}). Use the renewal flow instead of enrolling again.`,
      });
    }

    const whResult = await wellahealth.createSubscription({
      amountPaid, firstName, lastName, phoneNumber, planCode,
      email: email || "", location, gender, dateOfBirth, paymentReference,
    });

    const record = await createEnrollmentRecord({
      userId: req.user.role === "customer" ? null : req.user.id,
      customerAccountId: req.user.role === "customer" ? req.user.id : null,
      existingCustomerId: req.user.role === "customer" ? req.user.customer_id : null,
      firstName,
      lastName,
      phoneNumber,
      email,
      planCode,
      planName: effectivePlanName,
      location,
      gender,
      dateOfBirth,
      amountPaid,
      paymentReference,
      resolvedGroupId,
      wellahealthResult: whResult,
    });

    res.status(201).json({
      wellahealth: whResult,
      ...record,
    });
  } catch (err) {
    console.error("Enrollment failed:", { status: err.status, message: err.message, body: err.body });
    res.status(err.status || 500).json({
      error: err.message || "Enrollment failed",
      details: err.body || null,
    });
  }
});

// Bulk enrollment: one group and plan, up to 20 customers, one Paystack payment.
// Customer records stay in MySQL; Paystack receives only the order id/reference.
router.post("/bulk-orders", async (req, res) => {
  if (req.user.role !== "ambassador") return res.status(403).json({ error: "Only ambassadors can create bulk enrollments." });
  const { groupId, planCode, customers } = req.body || {};
  if (!groupId || !planCode || !Array.isArray(customers) || customers.length < 1 || customers.length > 20) {
    return res.status(400).json({ error: "Choose a group and plan, then add between 1 and 20 customers." });
  }
  const invalid = customers.find((c) => !c?.firstName || !c?.lastName || !c?.phoneNumber || !c?.location || !c?.dateOfBirth || !["Male", "Female"].includes(c?.gender));
  if (invalid) return res.status(400).json({ error: "Every customer needs a name, phone, location, date of birth, and gender." });
  if (new Set(customers.map((c) => String(c.phoneNumber))).size !== customers.length) return res.status(400).json({ error: "Each customer in the batch needs a different phone number." });
  try {
    const [groups] = await pool.execute("SELECT id FROM groups_ WHERE id = ? AND ambassador_id = ?", [groupId, req.user.id]);
    if (!groups[0]) return res.status(400).json({ error: "Choose one of your own groups." });
    const { price, planName } = await resolvePlanPrice(planCode);
    const phones = customers.map((c) => c.phoneNumber);
    const placeholders = phones.map(() => "?").join(",");
    const [existing] = await pool.execute(`SELECT phone FROM customers WHERE phone IN (${placeholders})`, phones);
    if (existing.length) return res.status(409).json({ error: `Already enrolled: ${existing.map((c) => c.phone).join(", ")}. Remove them and use renewal instead.` });
    const total = Math.round(price * customers.length * 100) / 100;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [orderResult] = await connection.execute("INSERT INTO bulk_orders (ambassador_id, group_id, total_amount, status) VALUES (?, ?, ?, 'pending_payment')", [req.user.id, groupId, total]);
      for (const c of customers) {
        await connection.execute(
          `INSERT INTO bulk_order_items (bulk_order_id, first_name, last_name, phone, email, plan_code, plan_name, location, gender, date_of_birth, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderResult.insertId, c.firstName, c.lastName, c.phoneNumber, c.email || null, planCode, planName, c.location, c.gender, c.dateOfBirth, price]
        );
      }
      const reference = `bulk-${orderResult.insertId}-${Date.now()}`;
      await connection.execute("UPDATE bulk_orders SET payment_reference = ? WHERE id = ?", [reference, orderResult.insertId]);
      await connection.commit();
      const payment = await paystack.initializeTransaction({ email: customers.find((c) => c.email)?.email || "customer@example.com", amountNaira: total, reference, callbackUrl: getCallbackUrl(req), metadata: { type: "bulk_enrollment", bulkOrderId: orderResult.insertId } });
      res.json({ paymentRequired: true, authorizationUrl: payment.authorizationUrl, reference, total, customerCount: customers.length });
    } catch (err) { await connection.rollback(); throw err; } finally { connection.release(); }
  } catch (err) {
    console.error("Bulk order creation failed:", err);
    res.status(err.status || 500).json({ error: err.message || "Could not prepare the bulk enrollment." });
  }
});

// POST /api/subscriptions/renewals — any logged-in agent/ambassador can renew any customer
router.post("/subscriptions/renewals", async (req, res) => {
  const { phoneNumber, planCode, paymentReference, paymentMethod } = req.body || {};
  if (!phoneNumber || !planCode || (!paymentReference && paymentMethod !== "paystack")) {
    return res.status(400).json({ error: "phoneNumber, planCode, and paymentReference are required" });
  }

  try {
    const { price: amountPaid } = await resolvePlanPrice(planCode);

    if (paymentMethod === "paystack") {
      const reference = paymentReference || `renew-${Date.now()}-${req.user.id}`;
      const paymentInit = await paystack.initializeTransaction({
        email: "customer@example.com",
        amountNaira: amountPaid,
        reference,
        callbackUrl: getCallbackUrl(req),
        metadata: {
          userId: req.user.id,
          type: "renewal",
          email: "customer@example.com",
          amountPaid,
          paymentReference: reference,
          phoneNumber,
          planCode,
        },
      });

      return res.status(200).json({
        paymentRequired: true,
        paymentMethod: "paystack",
        authorizationUrl: paymentInit.authorizationUrl,
        accessCode: paymentInit.accessCode,
        reference,
      });
    }

    const whResult = await wellahealth.renewSubscription({
      phoneNumber, planCode, amountPaid, paymentReference,
    });

    // Try to attach this renewal to a local policy record for commission tracking.
    // If the customer isn't in our local DB (e.g. enrolled before this system
    // existed), we still return the WellaHealth result, just without local tracking.
    const [customerRows] = await pool.execute("SELECT * FROM customers WHERE phone = ?", [phoneNumber]);
    const customer = customerRows[0];
    let renewalId = null;
    let warning = null;

    if (customer) {
      const [policyRows] = await pool.execute(
        "SELECT * FROM policies WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1",
        [customer.id]
      );
      const policy = policyRows[0];
      if (policy) {
        const [renewalResult] = await pool.execute(
          `INSERT INTO renewals (policy_id, processed_by_agent_id, amount_paid, payment_reference, new_end_date)
           VALUES (?, ?, ?, ?, ?)`,
          [policy.id, req.user.id, amountPaid, paymentReference, whResult.endDate || null]
        );
        renewalId = renewalResult.insertId;
        await pool.execute("UPDATE policies SET end_date = ?, status = ? WHERE id = ?", [
          whResult.endDate || policy.end_date,
          whResult.status || policy.status,
          policy.id,
        ]);
      } else {
        warning = "No local policy found for this customer — renewal recorded with WellaHealth only, not tracked for commission.";
      }
    } else {
      warning = "This customer isn't in the local system — renewal recorded with WellaHealth only, not tracked for commission.";
    }

    res.status(200).json({ wellahealth: whResult, renewal_id: renewalId, warning });
  } catch (err) {
    console.error("Renewal failed:", { status: err.status, message: err.message, body: err.body });
    res.status(err.status || 500).json({
      error: err.message || "Renewal failed",
      details: err.body || null,
    });
  }
});

async function processBulkOrder(bulkOrderId) {
  const [orderRows] = await pool.execute("SELECT * FROM bulk_orders WHERE id = ?", [bulkOrderId]);
  const order = orderRows[0];
  if (!order) throw new Error("Bulk order not found");
  if (["completed", "partially_completed"].includes(order.status)) return order;
  await pool.execute("UPDATE bulk_orders SET status = 'processing', paid_at = COALESCE(paid_at, NOW()) WHERE id = ?", [order.id]);
  const [items] = await pool.execute("SELECT * FROM bulk_order_items WHERE bulk_order_id = ? AND status = 'pending'", [order.id]);
  let failed = 0;
  for (const item of items) {
    try {
      const whResult = await wellahealth.createSubscription({ amountPaid: item.amount, firstName: item.first_name, lastName: item.last_name, phoneNumber: item.phone, email: item.email || "", planCode: item.plan_code, location: item.location, gender: item.gender, dateOfBirth: item.date_of_birth, paymentReference: `${order.payment_reference}-${item.id}` });
      const record = await createEnrollmentRecord({ userId: order.ambassador_id, firstName: item.first_name, lastName: item.last_name, phoneNumber: item.phone, email: item.email, planCode: item.plan_code, planName: item.plan_name, location: item.location, gender: item.gender, dateOfBirth: item.date_of_birth, amountPaid: item.amount, paymentReference: `${order.payment_reference}-${item.id}`, resolvedGroupId: order.group_id, wellahealthResult: whResult });
      await pool.execute("UPDATE bulk_order_items SET status = 'completed', policy_id = ? WHERE id = ?", [record.policy_id, item.id]);
    } catch (err) {
      failed += 1;
      await pool.execute("UPDATE bulk_order_items SET status = 'failed', error_message = ? WHERE id = ?", [err.message || "Enrollment failed", item.id]);
    }
  }
  const [remaining] = await pool.execute("SELECT COUNT(*) AS count FROM bulk_order_items WHERE bulk_order_id = ? AND status = 'pending'", [order.id]);
  if (!remaining[0].count) await pool.execute("UPDATE bulk_orders SET status = ? WHERE id = ?", [failed ? "partially_completed" : "completed", order.id]);
  return order;
}

router.createEnrollmentRecord = createEnrollmentRecord;
router.resolvePlanPrice = resolvePlanPrice;
router.processBulkOrder = processBulkOrder;

module.exports = router;
