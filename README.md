# Exam Warrior Backend

Basic Node.js, Express, and TypeScript backend structure.

## Setup

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` starts the TypeScript server with Node watch mode.
- `npm run build` compiles TypeScript into `dist/`.
- `npm start` starts the compiled server from `dist/server.js`.

## API

All routes are mounted under the `/api/v1` prefix (configured in `server.ts` and
`router/index.ts`), except the top-level `GET /health` liveness probe.

Auth column legend:

- **None** — public endpoint, no token required.
- **Bearer** — requires `Authorization: Bearer <accessToken>` (`authMiddleware`).
- **Prod-only** — open in development; requires Bearer token when `NODE_ENV=production` (`authInProduction`).
- **Subscription** — requires Bearer token **and** an active subscription/trial (`subscriptionMiddleware`).

Standard success responses are shaped `{ success, message?, data }`.

### Health

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| GET | `/health` | None | Top-level Render uptime probe. Returns `{ status, timestamp }`. |
| GET | `/api/v1/health` | None | Returns `{ success, message, data }` with service health status. |

### Auth (`/api/v1/auth`)

Public but rate-limited per IP in production.

| Method | Path | Auth | Body | Response |
| ------ | ---- | ---- | ---- | -------- |
| POST | `/auth/send-otp` | None | `phone` (string, 10–15 chars, required) | `{ success, message, data: {} }` |
| POST | `/auth/verify-otp` | None | `phone` (required), `otp` (required), `preferred_language?` (`english`\|`hindi`) | `{ success, message, data: { accessToken, refreshToken, user } }` |
| POST | `/auth/refresh-token` | None | `refreshToken` (string, required) | `{ success, message, data: { accessToken, ... } }` |

### Users (`/api/v1/users`)

| Method | Path | Auth | Params / Body | Response |
| ------ | ---- | ---- | ------------- | -------- |
| GET | `/users` | Prod-only | query: `limit?`, `page?` | `{ success, message, data: User[] }` |
| GET | `/users/stats` | Bearer | — | `{ success, data: { totalTests, avgScore, bestScore, streakCount, overallAccuracy, subscriptionStatus, preferredLanguage, appLanguage, name, phone, examType, state, avatar, trialDaysRemaining, todayTest } }` |
| GET | `/users/weak-topics` | Bearer | — | `{ success, data }` |
| GET | `/users/subject-stats` | Bearer | — | `{ success, data }` |
| GET | `/users/leaderboard` | Bearer | — | `{ success, data }` |
| PUT | `/users/exam-type` | Bearer | `examType` (`SSC`\|`RAILWAY`\|`BANKING`\|`UPSC`, required) | `{ success, message, data: User }` |
| PUT | `/users/language` | Bearer | `preferredLanguage` (`english`\|`hindi`, required) | `{ success, message, data: User }` |
| PUT | `/users/profile` | Bearer | `name?`, `exam_type?`, `preferred_language?`, `app_language?`, `state?`, `avatar?` | `{ success, message, data: { name, phone, examType, preferredLanguage, appLanguage, state, avatar } }` |

### AI (`/api/v1/ai`)

| Method | Path | Auth | Body | Response |
| ------ | ---- | ---- | ---- | -------- |
| POST | `/ai/generate-questions` | Prod-only | `examType` (required), `weakTopics` (array, required), `difficulty?`, `recentTopics?` | `{ message, count, questions }` |

> Expensive endpoint (multiple LLM calls). Additionally rate-limited (max 20/hour) in production.

### Questions (`/api/v1/questions`)

| Method | Path | Auth | Params / Body | Response |
| ------ | ---- | ---- | ------------- | -------- |
| GET | `/questions/bookmarks` | Bearer | query: `limit?`, `page?` | `{ success, data }` |
| POST | `/questions/:id/bookmark` | Bearer | path: `id` | `{ success, data: { bookmarked } }` (toggles) |
| DELETE | `/questions/:id/bookmark` | Bearer | path: `id` | `{ success, data: { bookmarked: false } }` |
| POST | `/questions/:id/report` | None | path: `id` | `{ message, question }` |

### Tests (`/api/v1/tests`)

| Method | Path | Auth | Params / Body | Response |
| ------ | ---- | ---- | ------------- | -------- |
| GET | `/tests/today` | Subscription | — | `{ success, data: Test }` |
| GET | `/tests/practice/subjects` | Bearer | — | `{ success, data: string[] }` |
| POST | `/tests/practice` | Subscription | `subject` (string or array), `topic?`, `difficulty?` (`easy`\|`medium`\|`hard`\|`all`) | `{ success, data: Test }` |
| GET | `/tests/history` | Bearer | query: `limit?`, `type?` (`daily`\|`practice`) | `{ success, data: Test[] }` |
| POST | `/tests/:id/progress` | Bearer | path: `id`; body: `answers?`, `currentIndex?` | `{ success, data: { saved } }` |
| POST | `/tests/:id/submit` | Bearer | path: `id`; body: `answers`, `timeTakenSec?` | `{ success, data: result }` |
| GET | `/tests/:id/review` | Bearer | path: `id` | `{ success, data: review }` |

### Payments (`/api/v1/payments`)

| Method | Path | Auth | Body | Response |
| ------ | ---- | ---- | ---- | -------- |
| POST | `/payments/create-subscription` | Bearer | `planType` (`monthly`\|`yearly`) | `{ success, data: { subscriptionId, razorpayKeyId, shortUrl } }` |
| POST | `/payments/verify` | Bearer | `razorpay_payment_id`, `razorpay_subscription_id`, `razorpay_signature` (all required) | `{ success, message, data: { subscriptionStatus, subscriptionEndDate } }` |
| POST | `/payments/webhook` | None | Raw Razorpay event (signature-verified) | `{ status: 'ok' }` |
| GET | `/payments/status` | Bearer | — | `{ success, data: { status, expiryDate, razorpaySubId } }` |
| GET | `/payments/history` | Bearer | query: `limit?`, `page?` | `{ success, data: Payment[] }` |

### Rooms (`/api/v1/rooms`)

Multiplayer challenge rooms. All endpoints require a Bearer token.

| Method | Path | Auth | Params / Body | Response |
| ------ | ---- | ---- | ------------- | -------- |
| GET | `/rooms` | Bearer | — | `{ success, data }` (rooms the user hosts/joined) |
| POST | `/rooms` | Bearer | — | `{ success, data: Room }` (creates a room with a join code) |
| POST | `/rooms/:code/join` | Bearer | path: `code` | `{ success, data: Room }` |
| GET | `/rooms/:code` | Bearer | path: `code` | `{ success, data: Room }` |
| POST | `/rooms/:code/start` | Bearer | path: `code` | `{ success, data: Room }` |
| GET | `/rooms/:code/test` | Bearer | path: `code` | `{ success, data: { totalQuestions, questions } }` |
| POST | `/rooms/:code/submit` | Bearer | path: `code`; body: `answers` (`[{ questionId, selectedOption }]`) | `{ success, data: { score, total } }` |
| GET | `/rooms/:code/leaderboard` | Bearer | path: `code` | `{ success, data: { status, totalQuestions, leaderboard } }` |

## Path Aliases

Use `@/` to import from the project root:

```ts
import userRouter from '@/router/userRouter';
import { env } from '@/lib/config';
```
