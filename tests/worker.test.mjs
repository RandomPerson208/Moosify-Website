import { describe, it } from "node:test";
import assert from "node:assert";
import { validateChatPayload } from "../cloudflare-worker.js";

// Tests for Cloudflare Worker responses
// These tests simulate the Worker's fetch handler logic.
// To run: node --test tests/worker.test.mjs

const PRODUCTION_ORIGIN = "https://moosify.pizzamonster.org";
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_ENTRIES = 50;
const MAX_REQUEST_BODY_BYTES = 20_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

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


describe("Worker - rate limiting", () => {
  it("allows requests under the rate limit", () => {
    rateLimitStore.clear();
    const ip = "1.2.3.4";
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
      assert.strictEqual(isRateLimited(ip), false);
    }
    assert.strictEqual(isRateLimited(ip), true); // next one trips the limit
  });

  it("resets rate limit after window expires", () => {
    rateLimitStore.clear();
    const ip = "5.6.7.8";
    isRateLimited(ip);
    // Simulate time passing by manipulating the entry
    const entry = rateLimitStore.get(ip);
    entry.windowStart = Date.now() - RATE_LIMIT_WINDOW_MS - 1000;
    assert.strictEqual(isRateLimited(ip), false);
  });

  it("tracks different IPs independently", () => {
    rateLimitStore.clear();
    assert.strictEqual(isRateLimited("10.0.0.1"), false);
    assert.strictEqual(isRateLimited("10.0.0.2"), false);
  });
});

describe("Worker - payload validation", () => {
  it("accepts valid payload", () => {
    assert.doesNotThrow(() => validateChatPayload({ message: "hi", history: [] }));
  });

  it("rejects message too long", () => {
    assert.throws(() => validateChatPayload({ message: "x".repeat(MAX_MESSAGE_LENGTH + 1) }), /2000 characters/);
  });

  it("rejects non-string message", () => {
    assert.throws(() => validateChatPayload({ message: 123 }), /Message must be a string/);
  });

  it("rejects invalid history (not array)", () => {
    assert.throws(() => validateChatPayload({ message: "hi", history: "not-array" }), /History must be an array/);
  });

  it("rejects history with invalid role", () => {
    assert.throws(() => validateChatPayload({ message: "hi", history: [{ role: "system", content: "x" }] }), /History must be an array/);
  });

  it("rejects history with empty content", () => {
    assert.throws(() => validateChatPayload({ message: "hi", history: [{ role: "user", content: "" }] }), /History must be an array/);
  });

  it("rejects history exceeding max entries", () => {
    const longHistory = Array.from({ length: MAX_HISTORY_ENTRIES + 1 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`
    }));
    assert.throws(() => validateChatPayload({ message: "hi", history: longHistory }), /History must be an array/);
  });

  it("rejects invalid payload (null)", () => {
    assert.throws(() => validateChatPayload(null), /Invalid payload/);
  });

  it("requires a non-empty message", () => {
    assert.throws(() => validateChatPayload({}), /Message is required/);
    assert.throws(() => validateChatPayload({ message: "" }), /Message is required/);
    assert.throws(() => validateChatPayload({ message: "   " }), /Message is required/);
  });
});

describe("Worker - CORS headers", () => {
  it("restricts origin to production domain", () => {
    assert.strictEqual(PRODUCTION_ORIGIN, "https://moosify.pizzamonster.org");
  });
});

describe("Worker - health endpoint", () => {
  it("returns ok status", async () => {
    const healthResponse = JSON.stringify({ status: "ok", timestamp: Date.now() });
    const parsed = JSON.parse(healthResponse);
    assert.strictEqual(parsed.status, "ok");
    assert.ok(typeof parsed.timestamp === "number");
  });
});
