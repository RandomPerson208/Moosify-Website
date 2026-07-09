# Moosify Website

Playful static storefront with a Moosy chat assistant.

## Run local fallback mode

```bash
npm run static
```

Moosy will answer with the built-in local product guide.

## Run OpenAI-backed Moosy

Set an API key on the server, not in browser code:

```bash
export OPENAI_API_KEY="your_api_key_here"
npm start
```

Optional:

```bash
export OPENAI_MODEL="gpt-5.5"
```

The site will call `/api/moosy`. If the key is missing or the API request fails, the browser falls back to the local Moosy guide. Checkout remains a demo preview and never charges payment.
