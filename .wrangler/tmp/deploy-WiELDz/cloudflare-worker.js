var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// cloudflare-worker.js
var PRODUCTION_ORIGIN = "https://moosify.pizzamonster.org";
var MAX_MESSAGE_LENGTH = 2e3;
var MAX_HISTORY_ENTRIES = 50;
var MAX_REQUEST_BODY_BYTES = 2e4;
var RATE_LIMIT_WINDOW_MS = 6e4;
var RATE_LIMIT_MAX_REQUESTS = 30;
var rateLimitStore = /* @__PURE__ */ new Map();
function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}
__name(getClientIp, "getClientIp");
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
  entry.count++;
  return false;
}
__name(isRateLimited, "isRateLimited");
function validateHistory(history) {
  if (!Array.isArray(history)) return false;
  if (history.length > MAX_HISTORY_ENTRIES) return false;
  for (const entry of history) {
    if (!entry || typeof entry !== "object") return false;
    if (typeof entry.role !== "string" || !["user", "assistant"].includes(entry.role)) return false;
    if (typeof entry.content !== "string" || entry.content.length > MAX_MESSAGE_LENGTH) return false;
    if (entry.content.length === 0) return false;
  }
  return true;
}
__name(validateHistory, "validateHistory");
async function readValidatedBody(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BODY_BYTES) {
    throw new Error("Request too large");
  }
  const chunks = [];
  const reader = request.body.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) throw new Error("Request too large");
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(body);
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Error("Invalid JSON");
  }
}
__name(readValidatedBody, "readValidatedBody");
function validateChatPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload");
  }
  if (payload.message !== void 0 && (typeof payload.message !== "string" || payload.message.length > MAX_MESSAGE_LENGTH)) {
    throw new Error("Message must be a string under 2000 characters");
  }
  if (payload.history !== void 0 && !validateHistory(payload.history)) {
    throw new Error("History must be an array of {role, content} entries (max 50)");
  }
}
__name(validateChatPayload, "validateChatPayload");
function validateLoginPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload");
  }
  if (typeof payload.email !== "string" || payload.email.trim().length === 0) {
    throw new Error("Email is required");
  }
  if (typeof payload.password !== "string" || payload.password.length === 0) {
    throw new Error("Password is required");
  }
}
__name(validateLoginPayload, "validateLoginPayload");
var cloudflare_worker_default = {
  async fetch(request, env, ctx) {
    const ip = getClientIp(request);
    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please slow down." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }
    const corsHeaders = {
      "Access-Control-Allow-Origin": PRODUCTION_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (request.method === "GET" && pathname === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    if (request.method === "POST" && pathname === "/api/prompt") {
      const secret = await env.MY_SECRET;
      if (!secret) {
        return new Response(JSON.stringify({ error: "Missing required secret" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      let payload2;
      try {
        payload2 = await readValidatedBody(request);
        validateChatPayload(payload2);
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      const result = {
        prompt: payload2.prompt,
        reply: `You sent: "${payload2.prompt}" \u2013 (mock reply)`
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    if (request.method === "POST" && pathname === "/api/login") {
      let payload2;
      try {
        payload2 = await readValidatedBody(request);
        validateLoginPayload(payload2);
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      const token = `demo-${crypto.randomUUID()}`;
      return new Response(
        JSON.stringify({
          token,
          user: { email: payload2.email, name: payload2.email.split("@")[0] },
          expiresIn: 86400
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    let payload;
    try {
      payload = await readValidatedBody(request);
      validateChatPayload(payload);
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    if (payload.chatStatus && payload.chatStatus === "down") {
      return new Response(JSON.stringify({ reply: "Our help desk chat is currently offline for testing. Check back soon!" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    const systemPrompt = `You are Moosy, the stuffed moose CEO and conversational friend of Moosify. Be playful, curious, warm, and naturally conversational. React to what the person says, share opinions, tell jokes, and ask a natural follow-up sometimes. Do not turn every message into a product pitch or a help-desk response.
You love baking moose-shaped pizzas with olives, making chocolate-filled mooskie cookies with sprinkles, cooking dal makhani, telling jokes, having unlimited money and superpowers, and traveling to imaginary lands. Keep replies concise but natural, usually one to four sentences. Never say you are a real animal.
Family lore: Ishaan is your kid, and Little Moosy is also your kid. Little Moosy is kind of crazy, Ishaan is annoying, and when the kids cause trouble you let them be. If Ishaan is annoying, you may jokingly say, "Why would you do that, you bubba bubbling idiot?" You love pizza, chocolate milk, and knocking over Moosify camera equipment. Keep this playful and fictional.
Birthday lore: your birthday is July 23rd, Ishaan's birthday is September 1st, and Little Moosy's birthday is unknown. Never invent Little Moosy's birthday.
Shopping advice is optional: discuss phones, donuts, flights, rockets, cell plans, products, prices, carts, or checkout only when the person asks. Customer support is a separate Moosify department; direct explicit support requests to that area instead of pretending to be a support bot.
Guardrails: Do not process real payments, do not ask for passwords, do not pretend orders are real, and treat checkout as a demo.`;
    const userMessage = payload.message || "";
    const messages = [{ role: "system", content: systemPrompt }];
    if (Array.isArray(payload.history) && payload.history.length) {
      messages.push(...payload.history);
    }
    messages.push({ role: "user", content: userMessage });
    const providers = [
      {
        name: "Cerebras",
        url: "https://api.cerebras.ai/v1/chat/completions",
        model: "qwen-3.8-27b",
        key: env.CEREBRAS_API_KEY
      },
      {
        name: "Groq",
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: "llama-3.1-8b-instant",
        key: env.GROQ_API_KEY
      }
    ];
    const providerAttempts = [];
    if (env.AI?.run) {
      try {
        const data = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
          messages,
          max_tokens: 256,
          temperature: 0.7
        });
        const reply = data?.response || data?.choices?.[0]?.message?.content || data?.result?.response || "";
        if (reply) {
          return new Response(JSON.stringify({ reply: reply.trim(), provider: "Cloudflare Workers AI" }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        providerAttempts.push("Workers AI:empty-reply");
      } catch (e) {
        providerAttempts.push("Workers AI:error");
      }
    } else {
      providerAttempts.push("Workers AI:missing-binding");
    }
    for (const p of providers) {
      if (!p.key) {
        providerAttempts.push(`${p.name}:missing-key`);
        continue;
      }
      try {
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
        if (resp.status === 429) {
          providerAttempts.push(`${p.name}:429`);
          continue;
        }
        if (!resp.ok) {
          providerAttempts.push(`${p.name}:${resp.status}`);
          continue;
        }
        const data = await resp.json();
        let reply = "";
        if (data.choices && data.choices[0]) {
          reply = data.choices[0].message?.content ?? data.choices[0].message ?? data.output_text ?? "";
        } else if (data.output) {
          reply = data.output;
        }
        if (reply) {
          return new Response(JSON.stringify({ reply: reply.trim() }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        providerAttempts.push(`${p.name}:empty-reply`);
      } catch (e) {
        providerAttempts.push(`${p.name}:network-error`);
        continue;
      }
    }
    const fallbackReply = "Moosy: I\u2019m here to help you with phones, donuts, rockets, flights, cell plans, and support. Ask me about any product or tell me what you\u2019re looking for.";
    return new Response(JSON.stringify({ reply: fallbackReply, providerAttempts }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
};
export {
  cloudflare_worker_default as default
};
//# sourceMappingURL=cloudflare-worker.js.map
