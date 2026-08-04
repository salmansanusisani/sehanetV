# SehaNet User Manual

Welcome to SehaNet — this guide explains how to use the app, whatever your role. Find
your section below and skip the rest; you don't need to read the whole manual, just the
part that matches what you do.

- [Getting Started](#getting-started)
- [For Admins](#for-admins)
- [For Ambassadors](#for-ambassadors)
- [For Agents](#for-agents)
- [Common Questions](#common-questions)
- [Troubleshooting](#troubleshooting)

---

## Getting Started

SehaNet has three types of accounts:

- **Admin** — runs the whole system: creates accounts, sets commission rates, approves
  weekly payouts.
- **Ambassador** — enrolls and renews customers, and earns commission for it.
- **Agent** — enrolls and renews customers too, but doesn't earn commission.

You'll be given a username and password by your admin. There's no self-signup — if you
don't have a login yet, ask your admin to create one for you.

**To log in:** enter your username and password on the first screen and tap **Log in**.

**To change your password:** tap the key icon at the top of the screen, enter your
current password and a new one (at least 6 characters), and confirm.

**If you're locked out:** contact your admin — they can reset your password for you at
any time.

---

## For Admins

### Creating an Agent or Ambassador

1. Go to **Agents & Ambassadors**.
2. Fill in their name, phone, a username, and a password (you choose the password —
   they can change it later themselves).
3. Choose the role:
   - **Agent** — no commission, no Groups.
   - **Ambassador** — earns commission, must create a Group before enrolling.
4. If they're an Ambassador, add their bank details (bank name and account number).
   SehaNet checks the account number against the bank and shows you the real account
   holder's name before saving — always check this matches who you think you're paying.
5. Tap **Create**.

### Blocking, unblocking, and removing someone

- **Block** — use this for a temporary pause (e.g. investigating something). They can't
  log in while blocked. You must give a reason. Unblock any time to restore access.
- **Remove** — this is permanent. If you're removing an Ambassador, you can optionally
  reassign their future commission to another active Ambassador — this only affects
  renewals going forward; anything they already earned is untouched and still gets paid.

### Commission Settings

Under **Commission Settings**, you control three numbers:

- **WellaHealth's cut to admin (%)** — what WellaHealth pays your business per plan.
- **Ambassador rate — new enrollment (%)** — what an Ambassador earns from a new sign-up,
  as a share of the WellaHealth cut above (not the full customer payment).
- **Ambassador rate — renewal (%)** — same idea, for renewals.

Changing these only affects activity going forward — anything already calculated in a
past payout stays as it was.

You can also give one specific Ambassador a different rate than everyone else, from
their profile.

### Weekly Payout

This is where Ambassadors actually get paid.

1. Go to **Weekly Payout**.
2. Load the draft for the current week (or type in a specific week if you're catching up
   on a past one).
3. Review the numbers carefully — this shows exactly what each Ambassador is owed and
   why (how many enrollments, how many renewals).
4. When you're confident it's correct, tap **Approve & Pay**. This is the moment real
   money leaves your account and goes to each Ambassador's bank account — there's no
   undo after this, so double-check the total first.
5. If any transfer fails (e.g. a bad account number), it's clearly marked — it won't
   block the others from going through, and you can retry it once it's fixed.
6. Past payouts are kept in **Payout History**, where you can also export any week as a
   spreadsheet (CSV) for your own records.

### Groups

Admins can see every Group any Ambassador has created (which bank, market, school, etc.
they're working), but Groups are created by Ambassadors themselves, not by you.

### Renewals Due

Shows every customer across the whole system whose plan is expiring soon, soonest first.
Use this to know who needs a renewal reminder call or SMS — reminders are still sent
manually for now.

### Searching Policies

Use the **Policies** tab to search by customer name or phone number, or filter by status,
if you need to find one specific enrollment.

---

## For Ambassadors

As an Ambassador, you do everything an Agent does, plus you earn commission — and there's
one extra step: you work through a **Group**.

### What's a Group?

A Group represents who you're enrolling — a bank's staff, a market association, a school,
etc. You pick a type (Bank, Market, School, Association, or Other) and give it a name,
like "GTBank Lagos Staff" or "Sabon Gari Market Traders." Every customer you enroll
afterward gets tagged with that Group.

**To create one:** go to **Enroll**, and before filling in a customer's details, create
your Group first (you only need to do this once per bank/market/school — after that, just
pick it from the list for every new customer from that same place).

### Enrolling a customer

1. Go to **Enroll**.
2. Pick the Group this customer belongs to (or create a new one if it's a new place
   you're working).
3. Fill in the customer's details: name, phone number, plan, amount paid, location,
   gender, date of birth, and payment reference.
4. Tap **Enroll**. If everything checks out, you'll see a confirmation with their new
   WellaHealth policy number.

**Important:** you can't enroll the same phone number twice. If someone's already a
customer, use **Renew** instead of trying to enroll them again.

### Looking someone up

Go to **Look Up**, choose whether you have their phone number or policy number, and
search. This works for any customer in the system, not just ones you personally enrolled.

### Renewing a customer

Go to **Renew**, enter their phone number, plan code, amount paid, and a payment
reference. You can renew any customer — not just people you originally enrolled
yourself.

### Checking your earnings

Go to **My Earnings** to see your total enrollments, total renewals, and an estimate of
your lifetime commission. The actual amount you're paid each week comes from your admin's
Weekly Payout process — this page is your own running estimate.

### Your Groups

Go to **My Groups** to see every Group you've created and when.

### Your upcoming renewals

Go to **Renewals Due** to see which of your own customers are expiring soon — this is
your worklist for who to call or message about renewing.

---

## For Agents

As an Agent, you can enroll, look up, and renew customers exactly like an Ambassador —
the only difference is you don't earn commission, and you don't use Groups.

### Enrolling a customer

Go to **Enroll**, fill in the customer's details (name, phone, plan, amount paid,
location, gender, date of birth, payment reference), and tap **Enroll**. No Group
selection needed — that's an Ambassador-only step.

### Looking someone up

Go to **Look Up**, search by phone number or policy number.

### Renewing a customer

Go to **Renew**, enter their phone number, plan code, amount paid, and payment reference.
Like Ambassadors, you can renew anyone in the system, not just people you personally
enrolled.

### Your enrollment history

Go to **My Enrollments** to see everyone you've personally signed up and their current
status.

---

## Common Questions

**Can I enroll the same person twice?**
No — SehaNet blocks it to prevent accidentally double-charging WellaHealth for the same
customer. If they're already enrolled, use Renew instead.

**Can any Agent or Ambassador renew any customer?**
Yes — renewals aren't limited to whoever originally enrolled that customer. Anyone with
an active account can process a renewal for anyone.

**I'm an Ambassador — why do I need a Group before I can enroll someone?**
It's how SehaNet tracks which community/market/bank each customer came through, and it's
required before your first enrollment from a new place. After that, just reuse the same
Group for anyone else from that same place.

**What happens to my customers if I'm removed from the system?**
Your past enrollments and the commission you already earned from them are untouched.
Going forward, your admin decides whether someone else takes over crediting for renewals
on your old customers.

**Why don't Agents earn commission?**
That's simply how the two roles are set up — Agent is the unpaid tier, Ambassador is the
paid tier. If this should change for you, that's a conversation with your admin, not
something changeable in the app.

---

## Troubleshooting

**"This phone number is already enrolled"**
Someone (possibly you, possibly someone else) already enrolled this customer. Use Renew
instead of Enroll.

**"Your account has been blocked. Contact the admin."**
Your admin has temporarily paused your account. Reach out to them directly — this isn't
something you can undo yourself.

**"groupId is required"** (Ambassadors only)
You tried to enroll someone without picking a Group first. Go back and either select an
existing Group or create a new one.

**"Current password is incorrect"**
You mistyped your current password while trying to change it. If you've genuinely
forgotten it, ask your admin to reset it for you.

**An enrollment or renewal fails with an unfamiliar error**
This usually means WellaHealth itself rejected the request (bad plan code, invalid data,
etc.) rather than a SehaNet problem. Double check the details you entered match exactly
(especially the plan code), and try again. If it keeps failing, contact your admin.

**Nothing loads / the screen stays blank**
Check your internet connection first. If that's fine, try logging out and back in. If it
still doesn't work, contact your admin — there may be a server issue on their end.
