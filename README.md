# DHANVEXA — Full Platform Starter (Web + Android-ready + Admin + Owner)

This is a runnable full-stack **development starter**, not yet an officially launched financial-services business.

## What is included
- Responsive customer web app (also installable as a PWA on supported Android browsers)
- Admin workspace and separate Owner dashboard (role-gated)
- Express API backend
- Prisma + SQLite development database
- Password hashing, JWT authentication, role checks, Helmet, rate limiting, input validation
- Customer registration/login, product catalogue, customer application submission, application tracking
- Admin application status management and user listing
- Owner summary dashboard
- Capacitor configuration to wrap the web client as an Android project

## Important limitations
- No live bank, broker, lender, insurer, mutual-fund, KYC, payment, SMS/OTP, email, Aadhaar/PAN, or commission partner integrations are included.
- The sample admin account is for local development only. Change it immediately and never deploy the sample credentials.
- SQLite is for local development. Use a managed production database (for example PostgreSQL) and secure secrets before production.
- PWA / Capacitor source is Android-ready, but an APK is **not** compiled here. Android Studio + Android SDK are required to build/sign an APK.
- Do not collect customer passwords for partner sites, OTPs, card PINs, CVV, or unnecessary sensitive identity/financial data.
- Before real operations in India, obtain legal advice on the exact business model, company/trademark checks, privacy/data protection, consumer protection, grievance redressal and any applicable RBI/SEBI/IRDAI/NPCI or other requirements. Sign partner agreements and use only authorised partner APIs/links.

## Run locally
Requirements: Node.js 20+ and npm.

### 1. Start API
```bash
cd server
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run seed
npm run dev
```
API runs at `http://localhost:4000`.

Development owner login:
- Email: `owner@dhanvexa.local`
- Password: `ChangeMe123!`

Development admin login:
- Email: `admin@dhanvexa.local`
- Password: `ChangeMe123!`

Change these passwords before sharing the project or exposing it to a network.

### 2. Start web app
In a second terminal:
```bash
cd client
cp .env.example .env
npm install
npm run dev
```
Open the Vite URL shown in the terminal (normally `http://localhost:5173`).

### 3. Android app
After starting and testing the web client:
```bash
cd client
npm run build
npx cap add android
npx cap sync android
npx cap open android
```
Build and sign the APK/AAB in Android Studio. For a real phone connected to a remote API, set `VITE_API_URL` to your deployed HTTPS API URL and rebuild.

## Roles
- CUSTOMER: customer dashboard and own applications
- ADMIN: admin workspace, application queue and user list
- OWNER: admin capabilities plus owner overview

## Production checklist
1. Replace SQLite with PostgreSQL; configure backups and migrations.
2. Set long random JWT_SECRET and production CORS allowlist.
3. Remove seed credentials and create an owner securely.
4. Add email/SMS OTP through a compliant provider, MFA for staff, password reset and session revocation.
5. Add audit logs, access reviews, monitoring, encrypted backups and incident response.
6. Add consent records, privacy notice, retention/deletion workflows, grievance contact and customer support.
7. Complete legal/compliance review and partner due diligence before publishing financial product journeys.
8. Penetration test and independent security review before real customer data.

This starter is deliberately labelled as a prototype. It must not be represented as a bank, lender, broker, insurer, investment adviser, or regulated distributor.

## Partner referral & commission module (development implementation)

This ZIP includes partner onboarding, approval, referral attribution, commission records and payout requests. It is a development implementation; it is not a live financial-services partner network and it does not create a provider agreement.

### Partner journey
1. Open **Become a partner** on the website and submit name, mobile, email and a password (minimum 10 characters).
2. The account is created with role `PARTNER` and status `PENDING`.
3. An admin/owner signs in and opens **Partners** in the staff workspace to approve, reject or suspend the application.
4. Approved partners sign in through the normal Sign in screen and open **Partner dashboard**. The referral link is shown there.
5. A customer visiting with `?ref=DHCODE` and submitting an enquiry is attributed to that approved partner. The first approved referral is retained on the customer account.
6. Admin creates a commission record against a referred application only after provider confirmation. It starts as `PENDING`; admin can confirm, reject or mark it paid.
7. Partner can request a payout from confirmed unpaid commission. Admin/owner reviews it under **Payouts** and records the payment reference when marking it paid.

### Partner API routes
- `POST /api/partners/register`
- `GET /api/partner/dashboard` (PARTNER)
- `PATCH /api/partner/payout-details` (PARTNER; UPI or bank name + last four account digits + IFSC)
- `POST /api/partner/payouts` (PARTNER)
- `GET /api/admin/partners`, `PATCH /api/admin/partners/:id` (ADMIN/OWNER)
- `POST /api/admin/commissions`, `PATCH /api/admin/commissions/:id` (ADMIN/OWNER)
- `GET /api/admin/payouts`, `PATCH /api/admin/payouts/:id` (ADMIN/OWNER)
- `GET /api/owner/partner-summary` (OWNER)

### Environment
Set `PUBLIC_CLIENT_URL` to the deployed website's public origin so partner links point to the correct website. Keep `JWT_SECRET` at least 32 random characters and set `CLIENT_ORIGIN` to an explicit production origin. Run `npx prisma generate` and `npx prisma db push` (or create reviewed migrations) after updating the schema.

### Important controls before launch
- Provider agreement and written commission schedule are required before advertising rates or paying commissions.
- The provider must confirm eligible transactions/settlements; do not create commission entries from an enquiry alone.
- Admin must independently reconcile payout amount to confirmed commission ledger and bank/UPI settlement. This starter does not connect to a bank, broker, insurer, payment gateway or provider webhook.
- Configure production database/backups, migrations, audit logs, MFA, OTP, password recovery, monitoring, privacy notice, terms, consent and applicable legal/regulatory review.
- Never collect customer Aadhaar numbers, OTPs, bank passwords, card PINs or full bank credentials on this platform. Payout profile stores UPI or bank name, IFSC and only the last four account digits in this prototype.
