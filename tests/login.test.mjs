import { describe, it } from "node:test";
import assert from "node:assert";

// --- localStorage mock for Node.js test environment ---
class LocalStorageMock {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}
globalThis.localStorage = new LocalStorageMock();

// --- Session management (mirrors moosify.js) ---
const SESSION_KEY = "moosify-session";

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.email !== "string" || parsed.email.length === 0) return null;
    if (typeof parsed.token !== "string" || parsed.token.length === 0) return null;
    return parsed;
  } catch (error) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// --- Login payload validation (mirrors cloudflare-worker.js) ---
const MAX_MESSAGE_LENGTH = 2000;

function validateHistory(history) {
  if (!Array.isArray(history)) return false;
  if (history.length > 50) return false;
  for (const entry of history) {
    if (!entry || typeof entry !== "object") return false;
    if (typeof entry.role !== "string" || !["user", "assistant"].includes(entry.role)) return false;
    if (typeof entry.content !== "string" || entry.content.length > MAX_MESSAGE_LENGTH) return false;
    if (entry.content.length === 0) return false;
  }
  return true;
}

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

// --- Login API tests ---
describe("Login API - validateLoginPayload", () => {
  it("accepts valid email + password", () => {
    assert.doesNotThrow(() => validateLoginPayload({ email: "moosy@moosify.com", password: "secret" }));
  });

  it("rejects missing email", () => {
    assert.throws(() => validateLoginPayload({ password: "secret" }), /Email is required/);
  });

  it("rejects empty email", () => {
    assert.throws(() => validateLoginPayload({ email: "  ", password: "secret" }), /Email is required/);
  });

  it("rejects missing password", () => {
    assert.throws(() => validateLoginPayload({ email: "moosy@moosify.com" }), /Password is required/);
  });

  it("rejects empty password", () => {
    assert.throws(() => validateLoginPayload({ email: "moosy@moosify.com", password: "" }), /Password is required/);
  });

  it("rejects null payload", () => {
    assert.throws(() => validateLoginPayload(null), /Invalid payload/);
  });
});

// --- Session persistence tests ---
describe("Session - graceful recovery", () => {
  it("returns null for missing session", () => {
    localStorage.removeItem(SESSION_KEY);
    assert.strictEqual(loadSession(), null);
  });

  it("returns null for invalid JSON", () => {
    localStorage.setItem(SESSION_KEY, "not json");
    assert.strictEqual(loadSession(), null);
    assert.strictEqual(localStorage.getItem(SESSION_KEY), null);
  });

  it("returns null for non-object JSON", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify("string"));
    assert.strictEqual(loadSession(), null);
  });

  it("returns null for session missing email", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: "abc" }));
    assert.strictEqual(loadSession(), null);
  });

  it("returns null for session missing token", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email: "a@b.com" }));
    assert.strictEqual(loadSession(), null);
  });

  it("round-trips valid session", () => {
    const session = { email: "moosy@moosify.com", token: "demo-123", user: { email: "moosy@moosify.com", name: "moosy" } };
    saveSession(session);
    const loaded = loadSession();
    assert.deepStrictEqual(loaded, session);
    localStorage.removeItem(SESSION_KEY);
  });

  it("clearSession removes session", () => {
    saveSession({ email: "a@b.com", token: "x" });
    clearSession();
    assert.strictEqual(localStorage.getItem(SESSION_KEY), null);
    assert.strictEqual(loadSession(), null);
  });
});

// --- handleLogin / handleLogout logic ---
describe("Session - login/logout state", () => {
  let session = null;

  function handleLogin(email, token) {
    const user = { email, name: email.split("@")[0] };
    session = { email, token, user, loggedInAt: Date.now() };
    saveSession(session);
  }

  function handleLogout() {
    clearSession();
    session = null;
  }

  it("handleLogin stores session", () => {
    localStorage.removeItem(SESSION_KEY);
    session = null;
    handleLogin("moosy@moosify.com", "demo-token");
    assert.strictEqual(session.email, "moosy@moosify.com");
    assert.strictEqual(session.token, "demo-token");
    assert.strictEqual(session.user.name, "moosy");
    const stored = loadSession();
    assert.strictEqual(stored.email, "moosy@moosify.com");
    assert.strictEqual(stored.token, "demo-token");
    localStorage.removeItem(SESSION_KEY);
  });

  it("handleLogout clears session", () => {
    session = { email: "a@b.com", token: "x", user: { email: "a@b.com", name: "a" } };
    saveSession(session);
    handleLogout();
    assert.strictEqual(session, null);
    assert.strictEqual(localStorage.getItem(SESSION_KEY), null);
  });
});
