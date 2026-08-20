const { pool } = require("../db/db");

// WellaHealth reconciliation (Phase 1).
//
// Read-only financial reconciliation calculated dynamically from the existing
// `policies` table — no duplicate data layer, so this always matches the
// source of truth. A policy row appears here only if the enrollment actually
// reached WellaHealth (i.e. it has a WellaHealth policy number), which is
// exactly what WellaHealth invoices against.
//
// This module is intentionally separate from the ambassador commission system
// (commission.js / earnings.js / payout logic) and must never modify it.

const WELLAHEALTH_SHARE_PERCENT = 80;
const PAYSTACK_FEE_PERCENT = 1.5;

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function calculateShares(grossAmount) {
  const gross = round2(grossAmount);
  const wellahealthShare = round2(gross * (WELLAHEALTH_SHARE_PERCENT / 100));
  const paystackFee = round2(gross * (PAYSTACK_FEE_PERCENT / 100));
  const sehanetGrossShare = round2(gross - wellahealthShare);
  const sehanetNetShare = round2(sehanetGrossShare - paystackFee);
  return { gross, wellahealthShare, paystackFee, sehanetGrossShare, sehanetNetShare };
}

async function getWellahealthReconciliation() {
  // Only expose the fields approved for the WellaHealth dashboard — no phone
  // numbers, emails, agent/ambassador identifiers, or commission data.
  const [rows] = await pool.execute(
    `SELECT payment_reference, wellahealth_policy_number, plan_name,
            amount_paid, created_at
       FROM policies
      WHERE wellahealth_policy_number IS NOT NULL
        AND amount_paid IS NOT NULL
      ORDER BY created_at DESC`
  );

  let totalTransactions = 0;
  let totalGross = 0;
  let totalWellahealthShare = 0;

  const transactions = rows.map((row) => {
    const { gross, wellahealthShare } = calculateShares(row.amount_paid);
    totalTransactions += 1;
    totalGross += gross;
    totalWellahealthShare += wellahealthShare;
    return {
      paymentReference: row.payment_reference,
      policyNumber: row.wellahealth_policy_number,
      dateTime: row.created_at,
      planName: row.plan_name,
      grossAmount: gross,
      wellahealthShare,
    };
  });

  return {
    summary: {
      totalTransactions,
      totalGross: round2(totalGross),
      totalWellahealthShare: round2(totalWellahealthShare),
    },
    transactions,
  };
}

// ---------------------------------------------------------------------------
// AltBank (AltBox) reconciliation.
//
// AltBox agents are plain agent accounts flagged is_altbox = 1. Their
// enrollments carry enrollment_source = 'altbox' on the policies table, set
// automatically at enrollment time. Revenue sharing:
//   WellaHealth 80% · SehaNet gross 20% · AltBank 15% OF SehaNet's share ·
//   Paystack fee 1.5% of gross absorbed by SehaNet.
// Completely separate from the ambassador commission system.
// ---------------------------------------------------------------------------
async function getAltbankReconciliation({ from, to, agentId, planCode } = {}) {
  const conditions = [
    "p.enrollment_source = 'altbox'",
    "u.is_altbox = 1",
    "p.wellahealth_policy_number IS NOT NULL",
    "p.amount_paid IS NOT NULL",
  ];
  const params = [];
  if (from) { conditions.push("p.created_at >= ?"); params.push(`${from} 00:00:00`); }
  if (to) { conditions.push("p.created_at <= ?"); params.push(`${to} 23:59:59`); }
  if (agentId) { conditions.push("u.id = ?"); params.push(agentId); }
  if (planCode) { conditions.push("p.plan_code = ?"); params.push(planCode); }

  const [rows] = await pool.execute(
    `SELECT p.payment_reference, p.created_at, p.plan_code, p.plan_name,
            p.amount_paid, u.id AS agent_id, u.name AS agent_name
       FROM policies p
       JOIN users u ON u.id = p.original_agent_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY p.created_at DESC`,
    params
  );

  let totalTransactions = 0;
  let totalGross = 0;
  let totalSehanetGross = 0;
  let totalAltbankShare = 0;
  let totalPaystackFees = 0;
  let totalSehanetNet = 0;

  const months = new Map();
  const transactions = rows.map((row) => {
    const shares = calculateShares(row.amount_paid);
    const sehanetGross = shares.sehanetGrossShare;
    const altbankShare = round2(sehanetGross * 0.15);
    const paystackFee = shares.paystackFee;
    const sehanetNet = round2(sehanetGross - altbankShare - paystackFee);

    totalTransactions += 1;
    totalGross += shares.gross;
    totalSehanetGross += sehanetGross;
    totalAltbankShare += altbankShare;
    totalPaystackFees += paystackFee;
    totalSehanetNet += sehanetNet;

    const monthKey = String(row.created_at).slice(0, 7);
    const month = months.get(monthKey) || { month: monthKey, transactions: 0, sehanetRevenue: 0, altbankShare: 0 };
    month.transactions += 1;
    month.sehanetRevenue = round2(month.sehanetRevenue + sehanetGross);
    month.altbankShare = round2(month.altbankShare + altbankShare);
    months.set(monthKey, month);

    return {
      paymentReference: row.payment_reference,
      dateTime: row.created_at,
      agentId: row.agent_id,
      agentName: row.agent_name,
      planCode: row.plan_code,
      planName: row.plan_name,
      grossAmount: shares.gross,
      wellahealthShare: shares.wellahealthShare,
      sehanetShare: sehanetGross,
      altbankShare,
      paystackFee,
      sehanetNet,
    };
  });

  // Distinct agents/plans among AltBox enrollments (unfiltered) for dropdowns.
  const [agentRows] = await pool.execute(
    `SELECT DISTINCT u.id, u.name
       FROM policies p JOIN users u ON u.id = p.original_agent_id
      WHERE p.enrollment_source = 'altbox' AND u.is_altbox = 1
      ORDER BY u.name`
  );
  const [planRows] = await pool.execute(
    `SELECT DISTINCT plan_code, plan_name
       FROM policies
      WHERE enrollment_source = 'altbox' AND plan_code IS NOT NULL
      ORDER BY plan_name`
  );

  return {
    summary: {
      totalTransactions,
      totalGross: round2(totalGross),
      totalSehanetRevenue: round2(totalSehanetGross),
      totalAltbankShare: round2(totalAltbankShare),
      totalPaystackFees: round2(totalPaystackFees),
      totalSehanetNet: round2(totalSehanetNet),
    },
    monthly: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    filters: { agents: agentRows, plans: planRows },
    transactions,
  };
}

module.exports = {
  WELLAHEALTH_SHARE_PERCENT,
  PAYSTACK_FEE_PERCENT,
  ALTBANK_SHARE_OF_SEHANET_PERCENT: 15,
  calculateShares,
  getWellahealthReconciliation,
  getAltbankReconciliation,
};
