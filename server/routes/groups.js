const express = require("express");
const { pool } = require("../db/db");

const router = express.Router();

const GROUP_TYPES = ["Bank", "Market", "School", "Association", "Other"];

// Create a group — ambassador only, one owner per group
router.post("/", async (req, res) => {
  if (req.user.role !== "ambassador") {
    return res.status(403).json({ error: "Only ambassadors create groups" });
  }
  const { name, type } = req.body || {};
  if (!name || !type) {
    return res.status(400).json({ error: "name and type are required" });
  }
  if (!GROUP_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${GROUP_TYPES.join(", ")}` });
  }

  try {
    const [result] = await pool.execute(
      "INSERT INTO groups_ (name, type, ambassador_id) VALUES (?, ?, ?)",
      [name, type, req.user.id]
    );
    res.status(201).json({ id: result.insertId, name, type, ambassador_id: req.user.id });
  } catch (err) {
    console.error("Group creation failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List my own groups — ambassador only
router.get("/mine", async (req, res) => {
  if (req.user.role !== "ambassador") {
    return res.status(403).json({ error: "Only ambassadors have groups" });
  }
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM groups_ WHERE ambassador_id = ? ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to load groups:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
