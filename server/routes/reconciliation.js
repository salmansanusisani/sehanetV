const express = require("express");
const crypto = require("crypto");
const {
  getWellahealthReconciliation,
  getAltbankReconciliation,
} = require("../services/reconciliation");

const router = express.Router();

// Token-authenticated, read-only reconciliation endpoints for partner
// dashboards. Deliberately mounted outside the session-auth wall (see
// index.js) and protected by per-partner tokens from .env instead — no new
// user roles are created for these.
function requireDashboardToken(envVar) {
  const expected = process.env[envVar];
  return (req, res, next) => {
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
  };
}

function parseAltbankFilters(query) {
  const clean = (v) => (v && String(v).trim()) || null;
  return {
    from: clean(query.from),
    to: clean(query.to),
    agentId: clean(query.agent),
    planCode: clean(query.plan),
  };
}

router.get("/wellahealth", requireDashboardToken("WELLAHEALTH_DASHBOARD_TOKEN"), async (req, res) => {
  try {
    res.json(await getWellahealthReconciliation());
  } catch (err) {
    console.error("Reconciliation dashboard failed:", err);
    res.status(500).json({ error: "Could not load reconciliation data." });
  }
});

router.get("/altbank", requireDashboardToken("ALTBANK_DASHBOARD_TOKEN"), async (req, res) => {
  try {
    res.json(await getAltbankReconciliation(parseAltbankFilters(req.query)));
  } catch (err) {
    console.error("AltBank reconciliation failed:", err);
    res.status(500).json({ error: "Could not load reconciliation data." });
  }
});

// CSV export: payment reference, date, agent name, plan name, gross,
// SehaNet share, AltBank share.
router.get("/altbank/export", requireDashboardToken("ALTBANK_DASHBOARD_TOKEN"), async (req, res) => {
  try {
    const data = await getAltbankReconciliation(parseAltbankFilters(req.query));
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["Payment Reference", "Date", "Agent Name", "Plan Name", "Gross Amount", "SehaNet Share", "AltBank Share"].map(esc).join(","),
      ...data.transactions.map((t) =>
        [
          t.paymentReference,
          t.dateTime instanceof Date ? t.dateTime.toISOString() : t.dateTime,
          t.agentName,
          t.planName,
          t.grossAmount.toFixed(2),
          t.sehanetShare.toFixed(2),
          t.altbankShare.toFixed(2),
        ].map(esc).join(",")
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="altbank-reconciliation.csv"');
    res.send("\uFEFF" + lines.join("\r\n"));
  } catch (err) {
    console.error("AltBank CSV export failed:", err);
    res.status(500).json({ error: "Could not export reconciliation data." });
  }
});

module.exports = router;
