const express = require("express");
const crypto = require("crypto");
const { getWellahealthReconciliation } = require("../services/reconciliation");

const router = express.Router();

// Token-authenticated, read-only endpoint for the WellaHealth reconciliation
// dashboard. Deliberately mounted outside the session-auth wall (see index.js)
// and protected by WELLAHEALTH_DASHBOARD_TOKEN from .env instead — no new
// user role is created for this.
function requireDashboardToken(req, res, next) {
  const expected = process.env.WELLAHEALTH_DASHBOARD_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: "Reconciliation dashboard is not configured." });
  }
  const provided = String(req.query.token || "");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}

router.get("/wellahealth", requireDashboardToken, async (req, res) => {
  try {
    const data = await getWellahealthReconciliation();
    res.json(data);
  } catch (err) {
    console.error("Reconciliation dashboard failed:", err);
    res.status(500).json({ error: "Could not load reconciliation data." });
  }
});

module.exports = router;
