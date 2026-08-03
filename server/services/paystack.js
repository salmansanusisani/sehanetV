const axios = require("axios");

const { PAYSTACK_SECRET_KEY } = process.env;

if (!PAYSTACK_SECRET_KEY) {
  console.warn(
    "[paystack] Missing PAYSTACK_SECRET_KEY in .env — Paystack calls will fail until this is set."
  );
}

const client = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    Accept: "application/json",
  },
  timeout: 15000,
});

async function request(config) {
  try {
    const response = await client.request(config);
    return response.data;
  } catch (err) {
    if (err.response) {
      const normalized = new Error(
        err.response.data?.message || err.response.data?.error || "Paystack API error"
      );
      normalized.status = err.response.status;
      normalized.body = err.response.data;
      throw normalized;
    }
    if (err.request) {
      const normalized = new Error("No response from Paystack API (network/timeout)");
      normalized.status = 502;
      throw normalized;
    }
    throw err;
  }
}

function toKobo(amountNaira) {
  const numeric = Number(amountNaira);
  if (!Number.isFinite(numeric)) {
    throw new Error("amountNaira must be a valid number");
  }
  return Math.round(numeric * 100);
}

async function resolveAccountNumber(accountNumber, bankCode) {
  const data = await request({
    method: "GET",
    url: "/bank/resolve",
    params: { account_number: accountNumber, bank_code: bankCode },
  });

  return {
    accountName: data?.data?.account_name || "",
    accountNumber: data?.data?.account_number || accountNumber,
    bankCode: data?.data?.bank_code || bankCode,
  };
}

async function listBanks() {
  const data = await request({
    method: "GET",
    url: "/bank",
    params: { country: "nigeria" },
  });

  const banks = Array.isArray(data?.data) ? data.data : [];
  return banks
    .map((bank) => ({ name: bank?.name, code: bank?.code }))
    .filter((bank) => bank.name && bank.code);
}

async function createTransferRecipient({ name, accountNumber, bankCode }) {
  const data = await request({
    method: "POST",
    url: "/transferrecipient",
    data: {
      type: "nuban",
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: "NGN",
    },
  });

  return data?.data?.recipient_code || null;
}

async function initializeTransaction({ email, amountNaira, reference, callbackUrl, metadata }) {
  const data = await request({
    method: "POST",
    url: "/transaction/initialize",
    data: {
      email,
      amount: Math.round(Number(amountNaira) * 100),
      reference,
      callback_url: callbackUrl,
      metadata,
    },
  });

  return {
    authorizationUrl: data?.data?.authorization_url || null,
    accessCode: data?.data?.access_code || null,
    reference: data?.data?.reference || reference || null,
  };
}

async function verifyTransaction(reference) {
  return request({
    method: "GET",
    url: `/transaction/verify/${encodeURIComponent(reference)}`,
  });
}

async function initiateTransfer({ recipientCode, amountNaira, reason, reference }) {
  const data = await request({
    method: "POST",
    url: "/transfer",
    data: {
      source: "balance",
      reason: reason || "Transfer",
      amount: toKobo(amountNaira),
      recipient: recipientCode,
      reference,
    },
  });

  return {
    status: data?.data?.status || data?.status || null,
    transferCode: data?.data?.transfer_code || null,
    reference: data?.data?.reference || reference || null,
  };
}

async function verifyTransfer(reference) {
  const data = await request({
    method: "GET",
    url: `/transfer/verify/${encodeURIComponent(reference)}`,
  });

  return {
    status: data?.data?.status || data?.status || null,
    transferCode: data?.data?.transfer_code || null,
    reference: data?.data?.reference || reference || null,
    data: data?.data || null,
  };
}

module.exports = {
  resolveAccountNumber,
  listBanks,
  createTransferRecipient,
  initializeTransaction,
  verifyTransaction,
  initiateTransfer,
  verifyTransfer,
};
