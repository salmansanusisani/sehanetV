-- SehaNet database schema (MySQL / InnoDB)
--
-- Converted from the original SQLite schema. Key differences:
-- - INT AUTO_INCREMENT instead of INTEGER PRIMARY KEY AUTOINCREMENT
-- - DATETIME DEFAULT CURRENT_TIMESTAMP instead of TEXT DEFAULT (datetime('now'))
-- - DECIMAL(12,2) instead of REAL for every money column, to avoid float rounding
--   errors in commission math
-- - Indexes are declared inline (KEY ...) inside CREATE TABLE, since MySQL doesn't
--   support "CREATE INDEX IF NOT EXISTS" the way SQLite does
-- - CHECK constraints are kept as-is (supported since MySQL 8.0.16). If you're on
--   an older MySQL version, convert the CHECK'd columns below to ENUM(...) instead.
-- - The settings table's key column is renamed setting_key, since KEY is a
--   reserved word in MySQL

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(32),
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'agent', 'ambassador')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'removed')),

  -- Ambassadors only
  commission_rate_new DECIMAL(6,2),
  commission_rate_renewal DECIMAL(6,2),
  bank_code VARCHAR(20),
  bank_account_number VARCHAR(32),
  bank_account_name VARCHAR(255),
  paystack_recipient_code VARCHAR(100),
  reassigned_to INT,

  block_reason TEXT,
  remove_reason TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_users_reassigned_to FOREIGN KEY (reassigned_to) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS groups_ (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('Bank', 'Market', 'School', 'Association', 'Other')),
  ambassador_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_groups_ambassador FOREIGN KEY (ambassador_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(255),
  location VARCHAR(255),
  dob DATE,
  gender VARCHAR(10) CHECK (gender IN ('Male', 'Female')),
  group_id INT,
  follow_up_status VARCHAR(30) NOT NULL DEFAULT 'new',
  follow_up_notes TEXT,
  last_contacted_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_customers_group FOREIGN KEY (group_id) REFERENCES groups_(id),
  UNIQUE KEY uniq_customers_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS policies (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  original_agent_id INT,
  customer_account_id INT,
  plan_code VARCHAR(50) NOT NULL,
  plan_name VARCHAR(255),
  price_at_enrollment DECIMAL(12,2),
  wellahealth_policy_number VARCHAR(100),
  status VARCHAR(20) DEFAULT 'Active',
  start_date DATE,
  end_date DATE,
  payment_reference VARCHAR(100),
  amount_paid DECIMAL(12,2),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_policies_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_policies_agent FOREIGN KEY (original_agent_id) REFERENCES users(id),
  KEY idx_policies_customer (customer_id),
  KEY idx_policies_agent (original_agent_id),
  UNIQUE KEY uniq_policies_payment_reference (payment_reference)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_accounts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL UNIQUE,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_customer_accounts_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payout_requests (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ambassador_id INT NOT NULL,
  requested_amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  note TEXT,
  admin_note TEXT,
  reviewed_by INT,
  reviewed_at DATETIME,
  paystack_transfer_code VARCHAR(100),
  paid_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payout_requests_ambassador FOREIGN KEY (ambassador_id) REFERENCES users(id),
  CONSTRAINT fk_payout_requests_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id),
  KEY idx_payout_requests_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id),
  KEY idx_notifications_user (user_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bulk_orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ambassador_id INT NOT NULL,
  group_id INT,
  payment_reference VARCHAR(100) UNIQUE,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_payment', 'paid', 'processing', 'completed', 'partially_completed', 'failed')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME,
  CONSTRAINT fk_bulk_orders_ambassador FOREIGN KEY (ambassador_id) REFERENCES users(id),
  CONSTRAINT fk_bulk_orders_group FOREIGN KEY (group_id) REFERENCES groups_(id),
  KEY idx_bulk_orders_ambassador (ambassador_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bulk_order_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  bulk_order_id INT NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(255),
  plan_code VARCHAR(50) NOT NULL,
  plan_name VARCHAR(255),
  location VARCHAR(255) NOT NULL,
  gender VARCHAR(10) NOT NULL,
  date_of_birth DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  error_message TEXT,
  policy_id INT,
  CONSTRAINT fk_bulk_items_order FOREIGN KEY (bulk_order_id) REFERENCES bulk_orders(id),
  CONSTRAINT fk_bulk_items_policy FOREIGN KEY (policy_id) REFERENCES policies(id),
  KEY idx_bulk_items_order (bulk_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS renewals (
  id INT PRIMARY KEY AUTO_INCREMENT,
  policy_id INT NOT NULL,
  processed_by_agent_id INT NOT NULL,
  amount_paid DECIMAL(12,2),
  payment_reference VARCHAR(100),
  new_end_date DATE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_renewals_policy FOREIGN KEY (policy_id) REFERENCES policies(id),
  CONSTRAINT fk_renewals_agent FOREIGN KEY (processed_by_agent_id) REFERENCES users(id),
  KEY idx_renewals_policy (policy_id),
  UNIQUE KEY uniq_renewals_payment_reference (payment_reference)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  value VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payouts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  week_label VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  approved_by INT,
  approved_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_payouts_approved_by FOREIGN KEY (approved_by) REFERENCES users(id),
  UNIQUE KEY uniq_payouts_week (week_label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payout_line_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  payout_id INT NOT NULL,
  ambassador_id INT NOT NULL,
  enrollment_count INT DEFAULT 0,
  renewal_count INT DEFAULT 0,
  amount DECIMAL(12,2) DEFAULT 0,
  transfer_status VARCHAR(20) DEFAULT 'pending' CHECK (transfer_status IN ('pending', 'success', 'failed')),
  paystack_transfer_code VARCHAR(100),

  CONSTRAINT fk_payout_line_items_payout FOREIGN KEY (payout_id) REFERENCES payouts(id),
  CONSTRAINT fk_payout_line_items_ambassador FOREIGN KEY (ambassador_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Commission ledger: snapshots each commission event at the moment of the
-- sale, so changing commission settings later never rewrites history.
-- `reference` is prefixed with the event type (e.g. "enrollment:REF",
-- "renewal:REF") and is UNIQUE so duplicate webhook/callback deliveries are
-- no-ops.
CREATE TABLE IF NOT EXISTS commission_ledger (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ambassador_id INT NOT NULL,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('enrollment', 'renewal')),
  plan_price DECIMAL(12,2) NOT NULL,
  wellahealth_percent DECIMAL(6,2) NOT NULL,
  ambassador_percent DECIMAL(6,2) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reference VARCHAR(120) NOT NULL,
  policy_id INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_ledger_ambassador FOREIGN KEY (ambassador_id) REFERENCES users(id),
  CONSTRAINT fk_ledger_policy FOREIGN KEY (policy_id) REFERENCES policies(id),
  UNIQUE KEY uniq_ledger_reference (reference),
  KEY idx_ledger_ambassador (ambassador_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
