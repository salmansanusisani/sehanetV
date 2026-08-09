const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config();

const {
  DB_HOST: configuredDbHost,
  DB_PORT: configuredDbPort,
  DB_USER: configuredDbUser,
  DB_PASSWORD: configuredDbPassword,
  DB_NAME: configuredDbName,
} = process.env;

const DB_HOST = configuredDbHost || process.env.MYSQLHOST || process.env.MYSQL_HOST || "localhost";
const DB_PORT = configuredDbPort || process.env.MYSQLPORT || process.env.MYSQL_PORT || "3306";
const DB_USER = configuredDbUser || process.env.MYSQLUSER || process.env.MYSQL_USER || process.env.MYSQL_USERNAME || "root";
const DB_PASSWORD = configuredDbPassword || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || "";
const DB_NAME = configuredDbName || process.env.MYSQLDATABASE || process.env.MYSQL_DB || process.env.MYSQL_DATABASE || "sehanet";

if (!configuredDbUser && !process.env.MYSQLUSER && !process.env.MYSQL_HOST) {
  console.warn(
    "[db] Using local MySQL defaults. Set DB_* or Railway MYSQL* variables to connect successfully in production."
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
  await ensureColumn("policies", "payment_fee", "DECIMAL(12,2) NOT NULL DEFAULT 0");
  await ensureColumn("renewals", "payment_fee", "DECIMAL(12,2) NOT NULL DEFAULT 0");
  await ensureColumn("bulk_orders", "payment_fee", "DECIMAL(12,2) NOT NULL DEFAULT 0");
  await ensureColumn("payout_requests", "paystack_transfer_code", "VARCHAR(100)");
  await ensureColumn("payout_requests", "paid_at", "DATETIME");
  await pool.query("ALTER TABLE policies MODIFY original_agent_id INT NULL");

  // Idempotency guards: unique indexes so duplicate webhook/callback
  // deliveries cannot create a second policy, renewal, or customer.
  await ensureUniqueIndex("customers", "uniq_customers_phone", "phone");
  await ensureUniqueIndex("policies", "uniq_policies_payment_reference", "payment_reference");
  await ensureUniqueIndex("renewals", "uniq_renewals_payment_reference", "payment_reference");
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

async function ensureUniqueIndex(tableName, indexName, columnName) {
  const [indexRows] = await pool.execute(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [tableName, indexName]
  );
  if (indexRows[0]) return;

  // Refuse to add a unique index if existing rows would violate it.
  const [dupRows] = await pool.execute(
    `SELECT ${columnName}, COUNT(*) AS c FROM \`${tableName}\`
     WHERE ${columnName} IS NOT NULL
     GROUP BY ${columnName} HAVING c > 1 LIMIT 1`
  );
  if (dupRows[0]) {
    console.warn(
      `[db] Skipping UNIQUE index ${indexName} on ${tableName}.${columnName}: ` +
        `existing duplicates exist (e.g. value '${dupRows[0][columnName]}'). ` +
        `Deduplicate data manually, then re-run npm run seed.`
    );
    return;
  }

  await pool.query(
    `ALTER TABLE \`${tableName}\` ADD UNIQUE INDEX \`${indexName}\` (\`${columnName}\`)`
  );
}

module.exports = { pool, ensureSchema };
