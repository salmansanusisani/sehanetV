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

module.exports = {
  getHealthPlans: () => request({ method: "GET", url: "/v1/zoi/plans/health" }),

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
