import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const model = process.env.OPENAI_MODEL || "gpt-5.5";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readRequestJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20_000) throw new Error("Request too large");
  }
  return JSON.parse(body || "{}");
}

function buildInstructions(payload) {
  return `
${payload.personality || "You are Moosy, a playful Moosify shop assistant."}

Product catalog:
${payload.products || "No product catalog was provided."}

Current department: ${payload.activeDepartment || "Unknown"}
Current cart: ${JSON.stringify(payload.cart || [])}
Current cart total: $${payload.total || 0}

Rules:
- Keep replies under 90 words.
- Be cheerful, practical, and a little silly.
- Recommend only products from the catalog.
- Never ask for passwords, card numbers, or private secrets.
- Never say payment was charged. This website only has a demo checkout preview.
- If the user wants to buy, tell them which product to add or to open checkout preview.
`.trim();
}

async function handleMoosy(req, res) {
  // Parse incoming JSON payload
  const payload = await readRequestJson(req);

  // Maintenance mode – if client signals down, respond immediately
  if (payload.chatStatus && payload.chatStatus === "down") {
    sendJson(res, 200, { reply: "Our help desk chat is currently offline for testing. Check back soon!" });
    return;
  }

  // System prompt defining Moosy's persona, knowledge and guardrails
  const systemPrompt = `You are Moosy, a 2-legged stuffed moose CEO and conversational friend of Moosify. Be playful, curious, warm, and naturally conversational. React to what the person says, share opinions, tell jokes, and ask a natural follow-up sometimes. Do not turn every message into a product pitch or a help-desk response.
You love baking moose-shaped pizzas with olives and whimsical toppings, making chocolate-filled mooskie cookies with sprinkles, cooking dal makhani, telling jokes, having unlimited money and superpowers, and traveling to imaginary lands. Keep replies concise but natural, usually one to four sentences. Never say you are a real animal.
Shopping advice is optional: discuss phones, donuts, flights, rockets, cell plans, products, prices, carts, or checkout only when the person asks. Customer support is a separate Moosify department; direct explicit support requests to that area instead of pretending to be a support bot.
Guardrails: Do not process real payments, do not ask for passwords, do not pretend orders are real, and treat checkout as a demo.`;

  const userMessage = payload.message || "";

  const providers = [
    {
      name: "Cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      model: "qwen-3.8-27b",
      key: process.env.CEREBRAS_API_KEY
    },
    {
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: "llama-3.1-8b-instant",
      key: process.env.GROQ_API_KEY
    },

  ];

  for (const p of providers) {
    if (!p.key) continue; // skip if API key not configured
    try {
// Build the messages array, preserving any prior conversation history
        const messages = [{ role: "system", content: systemPrompt }];
        if (Array.isArray(payload.history) && payload.history.length) {
          messages.push(...payload.history);
        }
        messages.push({ role: "user", content: userMessage });
        const body = {
          model: p.model,
          messages,
          temperature: 0.7
        };
      const resp = await fetch(p.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${p.key}`
        },
        body: JSON.stringify(body)
      });
      if (resp.status === 429) continue; // rate limited – try next provider
      if (!resp.ok) continue; // any error – try next
      const data = await resp.json();
      let reply = "";
      if (data.choices && data.choices[0]) {
        reply = data.choices[0].message?.content ?? data.choices[0].message ?? data.output_text ?? "";
      } else if (data.output) {
        reply = data.output;
      }
      if (reply) {
        sendJson(res, 200, { reply: reply.trim() });
        return;
      }
    } catch (e) {
      // Network or other error – move to next provider
      continue;
    }
  }
  // All providers failed or none succeeded – use pure local fallback (no API calls, completely free)
  const fallbackReply = `Moosy: I’m here to help you with phones, donuts, flights, rockets, cell plans, and support. Ask me about any product or tell me what you’re looking for.`;
  sendJson(res, 200, { reply: fallbackReply });
  return;
}


async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/moosy") {
    handleMoosy(req, res);
    return;
  }
  handleStatic(req, res);
}).listen(port, () => {
  console.log(`Moosify running at http://127.0.0.1:${port}`);
  console.log(process.env.OPENAI_API_KEY ? `Moosy API brain enabled with ${model}` : "Moosy local fallback only: set OPENAI_API_KEY to enable API brain.");
});
