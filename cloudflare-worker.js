// Cloudflare Worker for Moosify chat with multi‑provider failover
// Exported module for Workers runtime (ESM)

const PRODUCTION_ORIGIN = "https://moosify.pizzamonster.org";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_ENTRIES = 50;
const MAX_REQUEST_BODY_BYTES = 20_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

// In-memory rate limit store: IP -> { count, windowStart }
const rateLimitStore = new Map();

function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

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

function validateChatPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload");
  }
  if (payload.message !== undefined && (typeof payload.message !== "string" || payload.message.length > MAX_MESSAGE_LENGTH)) {
    throw new Error("Message must be a string under 2000 characters");
  }
  if (payload.history !== undefined && !validateHistory(payload.history)) {
    throw new Error("History must be an array of {role, content} entries (max 50)");
  }
}

function getAuthenticatedUser(request) {
  // Cloudflare Access injects this header when a valid session exists
  const email = request.headers.get("cf-access-authenticated-user-email");
  if (!email) return null;
  return { email };
}

function requireAuth(request, corsHeaders) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    return new Response(
      JSON.stringify({ error: "Authentication required. Please log in." }),
      {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      }
    );
  }
  return null;
}

export default {
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

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // ---------------------------------------------------------------------
    // 1️⃣ Health‑check endpoint – useful for CI/CD and monitoring
    // ---------------------------------------------------------------------
    if (request.method === "GET" && pathname === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // ---------------------------------------------------------------------
    // 1.5️⃣ Auth status endpoint – public; returns logged-in user email if
    // Cloudflare Access session exists, otherwise not-authenticated.
    // Used by frontend to update nav Login/Logout state.
    // ---------------------------------------------------------------------
    if (request.method === "GET" && pathname === "/api/auth-status") {
      const user = getAuthenticatedUser(request);
      return new Response(
        JSON.stringify({
          authenticated: !!user,
          user: user ? { email: user.email } : null
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ---------------------------------------------------------------------
    // Auth gate – Cloudflare Access injects Cf-Access-Authenticated-User-Email
    // Protect all API endpoints except /api/health and /api/auth-status
    // ---------------------------------------------------------------------
    if (pathname.startsWith("/api/")) {
      const authResult = requireAuth(request, corsHeaders);
      if (authResult) {
        return authResult;
      }
    }

    // ---------------------------------------------------------------------
    // 2️⃣ Prompt endpoint – demonstrates secret handling & permission check
    // ---------------------------------------------------------------------
    if (request.method === "POST" && pathname === "/api/prompt") {
      // Expect a secret named MY_SECRET to be set via Wrangler
      const secret = await env.MY_SECRET;
      if (!secret) {
        return new Response(JSON.stringify({ error: "Missing required secret" }), {
          status: 500,
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
      // Echo back a mock reply – replace with real LLM logic later
      const result = {
        prompt: payload.prompt,
        reply: `You sent: "${payload.prompt}" – (mock reply)`
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // ---------------------------------------------------------------------
    // Existing chat endpoint – keep original behaviour for any other POST
    // ---------------------------------------------------------------------
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

    // Maintenance mode – if client explicitly requests down, short‑circuit
    if (payload.chatStatus && payload.chatStatus === "down") {
      return new Response(JSON.stringify({ reply: "Our help desk chat is currently offline for testing. Check back soon!" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // System prompt that defines Moosy's personality, knowledge and guardrails
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
      },
    ];
    const providerAttempts = [];

    if (env.AI?.run) {
      try {
        const data = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
          messages,
          max_tokens: 256,
          temperature: 0.7
        });
        const reply = data?.response
          || data?.choices?.[0]?.message?.content
          || data?.result?.response
          || "";
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
          // Rate-limit – try next provider immediately
          providerAttempts.push(`${p.name}:429`);
          continue;
        }
        if (!resp.ok) {
          // Any non-OK response – fall back
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
        // Network or other error – try the next provider
        providerAttempts.push(`${p.name}:network-error`);
        continue;
      }
    }

    // All providers exhausted – return a friendly fallback
    const fallbackReply = "Moosy: I’m here to help you with phones, donuts, rockets, flights, cell plans, and support. Ask me about any product or tell me what you’re looking for.";
    return new Response(JSON.stringify({ reply: fallbackReply, providerAttempts }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
};
