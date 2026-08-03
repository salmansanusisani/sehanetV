const { pool } = require("../db/db");
const { calculateCommission } = require("./commission");

async function getAmbassadorBalance(ambassadorId) {
  const [users] = await pool.execute("SELECT * FROM users WHERE id = ? AND role = 'ambassador'", [ambassadorId]);
  const ambassador = users[0];
  if (!ambassador) return null;

  const [policies] = await pool.execute("SELECT price_at_enrollment FROM policies WHERE original_agent_id = ?", [ambassadorId]);
  const [renewals] = await pool.execute(
    "SELECT r.amount_paid FROM renewals r WHERE r.processed_by_agent_id = ?", [ambassadorId]
  );
  let earned = 0;
  for (const policy of policies) earned += await calculateCommission(policy.price_at_enrollment, "new", ambassador);
  for (const renewal of renewals) earned += await calculateCommission(renewal.amount_paid, "renewal", ambassador);

  const [paidRows] = await pool.execute(
    `SELECT COALESCE(SUM(pli.amount), 0) AS total FROM payout_line_items pli
     WHERE pli.ambassador_id = ? AND pli.transfer_status = 'success'`, [ambassadorId]
  );
  const [paidRequestRows] = await pool.execute(
    "SELECT COALESCE(SUM(requested_amount), 0) AS total FROM payout_requests WHERE ambassador_id = ? AND status = 'paid'",
    [ambassadorId]
  );
  const [requestedRows] = await pool.execute(
    `SELECT COALESCE(SUM(requested_amount), 0) AS total FROM payout_requests
     WHERE ambassador_id = ? AND status IN ('pending', 'approved')`, [ambassadorId]
  );
  const paid = Number(paidRows[0]?.total || 0) + Number(paidRequestRows[0]?.total || 0);
  const pending = Number(requestedRows[0]?.total || 0);
  const roundedEarned = Math.round(earned * 100) / 100;
  return { earned: roundedEarned, paid, pending, available: Math.max(0, Math.round((roundedEarned - paid - pending) * 100) / 100), enrollmentCount: policies.length, renewalCount: renewals.length };
}

module.exports = { getAmbassadorBalance };
