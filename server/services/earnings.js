const { pool } = require("../db/db");

/**
 * Ambassador balance, derived from the frozen commission_ledger rather than
 * recomputed from live settings. `paid` counts successful transfers
 * (payout_line_items + paid payout_requests); `pending` counts open payout
 * requests. Pass `{ excludeRequestId }` to ignore one specific request when
 * validating whether it can still be approved.
 */
async function getAmbassadorBalance(ambassadorId, opts = {}) {
  const [users] = await pool.execute("SELECT * FROM users WHERE id = ? AND role = 'ambassador'", [ambassadorId]);
  const ambassador = users[0];
  if (!ambassador) return null;

  const [earnedRows] = await pool.execute(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM commission_ledger WHERE ambassador_id = ?",
    [ambassadorId]
  );

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

  let pending = Number(requestedRows[0]?.total || 0);
  if (opts.excludeRequestId) {
    const [excludedRows] = await pool.execute(
      "SELECT requested_amount FROM payout_requests WHERE id = ? AND ambassador_id = ?",
      [opts.excludeRequestId, ambassadorId]
    );
    if (excludedRows[0]) {
      pending = Math.max(0, pending - Number(excludedRows[0].requested_amount || 0));
    }
  }

  const earned = Math.round(Number(earnedRows[0]?.total || 0) * 100) / 100;
  const paid = Number(paidRows[0]?.total || 0) + Number(paidRequestRows[0]?.total || 0);
  return {
    earned,
    paid,
    pending,
    available: Math.max(0, Math.round((earned - paid - pending) * 100) / 100),
    enrollmentCount: 0,
    renewalCount: 0,
  };
}

module.exports = { getAmbassadorBalance };
