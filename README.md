# Free AI Chatbot (OpenRouter)

A small ChatGPT-style chatbot built with plain HTML, CSS, and JavaScript. The
frontend lives in `public/` and all chat requests go through an Express backend
(`server.js`), so the OpenRouter API key is never exposed to the browser. The
same code runs locally and as a Vercel Function.

- Free models only, with no paid fallback.
- Automatic free routing through `openrouter/free`.
- Model selector grouped by category, with descriptions and FREE labels.
- Chat history is kept when you switch models.
- Images are supported only by models that accept them.
- Clear errors for rate limits, account restrictions, unavailable models, and
  provider outages.
- Server-side key handling, request validation, and a per-instance rate limit.

> **Provider note:** the current code talks to **OpenRouter only**. Google
> models are available through OpenRouter, but there is no direct Google Gemini
> API client and no `GEMINI_API_KEY` usage in this repository. If you add a
> direct Gemini integration later, keep that key in server-side environment
> variables and never in `public/`.

## Requirements

- Node.js **22 or newer** (tested on Node 24)
- An OpenRouter account and API key: <https://openrouter.ai/keys>

Free models do **not** require buying credits, but OpenRouter still applies
free-tier rate limits and account rules. Usage is not unlimited, and free-model
availability can change.

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local secret file. A starter `.env` may already exist in your
   workspace; if not, copy the example:

   ```bash
   cp .env.example .env          # macOS / Linux
   copy .env.example .env        # Windows (cmd)
   Copy-Item .env.example .env   # Windows (PowerShell)
   ```

3. Open `.env` and set the key **on your machine only**:

   ```dotenv
   OPENROUTER_API_KEY=sk-or-v1-your-real-key
   PORT=3000
   HOST=127.0.0.1
   APP_URL=http://localhost:3000
   ```

   Do not put the key in `public/index.html`, `public/script.js`, chat
   messages, or a Git commit. `.env` is already listed in `.gitignore`.

4. Start the app:

   ```bash
   npm start
   ```

5. Open <http://localhost:3000>.

For development with automatic restarts:

```bash
npm run dev
```

To run the project through Vercel's local emulator instead:

```bash
npx vercel dev --local
```

`vercel dev --local` uses the same zero-configuration routing as production
without linking a project or signing in. It still reads the local `.env` file.
`npm start` does not require the Vercel CLI at all.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Starts the Express server on `http://localhost:3000` |
| `npm run dev` | Starts the server with `node --watch` |
| `npm test` | Runs the backend, security, and upstream tests (mocked, no real API calls) |
| `npm run check` | Syntax-checks `server.js`, `models.js`, and `public/script.js` |
| `npm run verify:models` | Checks every allowlisted model against OpenRouter's live catalog and confirms it is still free |

## Deploying to Vercel

### 1. Prepare the GitHub repository

The workspace must be a Git repository before it can be imported by Vercel. If
it is not one yet:

```bash
git init
git add .
git commit -m "Prepare chatbot for Vercel"
git branch -M main
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

Before pushing, confirm that `.env` is **not** staged:

```bash
git status --short
```

You should not see `.env`, `node_modules/`, or any real API key. `.env` and the
local-only files are ignored by `.gitignore` / `.vercelignore`.

### 2. Import the repository into Vercel

1. Sign in at <https://vercel.com> and choose **Add New → Project** (or open
   <https://vercel.com/new>).
2. Import the GitHub repository.
3. Keep the root directory as `.`.
4. Vercel auto-detects **Express** from `server.js`. Do not change the framework
   preset to a static site and do not add rewrites.
5. Leave the build and output settings at their defaults. There is no frontend
   build step.
6. Deploy.

The deployment uses this layout:

| Path | Served by |
| --- | --- |
| `/`, `/index.html`, `/style.css`, `/script.js` | Vercel CDN from `public/` |
| `/api/chat`, `/api/models`, `/api/health` | `server.js` Express app as a Vercel Function |
| Any other path | `server.js` (404 handling) |

`vercel.json` only adds security headers. It deliberately contains **no
redirects or rewrites**, because Vercel's zero-configuration Express support
already routes `/api/*` to `server.js`. Adding `/(.*) -> /api` style rewrites
would conflict with the static `public/` files.

### 3. Configure environment variables

In the Vercel dashboard:

1. Open the project.
2. Go to **Settings → Environment Variables**.
3. Add:

   | Name | Value | Environments | Required |
   | --- | --- | --- | --- |
   | `OPENROUTER_API_KEY` | Your OpenRouter key | Production, Preview, Development | Yes |
   | `APP_URL` | `https://your-project.vercel.app` | Production (optional) | No |

4. Do **not** create `PORT` or `HOST` on Vercel; the platform supplies those.
5. Do **not** prefix a secret with `NEXT_PUBLIC_` or `VITE_`. Those prefixes make
   values visible to the browser.
6. Save the variables, then redeploy the project so the function picks them up.

On Vercel, `APP_URL` is optional because the server falls back to
`VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL`. It is only used for OpenRouter's
informational `HTTP-Referer` header.

### 4. Verify the deployment

After the deployment is ready, check:

```bash
curl https://your-project.vercel.app/api/health
curl https://your-project.vercel.app/api/models
```

Then open the site, select a model, and send a message. A healthy deployment
should return `configured: true` from `/api/health` and a normal chat reply from
`/api/chat`.

### Vercel limitations to know

- **Request body:** Vercel Functions accept up to **4.5 MB**. Images are
  therefore limited to **3 MB** on both the client and server, so the base64
  payload plus JSON envelope fits.
- **Function duration:** the Hobby plan allows up to **300 seconds** per
  invocation (default in 2026). The app's own upstream timeout is 120 seconds.
- **Rate limiting:** `express-rate-limit` keeps its counter in memory. On
  serverless, each warm function instance has its own counter, so the limit is a
  best-effort burst guard, not a global quota. For a strict global limit, use
  Vercel Firewall or an external store such as Upstash Redis.
- **Cold starts:** the first request after idle may be slower.
- **No persistent conversation storage:** chat history lives in the browser's
  memory for the current page. Only the selected model is saved in
  `localStorage`.
- **Upstream free limits:** OpenRouter free-model quotas still apply and are
  shared across users of the same key.

## Free models

The model list lives in one place: [`models.js`](./models.js). The server uses
the same list as an allowlist, so the frontend cannot request a paid model.

Models verified against <https://openrouter.ai/api/v1/models> on **2026-10-23**:

| Model | ID | Notes |
| --- | --- | --- |
| Auto (Free Model) | `openrouter/free` | OpenRouter picks an available free model, including vision-capable ones when needed |
| Gemma 4 31B | `google/gemma-4-31b-it:free` | Google, multimodal, 262K context |
| Inkling | `thinkingmachines/inkling:free` | Multimodal, 1M context |
| Nemotron 3 Ultra | `nvidia/nemotron-3-ultra-550b-a55b:free` | Large reasoning model, 1M context |
| Laguna S 2.1 | `poolside/laguna-s-2.1:free` | Coding and agent tasks |
| North Mini Code | `cohere/north-mini-code:free` | Fast coding assistance |
| Flint v1.0 | `recursive/flint-v1.0:free` | Coding-agent model, 262K context |
| LFM2.5 2.6B | `liquid/lfm-2.5-2.6b:free` | Small and fast |

The source of truth is the official free catalog:
<https://openrouter.ai/models?pricing=free>. Free status is checked again by the
server before each chat request (cached for 10 minutes). If a model stops being
free, the server refuses to call it instead of silently switching to a paid
model.

### Updating the list

Edit `FREE_MODELS` in `models.js`, then run:

```bash
npm run verify:models
```

Add only models where both prompt and completion prices are `0`, and keep the
`:free` suffix where OpenRouter uses one.

## How requests flow

1. The browser sends `POST /api/chat` with the selected model ID and the
   conversation history. It never sends an API key.
2. The server validates the model against the allowlist and validates the
   messages (roles, length, total size, and image type/size).
3. The server re-checks OpenRouter's catalog and confirms the model is still
   free.
4. The server calls OpenRouter with `Authorization: Bearer <key from env>`.
5. The reply, or a safe error message, is returned to the browser.

Additional protections:

- Request body limit: 4.5 MB (one image up to 3 MB).
- Per-IP rate limit: 20 chat requests per minute (per function instance on
  Vercel).
- 30 messages, 8,000 characters per message, 32,000 characters per conversation.
- Only `user` and `assistant` roles are accepted; the system prompt is set by
  the server.
- Upstream error details are truncated and the API key is redacted.
- Static serving is limited to `index.html`, `style.css`, and `script.js`, so
  server files and `.env` cannot be downloaded.
- On Vercel, only `public/` is exposed as static assets; `server.js`,
  `models.js`, `package.json`, and `.env` stay server-side.

## Error behavior

| Code | Meaning |
| --- | --- |
| `model_not_allowed` | The requested model is not on the free allowlist |
| `model_not_free` | OpenRouter no longer prices that model at zero |
| `model_unavailable` | The model was removed or has no available provider |
| `rate_limited` | OpenRouter's free-tier rate limit was reached; wait or switch models |
| `local_rate_limited` | This browser/instance sent too many requests in a minute |
| `insufficient_credits` | OpenRouter reports a credit/account restriction |
| `provider_unavailable` | No provider is currently serving that free model |
| `not_configured` | `OPENROUTER_API_KEY` is missing from the environment |
| `server_auth_error` | OpenRouter rejected the server's key |

Errors appear in the chat with a Retry button and a "Choose another model"
button. A user-selected model is never replaced silently.

## Project structure

```text
public/
  index.html        Chat UI and model selector markup
  style.css         Existing design, animations, and responsive styles
  script.js         Chat logic, model selector, error UI (no API key)
server.js           Express app, validation, rate limiting, OpenRouter calls
models.js           Central free-model configuration / allowlist
scripts/
  verify-models.js  Live free-pricing verification
test/
  smoke.test.js     Routing, validation, and secret-exposure tests
  upstream.test.js  Mocked OpenRouter integration and error mapping tests
vercel.json         Security headers only (no conflicting routing rules)
.vercelignore       Keeps local secrets and dev-only files out of CLI deploys
.env.example        Placeholder configuration (safe to commit)
.env                Your local key (ignored by Git)
```

## Testing

Run the local checks:

```bash
npm run check
npm test
```

`npm test` mocks OpenRouter, so it does not spend free-tier requests or need a
real key. The tests cover page/asset serving, blocked server files, the model
allowlist, message validation, image limits, missing-key errors, malformed JSON,
model selection, upstream error mapping, and API-key redaction.

Live free-model pricing can change. Run `npm run verify:models` before a release
to confirm every allowlisted model is still free in OpenRouter's catalog.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `/api/health` returns `configured: false` | Add `OPENROUTER_API_KEY` in **Settings → Environment Variables**, then redeploy |
| `/api/*` returns 404 on Vercel | Keep `server.js` at the repository root exporting the app, and remove any custom rewrites |
| Static assets return 404 on Vercel | Keep `index.html`, `style.css`, and `script.js` inside `public/` |
| Images fail immediately | Keep images under 3 MB; Vercel rejects bodies over 4.5 MB |
| Model requests return 429/503 | OpenRouter free quota or provider availability; wait or switch models |
| Works locally but not on Vercel | Confirm the env var is enabled for the environment you deployed (Production/Preview) |
