const bcrypt = require("bcryptjs");

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
