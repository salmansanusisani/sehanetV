require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { ensureSchema } = require("./db/db");
const { authenticate, requireRole } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const groupRoutes = require("./routes/groups");
const zoiRoutes = require("./routes/zoi");
const meRoutes = require("./routes/me");
const paystack = require("./services/paystack");
const paymentHandler = require("./services/enrollment");

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

  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  try {
    const event = payload?.event || "";
    if (event === "charge.success") {
      const data = payload.data || {};
      await paymentHandler.processChargeSuccess(data.metadata || {}, data.reference);
      console.log(`[payment] Webhook processed charge.success ${data.reference || ""}`);
    } else if (event.startsWith("transfer.")) {
      await paymentHandler.reconcileTransfer(payload.data || {});
      console.log(`[payment] Webhook processed ${event}`);
    } else {
      console.log(`[payment] Webhook received unhandled event: ${event || "(none)"}`);
    }
    res.sendStatus(200);
  } catch (err) {
    // Always ack Paystack so it doesn't retry forever; log for manual follow-up.
    console.error("[payment] Webhook processing error:", err.message);
    res.sendStatus(200);
  }
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
      const type = metadata.type || "";

      // The browser callback is a convenience confirmation path; the verified
      // webhook is the real record-creation path. Both go through the same
      // idempotent handler, so duplicate deliveries are safe.
      try {
        await paymentHandler.processChargeSuccess(metadata, reference);
      } catch (err) {
        console.error("Payment callback processing failed:", err.message);
        return res.redirect(`/?payment=failed&ref=${encodeURIComponent(reference)}`);
      }

      return res.redirect(`/?payment=success&type=${encodeURIComponent(type)}&ref=${encodeURIComponent(reference)}`);
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
