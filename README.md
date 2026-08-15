# Exam Warrior — Backend API

An AI-powered exam preparation platform for Indian government exam aspirants (SSC, Railway, Banking, UPSC).

Exam Warrior generates a **personalised daily mock test** for every user, explains each answer in **Hindi and English**, tracks which topics they are weak in, and uses that signal to shape tomorrow's test. This repository is the Node.js + TypeScript REST API that powers the Flutter mobile app and the web admin panel.

> **Live API:** `https://exam-warrior-api.onrender.com/api/v1` · **Health:** `/health`

---

## The core loop

Everything in this codebase serves one loop:

```
OTP login → pick exam → today's AI mock test → submit
    ↑                                            ↓
    └── tomorrow's test, re-weighted ← weak topics updated ← results + bilingual explanations
```

Most test-prep apps serve everyone the same static question bank. Exam Warrior's `UserTopicStat` collection tracks a recency-weighted (EMA) accuracy score per user per topic, and feeds the weakest topics straight back into the AI prompt that builds the next day's paper. The more you use it, the more the paper looks like your own weak spots.

---

## Features

**Authentication**
Phone OTP login via Twilio Verify (MSG91 as an alternative), bcrypt-hashed OTP storage, per-phone rate limiting, attempt tracking with progressive account lockout, and JWT access/refresh token rotation.

**AI question engine**
Generates bilingual (English + Hindi) questions with the Anthropic API, tagged by subject, topic and difficulty. Every generated batch passes through a Zod-based validation layer (`services/aiValidator.ts`) before it can reach a user — schema shape, bilingual completeness, and answer-key sanity. Questions carry an `aiVerified` flag and a user-facing "report wrong question" path, because a wrong answer shown to an aspirant is the single most damaging failure this product can have.

**Daily test engine**
One daily mock per user per day, enforced by a unique index. Resume-in-progress, per-question time tracking, scoring, and detailed review with explanations. Separate practice mode lets users drill a specific subject or topic from the exam syllabus catalog.

**Personalisation & analytics**
Lifetime and recency-weighted accuracy per topic, weak-topic surfacing, subject-level breakdowns, streaks, score trends, and all-India + state leaderboards with day-over-day rank movement.

**Subscriptions**
Razorpay subscriptions with UPI Autopay e-mandate support and custom VPA validation. The signature-verified webhook is the single source of truth for subscription state — the client is never trusted to confirm a payment. Seven-day free trial on signup.

**Classroom Battle**
Host-created rooms with a join code, a shared synchronised countdown, live leaderboard, auto-submit for no-shows when the timer expires, and a 6-hour TTL so abandoned rooms clean themselves up.

**Weekly leagues**
Duolingo-style tiers (Bronze → Diamond). Users compete within their tier and exam type by score earned in the current IST league week. Standings are computed live from test documents in a time window, so there is no weekly reset job to get wrong — crossing Monday simply starts a new week.

**Referrals**
Shareable codes with reward days for both sides, a silent per-account lifetime cap, and a daily cap on how many friends can earn a single referrer rewards. Caps are deliberately never exposed to the client.

**Institute layer**
A B2B layer where a library, coaching centre or YouTube educator manages batches of students, assigns assessments, and tracks results — while every student keeps their own personal account underneath. Seat-based plans.

**Push notifications**
FCM/APNs device registry plus scheduled campaigns: streak saver, weak-topic nudge, trial-ending reminder, weekly rank movement, and referral nudge — all language-aware and timed to an Indian aspirant's daily rhythm.

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express 5 |
| Database | MongoDB with Mongoose |
| Auth | JWT (access + refresh), bcrypt |
| AI | Anthropic API |
| Validation | Zod |
| OTP / SMS | Twilio Verify · MSG91 |
| Payments | Razorpay (subscriptions + UPI Autopay) |
| Push | Firebase Cloud Messaging |
| Scheduling | node-cron (in-process) + external HTTP cron endpoints |
| Security | Helmet, CORS allowlist, per-IP rate limiting |
| Hosting | Render (blueprint in `render.yaml`) |

Clients: **Flutter** mobile app (Android/iOS) and an **Angular** admin panel, both consuming this same REST API. No GraphQL — one REST surface, two clients.

---

## Architecture

A conventional layered Express structure, kept deliberately boring so the interesting logic stands out:

```
server/
├── server.ts             # App bootstrap: middleware order, static, error handlers
├── lib/
│   ├── config.ts         # Env parsing + fail-fast validation in production
│   ├── db.ts             # Mongo connection
│   ├── cron.ts           # In-process scheduled jobs
│   └── firebase.ts       # Lazy firebase-admin init (no-ops if unconfigured)
├── router/               # Route definitions, mounted under /api/v1
├── middleware/           # auth, subscription gate, rate limit, language, validation, errors
├── validators/           # Zod request schemas
├── controller/           # HTTP layer — parse, delegate, respond
├── services/             # Business logic (AI, OTP, analytics, leagues, referrals, ...)
├── model/                # Mongoose schemas
└── utils/                # AppError, asyncHandler, cache, prompt builder, Razorpay helpers
```

**Conventions worth knowing**

- Every route sits under `/api/v1`. `GET /health` is the one exception (Render's uptime probe).
- Standard envelope: `{ success, message?, data }`. Errors flow through a single `errorHandler` and return `{ success: false, message }` with a status carried by `AppError`.
- Path aliases (`@/services/...`) resolve via `tsconfig` paths and `tsc-alias` at build time.
- The Razorpay webhook needs the raw body, so `express.raw()` is mounted for that path *before* `express.json()`.
- `authInProduction` gates some routes only when `NODE_ENV=production`, keeping local development and Postman seeding open.

---

## API surface

Fourteen routers under `/api/v1`:

| Router | Purpose |
|---|---|
| `/auth` | Send OTP, verify OTP, refresh token |
| `/users` | Profile, stats, weak topics, subject stats, leaderboard, exam type, language |
| `/tests` | Today's test, practice tests, submit, progress, history, review |
| `/questions` | Question bank, bookmarks, report a wrong question |
| `/ai` | AI question generation endpoints |
| `/payments` | Create subscription, verify, VPA validation, UPI Autopay, webhook, status |
| `/rooms` | Classroom Battle — create, join, start, submit, leaderboard |
| `/leagues` | Weekly league standings and tier movement |
| `/referrals` | Referral code, share link, reward tracking |
| `/institutes` | Institute, batches, memberships, staff |
| `/assessments` | Institute-assigned assessments and attempts |
| `/devices` | FCM/APNs device registration |
| `/notifications` | Cron-triggered push campaigns (machine auth) |
| `/health` | Service health |

Full endpoint-by-endpoint reference with request and response shapes lives in **[`FEATURES_AND_API.md`](./FEATURES_AND_API.md)**. A Postman collection is included as `ExamWarrior.postman_collection.json`.

---

## Getting started

**Prerequisites:** Node.js 20+, and a MongoDB instance (local or a free MongoDB Atlas cluster).

```bash
git clone https://github.com/ui-vivek/exam-warrior-api.git
cd exam-warrior-api
npm install
cp .env.example .env      # then fill in the values
npm run dev
```

The API comes up on `http://localhost:5050`. Check `http://localhost:5050/health`.

### Configuration

`.env.example` documents every variable. The minimum to boot locally is `MONGODB_URI`. To go further:

| To use | You need |
|---|---|
| Real OTP login | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_VERIFY_SID` (or the MSG91 trio) |
| AI question generation | `ANTHROPIC_API_KEY` |
| Subscriptions | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, plan IDs, `RAZORPAY_WEBHOOK_SECRET` |
| Push notifications | `FIREBASE_SERVICE_ACCOUNT` or `FIREBASE_SERVICE_ACCOUNT_PATH` |
| Scheduled jobs | `ENABLE_CRON=true` |

Anything unconfigured degrades gracefully rather than crashing — push simply no-ops without a Firebase key, for instance. In **production**, however, the server refuses to start without `JWT_SECRET`, `REFRESH_SECRET` and `MONGODB_URI`, so a misconfigured deploy fails loudly instead of silently signing tokens with a placeholder.

### Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start with `tsx` in watch mode |
| `npm run build` | Compile TypeScript to `dist/` and rewrite path aliases |
| `npm start` | Run the compiled server |

---

## Deployment

`render.yaml` is a Render blueprint — point Render at this repo, choose "Blueprint", and it provisions the web service, generates JWT secrets, and prompts for the secrets marked `sync: false`. Health checks hit `/health`.

On Render's free tier the instance sleeps when idle, which also pauses in-process cron. Keep it awake with an uptime pinger, or drive the `/notifications/cron/*` endpoints from an external scheduler using the `x-cron-secret` header.

---

## Security notes

- OTPs are bcrypt-hashed at rest with attempt tracking and lockout; the store auto-expires via a TTL index.
- Razorpay webhooks are signature-verified; the client's word on a payment is never trusted.
- Cron endpoints are shared-secret gated and carry no user session.
- Helmet, a CORS origin allowlist, and per-IP rate limits on auth and AI routes.
- No credential ever lives in this repository — everything comes from the environment. `.env` and service-account keys are gitignored.

---

## Roadmap

- Previous Year Question (PYQ) bank alongside AI-generated questions
- Human review queue for reported questions
- Institute billing and per-teacher batch scoping
- Question de-duplication across a user's history at scale

---

## License

ISC. See `package.json`.
