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

module.exports = {
  WELLAHEALTH_SHARE_PERCENT,
  PAYSTACK_FEE_PERCENT,
  calculateShares,
  getWellahealthReconciliation,
};
