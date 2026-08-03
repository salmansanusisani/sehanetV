require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool, ensureSchema } = require("./db");

async function seed() {
  await ensureSchema();

  const {
    SEED_ADMIN_USERNAME = "admin",
    SEED_ADMIN_PASSWORD = "changeme",
    SEED_ADMIN_NAME = "Admin",
  } = process.env;

  const [existingAdminRows] = await pool.execute(
    "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
  );

  if (existingAdminRows.length === 0) {
    const hash = bcrypt.hashSync(SEED_ADMIN_PASSWORD, 10);
    await pool.execute(
      `INSERT INTO users (name, username, password_hash, role, status)
       VALUES (?, ?, ?, 'admin', 'active')`,
      [SEED_ADMIN_NAME, SEED_ADMIN_USERNAME, hash]
    );
    console.log(`Admin account created — username: ${SEED_ADMIN_USERNAME}`);
  } else {
    console.log("Admin account already exists — skipping.");
  }

  const defaultSettings = {
    wellahealth_commission_percent: "20",
    ambassador_new_percent: "30",
    ambassador_renewal_percent: "15",
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    // Insert-if-absent: this is a no-op update (not DO UPDATE), matching the
    // original SQLite "ON CONFLICT DO NOTHING" behavior — we never want to
    // silently overwrite a rate someone has already configured.
    await pool.execute(
      `INSERT INTO settings (setting_key, value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_key = setting_key`,
      [key, value]
    );
  }

  console.log("Default commission settings ensured:", defaultSettings);
  console.log("Seed complete.");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
