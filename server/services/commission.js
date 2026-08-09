const { pool } = require("../db/db");
const { getAllSettings } = require("./settings");

/**
 * Given the agent/ambassador who originally enrolled a customer, figure out
 * who should actually be credited for commission right now.
 *
 * - Unpaid agents never earn commission — returns null.
 * - An active ambassador is credited to themselves.
 * - A removed ambassador's *future* commission moves to whoever they were
 *   reassigned to (following the chain, in case that person was also
 *   later removed and reassigned again).
 */
async function resolveCreditedAmbassador(originalAgentId) {
  async function getUser(id) {
    const [rows] = await pool.execute(
      "SELECT id, role, status, reassigned_to FROM users WHERE id = ?",
      [id]
    );
    return rows[0] || null;
  }

  let user = await getUser(originalAgentId);
  if (!user || user.role !== "ambassador") return null;

  const visited = new Set();
  while (user.status === "removed" && user.reassigned_to && !visited.has(user.id)) {
    visited.add(user.id);
    const next = await getUser(user.reassigned_to);
    if (!next || next.role !== "ambassador") break;
    user = next;
  }

  return user.status === "removed" ? null : user.id;
}

/**
 * Commission = (plan price) x (WellaHealth's cut %) x (ambassador's rate %)
 * — the ambassador's rate applies to the admin's WellaHealth cut, not the
 * full customer payment.
 */
async function calculateCommission(planPrice, eventType, ambassadorOverrides = {}) {
  const settings = await getAllSettings();
  const whPercent = parseFloat(settings.wellahealth_commission_percent || "0");

  const ratePercent =
    eventType === "renewal"
      ? ambassadorOverrides.commission_rate_renewal ??
        parseFloat(settings.ambassador_renewal_percent || "0")
      : ambassadorOverrides.commission_rate_new ??
        parseFloat(settings.ambassador_new_percent || "0");

  const whCut = (planPrice || 0) * (whPercent / 100);
  const commission = whCut * (ratePercent / 100);
  return Math.round(commission * 100) / 100;
}

/**
 * Snapshot one commission event into the ledger. The rates used are the ones
 * in effect right now (per-ambassador override, else global settings) and are
 * stored alongside the amount, so later settings changes never rewrite what a
 * sale earned. Idempotent: `reference` is unique (prefixed with the event
 * type), so duplicate webhook/callback deliveries are a no-op.
 *
 * Returns the ledger row info, or null when no commission applies (unpaid
 * agent, removed ambassador, no ambassador).
 */
async function createCommissionEntry({ ambassadorId, eventType, planPrice, reference, policyId }) {
  if (!ambassadorId) return null;

  const [users] = await pool.execute(
    "SELECT * FROM users WHERE id = ? AND role = 'ambassador'",
    [ambassadorId]
  );
  const ambassador = users[0];
  if (!ambassador || ambassador.status === "removed") return null;

  const settings = await getAllSettings();
  const whPercent = parseFloat(settings.wellahealth_commission_percent || "0");
  const ratePercent =
    eventType === "renewal"
      ? ambassador.commission_rate_renewal ??
        parseFloat(settings.ambassador_renewal_percent || "0")
      : ambassador.commission_rate_new ??
        parseFloat(settings.ambassador_new_percent || "0");

  const amount = Math.round(
    (Number(planPrice || 0) * (whPercent / 100) * (ratePercent / 100)) * 100
  ) / 100;

  const ledgerReference = `${eventType}:${reference}`;
  await pool.execute(
    `INSERT INTO commission_ledger
       (ambassador_id, event_type, plan_price, wellahealth_percent, ambassador_percent, amount, reference, policy_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [ambassadorId, eventType, Number(planPrice || 0), whPercent, ratePercent, amount, ledgerReference, policyId || null]
  );

  return { ambassadorId, eventType, amount, reference: ledgerReference };
}

module.exports = { resolveCreditedAmbassador, calculateCommission, createCommissionEntry };
