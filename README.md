# CrewStaff

Internal labor-management tool for a live-event crewing company.

| Piece | What it is | Where |
|---|---|---|
| **Admin web app** | Create jobs, set pay rates per role, onboard workers, send offers, approve timesheets, bill clients, export payroll | `web/` (Next.js + SQLite), runs on your Mac |
| **CrewStaff phone app** | One Android app for everyone. Workers get offers, accept/decline, clock in/out, see hours, message. Whoever is booked in the **Steward** role on a call also gets the Steward controls: start the call, clock people in/out, fix times, mark no-shows, end the call and sign off. | `mobile/` (Expo / React Native), sideloaded APK |

Everything runs on your Mac. The phone talks to it over the same Wi-Fi. No paid services; nothing leaves your network except optional push notifications through Google Firebase (free).

---

## 1. Run the web app (on the Mac)

Requires Node 20+ and pnpm (both already installed).

```bash
cd web
pnpm install          # first time only
pnpm serve            # builds, then serves on http://localhost:3000 and on your Wi-Fi address
```

Open http://localhost:3000 and sign in with the default admin login:

- **Email:** `admin@crewstaff.local`
- **Password:** `crewstaff`

Change it under **Settings → Change my password**. You can also set a different first admin before the very first start with `CREWSTAFF_ADMIN_EMAIL` and `CREWSTAFF_ADMIN_PASSWORD`.

All data lives in `web/data/`: the SQLite database `crewstaff.db`, uploaded documents in `uploads/`, and the login signing key. To back up, copy that folder. To start over, stop the server and delete it.

### Demo data (optional)

With the server running on an empty database:

```bash
cd web
pnpm seed:demo
```

This loads 2 clients, 18 workers, a finished job ready to bill, an upcoming 3-day "Bruce Springsteen at MSG" job with offers out, and a call **today** for a Steward to run. Demo crew logins use the password `crewstaff1`:

- Steward: `marcus.reed@crew.example` (runs today's "Corporate Gala" call)
- Crew: `jordan.alvarez@crew.example`

### Development mode

`pnpm dev` runs with hot reload on port 3000, reachable from the LAN. For everyday use, run `pnpm serve` instead: in testing, dev mode sometimes kept reloading pages that have `?tab=` in the address. The production server doesn't have this problem.

---

## 2. Install the phone app (Android)

The built APK is at:

```
mobile/android/app/build/outputs/apk/release/app-release.apk
```

Copy it to the phone (USB, Google Drive, AirDrop-to-Android alternatives, email…), tap it, and allow "Install unknown apps" when Android asks.

**First sign-in:** the sign-in screen has a *Server address* field. Use the address shown in the web app under **Settings → Phone app connection** (for example `192.168.1.20:3000`). The phone must be on the same Wi-Fi as the Mac. The APK was built with your Mac's address at build time as the default, so it may already be filled in.

> If your Mac's IP changes, just edit the server address on the sign-in screen (Sign out → change).

### Rebuilding the APK

Requires Java 17 and the Android SDK (both installed at `~/Library/Android/sdk`).

```bash
cd mobile
npm install                                   # first time only
export ANDROID_HOME=$HOME/Library/Android/sdk
export EXPO_PUBLIC_SERVER_URL=http://$(ipconfig getifaddr en0):3000   # default server shown on sign-in
npx expo prebuild -p android --clean
cd android && ./gradlew assembleRelease
```

The release build is signed with the debug key, which is fine for sideloading but not for the Play Store.

---

## 3. Turn on push notifications (free, ~5 minutes)

Without this, the app still shows new offers and messages as phone notifications **while it's open** (it checks every 10 seconds). With Firebase, offers arrive even when the app is closed.

1. Go to https://console.firebase.google.com → **Add project** (Analytics can be off).
2. **Add app → Android**, package name **`com.crewstaff.app`**. Download **`google-services.json`** and put it in `mobile/` (next to `app.config.js`).
3. In Firebase: **Project settings → Service accounts → Generate new private key**. Save the file as **`web/data/firebase-service-account.json`**.
4. Restart the web server, and rebuild + reinstall the APK (section 2).

**Settings → Phone app connection** in the web app shows whether the server found the key. Both files are secrets; don't commit them.

---

## How it works

**Jobs → calls → positions.** A job (e.g. *Bruce Springsteen at MSG*) has a client, venue, and an hourly **pay rate per role for that job** (all Stagehands on that job earn the same; a different job can pay differently). A job has one or more **calls** (load-in, show, load-out), each with a date, start time and the number of people needed per role (**positions**).

**Labor pool.** Each worker has name, email (their app login), phone, one or more roles, and documents/certifications with optional expiry dates. Expiring documents show on the dashboard. Adding a worker generates a temporary app password to give them.

**Clients.** Saved with contacts, venues, default payment terms, and **preferred / banned crew**: preferred workers are listed first when offering, banned workers never appear for that client.

**Offers (first come, first served).** From a call, pick workers (or *Send to all qualified*) for a position. They get a push notification. The first to accept fill the spots; later acceptances go on **standby** and are promoted automatically, with a notification, if someone drops or the count goes up. You can also *Book directly* without asking.

**On site.** The worker booked as **Steward** taps *Start call*; the crew is notified and can clock in from their own phone (clock-in is blocked until the call is started). The Steward sees the live crew list and can clock someone in/out (dead phone), edit times, or mark no-shows. Every change is logged in the call's activity log. *End call* clocks out anyone still on the clock and marks anyone who never showed as a no-show (fixable). The Steward then **signs off**.

**Approval.** The admin reviews the timesheet on the call page, edits if needed, and **approves**, which locks it. *Reopen* unlocks it (only while the job's invoice is still a draft).

**Messaging.** Each call has a crew group chat and a private thread per worker, shared with the Steward(s) and the office. Admins can read and post in all of them (web → Messages, or the call page).

**Billing.** Once every call on a job is approved, the job's **Billing** tab asks for the **markup %** and shows the invoice preview: bill rate = pay rate × (1 + markup), one line per call per role. One invoice per job. Print / save as PDF from the browser, mark sent/paid, or download a **QuickBooks Desktop .IIF** file (*File → Utilities → Import → IIF Files*). Draft invoices refresh automatically if approved hours change.

**Exports.** Timesheet CSV per call or per job; **Payroll export**: approved hours × job rate per worker per week (Mon–Sun), summary or per-shift detail CSV, for your external payroll provider.

### Not included yet (by design)

Overtime / union rules, payroll calculation, external integrations (ADP, Sage, QuickBooks Online), geofenced clock-in, breaks/meals, offline clock-in, email/SMS, multiple admin permission levels, iPhone build. The Nexus specs in `~/Downloads/Labormanitems` describe where the time-segment/Terms Engine work would plug in later.

---

## Project layout

```
web/
  src/server/schema.sql      database schema (applied automatically on start)
  src/server/core.ts         offers/standby, clock-in rules, call lifecycle, hours
  src/server/api/*.ts        JSON API used by both the web app and the phone app
  src/app/(admin)/…          admin pages
  scripts/seed-demo.mjs      demo data loader
  data/                      database + uploads (created on first run; back this up)
mobile/
  app.config.js              app name, package id, Firebase hookup
  src/app/(tabs)/…           Offers, Shifts, Messages, Hours, Me
  src/app/call/[id].tsx      shift screen + Steward controls
  src/app/chat/[callId].tsx  chat
```
