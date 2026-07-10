# Moosify Website

<!-- Trigger CI after workflow fixes -->

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

## Deploy the Moosy backend

The front‑end needs a live HTTP endpoint for `/api/moosy`. We provide a ready‑to‑use **Cloudflare Worker** implementation (`cloudflare-worker.js`).

1. **Create a Cloudflare account** and generate an **API token** with the “Edit Cloudflare Workers” permission.
2. Add the following repository secrets (Settings → Secrets → Actions):
   * `CF_API_TOKEN` – your Cloudflare API token
   * `CF_ACCOUNT_ID` – your Cloudflare account ID
   * `CEREBRAS_API_KEY` – free Cerebras key (optional)
   * `GROQ_API_KEY` – free Groq key (optional)
   * `API_URL` – the URL where the worker will be published (e.g., `https://moosy-api.<account>.workers.dev`).
3. The workflow **`.github/workflows/deploy-worker.yml`** will automatically publish the worker on every push to `main`.
4. After the workflow finishes, the `API_URL` secret should point at the worker’s URL (the workflow prints the URL in the logs).

If you prefer a traditional VPS or a PaaS (Render, Railway, Fly.io), you can also run `server.mjs` there and set the same `API_URL` secret to that service’s address.
   
---

After configuring the secrets and pushing a commit, the site will automatically use your backend and the free LLM providers without falling back to the local placeholder.

<!-- Trigger CI after workflow fixes -->
