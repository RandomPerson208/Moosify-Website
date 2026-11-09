import { describe, it } from "node:test";
import assert from "node:assert";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import worker from "../cloudflare-worker.js";

// These tests run the real Worker fetch handler (not a copy of its logic).
const PRODUCTION_ORIGIN = "https://moosify.pizzamonster.org";
const SECRET = "test-session-secret";
const baseEnv = { SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: "test-client-id" };

let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `10.1.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

function b64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function signToken(payload, secret = SECRET, header = { alg: "HS256", typ: "JWT" }) {
  const head = b64url(header);
  const body = b64url(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function validPayload(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { email: "moosy@moosify.com", name: "Moosy", sub: "1", iat: now, exp: now + 3600, ...overrides };
}

function call(path, { method = "GET", token, body, ip = freshIp(), headers = {} } = {}, env = baseEnv) {
  const request = new Request(`https://api.example.com${path}`, {
    method,
    headers: {
      "cf-connecting-ip": ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return worker.fetch(request, env, {});
}

async function authStatus(token, env) {
  const resp = await call("/api/auth-status", { token }, env);
  return resp.json();
}

describe("Session tokens", () => {
  it("accepts a token signed with SESSION_SECRET", async () => {
    const data = await authStatus(signToken(validPayload()));
    assert.strictEqual(data.authenticated, true);
    assert.strictEqual(data.user.email, "moosy@moosify.com");
  });

  it("rejects an unsigned placeholder token", async () => {
    const forged = `${b64url({ alg: "HS256" })}.${b64url(validPayload())}.placeholder`;
    const data = await authStatus(forged);
    assert.strictEqual(data.authenticated, false);
  });

  it("rejects a token signed with a different secret", async () => {
    const data = await authStatus(signToken(validPayload(), "wrong-secret"));
    assert.strictEqual(data.authenticated, false);
  });

  it("rejects a token whose payload was edited after signing", async () => {
    const [head, , sig] = signToken(validPayload()).split(".");
    const tampered = `${head}.${b64url(validPayload({ email: "ishaan@moosify.com" }))}.${sig}`;
    const data = await authStatus(tampered);
    assert.strictEqual(data.authenticated, false);
  });

  it("rejects an expired token", async () => {
    const data = await authStatus(signToken(validPayload({ exp: Math.floor(Date.now() / 1000) - 10 })));
    assert.strictEqual(data.authenticated, false);
  });

  it("rejects a token without exp", async () => {
    const { exp, ...noExp } = validPayload();
    const data = await authStatus(signToken(noExp));
    assert.strictEqual(data.authenticated, false);
  });

  it("rejects alg=none tokens", async () => {
    const data = await authStatus(signToken(validPayload(), SECRET, { alg: "none" }));
    assert.strictEqual(data.authenticated, false);
  });

  it("treats everyone as logged out when SESSION_SECRET is missing", async () => {
    const data = await authStatus(signToken(validPayload()), { GOOGLE_CLIENT_ID: "x" });
    assert.strictEqual(data.authenticated, false);
  });
});

describe("Login endpoint", () => {
  it("returns 503 when login is not configured", async () => {
    const resp = await call("/api/login", { method: "POST", body: { credential: "x.y.z" } }, {});
    assert.strictEqual(resp.status, 503);
    assert.strictEqual(resp.headers.get("access-control-allow-origin"), PRODUCTION_ORIGIN);
  });

  it("rejects a missing credential", async () => {
    const resp = await call("/api/login", { method: "POST", body: {} });
    assert.strictEqual(resp.status, 400);
  });

  it("rejects a Google token for a different client ID", async () => {
    const now = Math.floor(Date.now() / 1000);
    const fakeGoogle = `${b64url({ alg: "RS256", kid: "k" })}.${b64url({ iss: "https://accounts.google.com", aud: "someone-else", exp: now + 60 })}.sig`;
    const resp = await call("/api/login", { method: "POST", body: { credential: fakeGoogle } });
    assert.strictEqual(resp.status, 401);
  });
});

describe("Auth gate", () => {
  it("lets anyone chat by default", async () => {
    const resp = await call("/api/moosy", { method: "POST", body: { message: "hi" } });
    assert.strictEqual(resp.status, 200);
    const data = await resp.json();
    assert.ok(data.reply);
  });

  it("lets anyone chat on the Worker root path", async () => {
    const resp = await call("/", { method: "POST", body: { message: "hi" } });
    assert.strictEqual(resp.status, 200);
  });

  it("requires login for chat when CHAT_REQUIRES_LOGIN is true", async () => {
    const env = { ...baseEnv, CHAT_REQUIRES_LOGIN: "true" };
    const anon = await call("/api/moosy", { method: "POST", body: { message: "hi" } }, env);
    assert.strictEqual(anon.status, 401);
    const authed = await call("/api/moosy", { method: "POST", body: { message: "hi" }, token: signToken(validPayload()) }, env);
    assert.strictEqual(authed.status, 200);
  });

  it("requires login for /api/prompt", async () => {
    const resp = await call("/api/prompt", { method: "POST", body: { prompt: "hi" } });
    assert.strictEqual(resp.status, 401);
    const body = await resp.json();
    assert.ok(body.error.includes("Authentication required"));
  });

  it("returns 404 for unknown API routes", async () => {
    const resp = await call("/api/nope", { method: "POST", body: {}, token: signToken(validPayload()) });
    assert.strictEqual(resp.status, 404);
  });
});

describe("Rate limiting", () => {
  it("sends CORS headers on 429 so the browser can read it", async () => {
    const ip = freshIp();
    let resp;
    for (let i = 0; i < 31; i++) resp = await call("/api/health", { ip });
    assert.strictEqual(resp.status, 429);
    assert.strictEqual(resp.headers.get("access-control-allow-origin"), PRODUCTION_ORIGIN);
  });

  it("does not count CORS preflights", async () => {
    const ip = freshIp();
    for (let i = 0; i < 40; i++) await call("/api/moosy", { method: "OPTIONS", ip });
    const resp = await call("/api/health", { ip });
    assert.strictEqual(resp.status, 200);
  });
});

describe("Google key rotation", () => {
  it("refetches Google's keys when a token uses a key it hasn't seen", async () => {
    const makeKey = (kid) => {
      const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
    };
    const oldKey = makeKey("old-key");
    const newKey = makeKey("new-key");
    let published = [oldKey.jwk];
    let certFetches = 0;

    const realFetch = globalThis.fetch;
    const realNow = Date.now;
    globalThis.fetch = async (url) => {
      assert.strictEqual(String(url), "https://www.googleapis.com/oauth2/v3/certs");
      certFetches += 1;
      return new Response(JSON.stringify({ keys: published }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" }
      });
    };

    const googleToken = (key) => {
      const now = Math.floor(realNow() / 1000);
      const head = b64url({ alg: "RS256", kid: key.kid, typ: "JWT" });
      const body = b64url({ iss: "https://accounts.google.com", aud: "test-client-id", sub: "42", email: "moosy@moosify.com", exp: now + 3600 });
      const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key.privateKey, "base64url");
      return `${head}.${body}.${sig}`;
    };
    const login = (key) => call("/api/login", { method: "POST", body: { credential: googleToken(key) } });

    try {
      assert.strictEqual((await login(oldKey)).status, 200);
      assert.strictEqual(certFetches, 1);

      // Google rotates in a new key; our cached copy doesn't have it yet
      published = [oldKey.jwk, newKey.jwk];
      Date.now = () => realNow() + 15_000;
      const resp = await login(newKey);
      assert.strictEqual(resp.status, 200);
      assert.strictEqual(certFetches, 2);
      const data = await resp.json();
      assert.strictEqual(data.user.email, "moosy@moosify.com");
    } finally {
      globalThis.fetch = realFetch;
      Date.now = realNow;
    }
  });
});

describe("Chat responses", () => {
  it("goes offline when the CHAT_STATUS secret is down", async () => {
    const resp = await call("/api/moosy", { method: "POST", body: { message: "hi" } }, { ...baseEnv, CHAT_STATUS: "down" });
    const data = await resp.json();
    assert.match(data.reply, /offline/);
  });

  it("flags the canned fallback reply so the UI can say so", async () => {
    const resp = await call("/api/moosy", { method: "POST", body: { message: "hi" } });
    const data = await resp.json();
    assert.strictEqual(data.fallback, true);
  });
});
