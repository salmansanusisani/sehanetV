/**
 * In-memory failed-login lockout. After MAX_ATTEMPTS failed logins for a
 * username, that username is locked for LOCK_MS. Per-username, so an attacker
 * brute-forcing one account can't lock out everyone, and a random-IP spray
 * across many usernames is still bounded by the IP rate limiter in index.js.
 */
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

const attempts = new Map(); // username(lower) -> { count, lockedUntil }

function isLocked(username) {
  const key = String(username || "").toLowerCase().trim();
  if (!key) return false;
  const rec = attempts.get(key);
  if (!rec) return false;
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) return true;
  if (rec.lockedUntil && Date.now() >= rec.lockedUntil) {
    attempts.delete(key);
  }
  return false;
}

function lockedUntilMs(username) {
  const key = String(username || "").toLowerCase().trim();
  return attempts.get(key)?.lockedUntil || 0;
}

/**
 * Record a failed attempt. Returns { attemptsLeft, lockedUntilMs } so the
 * caller can show a friendly "X attempts remaining" message.
 */
function recordFailure(username) {
  const key = String(username || "").toLowerCase().trim();
  const rec = attempts.get(key) || { count: 0, lockedUntil: null };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCK_MS;
  }
  attempts.set(key, rec);
  return {
    attemptsLeft: rec.lockedUntil ? 0 : Math.max(0, MAX_ATTEMPTS - rec.count),
    lockedUntilMs: rec.lockedUntil || 0,
  };
}

function resetFailures(username) {
  attempts.delete(String(username || "").toLowerCase().trim());
}

module.exports = { isLocked, lockedUntilMs, recordFailure, resetFailures, MAX_ATTEMPTS };
