require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { pool, ensureSchema } = require("./db/db");
const { authenticate, requireRole } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const groupRoutes = require("./routes/groups");
const zoiRoutes = require("./routes/zoi");
const meRoutes = require("./routes/me");
const paystack = require("./services/paystack");
const wellahealth = require("./services/wellahealthClient");

const app = express();
const PORT = process.env.PORT || 4000;
app.set("trust proxy", 1);

// Baseline browser protections without adding another runtime dependency.
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

const requestBuckets = new Map();
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/auth")) return next();
  const key = req.ip || "unknown";
  const now = Date.now();
  const bucket = requestBuckets.get(key) || { started: now, count: 0 };
  if (now - bucket.started > 15 * 60 * 1000) { bucket.started = now; bucket.count = 0; }
  bucket.count += 1; requestBuckets.set(key, bucket);
  if (bucket.count > 30) return res.status(429).json({ error: "Too many attempts. Please wait 15 minutes and try again." });
  next();
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || origin === "null") {
        callback(null, true);
        return;
      }

      const isLocalhostOrigin = /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
      if (isLocalhostOrigin || allowedOrigins.includes(origin) || (allowedOrigins.length === 0 && process.env.NODE_ENV !== "production")) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
// Paystack signs the exact raw body. Keep this before JSON parsing.
app.post("/payment/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers["x-paystack-signature"] || "";
  const expected = crypto.createHmac("sha512", secret || "").update(req.body).digest("hex");
  if (!secret || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(401).send("Invalid signature");
  // The browser callback remains the record-creation path for now; this
  // verified endpoint is intentionally retained for Paystack delivery/audit
  // and can be extended to queue retries when background workers are added.
  console.log("Verified Paystack webhook:", req.body.toString("utf8").slice(0, 500));
  res.sendStatus(200);
});
app.use(express.json({ limit: "200kb" }));

// Serve the frontend (index.html, app.js, style.css, manual.md) from the same
// server — lets one deployment serve both the API and the UI, no separate
// static server needed. Also fixes cross-origin issues, since the frontend's
// API calls resolve relative to whatever origin the page itself loaded from.
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/payment/callback", async (req, res) => {
  const { reference } = req.query || {};
  if (!reference) {
    return res.redirect("/?payment=failed&reason=missing_reference");
  }

  try {
    const result = await paystack.verifyTransaction(reference);
    const paymentStatus = result?.data?.status || result?.status || null;
    const metadata = result?.data?.metadata || {};

    if (paymentStatus === "success") {
      const { type, firstName, lastName, phoneNumber, planCode, planName, location, gender, dateOfBirth, amountPaid, paymentReference, groupId, userId, customerAccountId, existingCustomerId, email } = metadata;
      const amount = Number(amountPaid || 0);
      const resolvedGroupId = groupId || null;

      if (type === "bulk_enrollment") {
        await require("./routes/zoi").processBulkOrder(metadata.bulkOrderId);
      } else if (type === "enrollment") {
        // Paystack/browser callbacks can be repeated. If this verified payment
        // was already recorded, do not create another policy or commission.
        const [existingPolicyRows] = await pool.execute(
          "SELECT id FROM policies WHERE payment_reference = ? LIMIT 1",
          [paymentReference || reference]
        );
        if (existingPolicyRows[0]) {
          return res.redirect(`/?payment=success&type=${encodeURIComponent(type)}&ref=${encodeURIComponent(reference)}`);
        }
        const whResult = await wellahealth.createSubscription({
          amountPaid: amount,
          firstName,
          lastName,
          phoneNumber,
          planCode,
          email: metadata.email || "",
          location,
          gender,
          dateOfBirth,
          paymentReference: paymentReference || reference,
        });

        await require("./routes/zoi").createEnrollmentRecord({
          userId,
          customerAccountId,
          existingCustomerId,
          firstName,
          lastName,
          phoneNumber,
          email: metadata.email || "",
          planCode,
          planName,
          location,
          gender,
          dateOfBirth,
          amountPaid: amount,
          paymentReference: paymentReference || reference,
          resolvedGroupId,
          wellahealthResult: whResult,
        });
      } else if (type === "renewal") {
        const whResult = await wellahealth.renewSubscription({
          phoneNumber,
          planCode,
          amountPaid: amount,
          paymentReference: paymentReference || reference,
        });
        const [customerRows] = await pool.execute("SELECT * FROM customers WHERE phone = ?", [phoneNumber]);
        const customer = customerRows[0];
        if (customer) {
          const [policyRows] = await pool.execute(
            "SELECT * FROM policies WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1",
            [customer.id]
          );
          const policy = policyRows[0];
          if (policy) {
            await pool.execute(
              `INSERT INTO renewals (policy_id, processed_by_agent_id, amount_paid, payment_reference, new_end_date)
               VALUES (?, ?, ?, ?, ?)`,
              [policy.id, userId, amount, paymentReference || reference, whResult.endDate || null]
            );
            await pool.execute("UPDATE policies SET end_date = ?, status = ? WHERE id = ?", [
              whResult.endDate || policy.end_date,
              whResult.status || policy.status,
              policy.id,
            ]);
          }
        }
      }

      return res.redirect(`/?payment=success&type=${encodeURIComponent(type || "")}&ref=${encodeURIComponent(reference)}`);
    }

    return res.redirect(`/?payment=failed&ref=${encodeURIComponent(reference)}`);
  } catch (err) {
    console.error("Payment callback failed:", err);
    return res.redirect(`/?payment=failed&ref=${encodeURIComponent(reference)}`);
  }
});

// Public
app.use("/api/auth", authRoutes);

// Everything below requires a valid, active login
app.use("/api", authenticate);

// Admin-only
app.use("/api/admin", requireRole("admin"), adminRoutes);

// Any logged-in agent/ambassador/admin
app.use("/api/groups", groupRoutes);
app.use("/api", zoiRoutes);
app.use("/api", meRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  try {
    await ensureSchema();
    app.listen(PORT, () => {
      console.log(`SehaNet server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server (schema setup failed):", err);
    process.exit(1);
  }
}

start();
