const express = require("express");
const { pool } = require("../db/db");
const { verifyPassword, hashPassword } = require("../utils/password");
const { signToken } = require("../utils/jwt");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  try {
    const [rows] = await pool.execute("SELECT * FROM users WHERE username = ?", [username]);
    const user = rows[0];

    if (user && verifyPassword(password, user.password_hash)) {
      if (user.status !== "active") {
        return res.status(403).json({
          error: user.status === "blocked" ? "Your account has been blocked. Contact the admin." : "Your account is no longer active.",
        });
      }

      const token = signToken(user);
      return res.json({ token, user: { id: user.id, name: user.name, username: user.username, role: user.role } });
    }

    const [customerRows] = await pool.execute(
      `SELECT ca.id, ca.customer_id, ca.username, ca.password_hash, ca.status, c.full_name
       FROM customer_accounts ca JOIN customers c ON c.id = ca.customer_id
       WHERE ca.username = ?`,
      [username]
    );
    const customer = customerRows[0];
    if (!customer || !verifyPassword(password, customer.password_hash)) {
      return res.status(401).json({ error: "Incorrect username or password" });
    }
    if (customer.status !== "active") {
      return res.status(403).json({ error: "Your account is not active. Contact support." });
    }

    res.json({
      token: signToken({ id: customer.id, name: customer.full_name, username: customer.username, role: "customer", accountType: "customer" }),
      user: {
        id: customer.id,
        name: customer.full_name,
        username: customer.username,
        role: "customer",
      },
    });
  } catch (err) {
    console.error("Login failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/register", async (req, res) => {
  const { fullName, phone, email, username, password, location, gender, dateOfBirth } = req.body || {};
  if (!fullName || !phone || !email || !username || !password || !location || !gender || !dateOfBirth) {
    return res.status(400).json({ error: "Please complete all registration fields." });
  }
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  if (!['Male', 'Female'].includes(gender)) return res.status(400).json({ error: "Please choose a valid gender." });

  let connection;
  try {
    const [userRows] = await pool.execute("SELECT id FROM users WHERE username = ?", [username]);
    const [accountRows] = await pool.execute("SELECT id FROM customer_accounts WHERE username = ?", [username]);
    const [phoneRows] = await pool.execute("SELECT id FROM customers WHERE phone = ?", [phone]);
    if (userRows[0] || accountRows[0]) return res.status(409).json({ error: "That username is already taken." });
    if (phoneRows[0]) return res.status(409).json({ error: "This phone number already has a customer record. Please contact support to activate your account." });

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [customerResult] = await connection.execute(
      `INSERT INTO customers (full_name, phone, email, location, dob, gender, follow_up_status)
       VALUES (?, ?, ?, ?, ?, ?, 'self_registered')`,
      [fullName.trim(), phone.trim(), email.trim().toLowerCase(), location.trim(), dateOfBirth, gender]
    );
    const [accountResult] = await connection.execute(
      "INSERT INTO customer_accounts (customer_id, username, password_hash) VALUES (?, ?, ?)",
      [customerResult.insertId, username.trim(), hashPassword(password)]
    );
    await connection.commit();
    connection.release();
    connection = null;

    const user = { id: accountResult.insertId, name: fullName.trim(), username: username.trim(), role: "customer", accountType: "customer" };
    res.status(201).json({ token: signToken(user), user: { id: user.id, name: user.name, username: user.username, role: user.role } });
  } catch (err) {
    if (connection) { await connection.rollback(); connection.release(); }
    console.error("Customer registration failed:", err);
    res.status(500).json({ error: "We could not create your account. Please try again." });
  }
});

module.exports = router;
