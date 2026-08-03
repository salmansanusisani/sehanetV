const express = require("express");
const { pool } = require("../db/db");
const { resolveCreditedAmbassador, calculateCommission } = require("../services/commission");
const { verifyPassword, hashPassword } = require("../utils/password");
const { getAmbassadorBalance } = require("../services/earnings");

const router = express.Router();

router.get("/me", async (req, res) => {
  try {
    if (req.user.role === "customer") {
      const [rows] = await pool.execute(
        `SELECT ca.id, ca.username, ca.status, c.id as customer_id, c.full_name as name, c.phone, c.email, c.location
         FROM customer_accounts ca JOIN customers c ON c.id = ca.customer_id WHERE ca.id = ?`,
        [req.user.id]
      );
      const account = rows[0];
      return res.json(account ? { ...account, role: "customer" } : null);
    }
    const [rows] = await pool.execute(
      `SELECT id, name, phone, username, role, status, commission_rate_new, commission_rate_renewal
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error("Failed to load profile:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// My enrollment history (works for agent, ambassador, or admin)
router.get("/me/policies", async (req, res) => {
  try {
    if (req.user.role === "customer") {
      const [rows] = await pool.execute(
        `SELECT p.*, c.full_name as customer_name, c.phone as customer_phone
         FROM policies p JOIN customers c ON c.id = p.customer_id
         WHERE p.customer_id = ? ORDER BY p.created_at DESC`,
        [req.user.customer_id]
      );
      return res.json(rows);
    }
    const [rows] = await pool.execute(
      `SELECT p.*, c.full_name as customer_name, c.phone as customer_phone
       FROM policies p JOIN customers c ON c.id = p.customer_id
       WHERE p.original_agent_id = ?
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to load policies:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// My groups (ambassador only) — convenience alias, same data as /api/groups/mine
router.get("/me/summary", async (req, res) => {
  if (req.user.role !== "ambassador") {
    return res.json({ role: req.user.role, note: "Unpaid agents do not earn commission." });
  }

  try {
    const [ambassadorRows] = await pool.execute("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const ambassador = ambassadorRows[0];

    const [policies] = await pool.execute(
      "SELECT * FROM policies WHERE original_agent_id = ?",
      [req.user.id]
    );
    const [renewals] = await pool.execute(
      `SELECT r.* FROM renewals r
       JOIN policies p ON p.id = r.policy_id
       WHERE r.processed_by_agent_id = ?`,
      [req.user.id]
    );

    let lifetimeCommission = 0;
    for (const p of policies) {
      lifetimeCommission += await calculateCommission(p.price_at_enrollment, "new", ambassador);
    }
    for (const r of renewals) {
      lifetimeCommission += await calculateCommission(r.amount_paid, "renewal", ambassador);
    }

    res.json({
      role: "ambassador",
      total_enrollments: policies.length,
      total_renewals: renewals.length,
      lifetime_commission_estimate: Math.round(lifetimeCommission * 100) / 100,
    });
  } catch (err) {
    console.error("Failed to load summary:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me/earnings", async (req, res) => {
  if (req.user.role !== "ambassador") return res.status(403).json({ error: "Only ambassadors have commission earnings." });
  try {
    const balance = await getAmbassadorBalance(req.user.id);
    const [requests] = await pool.execute(
      "SELECT id, requested_amount, status, note, admin_note, created_at, reviewed_at FROM payout_requests WHERE ambassador_id = ? ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json({ ...balance, requests });
  } catch (err) {
    console.error("Failed to load earnings:", err);
    res.status(500).json({ error: "Could not load earnings." });
  }
});

router.post("/me/payout-requests", async (req, res) => {
  if (req.user.role !== "ambassador") return res.status(403).json({ error: "Only ambassadors can request a payout." });
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || "").trim();
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Enter a valid payout amount." });
  try {
    const balance = await getAmbassadorBalance(req.user.id);
    if (amount > balance.available) return res.status(400).json({ error: `You can request up to NGN ${balance.available.toLocaleString()}.` });
    const [result] = await pool.execute("INSERT INTO payout_requests (ambassador_id, requested_amount, note) VALUES (?, ?, ?)", [req.user.id, amount, note || null]);
    const [admins] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
    for (const admin of admins) {
      await pool.execute("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'payout_request', ?, ?)", [admin.id, "New payout request", `${req.user.name} requested NGN ${amount.toLocaleString()}.`]);
    }
    res.status(201).json({ id: result.insertId, message: "Your payout request was sent to the administrator." });
  } catch (err) {
    console.error("Payout request failed:", err);
    res.status(500).json({ error: "Could not submit the payout request." });
  }
});

// My renewals due soon
router.get("/me/renewals-due", async (req, res) => {
  const days = Math.max(1, parseInt(req.query.days || "14", 10));

  try {
    const ownerClause = req.user.role === "customer" ? "p.customer_id = ?" : "p.original_agent_id = ?";
    const ownerId = req.user.role === "customer" ? req.user.customer_id : req.user.id;
    const [rows] = await pool.execute(
      `SELECT p.*, c.full_name as customer_name, c.phone as customer_phone, u.name as agent_name,
              DATEDIFF(p.end_date, CURDATE()) as days_remaining
       FROM policies p
       JOIN customers c ON c.id = p.customer_id
       JOIN users u ON u.id = p.original_agent_id
       WHERE ${ownerClause}
         AND p.status = 'Active'
         AND p.end_date IS NOT NULL
         AND p.end_date >= CURDATE()
         AND p.end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
       ORDER BY p.end_date ASC`,
      [ownerId, days]
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to load renewals due:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Self-service password change
router.post("/me/password", async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: "newPassword must be at least 6 characters long" });
  }

  try {
    if (req.user.role === "customer") {
      const [rows] = await pool.execute("SELECT password_hash FROM customer_accounts WHERE id = ?", [req.user.id]);
      const account = rows[0];
      if (!account || !verifyPassword(currentPassword, account.password_hash)) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      await pool.execute("UPDATE customer_accounts SET password_hash = ? WHERE id = ?", [hashPassword(newPassword), req.user.id]);
      return res.json({ ok: true });
    }
    const [rows] = await pool.execute("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
    const user = rows[0];
    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    await pool.execute("UPDATE users SET password_hash = ? WHERE id = ?", [
      hashPassword(newPassword),
      req.user.id,
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error("Password change failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
