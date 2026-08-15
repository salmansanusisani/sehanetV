const axios = require("axios");

const {
  WELLAHEALTH_BASE_URL,
  WELLAHEALTH_CLIENT_ID,
  WELLAHEALTH_CLIENT_SECRET,
} = process.env;

if (!WELLAHEALTH_BASE_URL || !WELLAHEALTH_CLIENT_ID || !WELLAHEALTH_CLIENT_SECRET) {
  console.warn(
    "[wellahealthClient] Missing WELLAHEALTH_BASE_URL / CLIENT_ID / CLIENT_SECRET in .env — " +
      "WellaHealth calls will fail until these are set."
  );
}

const client = axios.create({
  baseURL: WELLAHEALTH_BASE_URL,
  auth: {
    username: WELLAHEALTH_CLIENT_ID,
    password: WELLAHEALTH_CLIENT_SECRET,
  },
  headers: { Accept: "application/json" },
  timeout: 15000,
});

async function request(config) {
  try {
    const response = await client.request(config);
    return response.data;
  } catch (err) {
    if (err.response) {
      const normalized = new Error(
        err.response.data?.title || err.response.data?.detail || "WellaHealth API error"
      );
      normalized.status = err.response.status;
      normalized.body = err.response.data;
      throw normalized;
    }
    if (err.request) {
      const normalized = new Error("No response from WellaHealth API (network/timeout)");
      normalized.status = 502;
      throw normalized;
    }
    throw err;
  }
}

// The plan list rarely changes; cache it so `resolvePlanPrice` doesn't hit
// the WellaHealth API on every single enrollment/renewal request.
const PLANS_TTL_MS = 15 * 60 * 1000;
let plansCache = { fetchedAt: 0, data: null };

async function getHealthPlansCached() {
  const now = Date.now();
  if (plansCache.data && now - plansCache.fetchedAt < PLANS_TTL_MS) {
    return plansCache.data;
  }
  const data = await request({ method: "GET", url: "/v1/zoi/plans/health" });
  plansCache = { fetchedAt: now, data };
  return data;
}let data = await request({
  method: "GET",
  url: "/v1/zoi/plans/health"
});

data = data.filter(
  (plan) => plan.planCode !== "WHZ-EDF01"
);

module.exports = {
  getHealthPlans: getHealthPlansCached,

  getSubscriptionByPhone: (phoneNumber) =>
    request({ method: "GET", url: `/v1/zoi/subscriptions/${encodeURIComponent(phoneNumber)}` }),

  getSubscriptionByPolicy: (policyNumber) =>
    request({
      method: "GET",
      url: `/v1/zoi/subscriptions/policy/${encodeURIComponent(policyNumber)}`,
    }),

  createSubscription: (payload) =>
    request({ method: "POST", url: "/v1/zoi/subscriptions", data: payload }),

  // Confirmed: WellaHealth's renewals endpoint identifies the subscriber by phoneNumber.
  renewSubscription: (payload) =>
    request({ method: "POST", url: "/v1/zoi/subscriptions/renewals", data: payload }),
};
