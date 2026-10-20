import { describe, it } from "node:test";
import assert from "node:assert";

// --- Auth gate tests (mirrors cloudflare-worker.js auth logic) ---
const PRODUCTION_ORIGIN = "https://moosify.pizzamonster.org";

function getAuthenticatedUser(request) {
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

function makeRequest(headers = {}) {
  return new Request("https://moosify.pizzamonster.org/api/moosy", {
    method: "POST",
    headers,
    body: JSON.stringify({ message: "hi" })
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": PRODUCTION_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// --- Auth tests ---
describe("Auth gate", () => {
  it("returns 401 without Access header", async () => {
    const req = makeRequest();
    const result = requireAuth(req, corsHeaders);
    assert.ok(result);
    assert.strictEqual(result.status, 401);
    const body = await result.json();
    assert.ok(body.error.includes("Authentication required"));
  });

  it("returns null with valid Access header", async () => {
    const req = makeRequest({
      "cf-access-authenticated-user-email": "moosy@moosify.com"
    });
    const result = requireAuth(req, corsHeaders);
    assert.strictEqual(result, null);
  });

  it("extracts user email from Access header", () => {
    const req = makeRequest({
      "cf-access-authenticated-user-email": "ishaan@moosify.com"
    });
    const user = getAuthenticatedUser(req);
    assert.deepStrictEqual(user, { email: "ishaan@moosify.com" });
  });

  it("returns null for missing email header", () => {
    const user = getAuthenticatedUser(makeRequest());
    assert.strictEqual(user, null);
  });

  it("includes CORS headers on 401", async () => {
    const req = makeRequest();
    const result = requireAuth(req, corsHeaders);
    assert.strictEqual(result.headers.get("access-control-allow-origin"), PRODUCTION_ORIGIN);
  });
});
