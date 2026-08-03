const jwt = require("jsonwebtoken");

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, username: user.username, accountType: user.accountType || "staff" },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
