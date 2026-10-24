# Free AI Chatbot

A simple ChatGPT-style chatbot with a lightweight frontend and a small Node.js backend. The backend keeps the OpenRouter API key private and allows only verified free models.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript |
| Backend | Node.js 22+, Express 5 |
| AI provider | OpenRouter |
| Configuration | dotenv |
| Rate limiting | express-rate-limit |
| Hosting | Local Node.js server or Vercel |



## Functionality

- The chat panel starts minimized. The landing page remains visible.
- **Chat with AI** opens the chat and focuses the message input.
- A floating chat button reopens the chat after it is closed.
- The close button minimizes the chat panel.
- Users can send text messages and attach images when the selected model supports vision.
- The model selector lists only free models and keeps the conversation when switching models.
- **Clear chat** restores the welcome message and clears conversation history.
- Errors such as rate limits, unavailable models, and network failures are shown in the chat.
- The frontend never receives the OpenRouter API key.

## How to Run in the Terminal

### Requirements

- Node.js 22 or newer
- An OpenRouter API key from <https://openrouter.ai/keys>

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Create the local environment file
cp .env.example .env
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set your key:

```dotenv
OPENROUTER_API_KEY=sk-or-v1-your-real-key
PORT=3000
```

Start the chatbot:

```bash
npm start
```

Open <http://localhost:3000> in your browser.

For development with automatic restarts:

```bash
npm run dev
```

## API Used

### OpenRouter API

The backend calls OpenRouter's chat completion endpoint:

```text
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <OPENROUTER_API_KEY>
```

The server also checks OpenRouter's model catalog to confirm that a selected model is still free:

```text
GET https://openrouter.ai/api/v1/models
```


The server rejects unknown or non-free models, invalid messages, and unsupported image inputs. OpenRouter free-tier rate limits still apply.

## Models Used

The allowlist is defined in `models.js`.

| Model | Provider | OpenRouter ID |
| --- | --- | --- |
| Auto (Free Model) | OpenRouter | `openrouter/free` |
| Nemotron 3 Ultra | NVIDIA | `nvidia/nemotron-3-ultra-550b-a55b:free` |
| Inkling | Thinking Machines | `thinkingmachines/inkling:free` |
| Laguna S 2.1 | Poolside | `poolside/laguna-s-2.1:free` |
| North Mini Code | Cohere | `cohere/north-mini-code:free` |
| LFM2.5 2.6B | Liquid AI | `liquid/lfm-2.5-2.6b:free` |
| Flint v1.0 | Recursive | `recursive/flint-v1.0:free` |

`openrouter/free` is the default. It automatically selects an available free model and can use a vision-capable free model when an image is attached.

All listed models must have both prompt and completion prices equal to zero in OpenRouter's live catalog. If a model stops being free, the server will not use it.
