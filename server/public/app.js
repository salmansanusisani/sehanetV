const API_BASE = "/api";

// Keep in sync with PAYMENT_FEE_NAIRA in server/config.js — the backend is
// the source of truth for what is actually charged at checkout.
const PAYMENT_FEE_NAIRA = 500;

let state = {
  token: localStorage.getItem("sehanet_token") || null,
  user: null,
  activeTab: null,
};

// ---------- API helper ----------
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });

  // Expired/invalid token mid-session: drop the session and return to login.
  if (res.status === 401 && state.token) {
    showLoginScreen("Your session has expired. Please log in again.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Request failed"), { data });
  return data;
}

// ---------- Toasts ----------
function showToast(message, type = "info", actions = []) {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", "status");
  el.innerHTML = `
    <div class="toast-body">${message}</div>
    ${actions.length ? `<div class="toast-actions">${actions.map((a) => `<button class="toast-btn" type="button">${a.label}</button>`).join("")}</div>` : ""}
    ${actions.length ? "" : `<button class="toast-close" type="button" aria-label="Dismiss">&times;</button>`}
  `;

  if (!actions.length) {
    el.querySelector(".toast-close").addEventListener("click", () => el.remove());
  }
  actions.forEach((action, i) => {
    el.querySelectorAll(".toast-btn")[i].addEventListener("click", () => {
      action.onClick && action.onClick();
      el.remove();
    });
  });

  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  if (!actions.length) setTimeout(() => el.remove(), 5000);
  return el;
}

// ---------- Auth ----------
function showLoginScreen(message) {
  state.token = null;
  state.user = null;
  localStorage.removeItem("sehanet_token");
  stopIdleTimer();
  document.getElementById("app").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("loginPassword").value = "";
  if (message) {
    document.getElementById("loginError").textContent = message;
  }
}

function doLogout() {
  showLoginScreen("You have been logged out.");
}

// Keep the login/register forms from doing a native page reload.
document.getElementById("loginForm")?.addEventListener("submit", (e) => e.preventDefault());
document.getElementById("registerForm")?.addEventListener("submit", (e) => e.preventDefault());

document.getElementById("loginBtn").addEventListener("click", login);
document.getElementById("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});

document.getElementById("showRegisterBtn").addEventListener("click", () => {
  document.querySelector("#loginScreen .login-card").classList.add("hidden");
  document.getElementById("registerCard").classList.remove("hidden");
});
document.getElementById("showLoginBtn").addEventListener("click", () => {
  document.getElementById("registerCard").classList.add("hidden");
  document.querySelector("#loginScreen .login-card").classList.remove("hidden");
});
document.getElementById("registerBtn").addEventListener("click", () => {
  runWithLoading(document.getElementById("registerBtn"), "Creating account…", async () => {
    const errEl = document.getElementById("registerError");
    errEl.textContent = "";
    const payload = {
      fullName: document.getElementById("reg-fullName").value.trim(),
      phone: document.getElementById("reg-phone").value.trim(),
      email: document.getElementById("reg-email").value.trim(),
      location: document.getElementById("reg-location").value.trim(),
      dateOfBirth: document.getElementById("reg-dob").value,
      gender: document.getElementById("reg-gender").value,
      username: document.getElementById("reg-username").value.trim(),
      password: document.getElementById("reg-password").value,
    };
    try {
      const data = await api("/auth/register", { method: "POST", body: JSON.stringify(payload) });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("sehanet_token", data.token);
      boot();
    } catch (err) {
      errEl.textContent = err.data?.error || "Unable to create your account. Please try again.";
    }
  });
});

async function login() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  if (!username || !password) {
    errEl.textContent = "Enter a username and password.";
    return;
  }
  await runWithLoading(document.getElementById("loginBtn"), "Signing in…", async () => {
    try {
      const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("sehanet_token", data.token);
      boot();
    } catch (err) {
      errEl.textContent = err.data?.error || "Login failed.";
    }
  });
}

document.getElementById("logoutBtn").addEventListener("click", doLogout);

// ---------- Session inactivity lockout ----------
// Auto-log out after 2 minutes of inactivity for security, with a 30-second
// warning toast so nobody gets silently kicked mid-work.
const SESSION_IDLE_MS = 2 * 60 * 1000;
const SESSION_WARNING_MS = 30 * 1000;

let idleTimeout = null;
let idleWarningTimer = null;
let idleWarningToast = null;

const IDLE_EVENTS = ["pointerdown", "pointermove", "keydown", "click", "scroll", "touchstart", "wheel"];
let idleBound = false;

function stopIdleTimer() {
  if (idleTimeout) { clearTimeout(idleTimeout); idleTimeout = null; }
  if (idleWarningTimer) { clearTimeout(idleWarningTimer); idleWarningTimer = null; }
  if (idleWarningToast) { idleWarningToast.remove(); idleWarningToast = null; }
}

function resetIdleTimer() {
  if (!state.user) return;
  stopIdleTimer();
  idleWarningToast = null;

  idleWarningTimer = setTimeout(() => {
    idleWarningToast = showToast(
      "For your security, your session will end in 30 seconds if you stay inactive.",
      "warning",
      [{ label: "Stay signed in", onClick: () => resetIdleTimer() }]
    );
  }, SESSION_IDLE_MS - SESSION_WARNING_MS);

  idleTimeout = setTimeout(() => {
    showLoginScreen("You were logged out automatically after 2 minutes of inactivity.");
    if (window.lucide) window.lucide.createIcons();
  }, SESSION_IDLE_MS);
}

function startIdleTimer() {
  if (idleBound) { resetIdleTimer(); return; }
  idleBound = true;
  for (const evt of IDLE_EVENTS) {
    window.addEventListener(evt, resetIdleTimer, { passive: true });
  }
  resetIdleTimer();
}

// ---------- Mobile hamburger nav ----------
(function setupMobileNav() {
  const menuBtn = document.getElementById("menuToggle");
  const tabsEl = document.getElementById("tabs");
  const overlay = document.getElementById("navOverlay");
  if (!menuBtn || !tabsEl || !overlay) return;

  function openMenu() {
    tabsEl.classList.add("open");
    overlay.classList.add("open");
    menuBtn.setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    tabsEl.classList.remove("open");
    overlay.classList.remove("open");
    menuBtn.setAttribute("aria-expanded", "false");
  }

  menuBtn.addEventListener("click", () => {
    tabsEl.classList.contains("open") ? closeMenu() : openMenu();
  });
  overlay.addEventListener("click", closeMenu);
  // Close the drawer whenever a tab is chosen (delegated, survives renderTabs re-renders)
  tabsEl.addEventListener("click", (e) => {
    if (e.target.closest(".tab-btn")) closeMenu();
  });
})();

// ---------- Payment result toast (shown after returning from Paystack) ----------
function showPaymentBanner() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get("payment");
  if (!payment) return;

  const type = params.get("type");
  const success = payment === "success";
  const title = success ? "Payment successful" : "Payment was not completed";
  const message = success
    ? `Your ${type === "renewal" ? "renewal" : "enrollment"} has been recorded. You can safely continue using SehaNet.`
    : "No money was recorded by SehaNet. Please try again or contact support if you were charged.";

  const result = document.createElement("section");
  result.className = `payment-result ${success ? "payment-result-success" : "payment-result-error"}`;
  result.setAttribute("role", "status");
  result.innerHTML = `
    <div class="payment-result-icon">${success ? "✓" : "!"}</div>
    <div><strong>${title}</strong><p>${message}</p></div>
    <button class="payment-result-close" type="button" aria-label="Dismiss">×</button>
  `;
  result.querySelector(".payment-result-close").addEventListener("click", () => result.remove());
  document.body.appendChild(result);
  setTimeout(() => result.remove(), 9000);

  // Clean the URL so refreshing the page doesn't re-show the banner
  window.history.replaceState({}, document.title, window.location.pathname);
}

// ---------- UI Helpers (Prompt 4.3) ----------
function renderLoading(container, text = "Loading…") {
  if (!container) return;
  container.innerHTML = `
    <div class="loading-spinner-wrap">
      <div class="spinner"></div>
      <div class="muted">${text}</div>
    </div>
  `;
}

function renderEmptyState(container, text = "No records found", icon = "file-text") {
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <i data-lucide="${icon}"></i>
      <p>${text}</p>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

function renderError(container, err, customMsg = null) {
  if (!container) return;
  const msg = customMsg || err.data?.error || err.message || "An unexpected error occurred.";
  container.innerHTML = `
    <div class="alert-error">
      <div>❌ ${msg}</div>
      <div class="muted">Please check the information and try again. If this continues, contact the administrator.</div>
    </div>
  `;
}

// Runs `fn` while showing a spinner + busy label on the button, then restores it.
// Returns a promise that resolves with fn's result (or rejects with fn's error).
async function runWithLoading(button, busyLabel, fn) {
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> ${busyLabel}`;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
}

// Self-service password change modal setup (Prompt 5.4)
function setupPasswordModal() {
  const openBtn = document.getElementById("changePasswordBtn");
  const modal = document.getElementById("passwordModal");
  const cancelBtn = document.getElementById("pwd-cancel");
  const submitBtn = document.getElementById("pwd-submit");
  const outputEl = document.getElementById("pwd-output");

  if (!openBtn || !modal) return;

  openBtn.addEventListener("click", () => {
    modal.classList.remove("hidden");
    outputEl.innerHTML = "";
    clearFields(["pwd-current", "pwd-new", "pwd-confirm"]);
  });

  cancelBtn.addEventListener("click", () => {
    modal.classList.add("hidden");
  });
  document.getElementById("pwd-close")?.addEventListener("click", () => modal.classList.add("hidden"));
  document.getElementById("passwordModal")?.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });

  submitBtn.addEventListener("click", () => {
    const currentPassword = document.getElementById("pwd-current").value;
    const newPassword = document.getElementById("pwd-new").value;
    const confirmPassword = document.getElementById("pwd-confirm").value;

    outputEl.innerHTML = "";

    if (!currentPassword || !newPassword) {
      outputEl.innerHTML = `<div class="alert-error">Please fill in all password fields.</div>`;
      return;
    }

    if (newPassword.length < 6) {
      outputEl.innerHTML = `<div class="alert-error">New password must be at least 6 characters long.</div>`;
      return;
    }

    if (newPassword !== confirmPassword) {
      outputEl.innerHTML = `<div class="alert-error">New passwords do not match.</div>`;
      return;
    }

    runWithLoading(submitBtn, "Updating…", async () => {
      try {
        await api("/me/password", {
          method: "POST",
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        outputEl.innerHTML = `<div class="alert-success">✔ Password updated successfully!</div>`;
        setTimeout(() => modal.classList.add("hidden"), 1500);
      } catch (err) {
        renderError(outputEl, err);
      }
    });
  });
}

// ---------- Onboarding tour (Phase 7) ----------
const TOUR_STEPS_BY_ROLE = {
  admin: [
    { tab: "dashboard", desc: "See customer payments (including the NGN 500 payment fee), your net before and after expenses, active policies, and ambassador commission totals." },
    { tab: "team", desc: "Create and manage agents and ambassadors. Confirm bank details before approving a payment." },
    { tab: "policies", desc: "Search all customer records by name, phone, or email for follow-up." },
    { tab: "payout", desc: "Review ambassador payment requests, approve them, then use Pay now only when ready to send a real bank transfer." },
    { tab: "settings", desc: "Set the commission percentages that drive earnings calculations." },
  ],
  ambassador: [
    { tab: "enroll", desc: "Create a group first, then enroll one customer securely." },
    { tab: "bulkenroll", desc: "Enroll up to 20 people on one plan and make one combined payment." },
    { tab: "mysummary", desc: "See available commission, request payment, and review payment status." },
    { tab: "renewalsdue", desc: "See your customers whose plans expire soon, so you can follow up." },
  ],
  agent: [
    { tab: "enroll", desc: "Enroll one customer securely. You do not need to create a group." },
    { tab: "mypolicies", desc: "See only the customers you enrolled and their current policy status." },
    { tab: "renewalsdue", desc: "Use this list to follow up with your customers before expiry." },
    { tab: "renew", desc: "Renew a customer's plan after confirming their phone number and selected plan." },
  ],
  customer: [
    { tab: "mypolicies", desc: "See your health plan, policy status, and expiry date." },
    { tab: "enroll", desc: "Choose a plan and complete secure payment to enroll yourself." },
    { tab: "renewalsdue", desc: "Check when your plan is close to expiry and renew in time." },
  ],
};

function tourStorageKey() {
  return `sehanet_tour_seen_v2_${state.user?.username || "anon"}`;
}

function maybeStartTour() {
  if (localStorage.getItem(tourStorageKey())) return;
  startTour();
}

function startTour() {
  if (!window.driver || !window.driver.js) return;

  const steps = TOUR_STEPS_BY_ROLE[state.user.role] || [];
  const driverSteps = [];

  driverSteps.push({
    popover: {
      title: "Welcome to SehaNet",
      description: "Quick tour of what you can do here — tap Skip any time.",
    },
  });

  for (const step of steps) {
    const el = document.querySelector(`.tab-btn[data-tab="${step.tab}"]`);
    if (!el) continue; // this role doesn't have that tab — skip it
    driverSteps.push({
      element: el,
      popover: {
        title: el.textContent.trim(),
        description: step.desc,
        side: "right",
      },
    });
  }

  const changePasswordEl = document.getElementById("changePasswordBtn");
  if (changePasswordEl) {
    driverSteps.push({
      element: changePasswordEl,
      popover: {
        title: "Change Password",
        description: "You can update your own password here any time.",
        side: "bottom",
      },
    });
  }

  const driverObj = window.driver.js.driver({
    showProgress: true,
    allowClose: true,
    steps: driverSteps,
    onDestroyed: () => {
      localStorage.setItem(tourStorageKey(), "1");
    },
  });

  driverObj.drive();
}

const retakeTourBtn = document.getElementById("retakeTourBtn");
if (retakeTourBtn) {
  retakeTourBtn.addEventListener("click", () => {
    localStorage.removeItem(tourStorageKey());
    startTour();
  });
}

async function boot() {
  try {
    state.user = await api("/me");
  } catch {
    localStorage.removeItem("sehanet_token");
    state.token = null;
    stopIdleTimer();
    document.getElementById("loginScreen").classList.remove("hidden");
    return;
  }
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("loginError").textContent = "";
  document.getElementById("userLabel").textContent = `${state.user.name} · ${state.user.role}`;
  setupPasswordModal();
  renderTabs();
  if (window.lucide) window.lucide.createIcons();
  showPaymentBanner();
  startIdleTimer();
  setTimeout(() => maybeStartTour(), 400); // small delay so tab elements are in the DOM for driver.js to target
}

// ---------- Tabs / routing ----------
const TABS_BY_ROLE = {
  admin: [
    ["dashboard", "Dashboard"],
    ["team", "Agents & Ambassadors"],
    ["policies", "Policies"],
    ["renewalsdue", "Renewals Due"],
    ["groups", "Groups"],
    ["settings", "Commission Settings"],
    ["payout", "Weekly Payout"],
    ["enroll", "Enroll"],
    ["lookup", "Look Up"],
    ["renew", "Renew"],
  ],
  ambassador: [
    ["enroll", "Enroll"],
    ["bulkenroll", "Bulk Enroll"],
    ["renewalsdue", "Renewals Due"],
    ["lookup", "Look Up"],
    ["renew", "Renew"],
    ["mygroups", "My Groups"],
    ["mysummary", "My Earnings"],
  ],
  agent: [
    ["enroll", "Enroll"],
    ["renewalsdue", "Renewals Due"],
    ["lookup", "Look Up"],
    ["renew", "Renew"],
    ["mypolicies", "My Enrollments"],
  ],
  customer: [
    ["mypolicies", "My Plan"],
    ["enroll", "Enroll"],
    ["renewalsdue", "Plan Expiry"],
  ],
};

const TAB_ICONS = {
  dashboard: "layout-dashboard",
  team: "users",
  policies: "file-text",
  renewalsdue: "clock",
  groups: "layers",
  settings: "shield-alert",
  payout: "bar-chart-3",
  enroll: "plus",
  bulkenroll: "users-round",
  lookup: "search",
  renew: "repeat",
  mygroups: "layers",
  mysummary: "bar-chart-3",
  mypolicies: "file-text",
};

function renderTabs() {
  const tabs = TABS_BY_ROLE[state.user.role] || [];
  const tabsEl = document.getElementById("tabs");
  tabsEl.innerHTML = tabs
    .map(([key, label]) => {
      const icon = TAB_ICONS[key] || "layers";
      return `<button class="tab-btn" data-tab="${key}"><i data-lucide="${icon}"></i><span>${label}</span></button>`;
    })
    .join("") +
    `<div class="manual-nav-link">
      <button class="tab-btn" data-tab="readmanual"><i data-lucide="book-open"></i><span>Read Manual</span></button>
    </div>`;
  tabsEl.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });
  if (window.lucide) {
    window.lucide.createIcons();
  }
  setActiveTab(tabs[0]?.[0]);
}

function setActiveTab(key) {
  // Remember the last non-manual tab so the manual page's Back button has
  // somewhere sensible to return to.
  if (state.activeTab && state.activeTab !== "readmanual") {
    state.lastTab = state.activeTab;
  }
  state.activeTab = key;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === key));
  const views = {
    dashboard: renderAdminDashboard,
    team: renderTeamView,
    policies: renderPoliciesView,
    renewalsdue: renderRenewalsDueView,
    groups: renderAdminGroupsView,
    settings: renderSettingsView,
    payout: renderPayoutView,
    enroll: renderEnrollView,
    bulkenroll: renderBulkEnrollView,
    lookup: renderLookupView,
    renew: renderRenewView,
    mygroups: renderMyGroupsView,
    mysummary: renderMySummaryView,
    mypolicies: renderMyPoliciesView,
    readmanual: renderManualView,
  };
  (views[key] || (() => {}))();
  if (window.lucide) {
    setTimeout(() => window.lucide.createIcons(), 50);
  }
}

async function renderAdminDashboard() {
  const container = document.getElementById("views");
  container.innerHTML = `<div class="page-head"><h1>Business Dashboard</h1><p class="muted">A live view of payments, policies, and commission across every ambassador.</p></div><div id="dashboard-content"></div>`;
  const content = document.getElementById("dashboard-content");
  renderLoading(content, "Calculating business figures…");
  try {
    const d = await api("/admin/dashboard");
    const money = (v) => `NGN ${Number(v || 0).toLocaleString()}`;
    const stat = (icon, label, value, tone = "", hint = "") => `
      <div class="stat-card ${tone}">
        <div class="stat-icon"><i data-lucide="${icon}"></i></div>
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        ${hint ? `<div class="stat-hint">${hint}</div>` : ""}
      </div>`;
    content.innerHTML = `
      <div class="stat-grid">
        ${stat("wallet", "Payments recorded", money(d.revenue), "tone-teal", `${d.policyCount} policies · ${d.renewalCount} renewals`)}
        ${stat("coins", "Payment fees collected", money(d.paymentFees), "", "NGN 500 per payment")}
        ${stat("piggy-bank", "Admin net before expenses", money(d.adminNetBeforeExpenses), "tone-gold", "Payments less commission")}
        ${stat("trending-up", "Admin net after expenses", money(d.adminNetAfterExpenses), "", `Your ${d.wellahealthPercent}% WellaHealth cut (${money(d.wellahealthCut)}) + fees, less commission`)}
        ${stat("trending-up", "Ambassador commission owed", money(d.ambassadorOutstanding), "", `${d.customerCount} customers`)}
        ${stat("check-circle-2", "Ambassador commission paid", money(d.ambassadorPaid), "")}
        ${stat("users", "Customers", d.customerCount, "")}
        ${stat("shield-check", "Active policies", d.activePolicies, "")}
      </div>
      <div class="card note-card"><div class="muted">“Admin net before expenses” is recorded customer payments (including the NGN 500 payment fee) less ambassador commission. “Admin net after expenses” is the admin’s actual income: your ${d.wellahealthPercent}% WellaHealth cut of plan payments, plus payment fees, less ambassador commission owed.</div></div>
    `;
    if (window.lucide) window.lucide.createIcons();
  } catch (err) { renderError(content, err); }
}


function out(id, data) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof data === "string") {
    el.innerHTML = `<div class="alert-error">${data}</div>`;
    return;
  }
  if (data?.error) {
    el.innerHTML = `<div class="alert-error">❌ ${data.error}<div class="muted">Please correct the information and try again.</div></div>`;
    return;
  }
  if (data?.paymentRequired) {
    el.innerHTML = `<div class="alert-success">Preparing secure payment…</div>`;
    return;
  }

  const skipKeys = ["message", "paymentRequired", "authorizationUrl", "success", "redirect_url", "reference"];
  const body = buildResultRows(data, skipKeys);
  const heading = data?.message || "Completed successfully";

  el.innerHTML = `
    <div class="result-card">
      <div class="result-card-icon">✓</div>
      <div class="result-card-body">
        <strong>${heading}</strong>
        ${body ? body : `<div class="muted">No details returned.</div>`}
      </div>
    </div>
  `;
}

// Convert a key like "policy_number" or "planCode" into "Policy Number"
function prettyLabel(key) {
  return String(key)
    .replace(/^_+|_+$/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Human-friendly rendering of a scalar value
function resultValueHtml(v) {
  if (v === null || v === undefined || v === "") return `<span class="muted">—</span>`;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "string" && /\d{4}-\d{2}-\d{2}(T|\s)/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d)) {
      const hasTime = v.includes("T") || v.trim().length > 10;
      const date = d.toLocaleDateString();
      if (!hasTime) return date;
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `${date} ${time}`;
    }
  }
  return String(v);
}

function isScalar(v) {
  return v === null || v === undefined || typeof v !== "object";
}

// Build a definition-list of scalar fields plus <details> blocks for nested objects/arrays
function buildResultRows(data, skipKeys = []) {
  if (!data || typeof data !== "object") {
    return `<div class="result-details"><div><span>Value</span><strong>${resultValueHtml(data)}</strong></div></div>`;
  }
  const scalars = [];
  const nested = [];
  for (const [key, val] of Object.entries(data)) {
    if (skipKeys.includes(key)) continue;
    if (isScalar(val)) scalars.push([key, val]);
    else nested.push([key, val]);
  }
  let html = "";
  if (scalars.length) {
    html += `<div class="result-details">${scalars
      .map(([k, v]) => `<div><span>${prettyLabel(k)}</span><strong>${resultValueHtml(v)}</strong></div>`)
      .join("")}</div>`;
  }
  for (const [key, val] of nested) {
    html += `<details class="result-nested"><summary>${prettyLabel(key)}</summary>${nestResultHtml(val)}</details>`;
  }
  return html;
}

function nestResultHtml(val) {
  if (Array.isArray(val)) {
    if (val.length === 0) return `<div class="muted">None</div>`;
    return val
      .map(
        (item, i) =>
          isScalar(item)
            ? `<div class="result-row"><span>${i + 1}</span><strong>${resultValueHtml(item)}</strong></div>`
            : `<details class="result-nested"><summary>Item ${i + 1}</summary>${buildResultRows(item)}</details>`
      )
      .join("");
  }
  return buildResultRows(val);
}

function normalizePlans(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.plans)) return data.plans;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.plans?.items)) return data.plans.items;
  if (Array.isArray(data?.data?.plans)) return data.data.plans;
  return [];
}

function getPlanMeta(plan) {
  const code = plan?.planCode || plan?.code || plan?.plan_code || plan?.id || "";
  const name = plan?.planName || plan?.name || plan?.title || plan?.displayName || code || "Unnamed plan";
  const price = plan?.price || plan?.amount || plan?.premium || plan?.priceAmount || plan?.monthlyPrice || "";
  const description = plan?.description || plan?.details || plan?.summary || plan?.benefits || "";
  return { code, name, price, description };
}

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function firstDefined(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

function splitList(v) {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "object" && x !== null ? Object.values(x).filter((y) => typeof y === "string").join(" — ") : String(x)))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof v === "string") return v.split(/\s*[,\n;•|]\s*/).map((s) => s.trim()).filter(Boolean);
  if (v && typeof v === "object") {
    return Object.entries(v).map(([k, val]) => `${String(k).replace(/_/g, " ")}: ${val}`);
  }
  return [];
}

function formatDuration(d) {
  const s = String(d);
  const num = Number(d);
  if (!Number.isNaN(num) && String(d).trim() !== "") return num === 1 ? "1 month" : `${num} months`;
  return s;
}

function formatDependants(d) {
  const s = String(d).trim().toLowerCase();
  if (s === "true") return "Dependants included";
  if (s === "false" || s === "0") return "";
  const num = Number(d);
  if (!Number.isNaN(num) && num > 0) return num === 1 ? "1 dependant" : `${num} dependants`;
  return String(d).trim();
}

function normalizePaymentPlans(pp) {
  if (!pp) return [];
  const fromItem = (item) => {
    if (typeof item === "string") return { label: item };
    if (item && typeof item === "object") {
      const label = firstDefined(item, ["duration", "period", "name", "title", "plan", "frequency", "description"]);
      const price = Number(firstDefined(item, ["price", "amount", "cost", "value"]));
      return { label: label ? String(label) : "", price: Number.isNaN(price) ? 0 : price };
    }
    return { label: String(item) };
  };
  if (Array.isArray(pp)) return pp.map(fromItem);
  if (typeof pp === "object") {
    return Object.entries(pp).map(([k, v]) => {
      if (v && typeof v === "object") return fromItem({ ...v, title: firstDefined(v, ["duration", "period", "name", "title"]) || k });
      const price = Number(v);
      return { label: k, price: Number.isNaN(price) ? 0 : price };
    });
  }
  return [];
}

function planCardMeta(plan) {
  const { code, name, price, description } = getPlanMeta(plan);
  const n = Number(price);
  const priceText =
    price !== undefined && price !== null && price !== "" && !Number.isNaN(n) && n > 0
      ? `NGN ${n.toLocaleString()}`
      : "";
  const duration = formatDuration(firstDefined(plan, ["duration", "durationMonths", "durationInMonths", "validity", "validityMonths", "coveragePeriod", "months", "tenure", "planDuration", "coverDuration", "period"]));
  const dependants = formatDependants(firstDefined(plan, ["dependants", "dependantsAllowed", "maxDependants", "dependents", "numberOfDependants", "dependant", "dependent", "includeDependants"]));
  const desc = Array.isArray(description) ? description.join(", ") : String(description || "");
  const benefits = splitList(firstDefined(plan, ["benefits", "benefitList", "benefitsList", "inclusions", "features", "planBenefits", "cover", "coverage", "covers"]));
  const paymentPlans = firstDefined(plan, ["paymentPlans", "payment_plans", "paymentOptions", "payment_options", "pricingOptions", "installments", "pricing"]);
  return { code, name, price: priceText, desc, duration, dependants, benefits, paymentPlans };
}

// Renders plans as selectable cards. `onSelect(plan, card)` fires when a card is picked.
function renderPlanCards(container, plans, opts = {}) {
  if (!container) return;
  if (!plans.length) {
    container.innerHTML = `<div class="muted">${opts.emptyText || "No plans available right now."}</div>`;
    return;
  }
  container.innerHTML = `<div class="plan-grid">${plans
    .map((plan, i) => {
      const meta = planCardMeta(plan);
      const tags = [meta.code, meta.duration, meta.dependants].filter(Boolean).map((t) => `<span class="plan-tag">${esc(t)}</span>`).join("");
      const benefits = meta.benefits.length
        ? `<span class="plan-benefits"><span class="plan-benefits-title">What’s covered</span>${meta.benefits
            .slice(0, 12)
            .map((b) => `<span class="plan-benefit"><i data-lucide="check"></i>${esc(b)}</span>`)
            .join("")}${meta.benefits.length > 12 ? `<span class="plan-benefit-more">+ ${meta.benefits.length - 12} more</span>` : ""}</span>`
        : "";
      const payments = normalizePaymentPlans(meta.paymentPlans);
      const paymentsHtml = payments.length
        ? `<span class="plan-payments"><span class="plan-benefits-title">Payment options</span><span class="plan-pay-chips">${payments
            .map((p) => `<span class="plan-pay-chip">${esc(p.label)}${p.price > 0 ? ` · NGN ${p.price.toLocaleString()}` : ""}</span>`)
            .join("")}</span></span>`
        : "";
      return `
        <button type="button" class="plan-card" data-index="${i}" aria-pressed="false">
          <span class="plan-card-check"><i data-lucide="check"></i></span>
          <span class="plan-card-top">
            <span class="plan-card-title">${esc(meta.name)}</span>
            ${meta.price ? `<span class="plan-card-price">${meta.price}</span>` : ""}
          </span>
          ${tags ? `<span class="plan-card-tags">${tags}</span>` : ""}
          ${meta.desc ? `<span class="plan-card-desc">${esc(meta.desc)}</span>` : ""}
          ${benefits}
          ${paymentsHtml}
        </button>`;
    })
    .join("")}</div>`;
  if (window.lucide) window.lucide.createIcons();

  container.querySelectorAll(".plan-card").forEach((card) => {
    card.addEventListener("click", () => {
      container.querySelectorAll(".plan-card").forEach((c) => {
        const isSel = c === card;
        c.classList.toggle("selected", isSel);
        c.setAttribute("aria-pressed", isSel ? "true" : "false");
      });
      if (opts.onSelect) opts.onSelect(plans[Number(card.dataset.index)], card);
    });
  });
}

function clearPlanSelection(containerId, summaryId) {
  document.querySelectorAll(`#${containerId} .plan-card.selected`).forEach((c) => {
    c.classList.remove("selected");
    c.setAttribute("aria-pressed", "false");
  });
  const summary = document.getElementById(summaryId);
  if (summary) summary.innerHTML = `Select a plan to continue.`;
}

function clearFields(ids) {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "SELECT") {
      el.selectedIndex = 0;
    } else {
      el.value = "";
    }
  });
}

function setupPaymentReferenceToggle(methodSelectId, referenceWrapId, referenceInputId) {
  const methodSelect = document.getElementById(methodSelectId);
  const referenceWrap = document.getElementById(referenceWrapId);
  const referenceInput = document.getElementById(referenceInputId);
  if (!methodSelect || !referenceWrap || !referenceInput) return;

  const sync = () => {
    const isPaystack = methodSelect.value === "paystack";
    referenceWrap.style.display = isPaystack ? "none" : "block";
    if (isPaystack) {
      referenceInput.value = "";
    }
  };

  methodSelect.addEventListener("change", sync);
  sync();
}

// Download a payout CSV using an authorized fetch (token stays in the header,
// never in the URL), then trigger a browser download from a blob URL.
async function downloadPayoutCsv(payoutId, weekLabel) {
  const res = await fetch(`${API_BASE}/admin/payouts/${payoutId}/export`, {
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Export failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payout-${weekLabel}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Admin: Team ----------
let cachedBanks = [];

async function fetchBanks() {
  if (cachedBanks.length > 0) return cachedBanks;
  try {
    cachedBanks = await api("/admin/banks");
    return cachedBanks;
  } catch (err) {
    console.error("Failed to load banks:", err);
    return [];
  }
}

async function renderTeamView() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="card">
      <h2>Create Agent / Ambassador</h2>
      <div class="grid">
        <input id="nu-name" placeholder="Full name" />
        <input id="nu-phone" placeholder="Phone" />
        <input id="nu-username" placeholder="Username" />
        <input id="nu-password" placeholder="Password" type="password" />
        <select id="nu-role">
          <option value="agent">Agent (unpaid)</option>
          <option value="ambassador">Ambassador (paid)</option>
        </select>
      </div>
      <div class="grid" id="nu-ambassador-fields">
        <select id="nu-bank-code">
          <option value="">Loading banks…</option>
        </select>
        <input id="nu-bank-account" placeholder="Bank account number (ambassador)" />
      </div>
      <button class="primary" id="nu-submit">Create</button>
      <div id="nu-output" style="margin-top:10px;"></div>
    </div>
    <div id="edit-user-card" class="card hidden">
      <h2>Edit Agent / Ambassador</h2>
      <input type="hidden" id="eu-id" />
      <div class="grid">
        <div>
          <label class="muted">Full Name</label>
          <input id="eu-name" placeholder="Full name" />
        </div>
        <div>
          <label class="muted">Phone</label>
          <input id="eu-phone" placeholder="Phone" />
        </div>
        <div id="eu-rate-new-wrap">
          <label class="muted">New Enrollment Rate (%)</label>
          <input id="eu-rate-new" type="number" placeholder="New %" />
        </div>
        <div id="eu-rate-renewal-wrap">
          <label class="muted">Renewal Rate (%)</label>
          <input id="eu-rate-renewal" type="number" placeholder="Renewal %" />
        </div>
        <div>
          <label class="muted">Bank</label>
          <select id="eu-bank-code"><option value="">Select bank…</option></select>
        </div>
        <div>
          <label class="muted">Bank Account Number</label>
          <input id="eu-bank-account" placeholder="Bank Account Number" />
        </div>
      </div>
      <div id="eu-bank-name-display" class="muted" style="margin-bottom:10px;"></div>
      <div class="row">
        <button class="primary" id="eu-submit">Save &amp; Verify Bank</button>
        <button class="subtle" id="eu-cancel">Cancel</button>
      </div>
      <div id="eu-output" style="margin-top:10px;"></div>
    </div>
    <div class="card">
      <h2>All Agents &amp; Ambassadors</h2>
      <div id="team-list"></div>
    </div>
  `;

  const bankCodeSelect = document.getElementById("nu-bank-code");
  const editBankSelect = document.getElementById("eu-bank-code");

  const banks = await fetchBanks();
  const optionsHtml = `<option value="">Select bank…</option>${banks
    .map((bank) => `<option value="${bank.code}">${bank.name} (${bank.code})</option>`)
    .join("")}`;

  if (bankCodeSelect) bankCodeSelect.innerHTML = optionsHtml || `<option value="">Unable to load banks</option>`;
  if (editBankSelect) editBankSelect.innerHTML = optionsHtml || `<option value="">Unable to load banks</option>`;

  document.getElementById("nu-submit").addEventListener("click", () => {
    runWithLoading(document.getElementById("nu-submit"), "Creating…", async () => {
      const outputEl = document.getElementById("nu-output");
      outputEl.innerHTML = "";
      const payload = {
        name: document.getElementById("nu-name").value,
        phone: document.getElementById("nu-phone").value,
        username: document.getElementById("nu-username").value,
        password: document.getElementById("nu-password").value,
        role: document.getElementById("nu-role").value,
        bank_code: document.getElementById("nu-bank-code").value || undefined,
        bank_account_number: document.getElementById("nu-bank-account").value || undefined,
      };
      try {
        await api("/admin/users", { method: "POST", body: JSON.stringify(payload) });
        outputEl.innerHTML = `<div class="alert-success">✔ User created successfully!</div>`;
        clearFields(["nu-name", "nu-phone", "nu-username", "nu-password", "nu-role", "nu-bank-code", "nu-bank-account"]);
        loadTeamList();
      } catch (err) {
        renderError(outputEl, err);
      }
    });
  });

  document.getElementById("eu-cancel").addEventListener("click", () => {
    document.getElementById("edit-user-card").classList.add("hidden");
  });

  document.getElementById("eu-submit").addEventListener("click", () => {
    const userId = document.getElementById("eu-id").value;
    const outputEl = document.getElementById("eu-output");

    const payload = {
      name: document.getElementById("eu-name").value,
      phone: document.getElementById("eu-phone").value,
      bank_code: document.getElementById("eu-bank-code").value || undefined,
      bank_account_number: document.getElementById("eu-bank-account").value || undefined,
    };

    const newRate = document.getElementById("eu-rate-new").value;
    const renewalRate = document.getElementById("eu-rate-renewal").value;
    if (newRate !== "") payload.commission_rate_new = parseFloat(newRate);
    if (renewalRate !== "") payload.commission_rate_renewal = parseFloat(renewalRate);

    runWithLoading(document.getElementById("eu-submit"), "Saving…", async () => {
      outputEl.innerHTML = `<div class="muted">Saving &amp; verifying bank account with Paystack…</div>`;
      try {
        await api(`/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(payload) });
        const updatedUserList = await api("/admin/users");
        const updatedUser = updatedUserList.find((u) => String(u.id) === String(userId));

        const verifiedName = updatedUser?.bank_account_name || "";
        outputEl.innerHTML = `<div class="alert-success">✔ Profile updated successfully! ${
          verifiedName ? `Verified Account Name: <strong>${verifiedName}</strong>` : ""
        }</div>`;

        if (updatedUser) {
          document.getElementById("eu-bank-name-display").innerHTML = verifiedName
            ? `Verified Account Name: <strong>${verifiedName}</strong>`
            : "";
        }
        loadTeamList();
      } catch (err) {
        renderError(outputEl, err);
      }
    });
  });

  await loadTeamList();
}

async function loadTeamList() {
  const listEl = document.getElementById("team-list");
  renderLoading(listEl, "Loading agents & ambassadors…");

  try {
    const users = await api("/admin/users");
    if (users.length === 0) {
      renderEmptyState(listEl, "No agents or ambassadors created yet", "users");
      return;
    }
    listEl.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Bank Info</th><th>Rates</th><th>Actions</th></tr></thead>
        <tbody>
          ${users.map(userRow).join("")}
        </tbody>
      </table>
    `;
    listEl.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleTeamAction(btn.dataset.action, btn.dataset.id, users));
    });
  } catch (err) {
    renderError(listEl, err);
  }
}

function userRow(u) {
  const badgeClass = u.status === "active" ? "badge-active" : u.status === "blocked" ? "badge-blocked" : "badge-removed";
  const rates = u.role === "ambassador" ? `${u.commission_rate_new ?? "-"}% / ${u.commission_rate_renewal ?? "-"}%` : "—";
  const bankInfo = u.bank_account_number
    ? `<div>${u.bank_account_number} (${u.bank_code || "-"})</div><div class="muted">${u.bank_account_name || "Unverified"}</div>`
    : '<span class="muted">No bank details</span>';

  const actions = [];
  if (u.status !== "removed") {
    actions.push(`<button class="subtle" data-action="edit" data-id="${u.id}">Edit</button>`);
    if (u.status === "active") actions.push(`<button class="subtle" data-action="block" data-id="${u.id}">Block</button>`);
    if (u.status === "blocked") actions.push(`<button class="subtle" data-action="unblock" data-id="${u.id}">Unblock</button>`);
    actions.push(`<button class="danger" data-action="remove" data-id="${u.id}">Remove</button>`);
  }
  return `
    <tr>
      <td>${u.name}<div class="muted">${u.username}</div></td>
      <td>${u.role}</td>
      <td><span class="badge ${badgeClass}">${u.status}</span></td>
      <td>${bankInfo}</td>
      <td>${rates}</td>
      <td>${actions.join(" ")}</td>
    </tr>
    <tr id="inline-confirm-${u.id}" class="hidden" style="background:#FAF9F6;">
      <td colspan="6">
        <div id="inline-confirm-box-${u.id}" class="inline-confirm-box"></div>
      </td>
    </tr>
  `;
}

// Inline confirmations for Block/Remove (Prompt 4.2)
async function handleTeamAction(action, id, users) {
  const user = users.find((u) => String(u.id) === String(id));
  if (!user) return;

  const confirmRow = document.getElementById(`inline-confirm-${id}`);
  const confirmBox = document.getElementById(`inline-confirm-box-${id}`);

  if (action === "block") {
    confirmRow.classList.remove("hidden");
    confirmBox.innerHTML = `
      <div style="font-weight:600; color:var(--danger);">Block Account — ${user.name}</div>
      <div class="muted">Enter a reason for blocking this user:</div>
      <textarea id="block-reason-${id}" placeholder="Reason for blocking (required)…"></textarea>
      <div class="row">
        <button class="subtle" id="block-cancel-${id}">Cancel</button>
        <button class="danger" id="block-confirm-${id}" disabled>Confirm Block</button>
      </div>
    `;

    const textarea = document.getElementById(`block-reason-${id}`);
    const confirmBtn = document.getElementById(`block-confirm-${id}`);
    const cancelBtn = document.getElementById(`block-cancel-${id}`);

    textarea.addEventListener("input", () => {
      confirmBtn.disabled = !textarea.value.trim();
    });

    cancelBtn.addEventListener("click", () => confirmRow.classList.add("hidden"));

    confirmBtn.addEventListener("click", async () => {
      try {
        await api(`/admin/users/${id}/block`, {
          method: "PATCH",
          body: JSON.stringify({ reason: textarea.value.trim() }),
        });
        loadTeamList();
      } catch (err) {
        alert(err.data?.error || err.message);
      }
    });
  } else if (action === "remove") {
    confirmRow.classList.remove("hidden");
    const isAmbassador = user.role === "ambassador";
    const activeAmbassadors = users.filter(
      (u) => u.role === "ambassador" && u.status === "active" && String(u.id) !== String(id)
    );

    const reassignSelectHtml = isAmbassador && activeAmbassadors.length > 0
      ? `
        <label class="muted">Reassign future commissions to (optional):</label>
        <select id="remove-reassign-${id}">
          <option value="">None (do not reassign)</option>
          ${activeAmbassadors.map((a) => `<option value="${a.id}">${a.name} (#${a.id})</option>`).join("")}
        </select>
      `
      : "";

    confirmBox.innerHTML = `
      <div style="font-weight:600; color:var(--danger);">⚠️ Permanent User Removal — ${user.name}</div>
      <div class="muted" style="color:var(--danger);">Warning: This action is permanent and cannot be undone.</div>
      ${reassignSelectHtml}
      <textarea id="remove-reason-${id}" placeholder="Reason for removal (required)…"></textarea>
      <div class="row">
        <button class="subtle" id="remove-cancel-${id}">Cancel</button>
        <button class="danger" id="remove-confirm-${id}" disabled>Confirm Permanent Removal</button>
      </div>
    `;

    const textarea = document.getElementById(`remove-reason-${id}`);
    const confirmBtn = document.getElementById(`remove-confirm-${id}`);
    const cancelBtn = document.getElementById(`remove-cancel-${id}`);

    textarea.addEventListener("input", () => {
      confirmBtn.disabled = !textarea.value.trim();
    });

    cancelBtn.addEventListener("click", () => confirmRow.classList.add("hidden"));

    confirmBtn.addEventListener("click", async () => {
      const reassignEl = document.getElementById(`remove-reassign-${id}`);
      const reassign_to = reassignEl && reassignEl.value ? Number(reassignEl.value) : undefined;
      try {
        await api(`/admin/users/${id}/remove`, {
          method: "PATCH",
          body: JSON.stringify({ reason: textarea.value.trim(), reassign_to }),
        });
        loadTeamList();
      } catch (err) {
        alert(err.data?.error || err.message);
      }
    });
  } else if (action === "unblock") {
    try {
      await api(`/admin/users/${id}/unblock`, { method: "PATCH" });
      loadTeamList();
    } catch (err) {
      alert(err.data?.error || err.message);
    }
  } else if (action === "edit") {
    const editCard = document.getElementById("edit-user-card");
    editCard.classList.remove("hidden");
    document.getElementById("eu-id").value = user.id;
    document.getElementById("eu-name").value = user.name || "";
    document.getElementById("eu-phone").value = user.phone || "";
    document.getElementById("eu-bank-code").value = user.bank_code || "";
    document.getElementById("eu-bank-account").value = user.bank_account_number || "";
    document.getElementById("eu-output").innerHTML = "";

    const isAmbassador = user.role === "ambassador";
    document.getElementById("eu-rate-new-wrap").style.display = isAmbassador ? "block" : "none";
    document.getElementById("eu-rate-renewal-wrap").style.display = isAmbassador ? "block" : "none";
    document.getElementById("eu-rate-new").value = user.commission_rate_new ?? "";
    document.getElementById("eu-rate-renewal").value = user.commission_rate_renewal ?? "";

    document.getElementById("eu-bank-name-display").innerHTML = user.bank_account_name
      ? `Verified Account Name: <strong>${user.bank_account_name}</strong>`
      : "";
    editCard.scrollIntoView({ behavior: "smooth" });
  }
}

// ---------- Admin: Policies Search & Filter (Prompt 5.1) ----------
let policySearchDebounceTimer = null;
let policyState = { search: "", status: "All", page: 1, limit: 10 };

async function renderPoliciesView() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="card">
      <h2>Policies Directory</h2>
      <div class="grid">
        <input id="pol-search" placeholder="Search customer name or phone…" value="${policyState.search}" />
        <select id="pol-status">
          <option value="All" ${policyState.status === "All" ? "selected" : ""}>All Statuses</option>
          <option value="Active" ${policyState.status === "Active" ? "selected" : ""}>Active</option>
          <option value="Cancelled" ${policyState.status === "Cancelled" ? "selected" : ""}>Cancelled</option>
          <option value="Expired" ${policyState.status === "Expired" ? "selected" : ""}>Expired</option>
        </select>
      </div>
      <div id="pol-list"></div>
      <div id="pol-pagination" class="row" style="margin-top:12px; justify-content:space-between; align-items:center;"></div>
    </div>
  `;

  const searchInput = document.getElementById("pol-search");
  const statusSelect = document.getElementById("pol-status");

  searchInput.addEventListener("input", () => {
    clearTimeout(policySearchDebounceTimer);
    policySearchDebounceTimer = setTimeout(() => {
      policyState.search = searchInput.value;
      policyState.page = 1;
      loadPolicies();
    }, 300);
  });

  statusSelect.addEventListener("change", () => {
    policyState.status = statusSelect.value;
    policyState.page = 1;
    loadPolicies();
  });

  await loadPolicies();

  async function loadPolicies() {
    const listEl = document.getElementById("pol-list");
    const pagEl = document.getElementById("pol-pagination");
    renderLoading(listEl, "Fetching policies…");

    try {
      const query = new URLSearchParams({
        search: policyState.search,
        status: policyState.status,
        page: policyState.page,
        limit: policyState.limit,
      });

      const data = await api(`/admin/policies?${query.toString()}`);

      if (!data.rows || data.rows.length === 0) {
        renderEmptyState(listEl, "No matching policies found", "file-text");
        pagEl.innerHTML = "";
        return;
      }

      listEl.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Plan</th>
              <th>Policy #</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Agent</th>
              <th>End Date</th>
            </tr>
          </thead>
          <tbody>
            ${data.rows
              .map((p) => {
                const statusBadgeClass =
                  p.status === "Active"
                    ? "badge-success"
                    : p.status === "Cancelled" || p.status === "Expired"
                    ? "badge-failed"
                    : "badge-pending";
                return `
                  <tr>
                    <td><strong>${p.customer_name || "—"}</strong><div class="muted">${p.customer_phone || ""}</div><div class="muted">${p.customer_email || ""}</div></td>
                    <td>${p.plan_name || p.plan_code}</td>
                    <td><span class="muted">${p.wellahealth_policy_number || "—"}</span></td>
                    <td>NGN ${(p.price_at_enrollment || 0).toLocaleString()}</td>
                    <td><span class="badge ${statusBadgeClass}">${p.status}</span></td>
                    <td>${p.agent_name || (p.customer_account_id ? "Self-enrolled customer" : `Agent #${p.original_agent_id}`)}</td>
                    <td>${p.end_date ? p.end_date.split("T")[0] : "—"}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      `;

      const totalPages = Math.ceil(data.total / data.limit) || 1;
      pagEl.innerHTML = `
        <button class="subtle" id="pol-prev" ${policyState.page <= 1 ? "disabled" : ""}>Previous</button>
        <span class="muted">Page ${policyState.page} of ${totalPages} (${data.total} total)</span>
        <button class="subtle" id="pol-next" ${policyState.page >= totalPages ? "disabled" : ""}>Next</button>
      `;

      document.getElementById("pol-prev")?.addEventListener("click", () => {
        if (policyState.page > 1) {
          policyState.page--;
          loadPolicies();
        }
      });

      document.getElementById("pol-next")?.addEventListener("click", () => {
        if (policyState.page < totalPages) {
          policyState.page++;
          loadPolicies();
        }
      });
    } catch (err) {
      renderError(listEl, err);
      pagEl.innerHTML = "";
    }
  }
}

// ---------- Renewals Due Soon View (Prompt 5.2) ----------
async function renderRenewalsDueView() {
  const container = document.getElementById("views");
  const isAdmin = state.user.role === "admin";

  container.innerHTML = `
    <div class="card">
      <h2>Upcoming Renewals Due</h2>
      <p class="muted">${isAdmin ? "All customer policies due for renewal in the next 14 days." : "Your customer policies expiring soon. Contact customers to process renewals."}</p>
      <div id="rd-list"></div>
    </div>
  `;

  const listEl = document.getElementById("rd-list");
  renderLoading(listEl, "Checking upcoming renewals…");

  try {
    const endpoint = isAdmin ? "/admin/renewals-due" : "/me/renewals-due";
    const data = await api(endpoint);

    if (!data || data.length === 0) {
      renderEmptyState(listEl, "No upcoming renewals due in the next 14 days", "check-circle-2");
      return;
    }

    listEl.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Phone</th>
            <th>Plan</th>
            <th>Agent/Ambassador</th>
            <th>End Date</th>
            <th>Due In</th>
          </tr>
        </thead>
        <tbody>
          ${data
            .map((r) => {
              const daysRemaining = typeof r.days_remaining === "number" ? r.days_remaining : 0;
              const isUrgent = daysRemaining <= 3;
              const urgentClass = isUrgent ? "urgent-row" : "";
              const formattedEndDate = r.end_date ? r.end_date.split("T")[0] : "—";
              const dueText = daysRemaining === 0 ? "Today" : daysRemaining === 1 ? "Tomorrow" : `${daysRemaining} days`;

              return `
                <tr class="${urgentClass}">
                  <td><strong>${r.customer_name || "—"}</strong></td>
                  <td><a href="tel:${r.customer_phone}" style="color:var(--teal); font-weight:600; text-decoration:none;">${r.customer_phone || "—"}</a></td>
                  <td>${r.plan_name || r.plan_code}</td>
                  <td>${r.agent_name || `User #${r.original_agent_id}`}</td>
                  <td>${formattedEndDate}</td>
                  <td><span class="badge ${isUrgent ? "badge-failed" : "badge-pending"}">${dueText}</span></td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    renderError(listEl, err);
  }
}

// ---------- Admin: Groups (read-only) ----------
async function renderAdminGroupsView() {
  const container = document.getElementById("views");
  container.innerHTML = `<div class="card"><h2>All Groups</h2><div id="groups-list"></div></div>`;
  const listEl = document.getElementById("groups-list");
  renderLoading(listEl, "Loading groups…");

  try {
    const groups = await api("/admin/groups");
    if (groups.length === 0) {
      renderEmptyState(listEl, "No groups created yet", "layers");
      return;
    }
    listEl.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Ambassador</th><th>Created</th></tr></thead>
        <tbody>
          ${groups.map(g => `<tr><td>${g.name}</td><td>${g.type}</td><td>${g.ambassador_name}</td><td>${g.created_at}</td></tr>`).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    renderError(listEl, err);
  }
}

// ---------- Admin: Settings ----------
async function renderSettingsView() {
  const container = document.getElementById("views");
  container.innerHTML = `<div class="card"><h2>Commission Settings</h2><div id="settings-form"></div></div>`;
  const formEl = document.getElementById("settings-form");
  renderLoading(formEl, "Loading settings…");

  try {
    const s = await api("/admin/settings");
    formEl.innerHTML = `
      <label class="muted">WellaHealth's cut to admin (%)</label>
      <input id="s-wh" value="${s.wellahealth_commission_percent}" />
      <label class="muted">Ambassador rate — new enrollment (%)</label>
      <input id="s-new" value="${s.ambassador_new_percent}" />
      <label class="muted">Ambassador rate — renewal (%)</label>
      <input id="s-renewal" value="${s.ambassador_renewal_percent}" />
      <div style="margin-top:12px"><button class="primary" id="s-save">Save Settings</button></div>
      <div id="s-output" style="margin-top:10px;"></div>
    `;
    document.getElementById("s-save").addEventListener("click", () => {
      const outputEl = document.getElementById("s-output");
      outputEl.innerHTML = "";
      runWithLoading(document.getElementById("s-save"), "Saving…", async () => {
        try {
          await api("/admin/settings", {
            method: "PUT",
            body: JSON.stringify({
              wellahealth_commission_percent: document.getElementById("s-wh").value,
              ambassador_new_percent: document.getElementById("s-new").value,
              ambassador_renewal_percent: document.getElementById("s-renewal").value,
            }),
          });
          outputEl.innerHTML = `<div class="alert-success">✔ Settings saved successfully!</div>`;
        } catch (err) {
          renderError(outputEl, err);
        }
      });
    });
  } catch (err) {
    renderError(formEl, err);
  }
}

// ---------- Admin: Weekly Payout Management ----------
async function renderPayoutView() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="card">
      <h2>Weekly Payout Management</h2>
      <p class="muted">Create payout drafts, approve weekly payouts, and process automated Paystack bank transfers.</p>
      <div class="row">
        <input id="payout-week" placeholder="e.g. 2026-W30 (leave blank for current week)" />
        <button class="primary" id="payout-load">Load / Create Draft</button>
      </div>
      <div id="payout-output"></div>
      <div id="payout-result" style="margin-top:16px;"></div>
    </div>
    <div class="card">
      <h2>Payout History</h2>
      <div id="payout-history"></div>
    </div>
    <div class="card"><h2>Ambassador Payment Requests</h2><div id="payout-requests"></div></div>
  `;

  document.getElementById("payout-load").addEventListener("click", handleCreateOrLoadPayout);
  await loadPayoutHistory();
  await loadPayoutRequests();
  await handleCreateOrLoadPayout();

  async function loadPayoutRequests() {
    const el = document.getElementById("payout-requests");
    renderLoading(el, "Loading payment requests…");
    try {
      const requests = await api("/admin/payout-requests");
      if (!requests.length) return renderEmptyState(el, "No ambassador payment requests", "bell");
      el.innerHTML = `<table><thead><tr><th>Ambassador</th><th>Requested</th><th>Available</th><th>Status</th><th>Action</th></tr></thead><tbody>${requests.map(r => `<tr><td>${r.ambassador_name}</td><td>NGN ${Number(r.requested_amount).toLocaleString()}</td><td>NGN ${Number(r.balance?.available || 0).toLocaleString()}</td><td><span class="badge ${r.status === "rejected" ? "badge-failed" : r.status === "approved" || r.status === "paid" ? "badge-success" : "badge-pending"}">${r.status}</span></td><td>${r.status === "pending" ? `<button class="subtle" data-request="approve" data-id="${r.id}">Approve</button> <button class="subtle" data-request="reject" data-id="${r.id}">Reject</button>` : r.status === "approved" ? `<button class="primary" data-pay-request="${r.id}" data-amount="${r.requested_amount}">Pay now</button>` : "—"}</td></tr>`).join("")}</tbody></table>`;
      el.querySelectorAll("[data-request]").forEach(button => button.addEventListener("click", async () => {
        const status = button.dataset.request === "approve" ? "approved" : "rejected";
        const adminNote = window.prompt(`Optional note for the ambassador (${status}):`) || "";
        try { await api(`/admin/payout-requests/${button.dataset.id}`, { method: "PATCH", body: JSON.stringify({ status, adminNote }) }); await loadPayoutRequests(); }
        catch (err) { renderError(el, err); }
      }));
      el.querySelectorAll("[data-pay-request]").forEach(button => button.addEventListener("click", async () => {
        const amount = Number(button.dataset.amount).toLocaleString();
        if (!window.confirm(`Send NGN ${amount} to this ambassador now? This starts a real Paystack bank transfer.`)) return;
        button.disabled = true;
        try { await api(`/admin/payout-requests/${button.dataset.payRequest}/pay`, { method: "POST" }); await loadPayoutRequests(); }
        catch (err) { button.disabled = false; renderError(el, err); }
      }));
    } catch (err) { renderError(el, err); }
  }

  async function handleCreateOrLoadPayout() {
    const weekInput = document.getElementById("payout-week").value.trim();
    const resultEl = document.getElementById("payout-result");
    const outputEl = document.getElementById("payout-output");
    renderLoading(resultEl, "Loading payout details…");
    outputEl.innerHTML = "";

    try {
      const data = await api("/admin/payouts", {
        method: "POST",
        body: JSON.stringify({ week: weekInput || undefined }),
      });
      displayPayoutDetails(data);
      loadPayoutHistory();
    } catch (err) {
      if (err.data?.error && err.data.error.includes("already exists")) {
        try {
          const payouts = await api("/admin/payouts");
          const targetWeek = weekInput || getIsoWeekLabel(new Date());
          const match = payouts.find((p) => p.week_label === targetWeek) || payouts[0];
          if (match) {
            const fullPayout = await api(`/admin/payouts/${match.id}`);
            displayPayoutDetails(fullPayout);
          } else {
            renderEmptyState(resultEl, `No payout found for week ${targetWeek}`, "bar-chart-3");
          }
        } catch (fetchErr) {
          renderError(resultEl, fetchErr);
        }
      } else {
        renderError(resultEl, err);
      }
    }
  }

  function displayPayoutDetails(payout) {
    const resultEl = document.getElementById("payout-result");
    const isDraft = payout.status === "draft";
    const statusBadgeClass = payout.status === "approved" || payout.status === "paid" ? "badge-success" : "badge-pending";

    const lineItemsHtml = payout.line_items && payout.line_items.length > 0
      ? `
        <table>
          <thead>
            <tr>
              <th>Ambassador</th>
              <th>Enrollments</th>
              <th>Renewals</th>
              <th>Amount</th>
              <th>Transfer Status</th>
            </tr>
          </thead>
          <tbody>
            ${payout.line_items
              .map((item) => {
                const statusClass =
                  item.transfer_status === "success"
                    ? "badge-success"
                    : item.transfer_status === "failed"
                    ? "badge-failed"
                    : "badge-pending";
                return `
                  <tr>
                    <td>${item.ambassador_name || `#${item.ambassador_id}`}</td>
                    <td>${item.enrollment_count || 0}</td>
                    <td>${item.renewal_count || 0}</td>
                    <td><strong>NGN ${(item.amount || 0).toLocaleString()}</strong></td>
                    <td><span class="badge ${statusClass}">${item.transfer_status || "pending"}</span></td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      `
      : `<div class="muted" style="padding:10px 0;">No line items for this payout.</div>`;

    resultEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3>Payout Week: ${payout.week_label}</h3>
        <span class="badge ${statusBadgeClass}">${payout.status.toUpperCase()}</span>
      </div>
      ${lineItemsHtml}
      <div style="margin-top:16px; font-size:1.05rem;">
        <strong>Total Amount: NGN ${(payout.total_amount || 0).toLocaleString()}</strong>
      </div>
      ${
        isDraft
          ? `<div style="margin-top:16px;">
              <button class="primary" id="payout-approve-btn">Approve &amp; Pay (Initiate Transfers)</button>
             </div>`
          : ""
      }
    `;

    if (isDraft) {
      document.getElementById("payout-approve-btn").addEventListener("click", () => handleApprovePayout(payout));
    }
  }

  async function handleApprovePayout(payout) {
    const ambassadorCount = payout.line_items ? payout.line_items.filter((i) => i.amount > 0).length : 0;
    const totalAmountStr = (payout.total_amount || 0).toLocaleString();

    const confirmed = window.confirm(
      `This will send real money to ${ambassadorCount} ambassador(s) totaling NGN ${totalAmountStr}. Continue?`
    );

    if (!confirmed) return;

    const outputEl = document.getElementById("payout-output");
    renderLoading(outputEl, "Initiating Paystack transfers… Please wait.");

    try {
      const summary = await api(`/admin/payouts/${payout.id}/approve`, { method: "POST" });
      outputEl.innerHTML = "";

      let summaryHtml = `<div class="alert-success">✔ Payout #${payout.id} successfully approved!</div>`;

      if (summary.paid && summary.paid.length > 0) {
        summaryHtml += `
          <div style="margin-top:10px;">
            <strong style="color:var(--teal);">Successful Transfers (${summary.paid.length}):</strong>
            <ul>
              ${summary.paid.map((p) => `<li>Ambassador #${p.ambassador_id}: NGN ${p.amount.toLocaleString()} ${p.transfer_code ? `(${p.transfer_code})` : ""}</li>`).join("")}
            </ul>
          </div>
        `;
      }

      if (summary.failed && summary.failed.length > 0) {
        summaryHtml += `
          <div class="alert-error" style="margin-top:10px;">
            <strong>❌ Failed Transfers (${summary.failed.length}):</strong>
            <ul>
              ${summary.failed.map((f) => `<li>Ambassador #${f.ambassador_id}: NGN ${f.amount.toLocaleString()} — ${f.error}</li>`).join("")}
            </ul>
          </div>
        `;
      }

      outputEl.innerHTML = summaryHtml;

      const updatedPayout = await api(`/admin/payouts/${payout.id}`);
      displayPayoutDetails(updatedPayout);
      loadPayoutHistory();
    } catch (err) {
      renderError(outputEl, err);
    }
  }

  // Prompt 5.3 CSV Export Integration
  async function loadPayoutHistory() {
    const historyEl = document.getElementById("payout-history");
    renderLoading(historyEl, "Loading payout history…");

    try {
      const payouts = await api("/admin/payouts");
      if (!payouts || payouts.length === 0) {
        renderEmptyState(historyEl, "No payout history records yet", "clock");
        return;
      }
      historyEl.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Week</th>
              <th>Status</th>
              <th>Total Amount</th>
              <th>Approved By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${payouts
              .map((p) => {
                const badgeClass = p.status === "approved" || p.status === "paid" ? "badge-success" : "badge-pending";
                return `
                  <tr>
                    <td><strong>${p.week_label}</strong></td>
                    <td><span class="badge ${badgeClass}">${p.status}</span></td>
                    <td>NGN ${(p.total_amount || 0).toLocaleString()}</td>
                    <td>${p.approved_by_name || "—"}</td>
                    <td style="display:flex; gap:4px;">
                      <button class="subtle" data-action="view-payout" data-id="${p.id}">View</button>
                      <button class="subtle" data-export-payout="${p.id}" data-week="${p.week_label}">
                        <i data-lucide="download" style="width:12px;height:12px;"></i> CSV
                      </button>
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      `;

      if (window.lucide) window.lucide.createIcons();

      historyEl.querySelectorAll('[data-action="view-payout"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          try {
            const fullPayout = await api(`/admin/payouts/${id}`);
            displayPayoutDetails(fullPayout);
            document.getElementById("payout-result").scrollIntoView({ behavior: "smooth" });
          } catch (err) {
            alert(`Failed to load payout details: ${err.message}`);
          }
        });
      });

      historyEl.querySelectorAll("[data-export-payout]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            await downloadPayoutCsv(btn.dataset.exportPayout, btn.dataset.week);
          } catch (err) {
            showToast(`CSV export failed: ${err.message}`, "error");
          } finally {
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      renderError(historyEl, err);
    }
  }
}

// ---------- Ambassador: My Groups ----------
async function renderMyGroupsView() {
  const container = document.getElementById("views");
  container.innerHTML = `<div class="card"><h2>My Groups</h2><div id="mg-list"></div></div>`;
  const listEl = document.getElementById("mg-list");
  renderLoading(listEl, "Loading your groups…");

  try {
    const groups = await api("/groups/mine");
    if (groups.length === 0) {
      renderEmptyState(listEl, "No groups created yet — create one from the Enroll tab", "layers");
      return;
    }
    listEl.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Created</th></tr></thead>
        <tbody>${groups.map(g => `<tr><td>${g.name}</td><td>${g.type}</td><td>${g.created_at}</td></tr>`).join("")}</tbody>
      </table>`;
  } catch (err) {
    renderError(listEl, err);
  }
}

// ---------- Ambassador: My Earnings ----------
async function renderMySummaryView() {
  const container = document.getElementById("views");
  container.innerHTML = `<div class="page-head"><h1>My Earnings</h1><p class="muted">Your commission, payment requests, and payout history.</p></div><div id="ms-content"></div>`;
  const contentEl = document.getElementById("ms-content");
  renderLoading(contentEl, "Calculating your earnings…");

  try {
    const s = await api("/me/earnings");
    const money = (v) => `NGN ${Number(v || 0).toLocaleString()}`;
    const stat = (icon, label, value, tone = "", hint = "") => `
      <div class="stat-card ${tone}">
        <div class="stat-icon"><i data-lucide="${icon}"></i></div>
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        ${hint ? `<div class="stat-hint">${hint}</div>` : ""}
      </div>`;
    contentEl.innerHTML = `
      <div class="stat-grid">
        ${stat("wallet", "Available to request", money(s.available), "tone-teal")}
        ${stat("check-circle-2", "Already paid", money(s.paid), "tone-gold")}
        ${stat("trending-up", "Lifetime commission", money(s.earned), "", `${money(s.pending)} currently requested`)}
      </div>
      <div class="card">
        <h3>Request payout</h3>
        <div class="grid">
          <input id="payout-request-amount" type="number" min="1" max="${s.available}" placeholder="Amount in NGN" />
          <input id="payout-request-note" placeholder="Optional note to admin" />
        </div>
        <button class="primary" id="payout-request-submit">Request payment</button>
        <div id="payout-request-output"></div>
      </div>
      <div class="card">
        <h3>Request history</h3>
        ${s.requests.length ? `<table><thead><tr><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>${s.requests.map(r => `<tr><td><strong>NGN ${Number(r.requested_amount).toLocaleString()}</strong></td><td><span class="badge ${r.status === "rejected" ? "badge-failed" : r.status === "paid" ? "badge-success" : "badge-pending"}">${r.status}</span></td><td>${r.created_at}</td></tr>`).join("")}</tbody></table>` : `<div class="muted">No payment requests yet.</div>`}
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    document.getElementById("payout-request-submit").addEventListener("click", () => {
      runWithLoading(document.getElementById("payout-request-submit"), "Requesting…", async () => {
        const output = document.getElementById("payout-request-output");
        try {
          const result = await api("/me/payout-requests", { method: "POST", body: JSON.stringify({ amount: document.getElementById("payout-request-amount").value, note: document.getElementById("payout-request-note").value }) });
          out("payout-request-output", result);
          setTimeout(renderMySummaryView, 900);
        } catch (err) { renderError(output, err); }
      });
    });
  } catch (err) {
    renderError(contentEl, err);
  }
}

// Helper: Calculate ISO week string (e.g. 2026-W30)
function getIsoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNo =
    1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// ---------- Enroll (shared by all roles) ----------
async function renderEnrollView() {
  const container = document.getElementById("views");
  const isAmbassador = state.user.role === "ambassador";

  let groupOptions = "";
  if (isAmbassador) {
    try {
      const groups = await api("/groups/mine");
      groupOptions = groups.map(g => `<option value="${g.id}">${g.name} (${g.type})</option>`).join("");
    } catch {}
  }

  container.innerHTML = `
    ${isAmbassador ? `
    <div class="card">
      <h2>Create a Group</h2>
      <p class="muted">Create one before enrolling if this is a new bank/market/school you're working.</p>
      <div class="grid">
        <input id="g-name" placeholder="Group name (e.g. GTBank Lagos Staff)" />
        <select id="g-type">
          <option value="Bank">Bank</option>
          <option value="Market">Market</option>
          <option value="School">School</option>
          <option value="Association">Association</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <button class="primary" id="g-create">Create Group</button>
      <pre class="output" id="g-output"></pre>
    </div>` : ""}

    <div class="card">
      <h2>Enroll Customer</h2>
      <div class="grid">
        <input id="e-firstName" placeholder="First name" />
        <input id="e-lastName" placeholder="Last name" />
        <input id="e-phoneNumber" placeholder="Phone number (2348...)" />
        <input id="e-email" placeholder="Email (optional)" />
        <div style="grid-column:1 / -1">
          <label class="muted">Choose a plan</label>
          <div id="e-planCards" class="plan-card-wrap">Fetching available health plans…</div>
          <div id="e-planSummary" class="plan-summary muted">Select a plan to continue.</div>
        </div>
        <input id="e-planCode" type="hidden" />
        <input id="e-planName" type="hidden" />
        <input id="e-location" placeholder="Location (e.g. Lagos, Nigeria)" />
        <select id="e-gender"><option value="Female">Female</option><option value="Male">Male</option></select>
        <input id="e-dateOfBirth" type="date" />
        <div class="muted" style="grid-column:1 / -1">Clicking Enroll will open the Paystack checkout automatically.</div>
        ${isAmbassador ? `<select id="e-groupId"><option value="">Select group\u2026</option>${groupOptions}</select>` : ""}
      </div>
      <button class="primary" id="e-submit">Enroll</button>
      <pre class="output" id="e-output"></pre>
    </div>
  `;

  const planCards = document.getElementById("e-planCards");
  const planSummary = document.getElementById("e-planSummary");
  const planCodeField = document.getElementById("e-planCode");
  const planNameField = document.getElementById("e-planName");

  if (planCards && planCodeField && planNameField) {
    (async () => {
      try {
        const plansData = await api("/plans/health");
        const plans = normalizePlans(plansData);
        renderPlanCards(planCards, plans, {
          emptyText: "No plans were returned by the provider.",
          onSelect: (plan) => {
            const { code, name, price, desc } = planCardMeta(plan);
            planCodeField.value = code;
            planNameField.value = name;
            const line = price
              ? `Selected: <strong>${name}</strong> · <strong>${price}</strong> + <strong>NGN ${PAYMENT_FEE_NAIRA.toLocaleString()}</strong> payment fee`
              : `Selected: <strong>${name}</strong> + <strong>NGN ${PAYMENT_FEE_NAIRA.toLocaleString()}</strong> payment fee`;
            const feeNote = `<div class="muted">You’ll pay plan price + NGN ${PAYMENT_FEE_NAIRA.toLocaleString()} payment fee at checkout.</div>`;
            planSummary.innerHTML = (desc ? `${line}<br><span class="muted">${desc}</span>` : line) + feeNote;
          },
        });
      } catch (err) {
        planCards.innerHTML = `<div class="alert-error">Unable to load plans right now: ${err.message}</div>`;
      }
    })();
  }

  if (isAmbassador) {
    document.getElementById("g-create").addEventListener("click", () => {
      runWithLoading(document.getElementById("g-create"), "Creating…", async () => {
        try {
          const data = await api("/groups", {
            method: "POST",
            body: JSON.stringify({ name: document.getElementById("g-name").value, type: document.getElementById("g-type").value }),
          });
          out("g-output", data);
          renderEnrollView();
        } catch (err) {
          out("g-output", err.data || err.message);
        }
      });
    });
  }

  document.getElementById("e-submit").addEventListener("click", () => {
    const payload = {
      firstName: document.getElementById("e-firstName").value,
      lastName: document.getElementById("e-lastName").value,
      phoneNumber: document.getElementById("e-phoneNumber").value,
      email: document.getElementById("e-email").value,
      planCode: document.getElementById("e-planCode").value,
      planName: document.getElementById("e-planName").value,
      paymentMethod: "paystack",
      location: document.getElementById("e-location").value,
      gender: document.getElementById("e-gender").value,
      dateOfBirth: document.getElementById("e-dateOfBirth").value,
    };
    if (isAmbassador) payload.groupId = document.getElementById("e-groupId").value;
    runWithLoading(document.getElementById("e-submit"), "Opening checkout…", async () => {
      try {
        const data = await api("/subscriptions", { method: "POST", body: JSON.stringify(payload) });
        if (data.paymentRequired && data.authorizationUrl) {
          out("e-output", { message: "Opening secure Paystack checkout…", paymentRequired: true });
          window.location.assign(data.authorizationUrl);
          return;
        } else {
          out("e-output", data);
        }
        clearFields(["e-firstName", "e-lastName", "e-phoneNumber", "e-email", "e-location", "e-gender", "e-dateOfBirth", "e-groupId"]);
        clearPlanSelection("e-planCards", "e-planSummary");
      } catch (err) {
        out("e-output", err.data || err.message);
      }
    });
  });
}

// ---------- Ambassador: Bulk Enroll ----------
async function renderBulkEnrollView() {
  const container = document.getElementById("views");
  container.innerHTML = `<div class="card"><h2>Bulk Enroll</h2><p class="muted">Add up to 20 people on the same plan, review the total, and make one secure payment.</p><div id="bulk-form"></div></div>`;
  const form = document.getElementById("bulk-form");
  try {
    const [groups, plansData] = await Promise.all([api("/groups/mine"), api("/plans/health")]);
    const plans = normalizePlans(plansData);
    form.innerHTML = `<select id="bulk-group"><option value="">Choose your group</option>${groups.map(g => `<option value="${g.id}">${g.name}</option>`).join("")}</select><select id="bulk-plan" style="margin-top:8px"><option value="">Choose one plan for this batch</option>${plans.map(p => { const m = getPlanMeta(p); const price = Number(m.price); return `<option value="${m.code}" data-price="${m.price}">${m.name} — NGN ${price.toLocaleString()} per person (+ NGN ${PAYMENT_FEE_NAIRA} fee per batch)</option>`; }).join("")}</select><div id="bulk-rows" style="margin-top:12px"></div><button class="subtle" id="bulk-add">Add person</button><button class="primary" id="bulk-pay" style="margin-left:6px">Review & pay</button><div id="bulk-output"></div>`;
    const rows = document.getElementById("bulk-rows");
    function addRow() {
      if (rows.children.length >= 20) return;
      const row = document.createElement("div"); row.className = "card bulk-row";
      row.innerHTML = `<input placeholder="First name" data-field="firstName" /><input placeholder="Last name" data-field="lastName" style="margin-top:6px" /><input placeholder="Phone number" data-field="phoneNumber" style="margin-top:6px" /><input placeholder="Email (optional)" data-field="email" style="margin-top:6px" /><input placeholder="Location" data-field="location" style="margin-top:6px" /><input type="date" data-field="dateOfBirth" style="margin-top:6px" /><select data-field="gender" style="margin-top:6px"><option value="">Gender</option><option>Male</option><option>Female</option></select><button class="subtle bulk-remove" type="button" style="margin-top:6px">Remove</button>`;
      row.querySelector(".bulk-remove").onclick = () => row.remove(); rows.appendChild(row);
    }
    addRow();
    document.getElementById("bulk-add").onclick = addRow;
    document.getElementById("bulk-pay").onclick = () => {
      const customers = [...rows.children].map(row => Object.fromEntries([...row.querySelectorAll("[data-field]")].map(el => [el.dataset.field, el.value.trim()])));
      const selectedPlan = document.getElementById("bulk-plan");
      const planTotal = Number(selectedPlan.options[selectedPlan.selectedIndex]?.dataset.price || 0) * customers.length;
      const total = planTotal + PAYMENT_FEE_NAIRA;
      if (!window.confirm(`You are about to pay NGN ${total.toLocaleString()} (NGN ${planTotal.toLocaleString()} plans + NGN ${PAYMENT_FEE_NAIRA.toLocaleString()} payment fee) for ${customers.length} customer(s). Continue?`)) return;
      runWithLoading(document.getElementById("bulk-pay"), "Preparing payment…", async () => {
        try {
          const result = await api("/bulk-orders", { method: "POST", body: JSON.stringify({ groupId: document.getElementById("bulk-group").value, planCode: selectedPlan.value, customers }) });
          out("bulk-output", { message: `Opening secure payment for ${result.customerCount} customers…`, paymentRequired: true });
          window.location.assign(result.authorizationUrl);
        } catch (err) { renderError(document.getElementById("bulk-output"), err); }
      });
    };
  } catch (err) { renderError(form, err); }
}

// ---------- Look Up (shared) ----------
function renderLookupView() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="card">
      <h2>Look Up Subscription</h2>
      <div class="row">
        <select id="l-type"><option value="phone">By phone number</option><option value="policy">By policy number</option></select>
        <input id="l-value" placeholder="e.g. 2348123456789" />
        <button class="primary" id="l-submit">Look up</button>
      </div>
      <pre class="output" id="l-output"></pre>
    </div>
  `;
  document.getElementById("l-submit").addEventListener("click", () => {
    const type = document.getElementById("l-type").value;
    const value = document.getElementById("l-value").value.trim();
    const outputEl = document.getElementById("l-output");
    if (!value) return out("l-output", { error: "Enter a value" });
    runWithLoading(document.getElementById("l-submit"), "Looking up…", async () => {
      renderLoading(outputEl, `Searching for ${value}…`);
      try {
        const path = type === "phone" ? `/subscriptions/phone/${encodeURIComponent(value)}` : `/subscriptions/policy/${encodeURIComponent(value)}`;
        const data = await api(path);
        out("l-output", data);
      } catch (err) {
        out("l-output", err.data || err.message);
      }
    });
  });
}

// ---------- Renew (shared) ----------
function renderRenewView() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="card">
      <h2>Renew Subscription</h2>
      <p class="muted">Any agent or ambassador can renew any customer \u2014 not limited to who originally enrolled them.</p>
      <div class="grid">
        <input id="r-phoneNumber" placeholder="Phone number" />
        <div style="grid-column:1 / -1">
          <label class="muted">Choose a plan</label>
          <div id="r-planCards" class="plan-card-wrap">Fetching available health plans…</div>
          <div id="r-planSummary" class="plan-summary muted">Select a plan to continue.</div>
        </div>
        <input id="r-planCode" type="hidden" />
        <div class="muted" style="grid-column:1 / -1">Clicking Renew will open the Paystack checkout automatically.</div>
      </div>
      <button class="primary" id="r-submit">Renew</button>
      <pre class="output" id="r-output"></pre>
    </div>
  `;

  const planCards = document.getElementById("r-planCards");
  const planSummary = document.getElementById("r-planSummary");
  const planCodeField = document.getElementById("r-planCode");

  if (planCards && planCodeField) {
    (async () => {
      try {
        const plansData = await api("/plans/health");
        const plans = normalizePlans(plansData);
        renderPlanCards(planCards, plans, {
          emptyText: "No plans were returned by the provider.",
          onSelect: (plan) => {
            const { code, name, price, desc } = planCardMeta(plan);
            planCodeField.value = code;
            const line = price
              ? `Selected: <strong>${name}</strong> · <strong>${price}</strong> + <strong>NGN ${PAYMENT_FEE_NAIRA.toLocaleString()}</strong> payment fee`
              : `Selected: <strong>${name}</strong> + <strong>NGN ${PAYMENT_FEE_NAIRA.toLocaleString()}</strong> payment fee`;
            const feeNote = `<div class="muted">You’ll pay plan price + NGN ${PAYMENT_FEE_NAIRA.toLocaleString()} payment fee at checkout.</div>`;
            planSummary.innerHTML = (desc ? `${line}<br><span class="muted">${desc}</span>` : line) + feeNote;
          },
        });
      } catch (err) {
        planCards.innerHTML = `<div class="alert-error">Unable to load plans right now: ${err.message}</div>`;
      }
    })();
  }

  document.getElementById("r-submit").addEventListener("click", () => {
    const payload = {
      phoneNumber: document.getElementById("r-phoneNumber").value,
      planCode: document.getElementById("r-planCode").value,
      paymentMethod: "paystack",
    };
    runWithLoading(document.getElementById("r-submit"), "Processing…", async () => {
      try {
        const data = await api("/subscriptions/renewals", { method: "POST", body: JSON.stringify(payload) });
        if (data.paymentRequired && data.authorizationUrl) {
          out("r-output", { message: "Opening secure Paystack checkout…", paymentRequired: true });
          window.location.assign(data.authorizationUrl);
          return;
        } else {
          out("r-output", data);
        }
        clearFields(["r-phoneNumber", "r-planCode"]);
        clearPlanSelection("r-planCards", "r-planSummary");
      } catch (err) {
        out("r-output", err.data || err.message);
      }
    });
  });
}

// ---------- My Enrollments (agent / customer / admin) ----------
async function renderMyPoliciesView() {
  const container = document.getElementById("views");
  container.innerHTML = `<div class="card"><h2>My Enrollments</h2><div id="mp-list"></div></div>`;
  const listEl = document.getElementById("mp-list");
  renderLoading(listEl, "Loading your enrollments…");

  try {
    const policies = await api("/me/policies");
    if (policies.length === 0) {
      renderEmptyState(listEl, "No enrollments created yet", "file-text");
      return;
    }
    listEl.innerHTML = `
      <table>
        <thead><tr><th>Customer</th><th>Plan</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>
          ${policies.map(p => {
            const badgeClass = p.status === "Active" ? "badge-success" : p.status === "Cancelled" || p.status === "Expired" ? "badge-failed" : "badge-pending";
            return `<tr><td><strong>${p.customer_name}</strong><div class="muted">${p.customer_phone || ""}</div></td><td>${p.plan_code}</td><td><span class="badge ${badgeClass}">${p.status}</span></td><td>${p.created_at}</td></tr>`;
          }).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    renderError(listEl, err);
  }
}

// ---------- Read Manual (full per-role guide) ----------
const MANUAL_COMMON = `
  <h2>Getting Started</h2>
  <h3>Logging in</h3>
  <p>Open SehaNet and enter the <strong>username</strong> and <strong>password</strong> your admin gave you, then click <strong>Log in</strong>. If you don't have login details yet, ask your admin to create an account for you.</p>
  <h3>Changing your password</h3>
  <p>Click the <strong>key icon</strong> at the top of the screen, enter your current password and a new one (at least 6 characters), type it again to confirm, and click <strong>Update</strong>. The app signs you out if you're idle for 2 minutes — that's a security feature, not a bug.</p>
  <h3>Signing out</h3>
  <p>Click the <strong>Log out</strong> button at the top of the screen whenever you finish working. Never share your password with anyone, and don't leave yourself logged in on a shared computer.</p>
`;

const MANUAL_COMMISSION_ENGINE = `
  <h2>How Commission Works</h2>
  <p>SehaNet's money model is simple. When a customer pays for a plan:</p>
  <ol>
    <li>The customer pays the <strong>plan price</strong>, plus a fixed <strong>NGN 500 payment fee</strong> at every checkout (one fee per transaction, even for bulk enrollments).</li>
    <li><strong>WellaHealth's cut to admin</strong> (the percentage in Commission Settings) is the share of the plan price that comes to the business. This is the admin's income from the sale.</li>
    <li>An <strong>Ambassador's commission</strong> is a percentage of that WellaHealth cut — <em>not</em> a percentage of the full customer payment. A different rate applies to new enrollments vs. renewals.</li>
  </ol>
  <p>So one new enrollment of NGN 5,000 with a 20% WellaHealth cut and a 30% ambassador rate looks like this:</p>
  <ul>
    <li>WellaHealth cut to admin: NGN 5,000 × 20% = <strong>NGN 1,000</strong></li>
    <li>Ambassador commission: NGN 1,000 × 30% = <strong>NGN 300</strong></li>
    <li>Admin net after expenses: NGN 1,000 + NGN 500 fee − NGN 300 = <strong>NGN 1,200</strong></li>
  </ul>
  <p>Rates are snapshotted at the moment of sale. Changing Commission Settings only affects future activity — it never rewrites a commission that was already earned.</p>
`;

const MANUAL_BY_ROLE = {
  admin: `
    <h1>SehaNet — Administrator Manual</h1>
    <p>This guide walks through every tab available to an admin, in order. Read the sections that apply to what you're doing today.</p>
    ${MANUAL_COMMON}
    <h2>Dashboard</h2>
    <p>The Dashboard is a live summary of the whole business. It shows:</p>
    <ul>
      <li><strong>Payments recorded</strong> — total money that came in from policies and renewals (plan prices plus payment fees).</li>
      <li><strong>Payment fees collected</strong> — total NGN 500 fees charged across all checkouts.</li>
      <li><strong>Admin net before expenses</strong> — all recorded payments less ambassador commission owed.</li>
      <li><strong>Admin net after expenses</strong> — your actual income: the WellaHealth cut (plan payments × the % set in Commission Settings), plus payment fees, less ambassador commission owed. See "How Commission Works" below.</li>
      <li><strong>Ambassador commission owed / paid</strong> — what ambassadors have earned and what has already been paid out. The gap is the outstanding balance.</li>
      <li><strong>Customers / Active policies</strong> — total customer records and currently-active policies.</li>
    </ul>
    <p>These figures are calculated from recorded data only; nothing here is typed in by hand.</p>

    <h2>Agents &amp; Ambassadors</h2>
    <h3>Creating an account</h3>
    <p>Fill in the person's <strong>name, phone, username, and password</strong> (you choose it — they can change it themselves later). Pick a role:</p>
    <ul>
      <li><strong>Agent (unpaid)</strong> — can enroll, look up, and renew customers, but earns no commission and uses no Groups.</li>
      <li><strong>Ambassador (paid)</strong> — earns commission and works through Groups. When you select Ambassador, bank fields appear.</li>
    </ul>
    <p>For an Ambassador, choose the <strong>bank</strong> and enter the <strong>account number</strong>. SehaNet verifies the account against the bank and shows the real account holder's name before saving — always confirm this matches the person you intend to pay.</p>
    <h3>Editing someone</h3>
    <p>Click <strong>Edit</strong> next to a user to change their name, phone, or bank details, or to set a <strong>personal commission rate</strong> that overrides the default. Clicking <strong>Save &amp; Verify Bank</strong> re-checks the account number before saving.</p>
    <h3>Blocking, unblocking, removing</h3>
    <ul>
      <li><strong>Block</strong> — temporary pause. The user can't log in while blocked. You must give a reason. <strong>Unblock</strong> restores access any time.</li>
      <li><strong>Remove</strong> — permanent, and it cannot be undone. For an Ambassador you can optionally <strong>reassign future commissions</strong> to another active Ambassador; this only affects renewals going forward. Anything already earned is untouched and still gets paid.</li>
    </ul>

    <h2>Policies</h2>
    <p>The full directory of every enrollment. <strong>Search</strong> by customer name or phone, or <strong>filter by status</strong> (Active, Cancelled, Expired). The list is paginated — use Previous/Next to move through results. Each row shows the customer, plan, WellaHealth policy number, amount paid, status, who enrolled them, and the policy end date.</p>

    <h2>Renewals Due</h2>
    <p>Every policy across the whole system that expires within the next 14 days, soonest first. Rows due in 3 days or less are highlighted. Use the phone number link to call or SMS the customer and remind them to renew — reminders are still sent manually.</p>

    <h2>Groups</h2>
    <p>A read-only view of every Group Ambassadors have created (which bank, market, school, or association each one covers). Groups are created by Ambassadors themselves, not by you.</p>

    <h2>Commission Settings</h2>
    <p>Three percentages control all money calculations:</p>
    <ul>
      <li><strong>WellaHealth's cut to admin (%)</strong> — the share of each plan payment that comes to your business.</li>
      <li><strong>Ambassador rate — new enrollment (%)</strong> — what an Ambassador earns from a new sign-up, as a share of the WellaHealth cut above.</li>
      <li><strong>Ambassador rate — renewal (%)</strong> — the same idea for renewals.</li>
    </ul>
    <p>Click <strong>Save Settings</strong> when done. Changes only affect activity going forward. You can also override the rate for one specific Ambassador from their profile in Agents &amp; Ambassadors.</p>

    <h2>Weekly Payout</h2>
    <p>This is where Ambassadors actually get paid.</p>
    <h3>Load a draft</h3>
    <p>Click <strong>Load / Create Draft</strong> for the current week (leave the week field blank), or type a specific week (e.g. 2026-W30) to catch up on a past one.</p>
    <h3>Review</h3>
    <p>The draft lists each Ambassador, how many enrollments and renewals they had, and the exact amount owed. Check these numbers before paying — this is the amount of money that will leave your account.</p>
    <h3>Approve &amp; Pay</h3>
    <p>Clicking <strong>Approve &amp; Pay</strong> initiates real Paystack bank transfers to each Ambassador's verified account. There is no undo, so double-check the total first. A failed transfer (e.g. a bad account number) is clearly marked and doesn't block the others; fix the account details and retry.</p>
    <h3>Payout History</h3>
    <p>Every past payout is kept here, and you can export any week as a CSV spreadsheet for your records.</p>
    <h3>Ambassador Payment Requests</h3>
    <p>When an Ambassador requests a payment from My Earnings, it appears here with their available balance. <strong>Approve</strong> to accept it, <strong>Reject</strong> to decline (optionally leaving a note), or <strong>Pay now</strong> to send the money immediately via Paystack. Only approve amounts you're sure about.</p>

    <h2>Enroll</h2>
    <p>Register a single customer exactly like an Agent would: fill in their details, pick a plan (the price plus the NGN 500 payment fee is shown), and click <strong>Enroll</strong>. The customer is taken to the secure Paystack checkout and, once payment succeeds, their WellaHealth policy is created automatically. The same phone number can never be enrolled twice.</p>

    <h2>Look Up</h2>
    <p>Find any customer by <strong>phone number</strong> or <strong>WellaHealth policy number</strong>. Results show the full subscription details, including nested payment information.</p>

    <h2>Renew</h2>
    <p>Renew any customer in the system: enter their phone number, choose a plan, and click <strong>Renew</strong>. They pay via the Paystack checkout (plan price + NGN 500 fee) and their policy end date is extended automatically.</p>

    ${MANUAL_COMMISSION_ENGINE}

    <h2>Security notes</h2>
    <p>Never share your password, Paystack keys, or customer data. Always confirm an Ambassador's bank details before approving a real transfer, and never pay a payout amount you haven't reviewed in the draft.</p>
  `,

  ambassador: `
    <h1>SehaNet — Ambassador Manual</h1>
    <p>As an Ambassador you enroll and renew customers and earn commission for it. This guide explains every tab you see.</p>
    ${MANUAL_COMMON}
    ${MANUAL_COMMISSION_ENGINE}

    <h2>Enroll</h2>
    <h3>Create a Group first</h3>
    <p>A <strong>Group</strong> represents the community you're working — a bank's staff, a market, a school, and so on. On the Enroll tab, give your Group a name (e.g. "GTBank Lagos Staff") and pick a type (Bank, Market, School, Association, or Other), then click <strong>Create Group</strong>. You only do this once per community; after that you pick it from the dropdown.</p>
    <h3>Enrolling one customer</h3>
    <ol>
      <li>Pick the Group this customer belongs to (or create a new one).</li>
      <li>Fill in the customer's <strong>first name, last name, phone number</strong> (in the format 2348...), email (optional), <strong>location, gender, and date of birth</strong>.</li>
      <li>Choose a plan from the cards. The summary shows the plan price plus the <strong>NGN 500 payment fee</strong> you'll collect.</li>
      <li>Click <strong>Enroll</strong> — the customer is taken to the secure Paystack checkout. When payment succeeds, their WellaHealth policy is created automatically and you'll see the confirmation.</li>
    </ol>
    <p><strong>You can't enroll the same phone number twice.</strong> If someone is already a customer, use <strong>Renew</strong> instead.</p>

    <h2>Bulk Enroll</h2>
    <p>For up to <strong>20 people on the same plan</strong> in one payment:</p>
    <ol>
      <li>Choose your <strong>Group</strong> and one <strong>plan</strong> for the whole batch.</li>
      <li>Click <strong>Add person</strong> to fill in each customer's details (a name, phone, location, date of birth, and gender are required for every person).</li>
      <li>Click <strong>Review &amp; pay</strong>. You'll see the total (all plan prices plus a single NGN 500 payment fee for the batch) and confirm.</li>
      <li>The batch opens in the secure Paystack checkout. Once paid, SehaNet creates each customer's policy automatically.</li>
    </ol>
    <p>All phone numbers in a batch must be different, and none may already be enrolled.</p>

    <h2>Renewals Due</h2>
    <p>Your worklist: your own customers whose plans expire within the next 14 days, soonest first. Rows due in 3 days or less are highlighted. Call or message them to offer a renewal.</p>

    <h2>Look Up</h2>
    <p>Find any customer in the system by <strong>phone number</strong> or <strong>policy number</strong> — useful for checking a customer's plan before renewing them.</p>

    <h2>Renew</h2>
    <p>You can renew <strong>any</strong> customer, not just ones you enrolled. Enter their phone number, choose a plan, and click <strong>Renew</strong>. They pay via the secure checkout (plan price + NGN 500 fee) and their policy end date extends automatically.</p>

    <h2>My Groups</h2>
    <p>A list of every Group you've created, with its type and when it was made.</p>

    <h2>My Earnings</h2>
    <p>Your money, in one place:</p>
    <ul>
      <li><strong>Available to request</strong> — commission you've earned and can withdraw right now.</li>
      <li><strong>Already paid</strong> — what has been paid out to you.</li>
      <li><strong>Lifetime commission</strong> — everything you've ever earned, including amounts currently sitting in a request.</li>
    </ul>
    <h3>Requesting payment</h3>
    <p>Enter an amount up to your available balance, optionally add a note, and click <strong>Request payment</strong>. Your admin reviews it in Weekly Payout; if approved, the money is sent to the bank account on file. Track the status of each request in <strong>Request history</strong> (Pending / Approved / Paid / Rejected).</p>

    <h2>Security notes</h2>
    <p>Keep your username and password private. You can only see your own customers and earnings — you cannot view another Ambassador's.</p>
  `,

  agent: `
    <h1>SehaNet — Agent Manual</h1>
    <p>As an Agent you enroll, look up, and renew customers. You don't earn commission and you don't use Groups. This guide explains every tab you see.</p>
    ${MANUAL_COMMON}

    <h2>Enroll</h2>
    <ol>
      <li>Fill in the customer's <strong>first name, last name, phone number</strong> (format 2348...), email (optional), <strong>location, gender, and date of birth</strong>.</li>
      <li>Choose a plan from the cards. The summary shows the plan price plus the <strong>NGN 500 payment fee</strong> charged at checkout.</li>
      <li>Click <strong>Enroll</strong> — the customer is taken to the secure Paystack checkout. When payment succeeds, their WellaHealth policy is created automatically.</li>
    </ol>
    <p><strong>You can't enroll the same phone number twice.</strong> If someone is already a customer, use <strong>Renew</strong> instead.</p>

    <h2>Renewals Due</h2>
    <p>Your worklist: customers you enrolled whose plans expire within the next 14 days, soonest first. Rows due in 3 days or less are highlighted. Contact them to offer a renewal.</p>

    <h2>Look Up</h2>
    <p>Find any customer by <strong>phone number</strong> or <strong>WellaHealth policy number</strong> — handy before renewing someone.</p>

    <h2>Renew</h2>
    <p>You can renew <strong>any</strong> customer in the system. Enter their phone number, choose a plan, and click <strong>Renew</strong>. They pay via the secure checkout (plan price + NGN 500 fee) and their policy end date extends automatically.</p>

    <h2>My Enrollments</h2>
    <p>Everyone you've personally signed up, with their current status (Active, Cancelled, Expired, etc.) and when they were enrolled. Use this for follow-up.</p>

    <h2>Security notes</h2>
    <p>Keep your username and password private. You only see your own enrollment records.</p>
  `,

  customer: `
    <h1>SehaNet — Customer Manual</h1>
    <p>SehaNet is how you buy and manage your WellaHealth plan. This guide explains the tabs available to you.</p>
    ${MANUAL_COMMON}

    <h2>My Plan</h2>
    <p>Your current policy: the plan you're on, its status, and when it was created. If your policy is active, you're covered — keep an eye on the end date so you can renew before it expires.</p>

    <h2>Enroll</h2>
    <p>Buy a health plan:</p>
    <ol>
      <li>Fill in your details (your phone number must match the one on your account).</li>
      <li>Choose a plan. The summary shows the plan price plus the <strong>NGN 500 payment fee</strong> added at checkout.</li>
      <li>Click <strong>Enroll</strong> — you're taken to the secure Paystack checkout to pay by card.</li>
    </ol>
    <p>Once payment succeeds, your policy is created automatically. Your phone number can only be enrolled once.</p>

    <h2>Plan Expiry</h2>
    <p>Shows when your plan is due to expire (within the next 14 days), so you know when to renew and avoid a gap in cover.</p>

    <h2>Security notes</h2>
    <p>Keep your username and password private. If you think your account has been used without permission, tell your admin immediately.</p>
  `,
};

async function renderManualView() {
  const container = document.getElementById("views");
  const content = MANUAL_BY_ROLE[state.user.role] || MANUAL_BY_ROLE.agent;
  container.innerHTML = `<div class="card"><button class="subtle manual-back-btn" id="manual-back-btn">← Back</button><div class="manual-content">${content}</div></div>`;
  document.getElementById("manual-back-btn").addEventListener("click", () => setActiveTab(state.lastTab || (TABS_BY_ROLE[state.user.role] || [])[0]?.[0]));
}

// ---------- Init ----------
if (state.token) {
  boot();
}
