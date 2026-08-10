# SehaNet Full User Manual

Welcome to SehaNet. This is the complete manual for the web app — it explains every tab
and how everything works (enrolling, renewing, commissions, payouts) for each type of
user. Find your role below and read the sections relevant to what you do.

- [Getting Started (all users)](#getting-started-all-users)
- [How Commission Works](#how-commission-works)
- [Administrator Manual](#administrator-manual)
- [Ambassador Manual](#ambassador-manual)
- [Agent Manual](#agent-manual)
- [Customer Manual](#customer-manual)
- [Troubleshooting](#troubleshooting)

---

## Getting Started (all users)

SehaNet has four types of accounts:

- **Admin** — runs the whole system: creates accounts, sets commission rates, reviews
  policies, approves weekly payouts.
- **Ambassador** — enrolls and renews customers, and earns commission for it.
- **Agent** — enrolls and renews customers too, but doesn't earn commission.
- **Customer** — buys and manages their own health plan.

### Logging in

Open SehaNet and enter the **username** and **password** your admin gave you, then click
**Log in**. Customers who registered themselves log in with the username and password
they created at sign-up.

### Changing your password

Click the **key icon** at the top of the screen, enter your current password and a new
one (at least 6 characters), type it again to confirm, and click **Update**.

### Sessions and security

- The app automatically signs you out after **2 minutes of inactivity**. You'll get a
  warning first. This is a security feature, not a bug.
- Always click **Log out** when you finish working.
- Never share your password or customer data.

---

## How Commission Works

SehaNet's money model is simple. When a customer pays for a plan:

1. The customer pays the **plan price**, plus a fixed **NGN 50 payment fee** at every
   checkout — one fee per transaction, even for a bulk enrollment of many people.
2. **WellaHealth's cut to admin** (the percentage set in Commission Settings) is the
   share of the plan price that comes to the business. This is the admin's income from
   the sale.
3. An **Ambassador's commission** is a percentage of *that WellaHealth cut* — not a
   percentage of the full customer payment. Different rates apply to new enrollments
   and renewals.

Example — one new enrollment of NGN 5,000, with a 20% WellaHealth cut and a 30%
ambassador rate:

- WellaHealth cut to admin: NGN 5,000 × 20% = **NGN 1,000**
- Ambassador commission: NGN 1,000 × 30% = **NGN 300**
- Admin net after expenses: NGN 1,000 + NGN 50 fee − NGN 300 = **NGN 750**

Rates are snapshotted at the moment of sale. Changing Commission Settings only affects
future activity — it never rewrites a commission that was already earned.

---

## Administrator Manual

The admin can see every tab in the app. Here is what each one does.

### Dashboard

A live summary of the whole business:

- **Payments recorded** — total money in from policies and renewals (plan prices plus
  payment fees).
- **Payment fees collected** — total NGN 50 fees charged across all checkouts.
- **Admin net before expenses** — all recorded payments less ambassador commission owed.
- **Admin net after expenses** — your actual income: the WellaHealth cut (plan payments
  × the % in Commission Settings), plus payment fees, less ambassador commission owed.
  See [How Commission Works](#how-commission-works).
- **Ambassador commission owed / paid** — what ambassadors have earned and what has been
  paid out. The gap is the outstanding balance.
- **Customers / Active policies** — total customer records and currently-active policies.

These figures are calculated from recorded data only; nothing here is typed in by hand.

### Agents & Ambassadors

**Creating an account.** Fill in the person's name, phone, username, and password (you
choose it — they can change it later). Pick a role:

- **Agent (unpaid)** — can enroll, look up, and renew customers, but earns no commission
  and uses no Groups.
- **Ambassador (paid)** — earns commission and works through Groups. When you select
  Ambassador, bank fields appear.

For an Ambassador, choose the **bank** and enter the **account number**. SehaNet
verifies the account against the bank and shows the real account holder's name before
saving — always confirm this matches the person you intend to pay.

**Editing someone.** Click **Edit** to change their name, phone, or bank details, or to
set a **personal commission rate** that overrides the default. Click **Save & Verify
Bank** to re-check the account number before saving.

**Blocking, unblocking, removing.**

- **Block** — temporary pause. The user can't log in while blocked; a reason is
  required. **Unblock** restores access any time.
- **Remove** — permanent and cannot be undone. For an Ambassador you can optionally
  **reassign future commissions** to another active Ambassador; this only affects
  renewals going forward. Anything already earned is untouched and still gets paid.

### Policies

The full directory of every enrollment. **Search** by customer name or phone, or
**filter by status** (Active, Cancelled, Expired). The list is paginated — use
Previous/Next to move through results. Each row shows the customer, plan, WellaHealth
policy number, amount paid, status, who enrolled them, and the policy end date.

### Renewals Due

Every policy across the whole system that expires within the next 14 days, soonest
first. Rows due in 3 days or less are highlighted. Use the phone number link to call or
SMS the customer and remind them to renew — reminders are still sent manually.

### Groups

A read-only view of every Group Ambassadors have created (which bank, market, school, or
association each one covers). Groups are created by Ambassadors themselves, not by you.

### Commission Settings

Three percentages control all money calculations:

- **WellaHealth's cut to admin (%)** — the share of each plan payment that comes to your
  business.
- **Ambassador rate — new enrollment (%)** — what an Ambassador earns from a new
  sign-up, as a share of the WellaHealth cut above.
- **Ambassador rate — renewal (%)** — the same idea for renewals.

Click **Save Settings** when done. Changes only affect activity going forward. You can
also override the rate for one specific Ambassador from their profile in Agents &
Ambassadors.

### Weekly Payout

This is where Ambassadors actually get paid.

1. **Load a draft.** Click **Load / Create Draft** for the current week (leave the week
   field blank), or type a specific week (e.g. 2026-W30) to catch up on a past one.
2. **Review.** The draft lists each Ambassador, how many enrollments and renewals they
   had, and the exact amount owed. Check these numbers carefully — this is the money
   that will leave your account.
3. **Approve & Pay.** Clicking this initiates real Paystack bank transfers to each
   Ambassador's verified account. There is no undo, so double-check the total first.
   A failed transfer (e.g. a bad account number) is clearly marked and doesn't block the
   others; fix the account details and retry.
4. **Payout History** keeps every past payout, and you can export any week as a CSV
   spreadsheet.
5. **Ambassador Payment Requests.** When an Ambassador requests a payment from My
   Earnings, it appears here with their available balance. **Approve** to accept it,
   **Reject** to decline (optionally leaving a note), or **Pay now** to send the money
   immediately via Paystack. Only approve amounts you're sure about.

### Enroll

Register a single customer exactly like an Agent would: fill in their details, pick a
plan (the price plus the NGN 50 payment fee is shown), and click **Enroll**. The
customer is taken to the secure Paystack checkout and, once payment succeeds, their
WellaHealth policy is created automatically. The same phone number can never be enrolled
twice.

### Look Up

Find any customer by **phone number** or **WellaHealth policy number**. Results show the
full subscription details, including nested payment information.

### Renew

Renew any customer in the system: enter their phone number, choose a plan, and click
**Renew**. They pay via the Paystack checkout (plan price + NGN 50 fee) and their
policy end date is extended automatically.

### Security notes

Never share your password, Paystack keys, or customer data. Always confirm an
Ambassador's bank details before approving a real transfer, and never pay a payout
amount you haven't reviewed in the draft.

---

## Ambassador Manual

As an Ambassador you enroll and renew customers and earn commission for it. Here is how
each tab works.

### Enroll

**Create a Group first.** A **Group** represents the community you're working — a bank's
staff, a market, a school, and so on. On the Enroll tab, give your Group a name (e.g.
"GTBank Lagos Staff") and pick a type (Bank, Market, School, Association, or Other),
then click **Create Group**. You only do this once per community; after that you pick it
from the dropdown.

**Enrolling one customer.**

1. Pick the Group this customer belongs to (or create a new one).
2. Fill in the customer's **first name, last name, phone number** (format 2348...),
   email (optional), **location, gender, and date of birth**.
3. Choose a plan from the cards. The summary shows the plan price plus the **NGN 50
   payment fee** you'll collect.
4. Click **Enroll** — the customer is taken to the secure Paystack checkout. When
   payment succeeds, their WellaHealth policy is created automatically and you'll see
   the confirmation.

**You can't enroll the same phone number twice.** If someone is already a customer, use
**Renew** instead.

### Bulk Enroll

For up to **20 people on the same plan** in one payment:

1. Choose your **Group** and one **plan** for the whole batch.
2. Click **Add person** to fill in each customer's details (a name, phone, location,
   date of birth, and gender are required for every person).
3. Click **Review & pay**. You'll see the total — all plan prices plus a single NGN 50
   payment fee for the batch — and confirm.
4. The batch opens in the secure Paystack checkout. Once paid, SehaNet creates each
   customer's policy automatically.

All phone numbers in a batch must be different, and none may already be enrolled.

### Renewals Due

Your worklist: your own customers whose plans expire within the next 14 days, soonest
first. Rows due in 3 days or less are highlighted. Call or message them to offer a
renewal.

### Look Up

Find any customer in the system by **phone number** or **policy number** — useful for
checking a customer's plan before renewing them.

### Renew

You can renew **any** customer, not just ones you enrolled. Enter their phone number,
choose a plan, and click **Renew**. They pay via the secure checkout (plan price + NGN
500 fee) and their policy end date extends automatically.

### My Groups

A list of every Group you've created, with its type and when it was made.

### My Earnings

Your money, in one place:

- **Available to request** — commission you've earned and can withdraw right now.
- **Already paid** — what has been paid out to you.
- **Lifetime commission** — everything you've ever earned, including amounts currently
  sitting in a request.

**Requesting payment.** Enter an amount up to your available balance, optionally add a
note, and click **Request payment**. Your admin reviews it in Weekly Payout; if
approved, the money is sent to the bank account on file. Track the status of each
request in **Request history** (Pending / Approved / Paid / Rejected).

### Security notes

Keep your username and password private. You can only see your own customers and
earnings — you cannot view another Ambassador's.

---

## Agent Manual

As an Agent you enroll, look up, and renew customers. You don't earn commission and you
don't use Groups.

### Enroll

1. Fill in the customer's **first name, last name, phone number** (format 2348...),
   email (optional), **location, gender, and date of birth**.
2. Choose a plan from the cards. The summary shows the plan price plus the **NGN 50
   payment fee** charged at checkout.
3. Click **Enroll** — the customer is taken to the secure Paystack checkout. When
   payment succeeds, their WellaHealth policy is created automatically.

**You can't enroll the same phone number twice.** If someone is already a customer, use
**Renew** instead.

### Renewals Due

Your worklist: customers you enrolled whose plans expire within the next 14 days, soonest
first. Rows due in 3 days or less are highlighted. Contact them to offer a renewal.

### Look Up

Find any customer by **phone number** or **WellaHealth policy number** — handy before
renewing someone.

### Renew

You can renew **any** customer in the system. Enter their phone number, choose a plan,
and click **Renew**. They pay via the secure checkout (plan price + NGN 50 fee) and
their policy end date extends automatically.

### My Enrollments

Everyone you've personally signed up, with their current status (Active, Cancelled,
Expired, etc.) and when they were enrolled. Use this for follow-up.

### Security notes

Keep your username and password private. You only see your own enrollment records.

---

## Customer Manual

SehaNet is how you buy and manage your WellaHealth plan.

### My Plan

Your current policy: the plan you're on, its status, and when it was created. If your
policy is active, you're covered — keep an eye on the end date so you can renew before
it expires.

### Enroll

Buy a health plan:

1. Fill in your details (your phone number must match the one on your account).
2. Choose a plan. The summary shows the plan price plus the **NGN 50 payment fee**
   added at checkout.
3. Click **Enroll** — you're taken to the secure Paystack checkout to pay by card.

Once payment succeeds, your policy is created automatically. Your phone number can only
be enrolled once.

### Plan Expiry

Shows when your plan is due to expire (within the next 14 days), so you know when to
renew and avoid a gap in cover.

### Security notes

Keep your username and password private. If you think your account has been used without
permission, tell your admin immediately.

---

## Troubleshooting

**"This phone number is already enrolled"**
Someone already enrolled this customer. Use Renew instead of Enroll.

**"Your account has been blocked. Contact the admin."**
Your admin has temporarily paused your account. Reach out to them directly.

**"groupId is required" (Ambassadors only)**
You tried to enroll someone without picking a Group first. Go back and either select an
existing Group or create a new one.

**"Current password is incorrect"**
You mistyped your current password while changing it. If you've genuinely forgotten it,
ask your admin to reset it.

**An enrollment or renewal fails with an unfamiliar error**
This usually means WellaHealth itself rejected the request (bad plan code, invalid data,
etc.). Double-check the details you entered match exactly, and try again. If it keeps
failing, contact your admin.

**I was charged, but the plan doesn't show up**
Payments are confirmed automatically by the payment webhook. If the confirmation page
says the payment was recorded, give it a minute and check again. If it still doesn't
appear, contact your admin with the payment reference.

**Nothing loads / the screen stays blank**
Check your internet connection first. If that's fine, try logging out and back in. If it
still doesn't work, contact your admin — there may be a server issue on their end.
