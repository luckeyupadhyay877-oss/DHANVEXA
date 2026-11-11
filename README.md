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
