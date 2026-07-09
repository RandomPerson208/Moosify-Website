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
  if (!process.env.OPENAI_API_KEY) {
    sendJson(res, 503, { error: "OPENAI_API_KEY is not set. The browser will use local Moosy fallback." });
    return;
  }

  try {
    const payload = await readRequestJson(req);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        instructions: buildInstructions(payload),
        input: [
          ...(payload.history || []).slice(-8),
          { role: "user", content: String(payload.message || "").slice(0, 1000) }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      sendJson(res, response.status, { error: data.error?.message || "OpenAI API request failed" });
      return;
    }

    sendJson(res, 200, { reply: data.output_text || "Moosy is thinking too hard. Try again in a moment." });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
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
