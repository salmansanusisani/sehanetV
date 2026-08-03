const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config();

const {
  DB_HOST = "localhost",
  DB_PORT = "3306",
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
} = process.env;

if (!DB_USER || !DB_NAME) {
  console.warn(
    "[db] Missing DB_USER / DB_NAME in .env — MySQL connections will fail until these are set."
  );
}

const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(DB_PORT) || 3306,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true, // return DATE/DATETIME columns as strings, matching the old SQLite text-based dates
});

/**
 * Applies schema.sql on startup. Split into individual statements since
 * mysql2 doesn't run multiple statements per query() call by default (and we
 * deliberately don't enable multipleStatements, since that flag also makes
 * the connection more vulnerable to SQL injection if ever misused elsewhere).
 */
async function ensureSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await pool.query(statement);
  }

  // `CREATE TABLE IF NOT EXISTS` cannot add fields to databases created by an
  // earlier SehaNet version. Keep these migrations additive so deployment
  // upgrades preserve existing customer and policy records.
  await ensureColumn("customers", "email", "VARCHAR(255)");
  await ensureColumn("customers", "location", "VARCHAR(255)");
  await ensureColumn("customers", "follow_up_status", "VARCHAR(30) NOT NULL DEFAULT 'new'");
  await ensureColumn("customers", "follow_up_notes", "TEXT");
  await ensureColumn("customers", "last_contacted_at", "DATETIME");
  await ensureColumn("policies", "customer_account_id", "INT NULL");
  await ensureColumn("payout_requests", "paystack_transfer_code", "VARCHAR(100)");
  await ensureColumn("payout_requests", "paid_at", "DATETIME");
  await pool.query("ALTER TABLE policies MODIFY original_agent_id INT NULL");
}

async function ensureColumn(tableName, columnName, definition) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tableName, columnName]
  );
  if (!rows[0]) {
    await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  }
}

module.exports = { pool, ensureSchema };
