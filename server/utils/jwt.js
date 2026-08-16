const jwt = require("jsonwebtoken");

function getExpiresIn() {
  const val = (process.env.JWT_EXPIRES_IN || "").trim();
  if (/^\d+[smhdw]$/i.test(val) || (!Number.isNaN(Number(val)) && Number(val) > 0)) {
    return val;
  }
  return "12h";
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, username: user.username, accountType: user.accountType || "staff" },
    process.env.JWT_SECRET || "default_secret",
    { expiresIn: getExpiresIn() }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
