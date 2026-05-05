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

- `GET /api/health`
- `GET /api/users`

## Path Aliases

Use `@/` to import from the project root:

```ts
import userRouter from '@/router/userRouter';
import { env } from '@/lib/config';
```
