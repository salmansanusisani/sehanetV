const express = require("express");
const { pool } = require("../db/db");
const { hashPassword } = require("../utils/password");
const { getAllSettings, setSetting } = require("../services/settings");
const { resolveCreditedAmbassador, calculateCommission } = require("../services/commission");
const paystack = require("../services/paystack");
const { getAmbassadorBalance } = require("../services/earnings");

const router = express.Router();

// High-level figures for the admin home screen. Amounts are derived from
// recorded policies/renewals, never from a browser-submitted value.
router.get("/dashboard", async (req, res) => {
  try {
    const [[policyTotals]] = await pool.execute("SELECT COUNT(*) AS count, COALESCE(SUM(amount_paid), 0) AS revenue FROM policies");
    const [[renewalTotals]] = await pool.execute("SELECT COUNT(*) AS count, COALESCE(SUM(amount_paid), 0) AS revenue FROM renewals");
    const [[customerTotals]] = await pool.execute("SELECT COUNT(*) AS count FROM customers");
    const [[activeTotals]] = await pool.execute("SELECT COUNT(*) AS count FROM policies WHERE status = 'Active'");
    const [ambassadors] = await pool.execute("SELECT id FROM users WHERE role = 'ambassador'");
    const balances = await Promise.all(ambassadors.map((a) => getAmbassadorBalance(a.id)));
    const ambassadorEarned = balances.reduce((sum, b) => sum + Number(b?.earned || 0), 0);
    const ambassadorPaid = balances.reduce((sum, b) => sum + Number(b?.paid || 0), 0);
    const revenue = Number(policyTotals.revenue || 0) + Number(renewalTotals.revenue || 0);
    res.json({ revenue, policyCount: policyTotals.count, renewalCount: renewalTotals.count, customerCount: customerTotals.count, activePolicies: activeTotals.count, ambassadorEarned, ambassadorPaid, ambassadorOutstanding: Math.max(0, ambassadorEarned - ambassadorPaid), adminNetBeforeExpenses: revenue - ambassadorEarned });
  } catch (err) {
    console.error("Dashboard failed:", err);
    res.status(500).json({ error: "Could not load dashboard figures." });
  }
});

// ---- User (agent/ambassador) management ----

router.get("/users", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, phone, username, role, status, commission_rate_new,
              commission_rate_renewal, reassigned_to, block_reason, remove_reason, created_at
       FROM users WHERE role != 'admin' ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to load users:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/users", async (req, res) => {
  const {
    name, phone, username, password, role,
    commission_rate_new, commission_rate_renewal,
    bank_code, bank_account_number, bank_account_name,
  } = req.body || {};

  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: "name, username, password, and role are required" });
  }
  if (!["agent", "ambassador"].includes(role)) {
    return res.status(400).json({ error: "role must be 'agent' or 'ambassador'" });
  }

  try {
    const [existingRows] = await pool.execute("SELECT id FROM users WHERE username = ?", [username]);
    if (existingRows[0]) {
      return res.status(409).json({ error: "That username is already taken" });
    }

    const settings = await getAllSettings();
    const rateNew =
      role === "ambassador"
        ? commission_rate_new ?? parseFloat(settings.ambassador_new_percent || "0")
        : null;
    const rateRenewal =
      role === "ambassador"
        ? commission_rate_renewal ?? parseFloat(settings.ambassador_renewal_percent || "0")
        : null;

    const [result] = await pool.execute(
      `INSERT INTO users
        (name, phone, username, password_hash, role, status,
         commission_rate_new, commission_rate_renewal,
         bank_code, bank_account_number, bank_account_name)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [
        name, phone || null, username, hashPassword(password), role,
        rateNew, rateRenewal,
        bank_code || null, bank_account_number || null, bank_account_name || null,
      ]
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error("User creation failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/users/:id/block", async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: "A reason is required to block a user" });
  }
  try {
    const [result] = await pool.execute(
      "UPDATE users SET status = 'blocked', block_reason = ? WHERE id = ? AND role != 'admin'",
      [reason, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Block failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/users/:id/unblock", async (req, res) => {
  try {
    const [result] = await pool.execute(
      "UPDATE users SET status = 'active', block_reason = NULL WHERE id = ? AND role != 'admin'",
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Unblock failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/users/:id/password", async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) {
    return res.status(400).json({ error: "password must be at least 6 characters" });
  }
  try {
    const [result] = await pool.execute(
      "UPDATE users SET password_hash = ? WHERE id = ? AND role != 'admin'",
      [hashPassword(password), req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Password reset failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update editable profile/rate/bank fields — not username, role, or status
// (those go through the dedicated block/unblock/remove endpoints instead)
router.patch("/users/:id", async (req, res) => {
  try {
    const [targetRows] = await pool.execute("SELECT * FROM users WHERE id = ?", [req.params.id]);
    const target = targetRows[0];
    if (!target || target.role === "admin") {
      return res.status(404).json({ error: "User not found" });
    }

    const editable = [
      "name", "phone",
      "commission_rate_new", "commission_rate_renewal",
      "bank_code", "bank_account_number", "bank_account_name",
    ];
    const updates = {};
    for (const key of editable) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No editable fields provided" });
    }
    if (target.role === "agent" && ("commission_rate_new" in updates || "commission_rate_renewal" in updates)) {
      return res.status(400).json({ error: "Unpaid agents cannot have a commission rate" });
    }

    const wantsBankVerification =
      Object.prototype.hasOwnProperty.call(req.body || {}, "bank_code") &&
      Object.prototype.hasOwnProperty.call(req.body || {}, "bank_account_number");

    if (wantsBankVerification) {
      const newBankCode = req.body.bank_code ?? "";
      const newBankAccountNumber = req.body.bank_account_number ?? "";
      const bankCodeChanged = String(newBankCode) !== String(target.bank_code || "");
      const bankAccountNumberChanged = String(newBankAccountNumber) !== String(target.bank_account_number || "");

      if (bankCodeChanged || bankAccountNumberChanged) {
        try {
          const resolved = await paystack.resolveAccountNumber(newBankAccountNumber, newBankCode);
          updates.bank_account_name = resolved.accountName || "";
          const recipientCode = await paystack.createTransferRecipient({
            name: resolved.accountName || "",
            accountNumber: newBankAccountNumber,
            bankCode: newBankCode,
          });
          updates.paystack_recipient_code = recipientCode;
        } catch (err) {
          return res.status(400).json({ error: err.message || "Bank verification failed" });
        }
      }
    }

    const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
    await pool.execute(`UPDATE users SET ${setClause} WHERE id = ?`, [...Object.values(updates), req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("User update failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Removing an ambassador — future commission on their book can be reassigned
// to another ambassador. Past, already-earned commission is untouched.
router.patch("/users/:id/remove", async (req, res) => {
  const { reason, reassign_to } = req.body || {};
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: "A reason is required to remove a user" });
  }

  try {
    const [targetRows] = await pool.execute("SELECT * FROM users WHERE id = ?", [req.params.id]);
    const target = targetRows[0];
    if (!target || target.role === "admin") {
      return res.status(404).json({ error: "User not found" });
    }

    if (reassign_to) {
      if (String(reassign_to) === String(req.params.id)) {
        return res.status(400).json({ error: "Cannot reassign an ambassador's book to themselves" });
      }
      const [reassignRows] = await pool.execute("SELECT * FROM users WHERE id = ?", [reassign_to]);
      const reassignTarget = reassignRows[0];
      if (!reassignTarget || reassignTarget.role !== "ambassador" || reassignTarget.status !== "active") {
        return res.status(400).json({ error: "reassign_to must be an existing, active ambassador" });
      }
    }

    await pool.execute(
      "UPDATE users SET status = 'removed', remove_reason = ?, reassigned_to = ? WHERE id = ?",
      [reason, reassign_to || null, req.params.id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("User removal failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Banks + Commission settings ----

router.get("/banks", async (req, res) => {
  try {
    const banks = await paystack.listBanks();
    res.json(banks);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to load banks" });
  }
});

router.get("/settings", async (req, res) => {
  try {
    res.json(await getAllSettings());
  } catch (err) {
    console.error("Failed to load settings:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/settings", async (req, res) => {
  const allowedKeys = [
    "wellahealth_commission_percent",
    "ambassador_new_percent",
    "ambassador_renewal_percent",
  ];
  const updates = req.body || {};
  for (const key of Object.keys(updates)) {
    if (!allowedKeys.includes(key)) {
      return res.status(400).json({ error: `Unknown setting: ${key}` });
    }
    const num = parseFloat(updates[key]);
    if (Number.isNaN(num) || num < 0 || num > 100) {
      return res.status(400).json({ error: `${key} must be a number between 0 and 100` });
    }
  }
  try {
    for (const [key, value] of Object.entries(updates)) {
      await setSetting(key, value);
    }
    res.json(await getAllSettings());
  } catch (err) {
    console.error("Settings update failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Groups (read-only for admin — created by ambassadors) ----

router.get("/groups", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT g.*, u.name as ambassador_name
       FROM groups_ g JOIN users u ON u.id = g.ambassador_id
       ORDER BY g.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to load groups:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Payout requests and admin notifications ----
router.get("/notifications", async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM notifications WHERE user_id = ? ORDER BY is_read ASC, created_at DESC LIMIT 50", [req.user.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Could not load notifications." }); }
});

router.post("/notifications/:id/read", async (req, res) => {
  await pool.execute("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.get("/payout-requests", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT pr.*, u.name as ambassador_name, u.username as ambassador_username
       FROM payout_requests pr JOIN users u ON u.id = pr.ambassador_id
       ORDER BY FIELD(pr.status, 'pending', 'approved', 'rejected', 'paid', 'cancelled'), pr.created_at DESC`
    );
    const enriched = await Promise.all(rows.map(async (row) => ({ ...row, balance: await getAmbassadorBalance(row.ambassador_id) })));
    res.json(enriched);
  } catch (err) { console.error("Failed to load payout requests:", err); res.status(500).json({ error: "Could not load payout requests." }); }
});

router.patch("/payout-requests/:id", async (req, res) => {
  const status = req.body?.status;
  const adminNote = String(req.body?.adminNote || "").trim();
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "Status must be approved or rejected." });
  try {
    const [rows] = await pool.execute("SELECT * FROM payout_requests WHERE id = ?", [req.params.id]);
    const request = rows[0];
    if (!request || request.status !== "pending") return res.status(400).json({ error: "This payout request can no longer be reviewed." });
    if (status === "approved") {
      const balance = await getAmbassadorBalance(request.ambassador_id);
      // Balance includes the pending request itself, so restore its amount for this validation.
      if (request.requested_amount > balance.available + Number(request.requested_amount)) return res.status(400).json({ error: "The requested amount is no longer available." });
    }
    await pool.execute("UPDATE payout_requests SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?", [status, adminNote || null, req.user.id, request.id]);
    await pool.execute("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'payout_request_reviewed', ?, ?)", [request.ambassador_id, `Payout request ${status}`, adminNote || `Your NGN ${Number(request.requested_amount).toLocaleString()} request was ${status}.`]);
    res.json({ message: `Payout request ${status}.` });
  } catch (err) { console.error("Payout request review failed:", err); res.status(500).json({ error: "Could not review the payout request." }); }
});

// Transfers are intentionally a separate action from approval. This makes the
// money-moving step explicit and gives the admin a final chance to check the
// ambassador's verified recipient account.
router.post("/payout-requests/:id/pay", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT pr.*, u.name as ambassador_name, u.paystack_recipient_code
       FROM payout_requests pr JOIN users u ON u.id = pr.ambassador_id WHERE pr.id = ?`,
      [req.params.id]
    );
    const request = rows[0];
    if (!request) return res.status(404).json({ error: "Payout request not found." });
    if (request.status !== "approved") return res.status(400).json({ error: "Only approved payout requests can be paid." });
    if (!request.paystack_recipient_code) return res.status(400).json({ error: `${request.ambassador_name} does not have a verified bank account yet.` });

    const reference = `sehanet-request-${request.id}`;
    const transfer = await paystack.initiateTransfer({
      recipientCode: request.paystack_recipient_code,
      amountNaira: request.requested_amount,
      reason: "SehaNet ambassador commission payout",
      reference,
    });
    const transferSucceeded = transfer.status === "success";
    await pool.execute(
      `UPDATE payout_requests SET paystack_transfer_code = ?, status = ?, paid_at = CASE WHEN ? THEN NOW() ELSE paid_at END
       WHERE id = ?`,
      [transfer.transferCode || null, transferSucceeded ? "paid" : "approved", transferSucceeded, request.id]
    );
    await pool.execute(
      "INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'payout_transfer', ?, ?)",
      [request.ambassador_id, transferSucceeded ? "Payment sent" : "Payment is processing", transferSucceeded
        ? `NGN ${Number(request.requested_amount).toLocaleString()} has been sent to your bank account.`
        : `Your NGN ${Number(request.requested_amount).toLocaleString()} transfer was initiated and is awaiting confirmation.`]
    );
    res.json({ message: transferSucceeded ? "Payment sent successfully." : "Transfer initiated and awaiting confirmation.", status: transferSucceeded ? "paid" : "approved", transferCode: transfer.transferCode || null });
  } catch (err) {
    console.error("Payout request transfer failed:", err);
    res.status(err.status || 500).json({ error: err.message || "Could not initiate the bank transfer." });
  }
});

// ---- Weekly payout draft (read-only preview — no money moves yet) ----
//
// NOTE: This computes what WOULD be owed for the given week. Triggering
// real Paystack transfers is a separate, later step that requires the
// admin's Paystack transfer capability to be confirmed.

async function calculatePayoutDraft(weekLabel) {
  const [weekStart, weekEnd] = weekBounds(weekLabel);

  const [enrollments] = await pool.execute(
    `SELECT p.*, c.full_name as customer_name
     FROM policies p JOIN customers c ON c.id = p.customer_id
     WHERE p.created_at >= ? AND p.created_at < ?`,
    [weekStart, weekEnd]
  );

  const [renewals] = await pool.execute(
    `SELECT r.*, p.plan_code
     FROM renewals r JOIN policies p ON p.id = r.policy_id
     WHERE r.created_at >= ? AND r.created_at < ?`,
    [weekStart, weekEnd]
  );

  const byAmbassador = {};

  async function ensure(id) {
    if (!byAmbassador[id]) {
      const [uRows] = await pool.execute("SELECT id, name FROM users WHERE id = ?", [id]);
      const u = uRows[0];
      byAmbassador[id] = {
        ambassador_id: id,
        name: u ? u.name : `#${id}`,
        enrollment_count: 0,
        renewal_count: 0,
        amount: 0,
      };
    }
    return byAmbassador[id];
  }

  for (const p of enrollments) {
    const creditedId = await resolveCreditedAmbassador(p.original_agent_id);
    if (!creditedId) continue; // unpaid agent — no commission
    const [ambassadorRows] = await pool.execute("SELECT * FROM users WHERE id = ?", [creditedId]);
    const ambassador = ambassadorRows[0];
    const amount = await calculateCommission(p.price_at_enrollment, "new", ambassador);
    const row = await ensure(creditedId);
    row.enrollment_count += 1;
    row.amount += amount;
  }

  for (const r of renewals) {
    const creditedId = await resolveCreditedAmbassador(r.processed_by_agent_id);
    if (!creditedId) continue;
    const [ambassadorRows] = await pool.execute("SELECT * FROM users WHERE id = ?", [creditedId]);
    const ambassador = ambassadorRows[0];
    const amount = await calculateCommission(r.amount_paid, "renewal", ambassador);
    const row = await ensure(creditedId);
    row.renewal_count += 1;
    row.amount += amount;
  }

  const rows = Object.values(byAmbassador).map((r) => ({
    ...r,
    amount: Math.round(r.amount * 100) / 100,
  }));
  const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;

  return { week: weekLabel, rows, total };
}

router.get("/payouts/draft", async (req, res) => {
  try {
    const week = req.query.week; // e.g. "2026-W30" — optional, defaults to current week
    const weekLabel = week || isoWeekLabel(new Date());
    const draft = await calculatePayoutDraft(weekLabel);
    res.json(draft);
  } catch (err) {
    console.error("Payout draft calculation failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List all past payouts
router.get("/payouts", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.*, u.name as approved_by_name,
              COALESCE((SELECT SUM(amount) FROM payout_line_items WHERE payout_id = p.id), 0) as total_amount
       FROM payouts p
       LEFT JOIN users u ON u.id = p.approved_by
       ORDER BY p.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to load payouts:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get a single payout with its line items
router.get("/payouts/:id", async (req, res) => {
  try {
    const [payoutRows] = await pool.execute(
      `SELECT p.*, u.name as approved_by_name
       FROM payouts p
       LEFT JOIN users u ON u.id = p.approved_by
       WHERE p.id = ?`,
      [req.params.id]
    );
    const payout = payoutRows[0];
    if (!payout) {
      return res.status(404).json({ error: "Payout not found" });
    }

    const [lineItems] = await pool.execute(
      `SELECT pli.*, u.name as ambassador_name, u.username as ambassador_username,
              u.bank_code, u.bank_account_number, u.bank_account_name, u.paystack_recipient_code
       FROM payout_line_items pli
       JOIN users u ON u.id = pli.ambassador_id
       WHERE pli.payout_id = ?`,
      [req.params.id]
    );

    const total = Math.round(lineItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) * 100) / 100;

    res.json({
      ...payout,
      line_items: lineItems,
      total_amount: total,
    });
  } catch (err) {
    console.error("Failed to load payout:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a payout draft record for a week
router.post("/payouts", async (req, res) => {
  const { week } = req.body || {};
  const weekLabel = week || isoWeekLabel(new Date());

  let connection;
  try {
    // This legacy weekly draft has no per-commission-event ledger. Once the
    // safer request-based payout flow is used, block creating another weekly
    // draft rather than risk paying the same commission a second time.
    const [manualPaymentRows] = await pool.execute(
      "SELECT id FROM payout_requests WHERE status IN ('approved', 'paid') LIMIT 1"
    );
    if (manualPaymentRows[0]) {
      return res.status(409).json({ error: "Weekly payout drafts are disabled after payout requests are used. Use approved ambassador payment requests to avoid duplicate payments." });
    }
    const [existingRows] = await pool.execute("SELECT id FROM payouts WHERE week_label = ?", [weekLabel]);
    if (existingRows[0]) {
      return res.status(409).json({ error: `A payout for week ${weekLabel} already exists` });
    }

    const draft = await calculatePayoutDraft(weekLabel);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [payoutResult] = await connection.execute(
      "INSERT INTO payouts (week_label, status) VALUES (?, 'draft')",
      [weekLabel]
    );
    const payoutId = payoutResult.insertId;

    for (const row of draft.rows) {
      await connection.execute(
        `INSERT INTO payout_line_items
          (payout_id, ambassador_id, enrollment_count, renewal_count, amount, transfer_status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [payoutId, row.ambassador_id, row.enrollment_count, row.renewal_count, row.amount]
      );
    }

    await connection.commit();
    connection.release();
    connection = null;

    const [createdPayoutRows] = await pool.execute("SELECT * FROM payouts WHERE id = ?", [payoutId]);
    const [lineItems] = await pool.execute(
      `SELECT pli.*, u.name as ambassador_name
       FROM payout_line_items pli
       JOIN users u ON u.id = pli.ambassador_id
       WHERE pli.payout_id = ?`,
      [payoutId]
    );

    res.status(201).json({
      ...createdPayoutRows[0],
      line_items: lineItems,
      total_amount: draft.total,
    });
  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }
      connection.release();
    }
    console.error("Payout creation failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Approve payout and initiate Paystack transfers
router.post("/payouts/:id/approve", async (req, res) => {
  try {
    const [payoutRows] = await pool.execute("SELECT * FROM payouts WHERE id = ?", [req.params.id]);
    const payout = payoutRows[0];
    if (!payout) {
      return res.status(404).json({ error: "Payout not found" });
    }
    if (payout.status !== "draft") {
      return res.status(400).json({ error: `Payout status is '${payout.status}', can only approve payouts in 'draft' status` });
    }

    const [lineItems] = await pool.execute(
      `SELECT pli.*, u.name as ambassador_name, u.paystack_recipient_code
       FROM payout_line_items pli
       JOIN users u ON u.id = pli.ambassador_id
       WHERE pli.payout_id = ?`,
      [req.params.id]
    );

    const missingRecipientCodes = lineItems.filter(
      (item) => Number(item.amount) > 0 && !item.paystack_recipient_code
    );

    if (missingRecipientCodes.length > 0) {
      const missingNames = missingRecipientCodes
        .map((item) => `${item.ambassador_name} (#${item.ambassador_id})`)
        .join(", ");
      return res.status(400).json({
        error: `Cannot approve payout: missing Paystack recipient code for ambassador(s): ${missingNames}`,
      });
    }

    const paid = [];
    const failed = [];

    for (const item of lineItems) {
      if (Number(item.amount) <= 0) {
        await pool.execute(
          "UPDATE payout_line_items SET transfer_status = ?, paystack_transfer_code = ? WHERE id = ?",
          ["success", null, item.id]
        );
        paid.push({ line_item_id: item.id, ambassador_id: item.ambassador_id, amount: item.amount, note: "Zero amount" });
        continue;
      }

      const reference = `sehanet-payout-${payout.id}-${item.ambassador_id}`;

      try {
        const result = await paystack.initiateTransfer({
          recipientCode: item.paystack_recipient_code,
          amountNaira: item.amount,
          reason: "SehaNet weekly commission",
          reference,
        });

        const status = result?.transferCode || result?.status === "success" || result?.status === "pending" ? "success" : "failed";
        await pool.execute(
          "UPDATE payout_line_items SET transfer_status = ?, paystack_transfer_code = ? WHERE id = ?",
          [status, result?.transferCode || null, item.id]
        );

        if (status === "success") {
          paid.push({
            line_item_id: item.id,
            ambassador_id: item.ambassador_id,
            amount: item.amount,
            transfer_code: result?.transferCode,
          });
        } else {
          failed.push({
            line_item_id: item.id,
            ambassador_id: item.ambassador_id,
            amount: item.amount,
            error: "Transfer status failed",
          });
        }
      } catch (err) {
        await pool.execute(
          "UPDATE payout_line_items SET transfer_status = ?, paystack_transfer_code = ? WHERE id = ?",
          ["failed", null, item.id]
        );
        failed.push({
          line_item_id: item.id,
          ambassador_id: item.ambassador_id,
          amount: item.amount,
          error: err.message || "Paystack transfer failed",
        });
      }
    }

    await pool.execute(
      "UPDATE payouts SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?",
      [req.user.id, payout.id]
    );

    res.json({ paid, failed });
  } catch (err) {
    console.error("Payout approval failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Policies Search & Filter ----
router.get("/policies", async (req, res) => {
  const { search, status, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const pageSize = Math.max(1, parseInt(limit, 10));

  let whereClauses = [];
  let params = [];

  if (search && search.trim()) {
    whereClauses.push("(c.full_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)");
    params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
  }

  if (status && status.trim() && status !== "All") {
    whereClauses.push("p.status = ?");
    params.push(status.trim());
  }

  const whereStr = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

  try {
    const [totalRows] = await pool.execute(
      `SELECT COUNT(*) as count
       FROM policies p
       JOIN customers c ON c.id = p.customer_id
       ${whereStr}`,
      params
    );
const [rows] = await pool.execute(
  `SELECT p.*, c.full_name as customer_name, c.phone as customer_phone, c.email as customer_email,
          c.location as customer_location, c.follow_up_status, u.name as agent_name
   FROM policies p
   JOIN customers c ON c.id = p.customer_id
   LEFT JOIN users u ON u.id = p.original_agent_id
   ${whereStr}
   ORDER BY p.created_at DESC
   LIMIT ${pageSize} OFFSET ${offset}`,
  params
);
    res.json({
      rows,
      total: totalRows[0] ? totalRows[0].count : 0,
      page: Math.max(1, parseInt(page, 10)),
      limit: pageSize,
    });
  } catch (err) {
    console.error("Policy search failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Renewals Due Soon (Admin view — all agents) ----
router.get("/renewals-due", async (req, res) => {
  const days = Math.max(1, parseInt(req.query.days || "14", 10));

  try {
    const [rows] = await pool.execute(
      `SELECT p.*, c.full_name as customer_name, c.phone as customer_phone, u.name as agent_name,
              DATEDIFF(p.end_date, CURDATE()) as days_remaining
       FROM policies p
       JOIN customers c ON c.id = p.customer_id
       LEFT JOIN users u ON u.id = p.original_agent_id
       WHERE p.status = 'Active'
         AND p.end_date IS NOT NULL
         AND p.end_date >= CURDATE()
         AND p.end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
       ORDER BY p.end_date ASC`,
      [days]
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to load renewals due:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- CSV Export for Payouts ----
router.get("/payouts/:id/export", async (req, res) => {
  try {
    const [payoutRows] = await pool.execute("SELECT * FROM payouts WHERE id = ?", [req.params.id]);
    const payout = payoutRows[0];
    if (!payout) {
      return res.status(404).json({ error: "Payout not found" });
    }

    const [lineItems] = await pool.execute(
      `SELECT pli.*, u.name as ambassador_name
       FROM payout_line_items pli
       JOIN users u ON u.id = pli.ambassador_id
       WHERE pli.payout_id = ?`,
      [req.params.id]
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="payout-${payout.week_label}.csv"`);

    let csv = "Ambassador Name,Enrollment Count,Renewal Count,Amount (NGN),Transfer Status\n";

    let totalEnrollments = 0;
    let totalRenewals = 0;
    let totalAmount = 0;

    for (const item of lineItems) {
      const name = `"${(item.ambassador_name || "").replace(/"/g, '""')}"`;
      const enc = item.enrollment_count || 0;
      const ren = item.renewal_count || 0;
      const amt = Number(item.amount) || 0;
      const status = item.transfer_status || "pending";

      totalEnrollments += enc;
      totalRenewals += ren;
      totalAmount += amt;

      csv += `${name},${enc},${ren},${amt},${status}\n`;
    }

    csv += `"TOTAL",${totalEnrollments},${totalRenewals},${Math.round(totalAmount * 100) / 100},""\n`;

    res.send(csv);
  } catch (err) {
    console.error("CSV export failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Helpers: ISO week label + bounds ----

function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNo =
    1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function weekBounds(weekLabel) {
  const [yearStr, weekStr] = weekLabel.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + (week - 1) * 7);
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(monday.getUTCDate() + 7);
  return [monday.toISOString().slice(0, 19).replace("T", " "), nextMonday.toISOString().slice(0, 19).replace("T", " ")];
}

module.exports = router;
