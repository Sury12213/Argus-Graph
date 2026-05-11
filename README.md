# Argus-Graph

High-frequency risk intelligence and decision support for Solana tokens.

Argus-Graph analyzes token risk before a trade by combining wallet graph clustering, transaction velocity, smart-money behavior, social signals, AI summaries, and user-defined decision rules. The system is split into a NestJS API, a React web app, PostgreSQL storage, and Redis-backed caching/time-series data.

## Core capabilities

| Area | What it does |
| --- | --- |
| Wallet cluster analysis | Detects coordinated wallets, shared funders, circular trading, concentration risk, and graph relationships. |
| Velocity engine | Scores transaction surges, buy/sell pressure, liquidity fragility, Telegram velocity, block density, and AI-refined social sentiment. |
| Smart-money engine | Tracks known alpha wallets, whale flow, stealth accumulation, developer dump risk, and holder concentration. |
| Social intelligence | Uses RapidAPI Twitter/X data for tweet velocity, KOL reach, engagement decay, bot-pump signals, and raw tweets for AI analysis. |
| Scoring and decision layer | Aggregates engine outputs into a final risk score and applies user risk settings. |
| Guardian execution flow | Builds quotes and swap payloads, records submitted exits, and tracks execution history. |
| Watchlist surveillance | Periodically re-scans watched tokens and sends Telegram alerts when risk changes. |
| Web dashboard | Provides scanning, history, watchlist, settings, wallet auth, risk panels, and graph visualizations. |

## Architecture

```text
Wallet / token input
        |
        v
Intent parser + token resolver
        |
        v
Scan orchestrator
        |
        +--> Cluster engine
        +--> Velocity engine
        +--> Smart-money engine
        +--> Social engine
        |
        v
Scoring service
        |
        v
Decision service + user settings
        |
        v
AI summary + persisted scan report
        |
        v
Dashboard, alerts, watchlist, guardian flow
```

## Tech stack

| Layer | Stack |
| --- | --- |
| API | NestJS 11, TypeScript, Prisma, Passport JWT, Vitest |
| Web | React 19, Vite 8, TypeScript 6, React Router, Zustand, Axios |
| Visualization | D3, Recharts, Framer Motion |
| Database | PostgreSQL via Prisma |
| Cache / time-series | Redis via ioredis, with development memory fallback |
| Solana data | Helius RPC/API, `@solana/web3.js` |
| AI | Groq-compatible LLM provider |
| Social data | RapidAPI `twitter-api45` |
| Alerts | Telegram Bot API |

## Repository layout

```text
Argus-Graph/
├── apps/
│   ├── api/
│   │   ├── prisma/                  # Database schema and migrations
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── auth/            # Wallet signature auth and JWT
│   │       │   ├── ai/              # Intent parsing and summaries
│   │       │   ├── cluster/         # Wallet graph and cluster risk
│   │       │   ├── decision/        # Risk decisions and guardian execution
│   │       │   ├── scan/            # Scan orchestration and Telegram alerts
│   │       │   ├── scoring/         # Final weighted risk score
│   │       │   ├── smart-money/     # Whale and alpha-wallet signals
│   │       │   ├── social/          # Social risk engine
│   │       │   ├── token/           # Token metadata and symbol resolution
│   │       │   ├── user/            # User settings and Telegram linking
│   │       │   ├── velocity/        # Transaction/social velocity signals
│   │       │   └── watchlist/       # Watchlist CRUD and surveillance
│   │       └── providers/
│   │           ├── ai/              # Groq LLM provider
│   │           ├── helius/          # Solana data provider
│   │           ├── prisma/          # Prisma service
│   │           └── redis/           # Redis cache/time-series service
│   └── web/
│       └── src/
│           ├── components/          # Risk panels, charts, layout, UI primitives
│           ├── pages/               # Landing, scan, history, watchlist, settings
│           ├── providers/           # Wallet provider
│           ├── services/            # API client
│           └── stores/              # Auth and app state
├── docker-compose.yml               # Local PostgreSQL and Redis
├── package.json                     # Workspace scripts
└── .env.example                     # API environment template
```

## Prerequisites

- Node.js 18+
- npm 9+
- Docker Desktop or local PostgreSQL/Redis
- Solana wallet browser extension for web auth
- API keys for live provider features:
  - Helius for on-chain Solana data
  - Groq for AI parsing/summaries/sentiment
  - RapidAPI `twitter-api45` for Twitter/X velocity
  - Telegram bot token for alerts and watchlist notifications

## Quick start

```bash
npm install
npm run docker:up
cp .env.example apps/api/.env
npm run db:generate
npm run db:migrate
npm run dev
```

Default services:

| Service | URL |
| --- | --- |
| Web | `http://localhost:5173` |
| API | `http://localhost:3001/api/v1` |
| PostgreSQL | `localhost:5433` |
| Redis | `localhost:6379` |

## Environment variables

`apps/api/.env` is loaded by the API. Start from `.env.example` and replace placeholder values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Yes | Runtime mode. Use `development` locally. |
| `PORT` | Yes | API port. Default `3001`. |
| `FRONTEND_URL` | Yes | CORS origin for the web app. |
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `REDIS_HOST` | Yes | Redis host. |
| `REDIS_PORT` | Yes | Redis port. |
| `JWT_SECRET` | Yes | JWT signing secret. Use a strong random value outside local dev. |
| `JWT_EXPIRY` | Yes | Access token lifetime. |
| `JWT_REFRESH_EXPIRY` | Yes | Refresh token lifetime. |
| `GROQ_API_KEY` | Optional | Enables AI intent fallback, summaries, and sentiment refinement. |
| `AI_MODEL` | Optional | Groq model name. Defaults to `llama-3.1-8b-instant`. |
| `HELIUS_API_KEY` | Recommended | Enables live Helius on-chain data. Required in production paths. |
| `HELIUS_RPC_URL` | Optional | Custom Helius RPC URL override. |
| `SOLANA_RPC_URL` | Optional | Generic Solana RPC fallback for guardian services. |
| `RAPIDAPI_KEY` | Optional | Enables Twitter/X velocity from `twitter-api45`. |
| `SMART_WALLET_ADDRESSES` | Optional | Comma-separated alpha wallet allowlist. |
| `COMMON_HOLDER_ALLOWLIST` | Optional | Comma-separated holders excluded from holder-risk labeling. |
| `CLUSTER_COMMON_FUNDER_ALLOWLIST` | Optional | Comma-separated funders excluded from cluster-risk labeling. |
| `TELEGRAM_BOT_TOKEN` | Optional | Enables Telegram alerts and Telegram velocity lookups. |
| `TELEGRAM_CHAT_ID` | Optional | Default admin chat for alerts. |
| `TELEGRAM_BOT_USERNAME` | Optional | Used to generate Telegram deep links. |
| `WATCHLIST_SURVEILLANCE_ENABLED` | Optional | Enables background watchlist scanning. |
| `WATCHLIST_SCAN_INTERVAL_MS` | Optional | Watchlist scan interval. |
| `WATCHLIST_ALERT_COOLDOWN_SECONDS` | Optional | Minimum seconds between repeat watchlist alerts. |

Web API base URL can be overridden with `VITE_API_URL`. Default is `http://localhost:3001/api/v1`.

## Scripts

Root workspace scripts:

```bash
npm run dev          # API + web
npm run dev:api      # API only
npm run dev:web      # Web only
npm run build:api    # Build API
npm run build:web    # Build web
npm run db:generate  # Prisma generate
npm run db:migrate   # Prisma migrate dev
npm run db:studio    # Prisma Studio
npm run docker:up    # Start PostgreSQL + Redis
npm run docker:down  # Stop PostgreSQL + Redis
```

Package-level scripts:

```bash
npm run test --workspace=apps/api
npm run test --workspace=apps/web
npm run lint --workspace=apps/web
npm run preview --workspace=apps/web
```

## API overview

API prefix: `/api/v1`

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Basic service health. |
| `GET` | `/health/providers` | Provider readiness for DB, Redis, Helius, Groq, RapidAPI, Telegram. |
| `POST` | `/auth/nonce` | Create wallet auth nonce. |
| `POST` | `/auth/verify` | Verify wallet signature and issue tokens. |
| `POST` | `/auth/refresh` | Refresh access token. |
| `GET` | `/users/me` | Get current user profile/settings. |
| `GET` | `/users/telegram/link-code` | Generate Telegram link code. |
| `PATCH` | `/users/telegram/link` | Link Telegram chat manually. |
| `PATCH` | `/users/settings` | Update user risk and alert settings. |
| `GET` | `/tokens/resolve/:query` | Resolve mint address, symbol, or supported token query. |
| `GET` | `/tokens/:address` | Fetch token metadata. |
| `POST` | `/scans` | Start token scan. |
| `GET` | `/scans/history` | List user scan history. |
| `GET` | `/scans/:id` | Get scan report. |
| `POST` | `/watchlist` | Add token to watchlist. |
| `GET` | `/watchlist` | List watched tokens. |
| `DELETE` | `/watchlist/:id` | Remove watchlist item. |
| `PATCH` | `/watchlist/:id/toggle` | Enable or disable watchlist item. |
| `POST` | `/guardian/quote` | Get guardian quote. |
| `POST` | `/guardian/swap/build` | Build guardian swap transaction payload. |
| `POST` | `/guardian/swap/submitted` | Record submitted guardian transaction. |
| `GET` | `/guardian/token-balance` | Get token balance for guardian flow. |
| `GET` | `/guardian/executions` | List guardian executions. |
| `GET` | `/guardian/executions/:id` | Get guardian execution detail. |
| `POST` | `/telegram/webhook` | Telegram bot webhook endpoint. |

## Database models

Main Prisma models:

| Model | Purpose |
| --- | --- |
| `User` | Wallet identity, risk settings, Telegram link, notification preferences. |
| `AuthNonce` | Wallet-login nonce lifecycle. |
| `Scan` | Token metadata, engine scores, decision, AI explanation, raw scan payload. |
| `GuardianExecution` | Quote/swap metadata, risk context, submitted transaction status. |
| `WalletCluster` | Persisted wallet-cluster records. |
| `SmartWallet` | Known smart/alpha wallet metadata. |
| `Watchlist` | User watchlist items and surveillance alert state. |

## Frontend routes

| Route | Page |
| --- | --- |
| `/` | Dashboard / intelligence overview. |
| `/connect` | Wallet connection flow. |
| `/scan` | Token scan input. |
| `/scan/:id` | Scan report. |
| `/history` | Scan history. |
| `/watchlist` | Watchlist and monitoring. |
| `/settings` | User risk settings, notifications, Telegram setup. |

## Development notes

- API uses a global validation pipe with whitelist, transform, and non-whitelisted field rejection.
- Redis is required for production consistency; development can fall back to memory when Redis is unavailable.
- AI services explain existing structured data only. They do not calculate scores or override deterministic decisions.
- `.env.example` must stay placeholder-only. Real secrets belong in `apps/api/.env`, which is ignored by git.
- Provider outages should degrade individual signals rather than fail the whole scan.

## Security notes

- Never commit `apps/api/.env` or any real provider key.
- Rotate any key that was committed or pasted into shared logs.
- Use a strong unique `JWT_SECRET` outside local development.
- Telegram webhook routes should be protected at deployment level if exposed publicly.

## Demo

[Watch the project demo](https://youtu.be/MpM-eFN5qng)

## License

MIT
