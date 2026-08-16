const API_BASE = "/api";

let state = {
  token: localStorage.getItem("sehanet_token") || null,
  user: null,
  activeTab: null,
  lastTab: null,
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

// Keep forms from doing native page reloads
document.getElementById("loginForm")?.addEventListener("submit", (e) => e.preventDefault());
document.getElementById("registerForm")?.addEventListener("submit", (e) => e.preventDefault());

document.getElementById("loginBtn")?.addEventListener("click", login);
document.getElementById("loginPassword")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});

document.getElementById("showRegisterBtn")?.addEventListener("click", () => {
  document.querySelector("#loginScreen .login-card").classList.add("hidden");
  document.getElementById("registerCard").classList.remove("hidden");
});
document.getElementById("showLoginBtn")?.addEventListener("click", () => {
  document.getElementById("registerCard").classList.add("hidden");
  document.querySelector("#loginScreen .login-card").classList.remove("hidden");
});
document.getElementById("registerBtn")?.addEventListener("click", () => {
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

document.getElementById("logoutBtn")?.addEventListener("click", doLogout);

// ---------- Session inactivity lockout ----------
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
  tabsEl.addEventListener("click", (e) => {
    if (e.target.closest(".tab-btn")) closeMenu();
  });
})();

// ---------- Payment result toast ----------
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

  window.history.replaceState({}, document.title, window.location.pathname);
}

// ---------- UI Helpers ----------
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
      <div class="muted">Please check the information and try again. If this continues, contact support.</div>
    </div>
  `;
}

async function runWithLoading(button, busyLabel, fn) {
  if (!button) return fn();
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

// Password modal
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

  cancelBtn?.addEventListener("click", () => modal.classList.add("hidden"));
  document.getElementById("pwd-close")?.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });

  submitBtn?.addEventListener("click", () => {
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

// Onboarding tour
const TOUR_STEPS_BY_ROLE = {
  admin: [
    { tab: "dashboard", desc: "See customer payments, your net before and after expenses, active policies, and ambassador commission totals." },
    { tab: "team", desc: "Create and manage agents and ambassadors." },
    { tab: "policies", desc: "Search all customer records by name, phone, or email." },
    { tab: "payout", desc: "Review ambassador payment requests and process bank transfers." },
    { tab: "settings", desc: "Set commission percentages." },
  ],
  ambassador: [
    { tab: "dashboard", desc: "Your personal hub with quick actions, customer stats, and communities." },
    { tab: "enroll", desc: "Enroll a customer and select or create their community." },
    { tab: "bulkenroll", desc: "Enroll up to 20 people in one batch." },
    { tab: "renewalsdue", desc: "Follow up with expiring policies." },
    { tab: "mysummary", desc: "View available earnings and request payouts." },
  ],
  agent: [
    { tab: "dashboard", desc: "Your agent hub showing active customers and quick action shortcuts." },
    { tab: "enroll", desc: "Enroll a new customer into a health plan." },
    { tab: "renewalsdue", desc: "Track customer policy renewal dates." },
  ],
  customer: [
    { tab: "mypolicies", desc: "See your health plan and policy status." },
    { tab: "enroll", desc: "Enroll yourself in a health plan." },
  ],
};

function isMobileDevice() {
  return window.innerWidth < 900 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function tourStorageKey() {
  return `sehanet_tour_seen_v2_${state.user?.username || "anon"}`;
}

function maybeStartTour() {
  if (isMobileDevice()) return;
  if (localStorage.getItem(tourStorageKey())) return;
  startTour();
}

function startTour() {
  if (isMobileDevice()) {
    showToast("The interactive tour is designed for desktop screens.", "info");
    return;
  }
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
    if (!el) continue;
    driverSteps.push({
      element: el,
      popover: {
        title: el.textContent.trim(),
        description: step.desc,
        side: "right",
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

document.getElementById("retakeTourBtn")?.addEventListener("click", () => {
  if (isMobileDevice()) {
    showToast("The interactive tour is available on desktop screens.", "info");
    return;
  }
  localStorage.removeItem(tourStorageKey());
  startTour();
});

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
  setTimeout(() => maybeStartTour(), 400);
}

// ---------- Role Tab Definitions & Router ----------
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
    ["dashboard", "Dashboard"],
    ["enroll", "Enroll Customer"],
    ["bulkenroll", "Bulk Enrollment"],
    ["renewalsdue", "Renewals Due"],
    ["renew", "Renew Customer"],
    ["lookup", "Customer Lookup"],
    ["mygroups", "My Communities"],
    ["mysummary", "My Earnings"],
  ],
  agent: [
    ["dashboard", "Dashboard"],
    ["enroll", "Enroll"],
    ["renew", "Renew"],
    ["lookup", "Customer Lookup"],
    ["renewalsdue", "Renewals Due"],
    ["mypolicies", "My Customers"],
  ],
  customer: [
    ["home", "Home"],
    ["myhealthcare", "My Healthcare"],
    ["search", "Search"],
    ["notifications", "Notifications"],
    ["profile", "Profile"],
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
  enroll: "user-plus",
  bulkenroll: "users-round",
  lookup: "search",
  renew: "repeat",
  mygroups: "layers",
  mysummary: "wallet",
  mypolicies: "file-text",
  home: "home",
  myhealthcare: "shield-check",
  notifications: "bell",
  profile: "user",
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
  if (state.activeTab && state.activeTab !== "readmanual") {
    state.lastTab = state.activeTab;
  }
  state.activeTab = key;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === key));
  
  const views = {
    dashboard: renderRoleDashboard,
    home: renderCustomerHome,
    myhealthcare: renderCustomerHealthcare,
    search: state.user?.role === "customer" ? renderCustomerSearch : renderLookupView,
    notifications: renderCustomerNotifications,
    profile: renderCustomerProfile,
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

function renderRoleDashboard() {
  if (state.user.role === "admin") return renderAdminDashboard();
  if (state.user.role === "ambassador") return renderAmbassadorDashboard();
  if (state.user.role === "agent") return renderAgentDashboard();
  return renderCustomerHome();
}

// ---------- Ambassador Dashboard ----------
async function renderAmbassadorDashboard() {
  const container = document.getElementById("views");
  container.innerHTML = `<div id="dashboard-content"></div>`;
  const content = document.getElementById("dashboard-content");
  renderLoading(content, "Loading dashboard figures…");

  try {
    const [earnings, renewals, groups, policies] = await Promise.all([
      api("/me/earnings").catch(() => ({ available: 0, earned: 0, paid: 0 })),
      api("/me/renewals-due").catch(() => []),
      api("/groups/mine").catch(() => []),
      api("/me/policies").catch(() => []),
    ]);

    const customerCount = policies.length;
    const renewalsCount = renewals.length;
    const availableComm = earnings.available || 0;
    const lifetimeComm = earnings.earned || 0;

    const money = (v) => `₦${Number(v || 0).toLocaleString()}`;
    const name = state.user.name || state.user.username || "Ambassador";

    const hour = new Date().getHours();
    const greetingTime = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    content.innerHTML = `
      <div class="greeting-banner">
        <h1 class="greeting-title">${greetingTime}, ${esc(name)} 👋</h1>
        <p class="greeting-subtitle">You currently manage <strong>${customerCount} customers</strong>, <strong>${renewalsCount} renewals due</strong>, and have <strong>${money(availableComm)}</strong> available commission.</p>
        <div class="greeting-pills">
          <span class="greeting-pill">👥 ${customerCount} Customers</span>
          <span class="greeting-pill">⏰ ${renewalsCount} Renewals Due</span>
          <span class="greeting-pill">💰 ${money(availableComm)} Available</span>
        </div>
      </div>

      <!-- Top Statistics -->
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon"><i data-lucide="users"></i></div>
          <div class="stat-label">Total Customers</div>
          <div class="stat-value">${customerCount}</div>
          <div class="stat-hint">Active customer accounts</div>
        </div>
        <div class="stat-card tone-gold">
          <div class="stat-icon"><i data-lucide="clock"></i></div>
          <div class="stat-label">Renewals Due</div>
          <div class="stat-value">${renewalsCount}</div>
          <div class="stat-hint">Expiring in next 14 days</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i data-lucide="wallet"></i></div>
          <div class="stat-label">Available Commission</div>
          <div class="stat-value">${money(availableComm)}</div>
          <div class="stat-hint">Available for payout</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i data-lucide="trending-up"></i></div>
          <div class="stat-label">Lifetime Commission</div>
          <div class="stat-value">${money(lifetimeComm)}</div>
          <div class="stat-hint">Total earned to date</div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="quick-actions-title">Quick Actions</div>
      <div class="quick-actions-grid">
        <button class="quick-action-btn" data-nav="enroll">
          <div class="quick-action-icon"><i data-lucide="user-plus"></i></div>
          <div class="quick-action-label">Enroll Customer</div>
        </button>
        <button class="quick-action-btn" data-nav="bulkenroll">
          <div class="quick-action-icon"><i data-lucide="users-round"></i></div>
          <div class="quick-action-label">Bulk Enroll</div>
        </button>
        <button class="quick-action-btn" data-nav="renew">
          <div class="quick-action-icon"><i data-lucide="repeat"></i></div>
          <div class="quick-action-label">Renew Customer</div>
        </button>
        <button class="quick-action-btn" data-nav="lookup">
          <div class="quick-action-icon"><i data-lucide="search"></i></div>
          <div class="quick-action-label">Find Customer</div>
        </button>
      </div>

      <!-- My Communities Section -->
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h2>My Communities</h2>
          <button class="subtle" data-nav="enroll">+ New Community</button>
        </div>
        ${groups.length ? `
          <div class="community-grid">
            ${groups.map(g => {
              const count = policies.filter(p => p.group_id == g.id).length;
              return `
                <div class="community-card">
                  <div class="community-info">
                    <div class="community-icon"><i data-lucide="layers"></i></div>
                    <div>
                      <div class="community-name">${esc(g.name)}</div>
                      <div class="community-meta">${esc(g.type)} · ${count} members</div>
                    </div>
                  </div>
                  <button class="subtle" data-nav="enroll" data-group-id="${g.id}">Enroll</button>
                </div>
              `;
            }).join("")}
          </div>
        ` : `
          <div class="empty-state">
            <i data-lucide="layers"></i>
            <p>No communities created yet. Create one when enrolling your first customer!</p>
          </div>
        `}
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    content.querySelectorAll("[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => {
        const navTab = btn.dataset.nav;
        setActiveTab(navTab);
        if (btn.dataset.groupId) {
          setTimeout(() => {
            const grpSelect = document.getElementById("e-groupId");
            if (grpSelect) grpSelect.value = btn.dataset.groupId;
          }, 100);
        }
      });
    });

  } catch (err) {
    renderError(content, err);
  }
}

// ---------- Agent Dashboard ----------
async function renderAgentDashboard() {
  const container = document.getElementById("views");
  container.innerHTML = `<div id="dashboard-content"></div>`;
  const content = document.getElementById("dashboard-content");
  renderLoading(content, "Loading agent dashboard…");

  try {
    const [policies, renewals] = await Promise.all([
      api("/me/policies").catch(() => []),
      api("/me/renewals-due").catch(() => []),
    ]);

    const customerCount = policies.length;
    const renewalsCount = renewals.length;
    const name = state.user.name || state.user.username || "Agent";

    const hour = new Date().getHours();
    const greetingTime = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    content.innerHTML = `
      <div class="greeting-banner">
        <h1 class="greeting-title">${greetingTime}, ${esc(name)} 👋</h1>
        <p class="greeting-subtitle">Track your customer signups and manage health plan renewals effortlessly.</p>
      </div>

      <!-- Agent Statistics -->
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon"><i data-lucide="users"></i></div>
          <div class="stat-label">Customers Enrolled</div>
          <div class="stat-value">${customerCount}</div>
          <div class="stat-hint">Active customers enrolled</div>
        </div>
        <div class="stat-card tone-gold">
          <div class="stat-icon"><i data-lucide="clock"></i></div>
          <div class="stat-label">Renewals Due</div>
          <div class="stat-value">${renewalsCount}</div>
          <div class="stat-hint">Expiring in next 14 days</div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="quick-actions-title">Quick Actions</div>
      <div class="quick-actions-grid">
        <button class="quick-action-btn" data-nav="enroll">
          <div class="quick-action-icon"><i data-lucide="user-plus"></i></div>
          <div class="quick-action-label">Enroll</div>
        </button>
        <button class="quick-action-btn" data-nav="renew">
          <div class="quick-action-icon"><i data-lucide="repeat"></i></div>
          <div class="quick-action-label">Renew</div>
        </button>
        <button class="quick-action-btn" data-nav="lookup">
          <div class="quick-action-icon"><i data-lucide="search"></i></div>
          <div class="quick-action-label">Lookup</div>
        </button>
        <button class="quick-action-btn" data-nav="mypolicies">
          <div class="quick-action-icon"><i data-lucide="file-text"></i></div>
          <div class="quick-action-label">My Customers</div>
        </button>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    content.querySelectorAll("[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => setActiveTab(btn.dataset.nav));
    });

  } catch (err) {
    renderError(content, err);
  }
}

// ---------- Customer Portal Views ----------

// Home Dashboard (Healthcare Companion)
async function renderCustomerHome() {
  const container = document.getElementById("views");
  container.innerHTML = `<div id="customer-home-content"></div>`;
  const content = document.getElementById("customer-home-content");
  renderLoading(content, "Loading your healthcare companion…");

  try {
    const [policies, renewals] = await Promise.all([
      api("/me/policies").catch(() => []),
      api("/me/renewals-due").catch(() => []),
    ]);

    const activePolicy = policies.find((p) => p.status === "Active") || policies[0] || null;
    const customerName = state.user.name || state.user.fullName || state.user.username || "Customer";

    const hour = new Date().getHours();
    const greetingTime = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    content.innerHTML = `
      <div class="greeting-banner">
        <h1 class="greeting-title">${greetingTime}, ${esc(customerName)} 👋</h1>
        <p class="greeting-subtitle">Welcome to your SehaNet Healthcare Companion portal.</p>
      </div>

      <!-- Active Coverage Card -->
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
          <h2>Active Health Coverage</h2>
          ${activePolicy ? `<span class="badge ${activePolicy.status === "Active" ? "badge-success" : "badge-failed"}">${esc(activePolicy.status)}</span>` : '<span class="badge badge-pending">No Active Plan</span>'}
        </div>
        ${
          activePolicy
            ? `
          <div class="grid-2">
            <div>
              <div class="muted" style="font-size:0.75rem;">HEALTH PLAN</div>
              <div style="font-weight:800; font-size:1.1rem; color:var(--primary-deep);">${esc(activePolicy.plan_name || activePolicy.plan_code)}</div>
            </div>
            <div>
              <div class="muted" style="font-size:0.75rem;">POLICY NUMBER</div>
              <div style="font-weight:700; font-size:0.95rem;">${esc(activePolicy.wellahealth_policy_number || "—")}</div>
            </div>
          </div>
          <div style="margin-top:12px; font-size:0.84rem;" class="muted">
            Expiration Date: <strong>${activePolicy.end_date ? activePolicy.end_date.split("T")[0] : "—"}</strong>
          </div>
          <div class="row" style="margin-top:16px;">
            <button class="primary" id="home-view-card-btn"><i data-lucide="shield-check"></i> View Health Card</button>
            <button class="subtle" id="home-renew-plan-btn"><i data-lucide="repeat"></i> Renew Plan</button>
          </div>
        `
            : `
          <div class="empty-state" style="padding:20px;">
            <i data-lucide="shield-alert"></i>
            <p>You currently do not have an active health plan. Enroll today to protect yourself and family.</p>
            <button class="primary" id="home-enroll-now-btn" style="margin-top:10px;">Enroll in a Health Plan</button>
          </div>
        `
        }
      </div>

      <!-- Quick Access Healthcare Categories -->
      <div class="quick-actions-title">Healthcare Services</div>
      <div class="category-grid">
        <div class="category-card" id="cat-health-plans">
          <div class="category-icon"><i data-lucide="shield"></i></div>
          <div class="category-label">Health Plans</div>
          <span class="badge badge-success" style="font-size:0.65rem;">Active</span>
        </div>
        <div class="category-card disabled">
          <div class="category-icon"><i data-lucide="user-check"></i></div>
          <div class="category-label">Doctor Consult</div>
          <span class="coming-soon-badge">Coming Soon</span>
        </div>
        <div class="category-card disabled">
          <div class="category-icon"><i data-lucide="pill"></i></div>
          <div class="category-label">Pharmacy</div>
          <span class="coming-soon-badge">Coming Soon</span>
        </div>
        <div class="category-card disabled">
          <div class="category-icon"><i data-lucide="activity"></i></div>
          <div class="category-label">Laboratory</div>
          <span class="coming-soon-badge">Coming Soon</span>
        </div>
        <div class="category-card disabled">
          <div class="category-icon"><i data-lucide="heart"></i></div>
          <div class="category-label">Pregnancy Care</div>
          <span class="coming-soon-badge">Coming Soon</span>
        </div>
        <div class="category-card disabled">
          <div class="category-icon"><i data-lucide="smile"></i></div>
          <div class="category-label">Child Healthcare</div>
          <span class="coming-soon-badge">Coming Soon</span>
        </div>
      </div>

      <!-- Care Packages Section -->
      <h2>Care Packages</h2>
      <p class="muted" style="margin-top:-8px; margin-bottom:16px; font-size:0.86rem;">SehaNet bundled healthcare solutions designed for your lifestyle.</p>
      
      <div class="care-package-grid">
        <div class="care-package-card" id="pkg-community">
          <div>
            <div class="care-package-header">
              <div class="care-package-title">Community Care Package</div>
              <span class="badge badge-success">Available</span>
            </div>
            <div class="care-package-desc" style="margin-top:8px;">Affordable healthcare coverage suitable for market traders, cooperatives, associations, and low-income households.</div>
            <div class="care-package-tags">
              <span class="care-package-tag">Cooperatives</span>
              <span class="care-package-tag">Market Traders</span>
              <span class="care-package-tag">Low-Income</span>
            </div>
          </div>
          <button class="primary" style="width:100%; margin-top:14px;">Explore Package</button>
        </div>

        <div class="care-package-card" id="pkg-individual">
          <div>
            <div class="care-package-header">
              <div class="care-package-title">Individual Care Package</div>
              <span class="badge badge-success">Available</span>
            </div>
            <div class="care-package-desc" style="margin-top:8px;">Everyday comprehensive healthcare coverage for individuals, self-employed artisans, and students.</div>
            <div class="care-package-tags">
              <span class="care-package-tag">Individuals</span>
              <span class="care-package-tag">Students</span>
              <span class="care-package-tag">Artisans</span>
            </div>
          </div>
          <button class="primary" style="width:100%; margin-top:14px;">Explore Package</button>
        </div>

        <div class="care-package-card disabled">
          <div>
            <div class="care-package-header">
              <div class="care-package-title">Employer Care Package</div>
              <span class="coming-soon-badge">Coming Soon</span>
            </div>
            <div class="care-package-desc" style="margin-top:8px;">Custom health plan coverage for small businesses and company employees.</div>
          </div>
        </div>

        <div class="care-package-card disabled">
          <div>
            <div class="care-package-header">
              <div class="care-package-title">Pregnancy Care Package</div>
              <span class="coming-soon-badge">Coming Soon</span>
            </div>
            <div class="care-package-desc" style="margin-top:8px;">Specialized maternal health support, antenatal care, and delivery coverage.</div>
          </div>
        </div>

        <div class="care-package-card disabled">
          <div>
            <div class="care-package-header">
              <div class="care-package-title">Child Care Package</div>
              <span class="coming-soon-badge">Coming Soon</span>
            </div>
            <div class="care-package-desc" style="margin-top:8px;">Pediatric consultation, immunizations, and child wellness protection.</div>
          </div>
        </div>

        <div class="care-package-card disabled">
          <div>
            <div class="care-package-header">
              <div class="care-package-title">Diabetes Management Package</div>
              <span class="coming-soon-badge">Coming Soon</span>
            </div>
            <div class="care-package-desc" style="margin-top:8px;">Continuous glucose monitoring, medication delivery, and specialist advice.</div>
          </div>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    // Event Listeners

    document.getElementById("home-view-card-btn")?.addEventListener("click", () => setActiveTab("myhealthcare"));
    document.getElementById("home-renew-plan-btn")?.addEventListener("click", () => setActiveTab("myhealthcare"));
    document.getElementById("home-enroll-now-btn")?.addEventListener("click", () => setActiveTab("search"));
    document.getElementById("cat-health-plans")?.addEventListener("click", () => setActiveTab("search"));

    document.getElementById("pkg-community")?.addEventListener("click", () => setActiveTab("search"));
    document.getElementById("pkg-individual")?.addEventListener("click", () => setActiveTab("search"));
  } catch (err) {
    renderError(content, err);
  }
}

// My Healthcare Page
async function renderCustomerHealthcare() {
  const container = document.getElementById("views");
  container.innerHTML = `<div id="healthcare-content"></div>`;
  const content = document.getElementById("healthcare-content");
  renderLoading(content, "Loading your health card & coverage details…");

  try {
    const policies = await api("/me/policies").catch(() => []);
    const activePolicy = policies.find((p) => p.status === "Active") || policies[0] || null;
    const customerName = state.user.name || state.user.fullName || state.user.username || "Customer";
    const phone = state.user.phone || activePolicy?.customer_phone || "—";
    const policyNum = activePolicy?.wellahealth_policy_number || "SIT-PENDING";
    const planName = activePolicy?.plan_name || activePolicy?.plan_code || "No Active Plan";
    const expiryDate = activePolicy?.end_date ? activePolicy.end_date.split("T")[0] : "—";
    const status = activePolicy?.status || "Inactive";

    content.innerHTML = `
      <div class="page-head">
        <h1>My Healthcare</h1>
        <p>Access your digital health card, coverage information, and policy renewals.</p>
      </div>

      <!-- Digital Health Card -->
      <div class="digital-health-card">
        <div class="digital-card-top">
          <div class="digital-card-brand">
            <div class="brand-mark" style="width:30px;height:30px;"><img src="s.png" alt="SehaNet" /></div>
            SehaNet Care Card
          </div>
          <div class="digital-card-chip"></div>
        </div>

        <div class="digital-card-holder-name">${esc(customerName)}</div>
        <div class="digital-card-number">POLICY #: ${esc(policyNum)}</div>

        <div class="digital-card-meta-grid">
          <div class="digital-card-meta-item">
            <span>HEALTH PLAN</span>
            <strong>${esc(planName)}</strong>
          </div>
          <div class="digital-card-meta-item">
            <span>PHONE NUMBER</span>
            <strong>${esc(phone)}</strong>
          </div>
          <div class="digital-card-meta-item">
            <span>EXPIRES ON</span>
            <strong>${expiryDate}</strong>
          </div>
        </div>

        <div class="digital-card-actions">
          <button class="ghost-btn" id="btn-download-card" title="Download Digital Card" style="width:100%;"><i data-lucide="download"></i> Download Care Card</button>
        </div>
      </div>

      <!-- Coverage & Policy Details -->
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h2>Coverage &amp; Policy Details</h2>
          <span class="badge ${status === "Active" ? "badge-success" : "badge-failed"}">${status}</span>
        </div>

        ${
          activePolicy
            ? `
          <div class="profile-details-grid">
            <div class="profile-detail-item">
              <div class="profile-detail-label">Policy Number</div>
              <div class="profile-detail-value">${esc(policyNum)}</div>
            </div>
            <div class="profile-detail-item">
              <div class="profile-detail-label">Health Plan</div>
              <div class="profile-detail-value">${esc(planName)}</div>
            </div>
            <div class="profile-detail-item">
              <div class="profile-detail-label">Enrollment Date</div>
              <div class="profile-detail-value">${activePolicy.created_at ? activePolicy.created_at.split("T")[0] : "—"}</div>
            </div>
            <div class="profile-detail-item">
              <div class="profile-detail-label">Expiration Date</div>
              <div class="profile-detail-value">${expiryDate}</div>
            </div>
          </div>

          <div style="margin-top:20px;">
            <button class="primary" id="btn-renew-coverage" style="width:100%;"><i data-lucide="repeat"></i> Renew Coverage Now</button>
          </div>
        `
            : `
          <div class="empty-state">
            <i data-lucide="file-text"></i>
            <p>No active policy record found.</p>
          </div>
        `
        }
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    document.getElementById("btn-download-card")?.addEventListener("click", () => {
      downloadHealthCardImage(customerName, policyNum, planName, phone, expiryDate);
      showToast("Downloading your HD SehaNet Care Card image…", "success");
    });

    document.getElementById("btn-renew-coverage")?.addEventListener("click", () => {
      setActiveTab("renew");
      setTimeout(() => {
        const phoneInput = document.getElementById("r-phoneNumber");
        if (phoneInput && phone) phoneInput.value = phone;
      }, 100);
    });
  } catch (err) {
    renderError(content, err);
  }
}

function downloadHealthCardImage(customerName, policyNum, planName, phone, expiryDate) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 700;
  const ctx = canvas.getContext("2d");

  // Background Gradient
  const grad = ctx.createLinearGradient(0, 0, 1200, 700);
  grad.addColorStop(0, "#0A2E2B");
  grad.addColorStop(1, "#0F6D61");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 700);

  // Outer Border
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 10;
  ctx.strokeRect(20, 20, 1160, 660);

  // Watermark
  ctx.font = "900 120px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  ctx.fillText("SEHANET", 550, 630);

  // Brand Header
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText("SehaNet Care Card", 80, 110);

  // Gold Chip Icon
  const chipGrad = ctx.createLinearGradient(1020, 70, 1110, 130);
  chipGrad.addColorStop(0, "#FDE68A");
  chipGrad.addColorStop(1, "#D97706");
  ctx.fillStyle = chipGrad;
  ctx.fillRect(1020, 70, 90, 60);

  // Divider Line
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(80, 160);
  ctx.lineTo(1120, 160);
  ctx.stroke();

  // Customer Name
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 52px sans-serif";
  ctx.fillText(customerName, 80, 260);

  // Policy Number
  ctx.fillStyle = "#A7F3D0";
  ctx.font = "700 36px monospace";
  ctx.fillText(`POLICY #: ${policyNum}`, 80, 330);

  // Meta Section Line
  ctx.beginPath();
  ctx.moveTo(80, 410);
  ctx.lineTo(1120, 410);
  ctx.stroke();

  // Meta Item 1: Health Plan
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = "600 24px sans-serif";
  ctx.fillText("HEALTH PLAN", 80, 470);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText(planName, 80, 520);

  // Meta Item 2: Phone Number
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = "600 24px sans-serif";
  ctx.fillText("PHONE NUMBER", 500, 470);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText(phone, 500, 520);

  // Meta Item 3: Expiration Date
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = "600 24px sans-serif";
  ctx.fillText("EXPIRES ON", 880, 470);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText(expiryDate, 880, 520);

  // Footer Tagline
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.font = "20px sans-serif";
  ctx.fillText("Official SehaNet Digital Healthcare Identity Card", 80, 620);

  // Trigger Download
  const link = document.createElement("a");
  link.download = `SehaNet-CareCard-${policyNum.replace(/[^a-zA-Z0-9-]/g, "")}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

// Healthcare Search Page
async function renderCustomerSearch() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="page-head">
      <h1>Healthcare Search</h1>
      <p>Search available health plans, policy records, and care services.</p>
    </div>

    <div class="card">
      <div class="search-input-wrap">
        <i data-lucide="search" class="search-input-icon"></i>
        <input id="customer-search-input" placeholder="Search health plans, doctors, lab tests, pharmacies..." />
      </div>

      <div id="customer-search-results"></div>
    </div>
  `;

  const input = document.getElementById("customer-search-input");
  const results = document.getElementById("customer-search-results");

  let searchTimer = null;
  input?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => performSearch(input.value.trim()), 300);
  });

  performSearch("");

  async function performSearch(query) {
    renderLoading(results, "Searching healthcare solutions…");
    try {
      const plansData = await api("/plans/health");
      const plans = normalizePlans(plansData);

      let filtered = plans;
      if (query) {
        const q = String(query || "").toLowerCase();
        filtered = plans.filter((p) => {
          const meta = getPlanMeta(p);
          const nameStr = String(meta.name || "").toLowerCase();
          const codeStr = String(meta.code || "").toLowerCase();
          const descStr = String(meta.description || meta.desc || "").toLowerCase();
          return nameStr.includes(q) || codeStr.includes(q) || descStr.includes(q);
        });
      }

      if (filtered.length === 0) {
        renderEmptyState(results, `No health plans matching "${query}"`, "search");
        return;
      }

      renderPlanCards(results, filtered, {
        emptyText: "No plans found.",
        onSelect: (plan) => {
          setActiveTab("enroll");
          setTimeout(() => {
            const planCodeEl = document.getElementById("e-planCode");
            if (planCodeEl) planCodeEl.value = planCardMeta(plan).code;
          }, 100);
        },
      });
    } catch (err) {
      renderError(results, err);
    }
  }
}

// Notifications Page
async function renderCustomerNotifications() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="page-head">
      <h1>Notifications</h1>
      <p>Policy updates, renewal alerts, and payment confirmations.</p>
    </div>
    <div id="customer-notifications-list"></div>
  `;

  const listEl = document.getElementById("customer-notifications-list");
  renderLoading(listEl, "Loading notifications…");

  try {
    const renewals = await api("/me/renewals-due").catch(() => []);

    if (renewals.length === 0) {
      listEl.innerHTML = `
        <div class="card">
          <div class="history-card">
            <div>
              <div style="font-weight:700; color:var(--primary-deep);">System Account Active</div>
              <div class="history-date">Your account is fully active and protected.</div>
            </div>
            <span class="badge badge-success">OK</span>
          </div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = `
      <div class="card">
        <h2>Upcoming Expirations</h2>
        <div class="history-card-grid">
          ${renewals
            .map(
              (r) => `
            <div class="history-card">
              <div>
                <div style="font-weight:700; color:var(--danger);">Policy Expiring Soon — ${esc(r.plan_name || r.plan_code)}</div>
                <div class="history-date">Policy #${esc(r.wellahealth_policy_number || "—")} expires in ${r.days_remaining} day(s).</div>
              </div>
              <button class="primary renewal-renew-btn" data-renew-phone="${r.customer_phone || ""}">Renew Now</button>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    listEl.querySelectorAll(".renewal-renew-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        setActiveTab("renew");
      });
    });
  } catch (err) {
    renderError(listEl, err);
  }
}

// Profile Page
async function renderCustomerProfile() {
  const container = document.getElementById("views");
  const user = state.user || {};

  container.innerHTML = `
    <div class="page-head">
      <h1>My Profile</h1>
      <p>Manage your account details, security settings, and support preferences.</p>
    </div>

    <div class="card">
      <div class="profile-header">
        <div class="profile-avatar"><i data-lucide="user"></i></div>
        <div>
          <div class="profile-name">${esc(user.name || user.fullName || user.username)}</div>
          <div class="profile-phone">📞 ${esc(user.phone || "—")}</div>
        </div>
        <span class="badge badge-success" style="margin-left:auto;">Customer</span>
      </div>

      <div class="profile-details-grid">
        <div class="profile-detail-item">
          <div class="profile-detail-label">Username</div>
          <div class="profile-detail-value">${esc(user.username || "—")}</div>
        </div>
        <div class="profile-detail-item">
          <div class="profile-detail-label">Email Address</div>
          <div class="profile-detail-value">${esc(user.email || "—")}</div>
        </div>
        <div class="profile-detail-item">
          <div class="profile-detail-label">Location</div>
          <div class="profile-detail-value">${esc(user.location || "—")}</div>
        </div>
        <div class="profile-detail-item">
          <div class="profile-detail-label">Gender</div>
          <div class="profile-detail-value">${esc(user.gender || "—")}</div>
        </div>
      </div>

      <div style="margin-top:24px; border-top:1px solid var(--border); padding-top:16px;">
        <h2>Security &amp; Password</h2>
        <div class="row">
          <button class="subtle" id="profile-change-password-btn"><i data-lucide="key"></i> Change Password</button>
        </div>
      </div>

      <div style="margin-top:20px; border-top:1px solid var(--border); padding-top:16px;">
        <h2>Notification Preferences</h2>
        <div style="display:flex; flex-direction:column; gap:10px;">
          <label style="display:flex; justify-content:space-between; align-items:center; font-size:0.9rem;">
            <span>SMS Expiry Reminders</span>
            <input type="checkbox" checked style="width:auto;" />
          </label>
          <label style="display:flex; justify-content:space-between; align-items:center; font-size:0.9rem;">
            <span>Email Payment Receipts</span>
            <input type="checkbox" checked style="width:auto;" />
          </label>
        </div>
      </div>

      <div style="margin-top:20px; border-top:1px solid var(--border); padding-top:16px;">
        <h2>Customer Support</h2>
        <div class="muted" style="font-size:0.88rem; margin-bottom:10px;">Need assistance with your plan or healthcare card?</div>
        <a href="tel:07075664676" class="subtle" style="display:inline-flex;"><i data-lucide="phone"></i> Call Support: 07075664676</a>
      </div>
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();

  document.getElementById("profile-change-password-btn")?.addEventListener("click", () => {
    document.getElementById("changePasswordBtn")?.click();
  });
}

// ---------- Admin Dashboard ----------
async function renderAdminDashboard() {
  const container = document.getElementById("views");
  container.innerHTML = `<div class="page-head"><h1>Business Dashboard</h1><p class="muted">Live overview of revenue, active policies, and ambassador payout figures.</p></div><div id="dashboard-content"></div>`;
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
        ${stat("piggy-bank", "Admin net before expenses", money(d.adminNetBeforeExpenses), "tone-gold", "Payments less commission")}
        ${stat("trending-up", "Admin net after expenses", money(d.adminNetAfterExpenses), "", `Your ${d.wellahealthPercent}% WellaHealth cut (${money(d.wellahealthCut)}), less commission`)}
        ${stat("trending-up", "Ambassador commission owed", money(d.ambassadorOutstanding), "", `${d.customerCount} customers`)}
        ${stat("check-circle-2", "Ambassador commission paid", money(d.ambassadorPaid), "")}
        ${stat("users", "Customers", d.customerCount, "")}
        ${stat("shield-check", "Active policies", d.activePolicies, "")}
      </div>
      <div class="card note-card"><div class="muted">“Admin net before expenses” is recorded customer payments less ambassador commission. “Admin net after expenses” is the admin’s actual income: your ${d.wellahealthPercent}% WellaHealth cut of plan payments, less ambassador commission owed.</div></div>
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
    el.innerHTML = `<div class="alert-success">Preparing secure Paystack checkout…</div>`;
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

function prettyLabel(key) {
  return String(key)
    .replace(/^_+|_+$/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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

function getPlanMeta(plan) {
  const code = plan?.planCode || plan?.code || plan?.plan_code || plan?.id || "";
  const name = plan?.planName || plan?.name || plan?.title || plan?.displayName || code || "Unnamed plan";
  const price = plan?.price || plan?.amount || plan?.premium || plan?.priceAmount || plan?.monthlyPrice || "";
  const description = plan?.description || plan?.details || plan?.summary || plan?.benefits || "";
  return { code, name, price, description };
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
  return { code, name, price: priceText, rawPrice: n || 0, desc, duration, dependants, benefits, paymentPlans };
}

function renderPlanCards(container, plans, opts = {}) {
  if (!container) return;
  if (!plans.length) {
    container.innerHTML = `<div class="muted">${opts.emptyText || "No plans available right now."}</div>`;
    return;
  }
  container.innerHTML = `<div class="plan-grid">${plans
    .map((plan, i) => {
      const meta = planCardMeta(plan);
      const benefits = meta.benefits.length
        ? `<div class="plan-benefits">${meta.benefits
            .slice(0, 6)
            .map((b) => `<div class="plan-benefit-item"><span class="plan-benefit-icon">✓</span><span>${esc(b)}</span></div>`)
            .join("")}</div>`
        : "";
      return `
        <button type="button" class="plan-card" data-index="${i}" aria-pressed="false">
          <div>
            <div class="plan-card-header">
              <div>
                <div class="plan-card-title">${esc(meta.name)}</div>
                ${meta.duration ? `<span class="plan-card-badge">${esc(meta.duration)}</span>` : ""}
              </div>
              <div class="plan-card-check-ring">✓</div>
            </div>
            <div class="plan-card-price-wrap">
              <span class="plan-card-price-amount">${meta.price || "NGN 0"}</span>
            </div>
            ${meta.desc ? `<div class="plan-card-desc">${esc(meta.desc)}</div>` : ""}
          </div>
          ${benefits}
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

// ---------- Admin Team View ----------
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

  document.getElementById("nu-submit")?.addEventListener("click", () => {
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

  document.getElementById("eu-cancel")?.addEventListener("click", () => {
    document.getElementById("edit-user-card").classList.add("hidden");
  });

  document.getElementById("eu-submit")?.addEventListener("click", () => {
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
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Bank Info</th><th>Rates</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.map(userRow).join("")}
          </tbody>
        </table>
      </div>
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
      <td><strong>${u.name}</strong><div class="muted">${u.username}</div></td>
      <td>${u.role}</td>
      <td><span class="badge ${badgeClass}">${u.status}</span></td>
      <td>${bankInfo}</td>
      <td>${rates}</td>
      <td>${actions.join(" ")}</td>
    </tr>
    <tr id="inline-confirm-${u.id}" class="hidden">
      <td colspan="6">
        <div id="inline-confirm-box-${u.id}" class="inline-confirm-box"></div>
      </td>
    </tr>
  `;
}

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
    const activeAmbassadors = users.filter(
      (u) => u.role === "ambassador" && u.status === "active" && String(u.id) !== String(id)
    );
    const reassignSelectHtml = user.role === "ambassador" && activeAmbassadors.length > 0
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

// ---------- Policies Directory View ----------
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
        <div class="table-wrap">
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
                      <td><strong>${p.customer_name || "—"}</strong><div class="muted">${p.customer_phone || ""}</div></td>
                      <td>${p.plan_name || p.plan_code}</td>
                      <td><span class="muted">${p.wellahealth_policy_number || "—"}</span></td>
                      <td>NGN ${(p.price_at_enrollment || 0).toLocaleString()}</td>
                      <td><span class="badge ${statusBadgeClass}">${p.status}</span></td>
                      <td>${p.agent_name || (p.customer_account_id ? "Self-enrolled" : `Agent #${p.original_agent_id}`)}</td>
                      <td>${p.end_date ? p.end_date.split("T")[0] : "—"}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
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

// ---------- Renewals Due Page (Task Manager for Agents & Ambassadors) ----------
async function renderRenewalsDueView() {
  const container = document.getElementById("views");
  const isAdmin = state.user.role === "admin";

  container.innerHTML = `
    <div class="page-head">
      <h1>Renewals Due</h1>
      <p>${isAdmin ? "All customer policies due for renewal in the next 14 days." : "Your task list of upcoming policy expirations. Reach out to renew cover seamlessly."}</p>
    </div>
    <div id="rd-list"></div>
  `;

  const listEl = document.getElementById("rd-list");
  renderLoading(listEl, "Checking upcoming renewals…");

  try {
    const endpoint = isAdmin ? "/admin/renewals-due" : "/me/renewals-due";
    const data = await api(endpoint);

    if (!data || data.length === 0) {
      renderEmptyState(listEl, "No upcoming renewals due in the next 14 days 🎉", "check-circle-2");
      return;
    }

    if (isAdmin) {
      // Admin sees structured overview table
      listEl.innerHTML = `
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Plan</th>
                  <th>Agent / Ambassador</th>
                  <th>End Date</th>
                  <th>Due In</th>
                </tr>
              </thead>
              <tbody>
                ${data
                  .map((r) => {
                    const daysRemaining = typeof r.days_remaining === "number" ? r.days_remaining : 0;
                    const isUrgent = daysRemaining <= 3;
                    const dueText = daysRemaining === 0 ? "Today" : daysRemaining === 1 ? "Tomorrow" : `${daysRemaining} days`;

                    return `
                      <tr class="${isUrgent ? "urgent-row" : ""}">
                        <td><strong>${r.customer_name || "—"}</strong></td>
                        <td><a href="tel:${r.customer_phone}" style="color:var(--primary); font-weight:600;">${r.customer_phone || "—"}</a></td>
                        <td>${r.plan_name || r.plan_code}</td>
                        <td>${r.agent_name || `User #${r.original_agent_id}`}</td>
                        <td>${r.end_date ? r.end_date.split("T")[0] : "—"}</td>
                        <td><span class="badge ${isUrgent ? "badge-failed" : "badge-pending"}">${dueText}</span></td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      // Ambassadors and Agents get Task Manager Cards!
      listEl.innerHTML = `
        <div class="renewal-task-grid">
          ${data
            .map((r) => {
              const daysRemaining = typeof r.days_remaining === "number" ? r.days_remaining : 0;
              const isUrgent = daysRemaining <= 3;
              const dueText = daysRemaining === 0 ? "Expires Today!" : daysRemaining === 1 ? "Expires Tomorrow" : `Expires in ${daysRemaining} days`;

              return `
                <div class="renewal-card ${isUrgent ? "urgent" : ""}">
                  <div class="renewal-card-top">
                    <div>
                      <div class="renewal-customer-name">${esc(r.customer_name || "Customer")}</div>
                      <div class="renewal-plan-name">${esc(r.plan_name || r.plan_code)}</div>
                    </div>
                    <span class="renewal-due-badge ${isUrgent ? "urgent-badge" : ""}">${dueText}</span>
                  </div>
                  <div class="muted" style="font-size:0.85rem;">📞 ${esc(r.customer_phone || "No phone")}</div>
                  <div class="renewal-card-actions">
                    ${r.customer_phone ? `<a href="tel:${r.customer_phone}" class="renewal-call-btn"><i data-lucide="phone" style="width:14px;height:14px;"></i> Call</a>` : ""}
                    <button class="primary renewal-renew-btn" data-renew-phone="${r.customer_phone || ""}">
                      <i data-lucide="repeat" style="width:14px;height:14px;"></i> Renew
                    </button>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `;

      if (window.lucide) window.lucide.createIcons();

      listEl.querySelectorAll(".renewal-renew-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const phone = btn.dataset.renewPhone;
          setActiveTab("renew");
          if (phone) {
            setTimeout(() => {
              const phoneInput = document.getElementById("r-phoneNumber");
              if (phoneInput) phoneInput.value = phone;
            }, 100);
          }
        });
      });
    }
  } catch (err) {
    renderError(listEl, err);
  }
}

// ---------- Admin Groups View ----------
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
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Ambassador</th><th>Created</th></tr></thead>
          <tbody>
            ${groups.map(g => `<tr><td><strong>${g.name}</strong></td><td>${g.type}</td><td>${g.ambassador_name}</td><td>${g.created_at}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    renderError(listEl, err);
  }
}

// ---------- Admin Commission Settings ----------
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
      <div style="margin-top:14px"><button class="primary" id="s-save">Save Settings</button></div>
      <div id="s-output" style="margin-top:10px;"></div>
    `;
    document.getElementById("s-save")?.addEventListener("click", () => {
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

// ---------- Admin Payout Management ----------
async function renderPayoutView() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="card">
      <h2>Weekly Payout Management</h2>
      <p class="muted">Create payout drafts, approve weekly payouts, and process automated bank transfers.</p>
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

  document.getElementById("payout-load")?.addEventListener("click", handleCreateOrLoadPayout);
  await loadPayoutHistory();
  await loadPayoutRequests();
  await handleCreateOrLoadPayout();

  async function loadPayoutRequests() {
    const el = document.getElementById("payout-requests");
    renderLoading(el, "Loading payment requests…");
    try {
      const requests = await api("/admin/payout-requests");
      if (!requests.length) return renderEmptyState(el, "No ambassador payment requests", "bell");
      el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Ambassador</th><th>Requested</th><th>Available</th><th>Status</th><th>Action</th></tr></thead><tbody>${requests.map(r => `<tr><td>${r.ambassador_name}</td><td>NGN ${Number(r.requested_amount).toLocaleString()}</td><td>NGN ${Number(r.balance?.available || 0).toLocaleString()}</td><td><span class="badge ${r.status === "rejected" ? "badge-failed" : r.status === "approved" || r.status === "paid" ? "badge-success" : "badge-pending"}">${r.status}</span></td><td>${r.status === "pending" ? `<button class="subtle" data-request="approve" data-id="${r.id}">Approve</button> <button class="subtle" data-request="reject" data-id="${r.id}">Reject</button>` : r.status === "approved" ? `<button class="primary" data-pay-request="${r.id}" data-amount="${r.requested_amount}">Pay now</button>` : "—"}</td></tr>`).join("")}</tbody></table></div>`;
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
        <div class="table-wrap">
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
        </div>
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
      document.getElementById("payout-approve-btn")?.addEventListener("click", () => handleApprovePayout(payout));
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
            <strong style="color:var(--primary);">Successful Transfers (${summary.paid.length}):</strong>
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
        <div class="table-wrap">
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
                      <td style="display:flex; gap:6px;">
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
        </div>
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

// ---------- My Communities Page (Ambassador) ----------
async function renderMyGroupsView() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="page-head">
      <h1>My Communities</h1>
      <p>Communities you manage across markets, banks, schools, and associations.</p>
    </div>
    <div id="mg-list"></div>
  `;
  const listEl = document.getElementById("mg-list");
  renderLoading(listEl, "Loading communities…");

  try {
    const [groups, policies] = await Promise.all([
      api("/groups/mine").catch(() => []),
      api("/me/policies").catch(() => []),
    ]);

    if (groups.length === 0) {
      renderEmptyState(listEl, "No communities created yet — create one when enrolling customers", "layers");
      return;
    }

    listEl.innerHTML = `
      <div class="community-grid">
        ${groups.map(g => {
          const count = policies.filter(p => p.group_id == g.id).length;
          const createdDate = g.created_at ? g.created_at.split("T")[0] : "";
          return `
            <div class="community-card">
              <div class="community-info">
                <div class="community-icon"><i data-lucide="layers"></i></div>
                <div>
                  <div class="community-name">${esc(g.name)}</div>
                  <div class="community-meta">${esc(g.type)} · ${count} members</div>
                  ${createdDate ? `<div class="muted" style="font-size:0.75rem; margin-top:2px;">Created: ${createdDate}</div>` : ""}
                </div>
              </div>
              <button class="subtle" data-enroll-group="${g.id}">Enroll Member</button>
            </div>
          `;
        }).join("")}
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    listEl.querySelectorAll("[data-enroll-group]").forEach(btn => {
      btn.addEventListener("click", () => {
        const groupId = btn.dataset.enrollGroup;
        setActiveTab("enroll");
        setTimeout(() => {
          const grpSelect = document.getElementById("e-groupId");
          if (grpSelect) grpSelect.value = groupId;
        }, 100);
      });
    });

  } catch (err) {
    renderError(listEl, err);
  }
}

// ---------- My Earnings Page (Ambassador) ----------
async function renderMySummaryView() {
  const container = document.getElementById("views");
  container.innerHTML = `<div class="page-head"><h1>My Earnings</h1><p>Your commission earnings, payment requests, and payout history.</p></div><div id="ms-content"></div>`;
  const contentEl = document.getElementById("ms-content");
  renderLoading(contentEl, "Calculating your earnings…");

  try {
    const s = await api("/me/earnings");
    const money = (v) => `₦${Number(v || 0).toLocaleString()}`;

    contentEl.innerHTML = `
      <!-- 3 Statistic Cards -->
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon"><i data-lucide="wallet"></i></div>
          <div class="stat-label">Available Commission</div>
          <div class="stat-value">${money(s.available)}</div>
          <div class="stat-hint">Ready to withdraw</div>
        </div>
        <div class="stat-card tone-gold">
          <div class="stat-icon"><i data-lucide="check-circle-2"></i></div>
          <div class="stat-label">Already Paid</div>
          <div class="stat-value">${money(s.paid)}</div>
          <div class="stat-hint">Transferred to bank</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i data-lucide="trending-up"></i></div>
          <div class="stat-label">Lifetime Commission</div>
          <div class="stat-value">${money(s.earned)}</div>
          <div class="stat-hint">${money(s.pending)} currently pending</div>
        </div>
      </div>

      <!-- Request Withdrawal -->
      <div class="card">
        <h2>Request Withdrawal</h2>
        <div class="grid">
          <input id="payout-request-amount" type="number" min="1" max="${s.available}" placeholder="Enter amount in NGN" />
          <input id="payout-request-note" placeholder="Optional note for admin" />
        </div>
        <button class="primary" id="payout-request-submit">Request Payout</button>
        <div id="payout-request-output" style="margin-top:10px;"></div>
      </div>

      <!-- Payment History Cards -->
      <div class="card">
        <h2>Payment History</h2>
        ${s.requests.length ? `
          <div class="history-card-grid">
            ${s.requests.map(r => {
              const statusClass = r.status === "rejected" ? "badge-failed" : r.status === "paid" ? "badge-success" : "badge-pending";
              const dateStr = r.created_at ? r.created_at.split("T")[0] : "";
              return `
                <div class="history-card">
                  <div>
                    <div class="history-amount">NGN ${Number(r.requested_amount).toLocaleString()}</div>
                    <div class="history-date">${dateStr} ${r.note ? `· ${esc(r.note)}` : ""}</div>
                  </div>
                  <span class="badge ${statusClass}">${r.status}</span>
                </div>
              `;
            }).join("")}
          </div>
        ` : `<div class="empty-state"><i data-lucide="clock"></i><p>No payout requests yet.</p></div>`}
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    document.getElementById("payout-request-submit")?.addEventListener("click", () => {
      runWithLoading(document.getElementById("payout-request-submit"), "Submitting request…", async () => {
        const output = document.getElementById("payout-request-output");
        try {
          const result = await api("/me/payout-requests", { method: "POST", body: JSON.stringify({ amount: document.getElementById("payout-request-amount").value, note: document.getElementById("payout-request-note").value }) });
          out("payout-request-output", result);
          setTimeout(renderMySummaryView, 1200);
        } catch (err) { renderError(output, err); }
      });
    });
  } catch (err) {
    renderError(contentEl, err);
  }
}

function getIsoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNo =
    1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// ---------- Combined Enroll Customer Page (3-Step Wizard) ----------
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
    <div class="page-head">
      <h1>Enroll Customer</h1>
      <p>Follow the 3-step guide below to complete customer enrollment.</p>
    </div>

    <!-- Stepper Navigation Tabs -->
    <div class="workflow-stepper">
      <div class="step-item active" id="step-tab-1"><span class="step-num">1</span> ${isAmbassador ? "Community & Info" : "Customer Info"}</div>
      <div class="step-item" id="step-tab-2"><span class="step-num">2</span> Select Plan</div>
      <div class="step-item" id="step-tab-3"><span class="step-num">3</span> Payment Summary</div>
    </div>

    <!-- Step 1 Panel: Community & Customer Info -->
    <div id="wizard-panel-1" class="wizard-step-panel active">
      <div class="card">
        ${isAmbassador ? `
          <h2>Step 1: Select Community</h2>
          <div class="grid">
            <div>
              <label class="input-label">Community / Group</label>
              <div style="display:flex; gap:8px;">
                <select id="e-groupId" style="flex:1;"><option value="">Select community…</option>${groupOptions}</select>
                <button type="button" class="subtle" id="toggle-new-group-btn">+ Create</button>
              </div>
            </div>
          </div>

          <div id="inline-create-group-box" class="card hidden" style="background:var(--surface-alt); margin-bottom:16px;">
            <h3>+ Create New Community</h3>
            <div class="grid">
              <input id="g-name" placeholder="Community Name (e.g. Sabon Gari Market)" />
              <select id="g-type">
                <option value="Market">Market</option>
                <option value="Bank">Bank</option>
                <option value="School">School</option>
                <option value="Association">Association</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <button type="button" class="primary" id="g-create">Save Community</button>
            <div id="g-output" style="margin-top:8px;"></div>
          </div>
        ` : ""}

        <h2>Customer Information</h2>
        <div class="grid">
          <div class="grid-2">
            <div><label class="input-label">First Name *</label><input id="e-firstName" placeholder="e.g. Salma" /></div>
            <div><label class="input-label">Last Name *</label><input id="e-lastName" placeholder="e.g. Ibrahim" /></div>
          </div>
          <div class="grid-2">
            <div><label class="input-label">Phone Number *</label><input id="e-phoneNumber" placeholder="2348123456789" /></div>
            <div><label class="input-label">Email (Optional)</label><input id="e-email" placeholder="customer@email.com" /></div>
          </div>
          <div><label class="input-label">Location</label><input id="e-location" placeholder="e.g. Kano, Nigeria" /></div>
          <div class="grid-2">
            <div><label class="input-label">Gender</label><select id="e-gender"><option value="Female">Female</option><option value="Male">Male</option></select></div>
            <div><label class="input-label">Date of Birth</label><input id="e-dateOfBirth" type="date" /></div>
          </div>
        </div>

        <div style="margin-top:20px;">
          <button type="button" class="primary" id="goto-step-2" style="width:100%;">Next: Select Health Plan →</button>
        </div>
      </div>
    </div>

    <!-- Step 2 Panel: Health Plan Selection -->
    <div id="wizard-panel-2" class="wizard-step-panel">
      <div class="card">
        <h2>Step 2: Choose a Health Plan</h2>
        <p class="muted">Select one of the health plans below to proceed.</p>
        
        <div id="e-planCards" class="plan-card-wrap">Fetching available health plans…</div>
        <input id="e-planCode" type="hidden" />
        <input id="e-planName" type="hidden" />

        <div style="display:flex; gap:12px; margin-top:24px;">
          <button type="button" class="subtle" id="goto-step-1">← Back to Info</button>
          <button type="button" class="primary" id="goto-step-3" style="flex:1;">Next: Payment Summary →</button>
        </div>
      </div>
    </div>

    <!-- Step 3 Panel: Payment Summary & Submit -->
    <div id="wizard-panel-3" class="wizard-step-panel">
      <div class="card">
        <h2>Step 3: Review &amp; Continue to Payment</h2>
        
        <div id="e-paymentSummaryBox" class="plan-summary-box">
          <div class="payment-summary-row"><span>Customer Name</span><strong id="summary-cust-name">—</strong></div>
          <div class="payment-summary-row"><span>Phone Number</span><strong id="summary-cust-phone">—</strong></div>
          <div class="payment-summary-row"><span>Plan Selected</span><strong id="summary-plan-name">—</strong></div>
          <div class="payment-summary-row"><span>Plan Amount</span><strong id="summary-plan-price">—</strong></div>
          <div class="payment-summary-row"><span>Payment Fee</span><strong>NGN 0</strong></div>
          <div class="payment-summary-row total"><span>Total Amount to Pay</span><strong id="summary-total-price">—</strong></div>
        </div>

        <div style="display:flex; gap:12px; margin-top:24px;">
          <button type="button" class="subtle" id="backto-step-2">← Back to Plans</button>
          <button type="button" class="primary" id="e-submit" style="flex:1;">Continue to Payment</button>
        </div>
        <div id="e-output" style="margin-top:10px;"></div>
      </div>
    </div>
  `;

  // Multi-step wizard panel navigation logic
  const panel1 = document.getElementById("wizard-panel-1");
  const panel2 = document.getElementById("wizard-panel-2");
  const panel3 = document.getElementById("wizard-panel-3");
  const tab1 = document.getElementById("step-tab-1");
  const tab2 = document.getElementById("step-tab-2");
  const tab3 = document.getElementById("step-tab-3");

  function switchStep(stepNum) {
    panel1.classList.toggle("active", stepNum === 1);
    panel2.classList.toggle("active", stepNum === 2);
    panel3.classList.toggle("active", stepNum === 3);

    tab1.classList.toggle("active", stepNum === 1);
    tab2.classList.toggle("active", stepNum === 2);
    tab3.classList.toggle("active", stepNum === 3);

    tab1.classList.toggle("completed", stepNum > 1);
    tab2.classList.toggle("completed", stepNum > 2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.getElementById("goto-step-2")?.addEventListener("click", () => {
    const fn = document.getElementById("e-firstName").value.trim();
    const ln = document.getElementById("e-lastName").value.trim();
    const phone = document.getElementById("e-phoneNumber").value.trim();

    if (!fn || !ln || !phone) {
      showToast("Please fill in first name, last name, and phone number.", "warning");
      return;
    }
    switchStep(2);
  });

  document.getElementById("goto-step-1")?.addEventListener("click", () => switchStep(1));

  document.getElementById("goto-step-3")?.addEventListener("click", () => {
    const planCode = document.getElementById("e-planCode").value;
    if (!planCode) {
      showToast("Please click to select a health plan first.", "warning");
      return;
    }
    const fn = document.getElementById("e-firstName").value.trim();
    const ln = document.getElementById("e-lastName").value.trim();
    const phone = document.getElementById("e-phoneNumber").value.trim();

    document.getElementById("summary-cust-name").textContent = `${fn} ${ln}`;
    document.getElementById("summary-cust-phone").textContent = phone;
    switchStep(3);
  });

  document.getElementById("backto-step-2")?.addEventListener("click", () => switchStep(2));
  tab1?.addEventListener("click", () => switchStep(1));
  tab2?.addEventListener("click", () => {
    if (document.getElementById("e-firstName").value.trim()) switchStep(2);
  });
  tab3?.addEventListener("click", () => {
    if (document.getElementById("e-planCode").value) switchStep(3);
  });

  // Inline group creation toggle handler
  if (isAmbassador) {
    const toggleBtn = document.getElementById("toggle-new-group-btn");
    const groupCard = document.getElementById("inline-create-group-box");
    toggleBtn?.addEventListener("click", () => {
      groupCard?.classList.toggle("hidden");
    });

    document.getElementById("g-create")?.addEventListener("click", () => {
      runWithLoading(document.getElementById("g-create"), "Saving…", async () => {
        const output = document.getElementById("g-output");
        try {
          const data = await api("/groups", {
            method: "POST",
            body: JSON.stringify({ name: document.getElementById("g-name").value, type: document.getElementById("g-type").value }),
          });
          output.innerHTML = `<div class="alert-success">✔ Community created!</div>`;
          setTimeout(() => renderEnrollView(), 800);
        } catch (err) {
          renderError(output, err);
        }
      });
    });
  }

  // Fetch and render health plans
  const planCards = document.getElementById("e-planCards");
  const planCodeField = document.getElementById("e-planCode");
  const planNameField = document.getElementById("e-planName");

  if (planCards && planCodeField && planNameField) {
    (async () => {
      try {
        const plansData = await api("/plans/health");
        const plans = normalizePlans(plansData);
        renderPlanCards(planCards, plans, {
          emptyText: "No health plans returned by provider.",
          onSelect: (plan) => {
            const { code, name, price } = planCardMeta(plan);
            planCodeField.value = code;
            planNameField.value = name;
            document.getElementById("summary-plan-name").textContent = name;
            document.getElementById("summary-plan-price").textContent = price || "NGN 0";
            document.getElementById("summary-total-price").textContent = price || "NGN 0";
          },
        });
      } catch (err) {
        planCards.innerHTML = `<div class="alert-error">Unable to load plans right now: ${err.message}</div>`;
      }
    })();
  }

  // Submit enrollment -> Paystack checkout
  document.getElementById("e-submit")?.addEventListener("click", () => {
    const payload = {
      firstName: document.getElementById("e-firstName").value.trim(),
      lastName: document.getElementById("e-lastName").value.trim(),
      phoneNumber: document.getElementById("e-phoneNumber").value.trim(),
      email: document.getElementById("e-email").value.trim(),
      planCode: document.getElementById("e-planCode").value,
      planName: document.getElementById("e-planName").value,
      paymentMethod: "paystack",
      location: document.getElementById("e-location").value.trim(),
      gender: document.getElementById("e-gender").value,
      dateOfBirth: document.getElementById("e-dateOfBirth").value,
    };
    if (isAmbassador) payload.groupId = document.getElementById("e-groupId").value;

    runWithLoading(document.getElementById("e-submit"), "Opening Paystack…", async () => {
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
        clearPlanSelection("e-planCards", "e-paymentSummaryBox");
      } catch (err) {
        out("e-output", err.data || err.message);
      }
    });
  });
}

// ---------- Bulk Enrollment Page ----------
async function renderBulkEnrollView() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="page-head">
      <h1>Bulk Enrollment</h1>
      <p>Enroll up to 20 customers on a single plan with one combined payment.</p>
    </div>
    <div id="bulk-form"></div>
  `;
  const form = document.getElementById("bulk-form");
  renderLoading(form, "Loading community & plan options…");

  try {
    const [groups, plansData] = await Promise.all([api("/groups/mine"), api("/plans/health")]);
    const plans = normalizePlans(plansData);

    form.innerHTML = `
      <div class="card">
        <h2>1. Select Community &amp; Plan</h2>
        <div class="grid">
          <div>
            <label class="input-label">Community / Group</label>
            <select id="bulk-group"><option value="">Choose community…</option>${groups.map(g => `<option value="${g.id}">${g.name}</option>`).join("")}</select>
          </div>
          <div>
            <label class="input-label">Select Plan (Applies to all)</label>
            <select id="bulk-plan"><option value="">Choose health plan…</option>${plans.map(p => { const m = getPlanMeta(p); const n = Number(m.price); return `<option value="${m.code}" data-price="${n}">${m.name} — NGN ${n.toLocaleString()}/person</option>`; }).join("")}</select>
          </div>
        </div>

        <h2 style="margin-top:20px;">2. Add Customer Details (Max 20)</h2>
        <div id="bulk-rows"></div>
        
        <div style="margin-top:12px;">
          <button class="subtle" id="bulk-add">+ Add Customer Card</button>
        </div>

        <!-- Totals Summary Card -->
        <div class="plan-summary-box" style="margin-top:20px;">
          <h3 style="margin:0 0 10px; color:var(--primary-deep);">Batch Summary</h3>
          <div class="payment-summary-row"><span>Number of Customers</span><strong id="bulk-summary-count">1</strong></div>
          <div class="payment-summary-row"><span>Plan Total</span><strong id="bulk-summary-plan-total">NGN 0</strong></div>
          <div class="payment-summary-row"><span>Payment Fee</span><strong>NGN 0</strong></div>
          <div class="payment-summary-row total"><span>Grand Total</span><strong id="bulk-summary-grand-total">NGN 0</strong></div>
        </div>

        <div style="margin-top:20px;">
          <button class="primary" id="bulk-pay" style="width:100%;">Proceed to Payment</button>
        </div>
        <div id="bulk-output" style="margin-top:10px;"></div>
      </div>
    `;

    const rows = document.getElementById("bulk-rows");
    
    function updateTotals() {
      const count = rows.children.length;
      const selectedPlan = document.getElementById("bulk-plan");
      const unitPrice = Number(selectedPlan.options[selectedPlan.selectedIndex]?.dataset.price || 0);
      const total = count * unitPrice;

      document.getElementById("bulk-summary-count").textContent = count;
      document.getElementById("bulk-summary-plan-total").textContent = `NGN ${total.toLocaleString()}`;
      document.getElementById("bulk-summary-grand-total").textContent = `NGN ${total.toLocaleString()}`;
    }

    function addRow() {
      if (rows.children.length >= 20) return;
      const index = rows.children.length + 1;
      const row = document.createElement("div"); 
      row.className = "bulk-row";
      row.innerHTML = `
        <div class="bulk-row-header">
          <span>Customer #${index}</span>
          ${index > 1 ? `<button class="subtle bulk-remove" type="button" style="padding:4px 8px; min-height:0; color:var(--danger);">Remove</button>` : ""}
        </div>
        <div class="grid-2">
          <input placeholder="First name" data-field="firstName" />
          <input placeholder="Last name" data-field="lastName" />
        </div>
        <div class="grid-2" style="margin-top:6px;">
          <input placeholder="Phone number (2348...)" data-field="phoneNumber" />
          <input placeholder="Email (optional)" data-field="email" />
        </div>
        <div class="grid-2" style="margin-top:6px;">
          <input placeholder="Location" data-field="location" />
          <input type="date" data-field="dateOfBirth" />
        </div>
        <select data-field="gender" style="margin-top:6px;"><option value="">Select gender</option><option>Male</option><option>Female</option></select>
      `;

      row.querySelector(".bulk-remove")?.addEventListener("click", () => {
        row.remove();
        updateTotals();
      });
      rows.appendChild(row);
      updateTotals();
    }

    addRow();
    document.getElementById("bulk-add").onclick = addRow;
    document.getElementById("bulk-plan").onchange = updateTotals;

    document.getElementById("bulk-pay").onclick = () => {
      const customers = [...rows.children].map(row => Object.fromEntries([...row.querySelectorAll("[data-field]")].map(el => [el.dataset.field, el.value.trim()])));
      const selectedPlan = document.getElementById("bulk-plan");
      const planTotal = Number(selectedPlan.options[selectedPlan.selectedIndex]?.dataset.price || 0) * customers.length;

      if (!window.confirm(`You are about to pay NGN ${planTotal.toLocaleString()} for ${customers.length} customer(s). Continue?`)) return;
      
      runWithLoading(document.getElementById("bulk-pay"), "Preparing payment…", async () => {
        try {
          const result = await api("/bulk-orders", { method: "POST", body: JSON.stringify({ groupId: document.getElementById("bulk-group").value, planCode: selectedPlan.value, customers }) });
          out("bulk-output", { message: `Opening secure Paystack checkout for ${result.customerCount} customers…`, paymentRequired: true });
          window.location.assign(result.authorizationUrl);
        } catch (err) { renderError(document.getElementById("bulk-output"), err); }
      });
    };
  } catch (err) { renderError(form, err); }
}

// ---------- Customer Lookup Page ----------
function renderLookupView() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="page-head">
      <h1>Customer Lookup</h1>
      <p>Search any customer record by phone number or policy number.</p>
    </div>
    <div class="card">
      <div class="grid">
        <select id="l-type"><option value="phone">Search by Phone Number</option><option value="policy">Search by Policy Number</option></select>
        <input id="l-value" placeholder="Enter phone number or policy number…" />
      </div>
      <button class="primary" id="l-submit" style="width:100%;">Find Customer</button>
      <div id="l-output" style="margin-top:14px;"></div>
    </div>
  `;

  document.getElementById("l-submit")?.addEventListener("click", () => {
    const type = document.getElementById("l-type").value;
    const value = document.getElementById("l-value").value.trim();
    const outputEl = document.getElementById("l-output");
    if (!value) return out("l-output", { error: "Enter a phone or policy number." });

    runWithLoading(document.getElementById("l-submit"), "Searching…", async () => {
      renderLoading(outputEl, `Searching for ${value}…`);
      try {
        const path = type === "phone" ? `/subscriptions/phone/${encodeURIComponent(value)}` : `/subscriptions/policy/${encodeURIComponent(value)}`;
        const data = await api(path);
        renderLookupResult(data, outputEl);
      } catch (err) {
        out("l-output", err.data || err.message);
      }
    });
  });
}

function renderLookupResult(data, container) {
  if (!data || data.error) {
    return out(container.id, data);
  }

  // Handle unwrapping nested response wrappers from API
  const root = data.subscription || data.policy || data.data || data.result || data;

  const extract = (keys) => {
    for (const k of keys) {
      if (root[k] !== undefined && root[k] !== null && root[k] !== "") {
        if (typeof root[k] === "object" && !Array.isArray(root[k])) {
          const sub = root[k];
          return sub.name || sub.title || sub.code || sub.displayName || null;
        }
        return root[k];
      }
      if (data[k] !== undefined && data[k] !== null && data[k] !== "") {
        if (typeof data[k] === "object" && !Array.isArray(data[k])) {
          const sub = data[k];
          return sub.name || sub.title || sub.code || sub.displayName || null;
        }
        return data[k];
      }
    }
    return null;
  };

  const name = extract(["customer_name", "customerName", "fullName", "full_name", "name", "customer"]) || "Customer Profile";
  const phone = extract(["phone", "phoneNumber", "phone_number", "customer_phone", "customerPhone"]) || "—";
  const policyNum = extract(["wellahealth_policy_number", "policy_number", "policyNumber", "policyCode", "policy_code", "policy"]) || "—";
  const plan = extract(["plan_name", "planName", "plan_code", "planCode", "plan", "title"]) || "—";

  const rawStart = extract(["start_date", "startDate", "effective_date", "effectiveDate", "created_at", "createdAt", "start", "commencementDate"]);
  const rawEnd = extract(["end_date", "endDate", "expiry_date", "expiryDate", "expiration_date", "expirationDate", "end", "dueDate"]);

  const formatDate = (val) => {
    if (!val) return "—";
    const str = String(val).trim();
    if (str.includes("T")) return str.split("T")[0];
    if (str.includes(" ")) return str.split(" ")[0];
    return str;
  };

  const startDate = formatDate(rawStart);
  const endDate = formatDate(rawEnd);
  const status = extract(["status", "policyStatus", "state"]) || "Active";
  const statusBadge = String(status).toLowerCase() === "active" ? "badge-success" : "badge-failed";

  container.innerHTML = `
    <div class="profile-card">
      <div class="profile-header">
        <div class="profile-avatar"><i data-lucide="user"></i></div>
        <div>
          <div class="profile-name">${esc(name)}</div>
          <div class="profile-phone">📞 ${esc(phone)}</div>
        </div>
        <span class="badge ${statusBadge}" style="margin-left:auto;">${status}</span>
      </div>
      <div class="profile-details-grid">
        <div class="profile-detail-item">
          <div class="profile-detail-label">Policy Number</div>
          <div class="profile-detail-value">${esc(policyNum)}</div>
        </div>
        <div class="profile-detail-item">
          <div class="profile-detail-label">Health Plan</div>
          <div class="profile-detail-value">${esc(plan)}</div>
        </div>
        <div class="profile-detail-item">
          <div class="profile-detail-label">Start Date</div>
          <div class="profile-detail-value">${startDate}</div>
        </div>
        <div class="profile-detail-item">
          <div class="profile-detail-label">Expiry Date</div>
          <div class="profile-detail-value">${endDate}</div>
        </div>
      </div>
      <div style="margin-top:16px;">
        <button class="primary" id="lookup-renew-btn" data-phone="${esc(phone)}"><i data-lucide="repeat"></i> Renew Customer</button>
      </div>
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();

  document.getElementById("lookup-renew-btn")?.addEventListener("click", () => {
    setActiveTab("renew");
    setTimeout(() => {
      const phoneInput = document.getElementById("r-phoneNumber");
      if (phoneInput) phoneInput.value = phone;
    }, 100);
  });
}

// ---------- Renew Customer Page ----------
function renderRenewView() {
  const container = document.getElementById("views");
  container.innerHTML = `
    <div class="page-head">
      <h1>Renew Customer</h1>
      <p>Renew any customer's plan by entering their phone number.</p>
    </div>
    <div class="card">
      <h2>Step 1: Enter Customer Phone Number</h2>
      <div class="grid">
        <input id="r-phoneNumber" placeholder="Phone number (2348...)" />
      </div>

      <h2 style="margin-top:20px;">Step 2: Select Health Plan</h2>
      <div id="r-planCards" class="plan-card-wrap">Fetching health plans…</div>
      <input id="r-planCode" type="hidden" />

      <!-- Payment Summary -->
      <div id="r-paymentSummaryBox" class="plan-summary-box hidden">
        <h3 style="margin:0 0 10px; color:var(--primary-deep);">Step 3: Review Payment</h3>
        <div class="payment-summary-row"><span>Selected Plan</span><strong id="r-summary-plan-name">—</strong></div>
        <div class="payment-summary-row"><span>Plan Amount</span><strong id="r-summary-plan-price">—</strong></div>
        <div class="payment-summary-row total"><span>Total Amount</span><strong id="r-summary-total-price">—</strong></div>
      </div>

      <div style="margin-top:20px;">
        <button class="primary" id="r-submit" style="width:100%;">Continue to Payment</button>
      </div>
      <div id="r-output" style="margin-top:10px;"></div>
    </div>
  `;

  const planCards = document.getElementById("r-planCards");
  const summaryBox = document.getElementById("r-paymentSummaryBox");
  const planCodeField = document.getElementById("r-planCode");

  if (planCards && planCodeField) {
    (async () => {
      try {
        const plansData = await api("/plans/health");
        const plans = normalizePlans(plansData);
        renderPlanCards(planCards, plans, {
          emptyText: "No plans returned by provider.",
          onSelect: (plan) => {
            const { code, name, price } = planCardMeta(plan);
            planCodeField.value = code;
            summaryBox.classList.remove("hidden");
            document.getElementById("r-summary-plan-name").textContent = name;
            document.getElementById("r-summary-plan-price").textContent = price || "NGN 0";
            document.getElementById("r-summary-total-price").textContent = price || "NGN 0";
          },
        });
      } catch (err) {
        planCards.innerHTML = `<div class="alert-error">Unable to load plans right now: ${err.message}</div>`;
      }
    })();
  }

  document.getElementById("r-submit")?.addEventListener("click", () => {
    const payload = {
      phoneNumber: document.getElementById("r-phoneNumber").value.trim(),
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
        clearPlanSelection("r-planCards", "r-paymentSummaryBox");
      } catch (err) {
        out("r-output", err.data || err.message);
      }
    });
  });
}

// ---------- My Enrollments (Agent / Customer) ----------
async function renderMyPoliciesView() {
  const container = document.getElementById("views");
  container.innerHTML = `<div class="page-head"><h1>My Customers</h1><p>Customer accounts you have enrolled.</p></div><div id="mp-list"></div>`;
  const listEl = document.getElementById("mp-list");
  renderLoading(listEl, "Loading enrollments…");

  try {
    const policies = await api("/me/policies");
    if (policies.length === 0) {
      renderEmptyState(listEl, "No enrollments completed yet", "file-text");
      return;
    }
    listEl.innerHTML = `
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Plan</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              ${policies.map(p => {
                const badgeClass = p.status === "Active" ? "badge-success" : p.status === "Cancelled" || p.status === "Expired" ? "badge-failed" : "badge-pending";
                return `<tr><td><strong>${p.customer_name}</strong><div class="muted">${p.customer_phone || ""}</div></td><td>${p.plan_code}</td><td><span class="badge ${badgeClass}">${p.status}</span></td><td>${p.created_at ? p.created_at.split("T")[0] : ""}</td></tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (err) {
    renderError(listEl, err);
  }
}

// ---------- Read Manual (Full User Manual) ----------
const MANUAL_COMMON = `
  <h2>Getting Started</h2>
  <h3>Logging in</h3>
  <p>Open SehaNet and enter the <strong>username</strong> and <strong>password</strong> your admin gave you, then click <strong>Log in</strong>. Customers who registered themselves log in with the username and password they created at sign-up.</p>
  <h3>Changing your password</h3>
  <p>Click the <strong>key icon / Password button</strong> at the top of the screen, enter your current password and a new one (at least 6 characters), type it again to confirm, and click <strong>Update</strong>.</p>
  <h3>Sessions and security</h3>
  <p>The app automatically signs you out after <strong>2 minutes of inactivity</strong> for security. Always click <strong>Log out</strong> when you finish working. Never share your password or customer data.</p>
`;

const MANUAL_COMMISSION_ENGINE = `
  <h2>How Commission Works</h2>
  <p>SehaNet's money model is simple. When a customer pays for a plan:</p>
  <ol>
    <li>The customer pays the <strong>plan price</strong>.</li>
    <li><strong>WellaHealth's cut to admin</strong> (the percentage set in Commission Settings) is the share of the plan price that comes to the business. This is the admin's income from the sale.</li>
    <li>An <strong>Ambassador's commission</strong> is a percentage of <em>that WellaHealth cut</em> — not a percentage of the full customer payment. Different rates apply to new enrollments and renewals.</li>
  </ol>
  <p>Example — one new enrollment of NGN 5,000 with a 20% WellaHealth cut and a 30% ambassador rate:</p>
  <ul>
    <li>WellaHealth cut to admin: NGN 5,000 × 20% = <strong>NGN 1,000</strong></li>
    <li>Ambassador commission: NGN 1,000 × 30% = <strong>NGN 300</strong></li>
    <li>Admin net after expenses: NGN 1,000 − NGN 300 = <strong>NGN 700</strong></li>
  </ul>
  <p>Rates are snapshotted at the moment of sale. Changing Commission Settings only affects future activity — it never rewrites a commission that was already earned.</p>
`;

const MANUAL_BY_ROLE = {
  admin: `
    <h1>SehaNet — Administrator Manual</h1>
    <p>This guide walks through every feature and tab available to administrators.</p>
    ${MANUAL_COMMON}
    <h2>Business Dashboard</h2>
    <p>A live summary of the whole business:</p>
    <ul>
      <li><strong>Payments recorded</strong> — total money in from policies and renewals.</li>
      <li><strong>Admin net before expenses</strong> — all recorded payments less ambassador commission owed.</li>
      <li><strong>Admin net after expenses</strong> — your actual income: the WellaHealth cut less ambassador commission owed.</li>
      <li><strong>Ambassador commission owed / paid</strong> — what ambassadors have earned and what has been paid out.</li>
      <li><strong>Customers / Active policies</strong> — total customer records and active policies.</li>
    </ul>

    <h2>Agents &amp; Ambassadors</h2>
    <p><strong>Creating an account:</strong> Fill in name, phone, username, password, and pick role (Agent or Ambassador). For Ambassadors, select the bank and enter account number — SehaNet automatically verifies the account holder name with Paystack before saving.</p>
    <p><strong>Editing someone:</strong> Click <strong>Edit</strong> to change bank details or set custom personal commission rates.</p>
    <p><strong>Blocking &amp; Removing:</strong> Block temporarily pauses login access. Remove permanently deletes an account, with an option to reassign future commissions to another active ambassador.</p>

    <h2>Policies Directory</h2>
    <p>Full directory of enrollments. Search by customer name or phone number, or filter by policy status (Active, Cancelled, Expired).</p>

    <h2>Renewals Due</h2>
    <p>Policies expiring within the next 14 days, sorted soonest first. Highlighted when expiring within 3 days.</p>

    <h2>Groups / Communities</h2>
    <p>Read-only view of communities created by Ambassadors (bank, market, school, association).</p>

    <h2>Commission Settings</h2>
    <p>Set WellaHealth cut to admin %, Ambassador new enrollment rate %, and Ambassador renewal rate %.</p>

    <h2>Weekly Payout</h2>
    <p>Load draft payouts for the week, review Ambassador line items, approve &amp; execute real Paystack bank transfers, export weekly CSV reports, and review Ambassador withdrawal requests.</p>

    <h2>Enroll</h2>
    <p>Register single customers into health plans with automatic Paystack checkout.</p>

    <h2>Customer Lookup</h2>
    <p>Search by phone or policy number to view formatted profile cards.</p>

    <h2>Renew Customer</h2>
    <p>Renew any customer policy by phone number and plan selection.</p>

    ${MANUAL_COMMISSION_ENGINE}
  `,

  ambassador: `
    <h1>SehaNet — Ambassador Manual</h1>
    <p>As an Ambassador you enroll and renew customers in communities and earn commission.</p>
    ${MANUAL_COMMON}
    ${MANUAL_COMMISSION_ENGINE}

    <h2>Ambassador Dashboard</h2>
    <p>Your main hub displaying greeting stats (Total Customers, Renewals Due, Available Commission, Lifetime Commission), Quick Action cards, and My Communities grid.</p>

    <h2>Enroll Customer (Combined Workflow)</h2>
    <ol>
      <li><strong>Step 1: Select Community</strong> — Choose an existing group or click <strong>+ Create</strong> to add a new community (e.g. GTBank Staff, Sabon Gari Market).</li>
      <li><strong>Step 2: Customer Information</strong> — Fill in first name, last name, phone (format 2348...), email, location, gender, and date of birth.</li>
      <li><strong>Step 3: Select Health Plan</strong> — Click a health plan card to view prices and coverage details.</li>
      <li><strong>Step 4: Payment Summary</strong> — Review plan amount and grand total.</li>
      <li><strong>Step 5: Continue to Payment</strong> — Opens the secure Paystack checkout. When payment succeeds, WellaHealth policy is created automatically.</li>
    </ol>

    <h2>Bulk Enrollment</h2>
    <p>Enroll up to 20 customers on one plan in a single transaction:</p>
    <ol>
      <li>Select your community group and health plan.</li>
      <li>Click <strong>+ Add Customer Card</strong> to fill details for each person.</li>
      <li>Review batch totals (customer count, plan total, grand total).</li>
      <li>Click <strong>Proceed to Payment</strong> for single Paystack checkout.</li>
    </ol>

    <h2>Renewals Due (Task Manager)</h2>
    <p>Your worklist of expiring customer policies. Displays customer name, plan, days remaining, urgent highlight badges (expiring within 3 days), <strong>Call button</strong> (phone link), and <strong>Renew button</strong> which pre-fills the renewal page.</p>

    <h2>Customer Lookup</h2>
    <p>Search any customer by phone number or policy number to view profile card details and quick renew action.</p>

    <h2>Renew Customer</h2>
    <p>Renew any customer in the system by entering their phone number, selecting a plan, and completing payment.</p>

    <h2>My Communities</h2>
    <p>Grid view of all community groups you manage with member counts and direct enrollment links.</p>

    <h2>My Earnings</h2>
    <p>View Available Commission, Paid Out, and Lifetime Commission stat cards. Request payouts directly to your verified bank account and track payment request history cards.</p>
  `,

  agent: `
    <h1>SehaNet — Agent Manual</h1>
    <p>As an Agent you enroll, lookup, and renew customers. You do not earn commission and do not use groups.</p>
    ${MANUAL_COMMON}

    <h2>Agent Dashboard</h2>
    <p>Displays enrolled customer count, renewals due, and quick action shortcuts for Enroll, Renew, Lookup, and My Customers.</p>

    <h2>Enroll</h2>
    <p>Fill in customer information, choose a health plan card, review payment summary, and proceed to secure Paystack checkout.</p>

    <h2>Renewals Due</h2>
    <p>Task manager showing customers you enrolled whose policies expire soon. Use Call and Renew action buttons for quick follow-up.</p>

    <h2>Customer Lookup</h2>
    <p>Search any customer record by phone or policy number to view profile details.</p>

    <h2>Renew Customer</h2>
    <p>Renew any customer policy by phone number and plan selection.</p>

    <h2>My Customers</h2>
    <p>List of all customers you have personally enrolled and their active policy statuses.</p>
  `,

  customer: `
    <h1>SehaNet — Customer Manual</h1>
    ${MANUAL_COMMON}
    <h2>My Plan</h2>
    <p>View your active health plan policy details, status, and coverage end date.</p>
    <h2>Enroll</h2>
    <p>Buy a health plan for yourself by filling your details and completing Paystack payment.</p>
    <h2>Plan Expiry</h2>
    <p>Track when your health plan expires so you can renew in time without gap in cover.</p>
  `,
};

async function renderManualView() {
  const container = document.getElementById("views");
  const content = MANUAL_BY_ROLE[state.user.role] || MANUAL_BY_ROLE.agent;
  container.innerHTML = `<div class="card"><button class="subtle manual-back-btn" id="manual-back-btn">← Back</button><div class="manual-content">${content}</div></div>`;
  document.getElementById("manual-back-btn")?.addEventListener("click", () => setActiveTab(state.lastTab || (TABS_BY_ROLE[state.user.role] || [])[0]?.[0]));
}

// Init
if (state.token) {
  boot();
}

