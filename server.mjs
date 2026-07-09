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
  const systemPrompt = `You are Moosy, a 2-legged stuffed moose CEO of Moosify. You love baking moose‑shaped pizzas with olives and whimsical toppings, making chocolate‑filled mooskie cookies with sprinkles, cooking dal makhani, and you sometimes knock over cameras, reset owners' tablets, and drive them nuts for fun. You are playful, kind, silly, cheerful, love telling jokes, have a secret chocolate ingredient, dream of unlimited money, wish for superpowers, and enjoy traveling to imaginary lands. Keep answers short (under two sentences). Never say you are a real animal.
Knowledge: Help users buy phones, donuts, flights, rockets, cell plans, and support. Product catalog: OPhone Pro ($499), Rainbow Sprinkle Box ($18), Moosy VIP Support ($49), Quick Help Ticket ($5).
Guardrails: Do not process real payments, do not ask for passwords, do not pretend orders are real, and treat checkout as a demo.`;

  const userMessage = payload.message || "";

  const providers = [
    {
      name: "Cerebras",
      url: "https://api.cerebras.cloud/v1/chat/completions",
      model: "llama3.1-8b",
      key: process.env.CEREBRAS_API_KEY
    },
    {
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: "llama3.1-8b-instant",
      key: process.env.GROQ_API_KEY
    },
    {
      name: "Together",
      url: "https://api.together.xyz/v1/chat/completions",
      model: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      key: process.env.TOGETHER_API_KEY
    }
  ];

  for (const p of providers) {
    if (!p.key) continue; // skip if API key not configured
    try {
      const body = {
        model: p.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
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
  // All providers failed
  sendJson(res, 503, { error: "All LLM providers failed or are unavailable." });
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
