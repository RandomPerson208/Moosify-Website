import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import worker from "../cloudflare-worker.js";
import { createFakeD1 } from "./helpers/d1.mjs";

const SECRET = "test-session-secret";
let ipCounter = 0;
let DB;
let env;

const b64url = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

function tokenFor(sub, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url({ email: `${sub}@moosify.com`, name: sub, sub, iat: now, exp: now + 3600, ...extra });
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function call(path, { method = "GET", token, body, rawBody } = {}, useEnv = env) {
  ipCounter += 1;
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  return worker.fetch(
    new Request(`https://api.example.com${path}`, {
      method,
      headers: {
        "cf-connecting-ip": `10.7.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload !== undefined ? { "Content-Type": "application/json" } : {})
      },
      body: payload
    }),
    useEnv,
    {}
  );
}

const phone = { id: "o1", name: "OPhone O1", price: 399, quantity: 2 };
const donut = { id: "donut-box", name: "Donut box", price: 12.5, quantity: 1 };

beforeEach(() => {
  DB = createFakeD1();
  env = { SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: "test-client-id", DB };
});

describe("Account routes need a login", () => {
  for (const [method, path] of [
    ["GET", "/api/me/data"],
    ["PUT", "/api/me/cart"],
    ["POST", "/api/me/chat"],
    ["DELETE", "/api/me/chat"],
    ["GET", "/api/orders"],
    ["POST", "/api/orders"],
    ["DELETE", "/api/me"]
  ]) {
    it(`${method} ${path} returns 401 without a token`, async () => {
      const resp = await call(path, { method, body: method === "GET" || method === "DELETE" ? undefined : {} });
      assert.strictEqual(resp.status, 401);
    });
  }

  it("rejects a forged token", async () => {
    const resp = await call("/api/me/data", { token: "a.b.c" });
    assert.strictEqual(resp.status, 401);
  });

  it("returns 503 when no database is bound", async () => {
    const resp = await call("/api/me/data", { token: tokenFor("ann") }, { SESSION_SECRET: SECRET });
    assert.strictEqual(resp.status, 503);
  });

  it("auth-status says whether saving is available", async () => {
    const on = await (await call("/api/auth-status", { token: tokenFor("ann") })).json();
    assert.strictEqual(on.persistence, true);
    const off = await (await call("/api/auth-status", { token: tokenFor("ann") }, { SESSION_SECRET: SECRET })).json();
    assert.strictEqual(off.persistence, false);
  });
});

describe("Saved cart", () => {
  it("starts empty, saves, and replaces the whole cart", async () => {
    const token = tokenFor("ann");
    assert.deepStrictEqual((await (await call("/api/me/data", { token })).json()).cart, []);

    let resp = await call("/api/me/cart", { method: "PUT", token, body: { items: [phone, donut] } });
    assert.strictEqual(resp.status, 200);
    assert.deepStrictEqual((await (await call("/api/me/data", { token })).json()).cart, [phone, donut]);

    resp = await call("/api/me/cart", { method: "PUT", token, body: { items: [donut] } });
    assert.strictEqual(resp.status, 200);
    assert.deepStrictEqual((await (await call("/api/me/data", { token })).json()).cart, [donut]);

    await call("/api/me/cart", { method: "PUT", token, body: { items: [] } });
    assert.deepStrictEqual((await (await call("/api/me/data", { token })).json()).cart, []);
  });

  it("keeps each user's cart separate", async () => {
    await call("/api/me/cart", { method: "PUT", token: tokenFor("ann"), body: { items: [phone] } });
    const bob = await (await call("/api/me/data", { token: tokenFor("bob") })).json();
    assert.deepStrictEqual(bob.cart, []);
  });

  it("rejects bad carts", async () => {
    const token = tokenFor("ann");
    const bad = [
      { items: "nope" },
      { items: [{ ...phone, quantity: 0 }] },
      { items: [{ ...phone, quantity: 1.5 }] },
      { items: [{ ...phone, quantity: 101 }] },
      { items: [{ ...phone, price: -1 }] },
      { items: [{ ...phone, price: "free" }] },
      { items: [{ ...phone, id: "" }] },
      { items: [phone, phone] },
      { items: Array.from({ length: 51 }, (_, i) => ({ ...phone, id: `p${i}` })) },
      {}
    ];
    for (const body of bad) {
      const resp = await call("/api/me/cart", { method: "PUT", token, body });
      assert.strictEqual(resp.status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.strictEqual((await call("/api/me/cart", { method: "PUT", token, rawBody: "{nope" })).status, 400);
    assert.deepStrictEqual((await (await call("/api/me/data", { token })).json()).cart, []);
  });
});

describe("Saved chat", () => {
  it("saves messages in order and restores them", async () => {
    const token = tokenFor("ann");
    const first = [{ role: "user", content: "hi" }, { role: "assistant", content: "Hey!" }];
    const second = [{ role: "user", content: "sell me a phone" }, { role: "assistant", content: "OPhone O1!" }];
    assert.strictEqual((await call("/api/me/chat", { method: "POST", token, body: { messages: first } })).status, 200);
    assert.strictEqual((await call("/api/me/chat", { method: "POST", token, body: { messages: second } })).status, 200);
    const data = await (await call("/api/me/data", { token })).json();
    assert.deepStrictEqual(data.chat, [...first, ...second]);
  });

  it("clear chat deletes only that user's messages", async () => {
    const msg = [{ role: "user", content: "hello" }];
    await call("/api/me/chat", { method: "POST", token: tokenFor("ann"), body: { messages: msg } });
    await call("/api/me/chat", { method: "POST", token: tokenFor("bob"), body: { messages: msg } });
    const resp = await call("/api/me/chat", { method: "DELETE", token: tokenFor("ann") });
    assert.strictEqual(resp.status, 200);
    assert.deepStrictEqual((await (await call("/api/me/data", { token: tokenFor("ann") })).json()).chat, []);
    assert.strictEqual((await (await call("/api/me/data", { token: tokenFor("bob") })).json()).chat.length, 1);
  });

  it("returns only the latest 40 and stores at most 200 per user", async () => {
    const token = tokenFor("ann");
    for (let batch = 0; batch < 22; batch++) {
      const messages = Array.from({ length: 10 }, (_, i) => ({ role: "user", content: `m${batch * 10 + i}` }));
      await call("/api/me/chat", { method: "POST", token, body: { messages } });
    }
    const { chat } = await (await call("/api/me/data", { token })).json();
    assert.strictEqual(chat.length, 40);
    assert.strictEqual(chat.at(-1).content, "m219");
    assert.strictEqual(DB.rows("SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = 'ann'")[0].n, 200);
  });

  it("rejects bad messages", async () => {
    const token = tokenFor("ann");
    const bad = [
      { messages: [] },
      { messages: [{ role: "system", content: "x" }] },
      { messages: [{ role: "user", content: "" }] },
      { messages: [{ role: "user", content: "x".repeat(2001) }] },
      { messages: Array.from({ length: 11 }, () => ({ role: "user", content: "x" })) },
      {}
    ];
    for (const body of bad) {
      const resp = await call("/api/me/chat", { method: "POST", token, body });
      assert.strictEqual(resp.status, 400, JSON.stringify(body).slice(0, 60));
    }
  });
});

describe("Orders", () => {
  it("places a demo order, clears the saved cart and lists it", async () => {
    const token = tokenFor("ann");
    await call("/api/me/cart", { method: "PUT", token, body: { items: [phone, donut] } });
    const resp = await call("/api/orders", { method: "POST", token, body: { items: [phone, donut] } });
    assert.strictEqual(resp.status, 201);
    const { order } = await resp.json();
    assert.strictEqual(order.total, 810.5);
    assert.ok(order.id > 0);

    assert.deepStrictEqual((await (await call("/api/me/data", { token })).json()).cart, []);
    const { orders } = await (await call("/api/orders", { token })).json();
    assert.strictEqual(orders.length, 1);
    assert.strictEqual(orders[0].id, order.id);
    assert.strictEqual(orders[0].total, 810.5);
    assert.deepStrictEqual(orders[0].items, [phone, donut]);
  });

  it("lists newest first and never shows another user's orders", async () => {
    await call("/api/orders", { method: "POST", token: tokenFor("ann"), body: { items: [phone] } });
    await call("/api/orders", { method: "POST", token: tokenFor("ann"), body: { items: [donut] } });
    await call("/api/orders", { method: "POST", token: tokenFor("bob"), body: { items: [donut] } });
    const ann = (await (await call("/api/orders", { token: tokenFor("ann") })).json()).orders;
    assert.strictEqual(ann.length, 2);
    assert.strictEqual(ann[0].items[0].id, "donut-box");
    assert.strictEqual((await (await call("/api/orders", { token: tokenFor("bob") })).json()).orders.length, 1);
  });

  it("keeps only the newest 100 orders per user", async () => {
    const token = tokenFor("ann");
    for (let i = 0; i < 103; i++) {
      await call("/api/orders", { method: "POST", token, body: { items: [{ ...donut, quantity: (i % 5) + 1 }] } });
    }
    assert.strictEqual(DB.rows("SELECT COUNT(*) AS n FROM orders WHERE user_id = 'ann'")[0].n, 100);
    const oldest = DB.rows("SELECT MIN(id) AS id FROM orders WHERE user_id = 'ann'")[0].id;
    assert.strictEqual(oldest, 4);
    await call("/api/orders", { method: "POST", token: tokenFor("bob"), body: { items: [donut] } });
    assert.strictEqual(DB.rows("SELECT COUNT(*) AS n FROM orders WHERE user_id = 'bob'")[0].n, 1);
  });

  it("rejects an empty or invalid order", async () => {
    const token = tokenFor("ann");
    assert.strictEqual((await call("/api/orders", { method: "POST", token, body: { items: [] } })).status, 400);
    assert.strictEqual((await call("/api/orders", { method: "POST", token, body: { items: [{ ...phone, price: -5 }] } })).status, 400);
    assert.strictEqual(DB.rows("SELECT COUNT(*) AS n FROM orders")[0].n, 0);
  });
});

describe("Delete account", () => {
  it("removes the user and all of their data, and nobody else's", async () => {
    for (const who of ["ann", "bob"]) {
      const token = tokenFor(who);
      await call("/api/me/cart", { method: "PUT", token, body: { items: [phone] } });
      await call("/api/me/chat", { method: "POST", token, body: { messages: [{ role: "user", content: "hi" }] } });
      await call("/api/orders", { method: "POST", token, body: { items: [donut] } });
    }
    await DB.prepare("INSERT INTO users (id, created_at, last_login_at) VALUES (?, 1, 1)").bind("ann").run();
    await DB.prepare("INSERT INTO users (id, created_at, last_login_at) VALUES (?, 1, 1)").bind("bob").run();

    const resp = await call("/api/me", { method: "DELETE", token: tokenFor("ann") });
    assert.strictEqual(resp.status, 200);
    for (const table of ["chat_messages", "cart_items", "orders"]) {
      assert.strictEqual(DB.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = 'ann'`)[0].n, 0, table);
    }
    assert.strictEqual(DB.rows("SELECT COUNT(*) AS n FROM users WHERE id = 'ann'")[0].n, 0);
    assert.strictEqual(DB.rows("SELECT COUNT(*) AS n FROM users WHERE id = 'bob'")[0].n, 1);
    assert.strictEqual(DB.rows("SELECT COUNT(*) AS n FROM orders WHERE user_id = 'bob'")[0].n, 1);
  });
});

describe("Login creates the user", () => {
  it("saves the Google account on login and updates it on the next one", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "acct-key", alg: "RS256", use: "sig" };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=3600" } });

    const googleToken = (name, overrides = {}) => {
      const now = Math.floor(Date.now() / 1000);
      const head = b64url({ alg: "RS256", kid: "acct-key", typ: "JWT" });
      const body = b64url({ iss: "https://accounts.google.com", aud: "test-client-id", sub: "g-123", email: "ann@moosify.com", name, picture: "https://img/a.png", exp: now + 3600, ...overrides });
      const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey, "base64url");
      return `${head}.${body}.${sig}`;
    };

    try {
      const resp = await call("/api/login", { method: "POST", body: { credential: googleToken("Ann") } });
      assert.strictEqual(resp.status, 200);
      const data = await resp.json();
      assert.strictEqual(data.persistence, true);
      let rows = DB.rows("SELECT * FROM users");
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].id, "g-123");
      assert.strictEqual(rows[0].name, "Ann");

      await call("/api/login", { method: "POST", body: { credential: googleToken("Ann Renamed") } });
      rows = DB.rows("SELECT * FROM users");
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].name, "Ann Renamed");

      // A correctly signed Google token with no expiry must be refused
      const noExp = await call("/api/login", { method: "POST", body: { credential: googleToken("Ann", { exp: undefined }) } });
      assert.strictEqual(noExp.status, 401);

      // The token we just got works on the account routes
      const me = await call("/api/me/data", { token: data.token });
      assert.strictEqual(me.status, 200);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("still logs in when the database is not bound", async () => {
    const resp = await call("/api/login", { method: "POST", body: { credential: "bad.token.here" } }, { SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: "x" });
    assert.strictEqual(resp.status, 401);
  });
});
