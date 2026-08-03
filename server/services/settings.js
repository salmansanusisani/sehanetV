const { pool } = require("../db/db");

async function getAllSettings() {
  const [rows] = await pool.execute("SELECT setting_key, value FROM settings");
  const out = {};
  for (const r of rows) out[r.setting_key] = r.value;
  return out;
}

async function getSetting(key) {
  const [rows] = await pool.execute("SELECT value FROM settings WHERE setting_key = ?", [key]);
  return rows.length ? rows[0].value : null;
}

async function setSetting(key, value) {
  await pool.execute(
    `INSERT INTO settings (setting_key, value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [key, String(value)]
  );
}

module.exports = { getAllSettings, getSetting, setSetting };
