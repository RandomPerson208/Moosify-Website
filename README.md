# Moosify Website

Playful static storefront with a Moosy chat assistant.

## Run local fallback mode

```bash
npm run static
```

Moosy will answer with the built-in local product guide.

## Run Moosy with multi‑provider LLM fallback

Set the two provider API keys on the server (they are read from the environment, not the browser). Example using a `.env` file:

```bash
# .env (do NOT commit this file)
# Install dependencies first:
#   npm install
CEREBRAS_API_KEY="your_cerebras_key"
GROQ_API_KEY="your_groq_key"
# API_URL is the full endpoint for the Moosy backend (e.g., https://my-backend.workers.dev). Omit if you want to use the built‑in local fallback.
API_URL="https://my-backend.workers.dev"
# You may omit both keys – the server will then use a built‑in local fallback (completely free).
# Optional: choose a different model for the OpenAI fallback (if you still keep it)
OPENAI_MODEL="gpt-5.5"
```

Start the server:

```bash
npm start
```

The request flow:
* The client POSTs to `/api/moosy` **including the recent chat history** so that each provider receives the full conversation context.
* The server tries the Cerebras model first, then Groq. If either provider returns a 429 rate‑limit or any error, the next provider is tried automatically.
* If **all** providers fail (or no keys are set), the server now uses a built‑in local fallback, so the chat works **completely free** without any external API calls.

The site will call `/api/moosy`. If no provider keys are set, the server falls back to the built‑in local response, so the chat still works (completely free). Checkout remains a demo preview and never charges a payment.

You can also control chat availability via the `CHAT_STATUS` secret (set to `down` to disable the chat UI). Additionally, set an `API_URL` secret to point the front‑end at your external backend (e.g., a Cloudflare Worker or Render service). If omitted, the site will use the built‑in local fallback.