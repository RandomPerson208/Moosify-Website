import { describe, it } from "node:test";
import assert from "node:assert";
import { createHmac } from "node:crypto";
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
