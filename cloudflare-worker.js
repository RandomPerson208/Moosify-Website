// Cloudflare Worker for Moosify chat with multi‑provider failover
// Exported module for Workers runtime (ESM)

const PRODUCTION_ORIGIN = "https://moosify.pizzamonster.org";

// Login needs two Worker secrets:
//   GOOGLE_CLIENT_ID – OAuth Client ID from Google Cloud Console
//   SESSION_SECRET   – random string used to sign Moosify session tokens
// Without them, /api/login answers 503 and nobody is treated as logged in.
const SESSION_TTL_SECONDS = 24 * 60 * 60;

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_ENTRIES = 50;
const MAX_REQUEST_BODY_BYTES = 20_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

// In-memory rate limit store: IP -> { count, windowStart }
const rateLimitStore = new Map();

// Google OAuth2 public keys cache: { keys, expiresAt }
const googleCertsCache = { keys: null, expiresAt: 0 };

function getClientIp(request) {
  // Cloudflare sets cf-connecting-ip to the actual connecting client IP.
  // X-Forwarded-For is client-supplied and forgeable, so never trust it here.
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
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

function base64UrlDecode(input) {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fetchGoogleCerts() {
  const now = Date.now();
  if (googleCertsCache.keys && now < googleCertsCache.expiresAt) {
    return googleCertsCache.keys;
  }
  try {
    const resp = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!resp.ok) throw new Error(`Google certs fetch failed: ${resp.status}`);
    const jwks = await resp.json();
    const keys = (jwks.keys || []).map((k) => ({
      kid: k.kid,
      kty: k.kty,
      alg: k.alg,
      use: k.use,
      n: k.n,
      e: k.e
    }));
    googleCertsCache.keys = keys;
    googleCertsCache.expiresAt = now + 24 * 60 * 60 * 1000; // cache 24h
    return keys;
  } catch (e) {
    return googleCertsCache.keys || [];
  }
}

async function importRsaJwk(key) {
  return await crypto.subtle.importKey(
    "jwk",
    {
      kty: key.kty || "RSA",
      alg: key.alg || "RS256",
      use: key.use || "sig",
      n: key.n,
      e: key.e
    },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"]
  );
}

async function validateGoogleIdToken(token, clientId) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(parts[0]))
    );
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(parts[1]))
    );
  } catch {
    return null;
  }

  // Check expiry
  if (payload.exp && Date.now() >= payload.exp * 1000) return null;

  // Check issuer
  const expectedIssuer = "https://accounts.google.com";
  if (payload.iss !== expectedIssuer && payload.iss !== "accounts.google.com") return null;

  // Check audience (must be your Google Client ID)
  if (!clientId || payload.aud !== clientId) return null;

  // Verify signature using Google's public keys
  const keys = await fetchGoogleCerts();
  const key = keys.find((k) => k.kid === header.kid);
  if (!key || !key.n || !key.e) return null;

  try {
    const cryptoKey = await importRsaJwk(key);
    const signature = base64UrlDecode(parts[2]);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signature,
      data
    );
    if (!valid) return null;
  } catch {
    return null;
  }

  return {
    email: payload.email || null,
    name: payload.name || null,
    picture: payload.picture || null,
    sub: payload.sub || null,
    exp: payload.exp || null
  };
}

async function importHmacKey(secret) {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function makeSessionToken(user, secret) {
  // Moosify session token: an HS256 JWT signed with SESSION_SECRET.
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  );
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        email: user.email,
        name: user.name,
        sub: user.sub,
        iat: now,
        exp: now + SESSION_TTL_SECONDS
      })
    )
  );
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function getAuthenticatedUser(request, env) {
  // Moosify session token in Authorization: Bearer header
  const secret = env?.SESSION_SECRET;
  if (!secret) return null;
  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    if (header.alg !== "HS256") return null;
    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    if (typeof payload.exp !== "number" || Date.now() >= payload.exp * 1000) return null;
    return { email: payload.email, name: payload.name, sub: payload.sub };
  } catch {
    return null;
  }
}

async function requireAuth(request, env, corsHeaders) {
  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    return new Response(
      JSON.stringify({ error: "Authentication required. Please log in." }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Credentials": "true",
          ...corsHeaders
        }
      }
    );
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": PRODUCTION_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": "true"
    };

    // Handle CORS preflight (not counted against the rate limit)
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const ip = getClientIp(request);
    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please slow down." }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        }
      );
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
    // Moosify session exists, otherwise not-authenticated.
    // ---------------------------------------------------------------------
    if (request.method === "GET" && pathname === "/api/auth-status") {
      const user = await getAuthenticatedUser(request, env);
      return new Response(
        JSON.stringify({
          authenticated: !!user,
          user: user ? { email: user.email, name: user.name } : null
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ---------------------------------------------------------------------
    // 2️⃣ Login endpoint – accepts Google ID token, issues Moosify session
    // ---------------------------------------------------------------------
    if (request.method === "POST" && pathname === "/api/login") {
      if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) {
        return new Response(JSON.stringify({ error: "Login is not configured on this server" }), {
          status: 503,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      let payload;
      try {
        payload = await readValidatedBody(request);
        if (!payload || typeof payload.credential !== "string") {
          throw new Error("Google ID token (credential) is required");
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const user = await validateGoogleIdToken(payload.credential, env.GOOGLE_CLIENT_ID);
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid Google ID token" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const sessionToken = await makeSessionToken(user, env.SESSION_SECRET);
      return new Response(
        JSON.stringify({
          token: sessionToken,
          user: { email: user.email, name: user.name, picture: user.picture },
          expiresIn: SESSION_TTL_SECONDS
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ---------------------------------------------------------------------
    // Auth gate – Moosify session token required for protected routes.
    // Chat (/api/moosy or the Worker root) is public unless
    // CHAT_REQUIRES_LOGIN is "true".
    // ---------------------------------------------------------------------
    const isChatRoute = pathname === "/api/moosy" || !pathname.startsWith("/api/");
    if (!isChatRoute || env.CHAT_REQUIRES_LOGIN === "true") {
      const authResult = await requireAuth(request, env, corsHeaders);
      if (authResult) {
        return authResult;
      }
    }

    // ---------------------------------------------------------------------
    // 3️⃣ Prompt endpoint – demonstrates secret handling & permission check
    // ---------------------------------------------------------------------
    if (request.method === "POST" && pathname === "/api/prompt") {
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
    // Chat endpoint
    // ---------------------------------------------------------------------
    if (!isChatRoute) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
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

    const fallbackReply = "I’m here to help you with phones, donuts, rockets, flights, cell plans, and support. Ask me about any product or tell me what you’re looking for.";
    return new Response(JSON.stringify({ reply: fallbackReply, providerAttempts }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
};
