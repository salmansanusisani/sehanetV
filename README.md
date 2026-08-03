# SehaNet

Full app: auth, agent/ambassador management, groups, WellaHealth-tied enrollment/renewal
via Paystack checkout, commission engine, weekly payouts with real Paystack transfers,
search/filter, renewals-due tracking, an onboarding tour, and an in-app manual.

Now running on **MySQL** instead of SQLite, and served as one combined app (API + frontend
on the same port — no separate static server needed).

## What changed in this build

- **Migrated SQLite → MySQL.** Every database call is now async (`mysql2/promise`).
  See `server/db/schema.sql` for the converted schema — money columns are now
  `DECIMAL(12,2)` instead of `REAL`, to avoid float rounding issues in commission math.
- **One server serves everything.** `server/index.js` now serves `public/` via
  `express.static`, so you just run the backend and open one URL — no more running
  a separate `python3 -m http.server` for the frontend.
- **Plan prices are resolved server-side.** `POST /subscriptions` and
  `POST /subscriptions/renewals` no longer trust a client-submitted `amountPaid` —
  they look up the real price from WellaHealth's plan list by `planCode`.
- **Payment callback redirects back into the app** with a `?payment=success` or
  `?payment=failed` banner, instead of showing raw JSON.
- **Onboarding tour** (via driver.js) shows automatically on first login per user,
  with a Skip option and a "Retake Tour" button in the top bar.
- **Read Manual** — a persistent link at the bottom of the nav renders `public/manual.md`
  right inside the app.

## Setup

### 1. Create the MySQL database

On Hostinger (or wherever you're hosting), create a database and a user with full
privileges on it via hPanel (or `CREATE DATABASE sehanet;` if you have direct access).

### 2. Configure the server

```bash
cd server
npm install
cp .env.example .env
```

Fill in `.env`:
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — your MySQL connection details
- `WELLAHEALTH_CLIENT_ID` / `WELLAHEALTH_CLIENT_SECRET` — real credentials
- `PAYSTACK_SECRET_KEY` — your live secret key
- `JWT_SECRET` — a long random string
- `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` — your first admin login
- `APP_BASE_URL` — the public URL this server will be reachable at (needed so Paystack's
  payment callback redirects to the right place). Leave blank for local-only testing.

### 3. Create the schema + admin account

```bash
npm run seed
```

This connects to MySQL, creates every table if it doesn't exist yet, and creates your
first admin account.

### 4. Start it

```bash
npm start
```

Open `http://localhost:4000` (or wherever it's hosted) — that's it, one URL for both
the app and the API. Log in with your admin credentials from `.env`.

## Production deployment guide

Use this sequence on Hostinger or another Node.js-capable host. Start with
Paystack test credentials; do not use live money until the test checklist passes.

### Requirements

- A domain with HTTPS, for example `https://app.example.com`.
- Node.js 20 LTS or newer and MySQL 8.0+.
- A MySQL user restricted to the SehaNet database only.

### Database

In the hosting panel, create a new MySQL database (for example `sehanet_prod`),
create a dedicated user with a strong password, and give it privileges only on
that database. Record its host, port, name, username, and password. Do not make
MySQL publicly accessible.

The application creates and updates its tables safely when you run `npm run seed`.

### Install and environment configuration

Upload the project without `.env`, then run:

```bash
cd server
npm ci
cp .env.example .env
```

Set these values in `server/.env` or your host's environment-variable screen:

```env
NODE_ENV=production
PORT=4000
APP_BASE_URL=https://app.example.com
ALLOWED_ORIGINS=https://app.example.com

DB_HOST=your-mysql-host
DB_PORT=3306
DB_NAME=sehanet_prod
DB_USER=sehanet_app
DB_PASSWORD=a-long-unique-database-password

JWT_SECRET=a-long-random-secret-at-least-32-characters
JWT_EXPIRES_IN=12h
SEED_ADMIN_USERNAME=your-first-admin-username
SEED_ADMIN_PASSWORD=a-long-unique-admin-password
SEED_ADMIN_NAME=Administrator

WELLAHEALTH_BASE_URL=https://api.wellahealth.com
WELLAHEALTH_CLIENT_ID=your-wellahealth-client-id
WELLAHEALTH_CLIENT_SECRET=your-wellahealth-client-secret
PAYSTACK_SECRET_KEY=your-paystack-test-or-live-secret-key
PAYSTACK_WEBHOOK_SECRET=your-paystack-test-or-live-secret-key
```

Generate `JWT_SECRET` with `openssl rand -base64 48`. Never commit `.env` or
place its contents in a public chat, screenshot, or repository.

### Start the production app

Run the schema migration and create the first admin:

```bash
cd server
npm run seed
```

Configure the hosting Node application with `server/index.js` as its startup
file and `NODE_ENV=production`. Route your HTTPS domain to the application's
`PORT`. The app serves both frontend and API; no second web server is required.

### Paystack configuration

In the matching Paystack test/live dashboard:

1. Set the callback domain to `APP_BASE_URL`.
2. Set the webhook URL to `https://app.example.com/payment/webhook`.
3. Verify that ambassador bank details before any payout.
4. Compare every test payment and transfer with the Paystack dashboard.

### Backups, updates, and launch checks

- Enable daily MySQL backups and test restoring one before launch.
- Before an update: back up MySQL, upload the release, run `npm ci`, run
  `npm run seed`, and restart the Node application.
- Test admin, agent, ambassador, and customer permissions; single enrollment,
  renewal, failed payment, bulk enrollment, payout request, test transfer,
  duplicate callback, and two simultaneous browser enrollments.
- Switch to live WellaHealth/Paystack keys only after all test cases pass.

## Migrating your existing SQLite data

This build does **not** automatically migrate your old `sehanet.db` data into MySQL —
schema and data types changed too much for a safe automatic copy (e.g. money columns
moving from `REAL` to `DECIMAL`). If you have real ambassadors/customers/policies in the
old SQLite file you need preserved, don't discard it — flag that back to me and we'll
write a one-off migration script together rather than risk quietly losing or corrupting
data with a rushed conversion.

## Notes

- The `.env` file holds real secrets (WellaHealth, Paystack, JWT, DB password) —
  never commit it.
- Money math happens entirely server-side — the frontend never calculates or sends a
  price, only a `planCode`.
- The onboarding tour and manual link are static/client-side — no backend changes
  needed if you want to edit the tour text or manual content later; just edit
  `public/app.js` (search `TOUR_STEPS_BY_ROLE`) or `public/manual.md` directly.

## Production launch checklist

- Use HTTPS and set `APP_BASE_URL` to the final `https://` domain.
- Set `NODE_ENV=production` and explicitly set `ALLOWED_ORIGINS` to that domain.
- Use live WellaHealth and Paystack keys only after completing all Paystack test-mode flows.
- In Paystack, configure the webhook URL as `https://YOUR-DOMAIN/payment/webhook`.
- Back up the MySQL database daily and restrict database access to the application host.
- Test: staff login, customer registration, one enrollment, renewal, bulk enrollment,
  payout request, approved transfer, failed payment, and simultaneous enrollment attempts.
- Do not launch until every real Paystack transfer is confirmed in the Paystack dashboard.
