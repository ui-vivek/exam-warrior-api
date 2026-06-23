# Exam Warrior — Features & API Reference (Living Document)

> **Auto-maintained.** A scheduled task regenerates this file every day at **12:00 PM (noon)** by re-scanning `server/` (the Node/Express API) and `app/` (the Flutter client). Each run captures **new** features and **changes** to existing ones (renamed fields, new payload keys, new endpoints), then commits the result to git. Do not hand-edit below the line — your edits will be overwritten on the next run.

- **Last generated:** 2026-06-23
- **Backend:** Node.js + Express 5 + TypeScript + Mongoose (MongoDB)
- **Client:** Flutter (Android/iOS) — clean architecture (`data` / `domain` / `presentation`)
- **API base URL:** `https://exam-warrior-api.onrender.com/api/v1` (prod) · `http://10.0.2.2:5050/api/v1` (emulator dev)
- **Repo:** `github.com/ui-vivek/exam-warrior`

---

## 1. Conventions

**Base path.** Every API route below is mounted under `/api/v1` (`app.use('/api/v1', apiRouter)` in `server.ts`). The Flutter `Env.apiBaseUrl` already includes this prefix, so paths line up 1:1.

**Auth.** Most endpoints require a Bearer JWT access token in the `Authorization: Bearer <accessToken>` header (`authMiddleware`). Some are gated only in production (`authInProduction`) so dev/Postman/seeding stays open. The Razorpay webhook and the `cron/*` endpoints use no user session (webhook signature / `x-cron-secret` header instead).

**Language.** A `languageMiddleware` resolves the response language. Clients send it via the language interceptor; questions/explanations are served in `english` or `hindi` per the user's `preferredLanguage`.

**Standard response envelope.** Almost all endpoints return:

```json
{ "success": true, "message": "optional human message", "data": { } }
```

Errors flow through `errorHandler` and return `{ success: false, message }` with an appropriate HTTP status (`AppError` carries the status code, e.g. 400/401/404).

**Enums (consistent on both sides).**

- `examType`: `SSC` · `RAILWAY` · `BANKING` · `UPSC` (uppercase)
- language fields: `english` · `hindi` (lowercase)
- `difficulty`: `easy` · `medium` · `hard`
- `planType`: `monthly` · `yearly`
- `subscriptionStatus`: `trial` · `active` · `expired`

---

## 2. API Reference

Routers are mounted in `server/router/index.ts`. Auth column: 🔓 public · 🔐 always auth · 🟡 auth in production only · 🤖 machine (webhook / cron secret).

### 2.1 Auth — `/auth`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/send-otp` | 🔓 | Send a login OTP to a phone number |
| POST | `/auth/verify-otp` | 🔓 | Verify OTP, create/login user, issue tokens |
| POST | `/auth/refresh-token` | 🔓 | Exchange a refresh token for a new access token |

Per-IP rate limits sit on top of the per-phone OTP limit: send-otp 10/15min, verify-otp 30/15min, refresh 60/15min.

**POST `/auth/send-otp`** — request:

```json
{ "phone": "+919999999999" }
```

Response `data` is `{}` (the OTP is delivered out-of-band via SMS).

**POST `/auth/verify-otp`** — request:

```json
{ "phone": "+919999999999", "otp": "123456", "preferred_language": "hindi" }
```

`preferred_language` is optional (`english` | `hindi`). Response `data`:

```json
{ "accessToken": "...", "refreshToken": "...", "user": { /* user */ }, "isNewUser": true }
```

**POST `/auth/refresh-token`** — request `{ "refreshToken": "..." }` → `data` `{ "accessToken": "...", "refreshToken": "..." }`.

### 2.2 Users / Profile / Analytics / Leaderboard — `/users`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/users/` | 🟡 | Admin: paginated user list (`?limit&page`) |
| GET | `/users/stats` | 🔐 | Dashboard "me" payload (used as the profile/me endpoint) |
| GET | `/users/weak-topics` | 🔐 | Weakest topics for personalization |
| GET | `/users/subject-stats` | 🔐 | Per-subject accuracy breakdown |
| GET | `/users/leaderboard` | 🔐 | All-India + state ranking with day-over-day movement |
| PUT | `/users/exam-type` | 🔐 | Switch active exam |
| PUT | `/users/language` | 🔐 | Set question language |
| PUT | `/users/profile` | 🔐 | Update profile fields |

**GET `/users/stats`** → `data` includes `totalTests, avgScore, bestScore, streakCount, overallAccuracy, subscriptionStatus, preferredLanguage, appLanguage, name, phone, examType, state, avatar, trialDaysRemaining, todayTest{status, testId, score, total}`.

**PUT `/users/exam-type`** — `{ "examType": "SSC" }` (validated; one of the four enums).
**PUT `/users/language`** — `{ "preferredLanguage": "hindi" }`.
**PUT `/users/profile`** — any of `{ "name", "exam_type", "preferred_language", "app_language", "state", "avatar" }` (all optional).
**GET `/users/weak-topics`** → list of `{ subject, topic, totalAttempted, totalCorrect, accuracyPct }`.
**GET `/users/subject-stats`** → list of `{ subject, accuracy, totalAttempted }`.
**GET `/users/leaderboard`** → `{ myRank, totalPlayers, leaderboard[{rank,name,examType,state,totalScore,tests,isMe}], allIndiaRankChange, state, stateRank, stateTotalPlayers, stateLeaderboard, stateRankChange }`.

### 2.3 Tests — `/tests`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/tests/today` | 🔐 + subscription | Today's daily mock (20 questions) |
| GET | `/tests/practice/subjects` | 🔐 | Distinct subjects available to drill |
| GET | `/tests/practice/syllabus` | 🔐 | In-syllabus subjects/topics for the exam |
| POST | `/tests/practice` | 🔐 + subscription | Create a focused practice test |
| GET | `/tests/history` | 🔐 | Past tests (`?limit&type`) |
| POST | `/tests/:id/progress` | 🔐 | Save in-progress answers (resume support) |
| POST | `/tests/:id/submit` | 🔐 | Submit answers, score, update topic stats |
| GET | `/tests/:id/review` | 🔐 | Per-question review with explanations |

`/tests/today` and `/tests/practice` are guarded by `subscriptionMiddleware` (trial or active required).

**Question shape (today/practice)** — each question is flattened to: `{ _id, questionText, optionA, optionB, optionC, optionD, subject, topic, difficulty }` in the requested language (correct answer & explanation withheld until review).

**POST `/tests/practice`** — request: `{ "subject": "History", "topics": ["Mughals"], "difficulty": "medium" }` (topic/topics + difficulty optional).

**POST `/tests/:id/submit`** — request:

```json
{
  "answers": [
    { "questionId": "65f1...345", "selectedOption": "a", "timeSpentSec": 15 },
    { "questionId": "65f1...346", "selectedOption": "c", "timeSpentSec": 10 }
  ],
  "timeTakenSec": 120
}
```

Response `data`: `{ score, total, accuracyPct, timeTakenSec, improvement? }`. For practice tests `improvement` carries `{ subject, topic, thisTestAccuracy, beforeAccuracy, afterAccuracy, delta, beforeLevel, afterLevel, totalAttempted }`.

**POST `/tests/:id/progress`** — request `{ "answers": [...], "currentIndex": 4 }` → `data` `{ saved: true|false }`.
**GET `/tests/:id/review`** → per-question objects including `explanationHindi` and the correct option.
**GET `/tests/history`** → list of `{ testDate, score, totalQuestions, timeTakenSec, type, createdAt }`.

### 2.4 AI Question Engine — `/ai`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/ai/generate-questions` | 🟡 + rate-limit | Generate & save AI questions (Anthropic) |

Expensive (multiple LLM calls): production requires auth + 20/hour rate limit. Request:

```json
{ "examType": "SSC", "weakTopics": ["Percentages"], "difficulty": "medium", "recentTopics": ["Ratio"] }
```

`examType` and `weakTopics` (array) are required (400 otherwise). Generated questions are stored bilingually and pass an AI-validation layer (`aiVerified`) before being shown.

### 2.5 Questions / Bookmarks / Reports — `/questions`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/questions/bookmarks` | 🔐 | List saved questions (`?limit&page`) |
| POST | `/questions/:id/bookmark` | 🔐 | Toggle bookmark on a question |
| DELETE | `/questions/:id/bookmark` | 🔐 | Remove a bookmark |
| POST | `/questions/:id/report` | 🔓 | Report a wrong question |

**POST `/questions/:id/bookmark`** → `data` `{ bookmarked: true|false }`.
**POST `/questions/:id/report`** — request `{ "reason": "Question is wrong", "details": "The correct answer should be B." }`. Increments `reportCount` / sets `reportedWrong` for manual review.

### 2.6 Payments / Subscription (Razorpay) — `/payments`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/payments/create-subscription` | 🔐 | Create/resume a Razorpay subscription |
| POST | `/payments/verify` | 🔐 | Verify checkout result (frontend fallback) |
| POST | `/payments/validate-vpa` | 🔐 | Validate a typed UPI ID before charging |
| POST | `/payments/upi/autopay` | 🔐 | Start UPI Autopay (recurring e-mandate) |
| GET | `/payments/status` | 🔐 | Current subscription status |
| GET | `/payments/history` | 🔐 | Payment history (`?limit&page`) |
| POST | `/payments/webhook` | 🤖 | Razorpay webhook (trusted source of truth) |

Pricing: **₹99/month**, **₹799/year**, 7-day free trial.

**POST `/payments/create-subscription`** — request `{ "planType": "monthly" }` (or `yearly`). Response `data`: `{ subscriptionId, razorpayKeyId, shortUrl }`. Resumes a pending order if one exists for the same plan; switching plans starts fresh.

**POST `/payments/verify`** — request `{ "razorpay_payment_id", "razorpay_subscription_id", "razorpay_signature" }` → verifies the HMAC signature and activates the subscription.
**POST `/payments/validate-vpa`** — request `{ "vpa": "name@bank" }` → `data` `{ available, valid, vpa }`.
**POST `/payments/upi/autopay`** — request `{ "subscriptionId": "...", "vpa": "name@bank" }`.
**GET `/payments/status`** → `{ status, expiryDate }`.
**POST `/payments/webhook`** — raw body; signature-verified (`express.raw`). Always returns HTTP 200 (`{ status: 'ok' }`) so Razorpay does not retry; failures are logged internally.

### 2.7 Classroom Battle (Rooms) — `/rooms`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/rooms` | 🔐 | "My rooms" history |
| POST | `/rooms` | 🔐 | Create a room (host) |
| POST | `/rooms/:code/join` | 🔐 | Join a room by code |
| GET | `/rooms/:code` | 🔐 | Room state (lobby/active/finished) |
| POST | `/rooms/:code/start` | 🔐 | Host starts the shared timed test |
| GET | `/rooms/:code/test` | 🔐 | The room's question set |
| POST | `/rooms/:code/submit` | 🔐 | Submit a participant's score |
| GET | `/rooms/:code/leaderboard` | 🔐 | Live room leaderboard |

**POST `/rooms/:code/submit`** — request (same answers shape as test submit):

```json
{ "answers": [ { "questionId": "65f1...345", "selectedOption": "a", "timeSpentSec": 15 } ], "timeTakenSec": 120 }
```

→ `data` `{ score, total }`. Room responses are serialized via `serializeRoom` returning `{ code, hostName, status, totalQuestions, isHost, participants[], startedAt, endsAt, ... }`. Rooms auto-expire after 6h; a deadline finalizer closes rooms whose `endsAt` has passed.

### 2.8 Devices / Push — `/devices`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/devices/register` | 🔐 | Register an FCM/APNs device token |
| POST | `/devices/unregister` | 🔐 | Remove a device token |
| POST | `/devices/test-push` | 🔐 | Send a test push to the user |

**POST `/devices/register`** — request `{ "deviceId": "stable-install-id", "deviceToken": "fcm-token", "deviceType": "android", "appVersion": "1.0.0" }` (only `deviceId` is required) → `data` `{ id }`.
**POST `/devices/unregister`** — `{ "deviceId"?, "deviceToken"? }` → `{ removed: true }`.
**POST `/devices/test-push`** → `{ firebaseReady, tokensForUser, sent, failed, ... }`.

### 2.9 Notification cron triggers — `/notifications`

Machine-only endpoints (header `x-cron-secret`), triggered by an external scheduler (cron-job.org / GitHub Actions / UptimeRobot). No user session.

| Method | Path | Purpose |
|---|---|---|
| POST | `/notifications/cron/daily-reminder` | Daily "take your test" push |
| POST | `/notifications/cron/streak-saver` | Nudge users about to lose a streak |
| POST | `/notifications/cron/weak-topic` | Suggest practice on a weak topic |
| POST | `/notifications/cron/trial-check` | Trial-expiry reminders |
| POST | `/notifications/cron/rank-movement` | Weekly rank-change push |

### 2.10 Health — `/health` and `/` 

`GET /health` (root, for Render uptime) → `{ status: 'ok', timestamp }`. `GET /api/v1/health` → controller health payload.

---

## 3. Data Models (MongoDB collections)

| Collection | Key fields |
|---|---|
| **User** | `phone` (unique), `name`, `examType`, `subscriptionStatus`, `trialStartDate`, `subscriptionEndDate`, `razorpayCustomerId/SubId`, `streakCount`, `lastActiveDate`, `refreshToken`, `preferredLanguage`, `appLanguage`, `state`, `avatar`, `rankTrack{dateKey,allIndiaToday/Prev,stateToday/Prev}`, `lastNotifiedRank` |
| **Question** | `examType`, `subject`, `topic`, `difficulty`, bilingual `questionText{en,hi}` + `options.a–d{en,hi}`, `correctOption`, `explanation{en,hi}`, `source`, `isActive`, `aiVerified`, `reportCount`, `reportedWrong`, `version` |
| **Test** | `userId`, `examType`, `testDate` (`YYYY-MM-DD` or `practice-<ts>`), `questions[]`, `answers[{questionId,selectedOption,isCorrect,timeSpentSec}]`, `score`, `totalQuestions`, `timeTakenSec`, `completed`, `currentIndex`, `type` (daily/practice), `subject`, `topic` |
| **UserTopicStat** | `userId`, `examType`, `subject`, `topic`, `totalAttempted`, `totalCorrect`, `accuracyPct`, `recentAccuracyPct` (EMA — drives weak-topic detection), `lastAttemptedAt` |
| **ExamCatalog** | `examType`, `subject`, `topics[]`, `order`, `isActive` — canonical syllabus driving practice chips |
| **Bookmark** | `userId`, `questionId` (unique per pair) |
| **Payment** | `userId`, `razorpayPaymentId/SubscriptionId/Signature`, `planId`, `planType`, `amount` (paise), `currency`, `method`, `status`, `paidAt` |
| **Subscription** | `userId`, `razorpaySubscriptionId` (unique), `planId`, `planType`, `status`, `currentPeriodStart/End`, `cancelAtPeriodEnd`, `endedAt` |
| **Room** | `code` (unique), `hostId/Name`, `examType`, `status` (lobby/active/finished), `questionIds[]`, `totalQuestions`, `participants[{userId,name,score,finishedAt}]`, `startedAt`, `durationSec`, `endsAt`, `expiresAt` (6h TTL) |
| **UserDevice** | `userId`, `deviceId` (stable per install), `deviceType`, `deviceToken` (FCM/APNs), `appVersion`, `lastSeenAt` |
| **OtpStore** | `phone`, `otpHash` (bcrypt), `attempts`, `lockedUntil`, `expiresAt` (10 min), TTL auto-delete after 1h |

---

## 4. Backend Features

The core loop is **OTP login → select exam → daily AI mock → submit → results + Hindi explanations → weak-topic update → tomorrow's personalized test**.

- **OTP auth** with bcrypt-hashed OTPs, lockout + attempt tracking, JWT access/refresh tokens.
- **AI question engine** (Anthropic SDK) generating bilingual questions tagged by subject/topic/difficulty, with an AI-validation layer (`aiVerified`) and a "report wrong question" safeguard.
- **Daily test engine** — one daily mock per user per day (unique index), resume-in-progress, scoring, and per-topic stat updates feeding personalization.
- **Personalization brain** — `UserTopicStat` tracks lifetime + recent-weighted (EMA) accuracy to surface weak topics and gate "mastered".
- **Analytics & ranking** — accuracy, streaks, score trends, all-India + state leaderboards with day-over-day rank movement.
- **Subscriptions** — Razorpay subscriptions + UPI Autopay e-mandate, custom VPA validation, signature-verified webhook as the source of truth, 7-day trial.
- **Classroom Battle** — host-created rooms, shared countdown, live leaderboard, auto-expiry.
- **Push notifications** — FCM/APNs device registry + five cron-driven campaigns (daily reminder, streak saver, weak-topic nudge, trial check, rank movement).
- **Hardening** — Helmet, CORS allowlist, per-IP rate limiting on auth & AI, language middleware.

---

## 5. Flutter App Features

Clean architecture per module (`data/datasources + models + repositories`, `domain/entities + usecases + repositories`, `presentation/screens + providers + widgets`). Riverpod providers, Dio client with auth/language/logging interceptors, GoRouter named routes.

| Module | Screens / routes | Backend endpoints used |
|---|---|---|
| **splash** | `/splash` | token check |
| **auth** | `/login`, `/verify-otp` | `send-otp`, `verify-otp`, `refresh-token` |
| **onboarding** | `/onboarding/exam` | `PUT /users/exam-type` |
| **dashboard** | `/home` | `GET /users/stats`, `GET /users/weak-topics` |
| **test** | `/home/practice`, `/home/test`, `/home/result`, `/home/review` | `tests/today`, `tests/practice(+subjects/syllabus)`, `tests/:id/submit`, `:id/progress`, `:id/review` |
| **history** | `/home/test-history` | `GET /tests/history` |
| **analytics** | `/home/analytics` | `subject-stats`, `weak-topics` |
| **rankings** | `/home/rankings`, `/home/leaderboard` | `GET /users/leaderboard` |
| **battle** | `/home/classroom(+/history)`, `/home/room`, `/home/battle` | `rooms` create/join/get/start/test/submit/leaderboard |
| **bookmarks** | `/home/bookmarks` | `questions/bookmarks`, `:id/bookmark` |
| **subscription** | `/home/subscription` (+ Razorpay & UPI checkout) | `payments/create-subscription`, `verify`, `validate-vpa`, `upi/autopay`, `status` |
| **profile** | `/home/profile`, `/home/notifications` | `PUT /users/profile`, `/users/language`, devices register/unregister/test-push |
| **weekly_focus** | `/home/weekly-focus` | weak-topic driven |
| **home** | `/home` shell | tab navigation |

Core infra: `core/network` (Dio + interceptors + `ApiEndpoints`), `core/notifications` (FCM push + routing), `core/i18n` (english/hindi + subject labels), `core/theme`, `core/storage` (secure token storage), `core/router`.

---

## 6. Background Jobs

- In-process `node-cron` (`startCron`, enabled when `ENABLE_CRON=true`) — daily reminder.
- External-scheduler-driven `/notifications/cron/*` endpoints (secret-protected) for the five push campaigns.
- Room deadline finalizer + TTL auto-expiry on `Room`, `OtpStore`.

---

*Generated by the Exam Warrior daily documentation scheduler. Sources: `server/router`, `server/controller`, `server/validators`, `server/model`, `server/server.ts`, `app/lib/core/network/api_endpoints.dart`, `app/lib/core/router/routes.dart`, `app/lib/features/**`, and `ExamWarrior.postman_collection.json`.*
