const { verifyToken } = require("../utils/jwt");
const { pool } = require("../db/db");

async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query.token || null);

  if (!token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header or token" });
  }

  try {
    const payload = verifyToken(token);
    // Re-check current status on every request — a blocked/removed user's
    // existing token should stop working immediately, not just at next login.
    let user;
    if (payload.accountType === "customer") {
      const [rows] = await pool.execute(
        `SELECT ca.id, ca.customer_id, c.full_name as name, ca.username, ca.status, 'customer' as role
         FROM customer_accounts ca JOIN customers c ON c.id = ca.customer_id WHERE ca.id = ?`,
        [payload.id]
      );
      user = rows[0];
      if (user) user.accountType = "customer";
    } else {
      const [rows] = await pool.execute(
        "SELECT id, name, username, role, status FROM users WHERE id = ?",
        [payload.id]
      );
      user = rows[0];
      if (user) user.accountType = "staff";
    }

    if (!user || user.status !== "active") {
      return res.status(403).json({ error: "Account is not active" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have access to this resource" });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
