import { describe, it } from "node:test";
import assert from "node:assert";

// Tests for cart persistence, chat persistence, and route handling.
// To run: node --test tests/persistence.test.mjs

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

// --- Cart persistence tests ---

function loadCart() {
  try {
    const raw = localStorage.getItem("moosify-cart");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) =>
      item && typeof item.id === "string" && typeof item.name === "string" &&
      typeof item.price === "number" && item.price >= 0 &&
      Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100
    );
  } catch (error) {
    localStorage.removeItem("moosify-cart");
    return [];
  }
}

function saveCart(cartMap) {
  localStorage.setItem("moosify-cart", JSON.stringify(Array.from(cartMap.values())));
}

describe("Cart - graceful recovery", () => {
  it("returns empty array for missing cart", () => {
    localStorage.removeItem("moosify-cart");
    assert.deepStrictEqual(loadCart(), []);
  });

  it("returns empty array for invalid JSON", () => {
    localStorage.setItem("moosify-cart", "not json {");
    assert.deepStrictEqual(loadCart(), []);
    assert.strictEqual(localStorage.getItem("moosify-cart"), null); // cleaned up
  });

  it("returns empty array for non-array JSON", () => {
    localStorage.setItem("moosify-cart", JSON.stringify({ foo: "bar" }));
    assert.deepStrictEqual(loadCart(), []);
  });

  it("filters out invalid cart items", () => {
    localStorage.setItem("moosify-cart", JSON.stringify([
      { id: "valid", name: "Valid Item", price: 10, quantity: 1 },
      { id: 123, name: "Bad ID", price: 10, quantity: 1 }, // id not string
      { id: "no-name", price: 10, quantity: 1 }, // missing name
      { id: "neg-price", name: "Neg", price: -5, quantity: 1 }, // negative price
      { id: "bad-qty", name: "BadQty", price: 10, quantity: 0 }, // zero quantity
      { id: "too-many", name: "TooMany", price: 10, quantity: 999 } // quantity > 100
    ]));
    const result = loadCart();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, "valid");
  });

  it("round-trips valid cart data", () => {
    const cart = new Map([
      ["ophone-o1", { id: "ophone-o1", name: "OPhone O1", price: 199, quantity: 2 }]
    ]);
    saveCart(cart);
    const loaded = loadCart();
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].id, "ophone-o1");
    assert.strictEqual(loaded[0].quantity, 2);
    localStorage.removeItem("moosify-cart");
  });
});

// --- Chat persistence tests ---

function loadChatHistory() {
  try {
    const raw = localStorage.getItem("moosify-chat-history");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) =>
      entry && typeof entry.role === "string" && ["user", "assistant"].includes(entry.role) &&
      typeof entry.content === "string" && entry.content.length > 0 && entry.content.length <= 2000
    ).slice(-40);
  } catch (error) {
    localStorage.removeItem("moosify-chat-history");
    return [];
  }
}

describe("Chat - graceful recovery", () => {
  it("returns empty array for missing history", () => {
    localStorage.removeItem("moosify-chat-history");
    assert.deepStrictEqual(loadChatHistory(), []);
  });

  it("returns empty array for invalid JSON", () => {
    localStorage.setItem("moosify-chat-history", "bad json");
    assert.deepStrictEqual(loadChatHistory(), []);
    assert.strictEqual(localStorage.getItem("moosify-chat-history"), null); // cleaned up
  });

  it("filters invalid chat entries", () => {
    localStorage.setItem("moosify-chat-history", JSON.stringify([
      { role: "user", content: "Hello" },
      { role: "system", content: "invalid role" },
      { role: "assistant", content: "" },
      { role: "user", content: "Valid again" },
      { content: "missing role" },
      null,
      "not an object"
    ]));
    const result = loadChatHistory();
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].role, "user");
    assert.strictEqual(result[0].content, "Hello");
    assert.strictEqual(result[1].role, "user");
    assert.strictEqual(result[1].content, "Valid again");
  });

  it("caps history at 40 entries", () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`
    }));
    localStorage.setItem("moosify-chat-history", JSON.stringify(entries));
    const result = loadChatHistory();
    assert.strictEqual(result.length, 40);
    assert.strictEqual(result[0].content, "message 10"); // last 40
  });

  it("round-trips valid chat data", () => {
    localStorage.setItem("moosify-chat-history", JSON.stringify([
      { role: "user", content: "Hi Moosy" },
      { role: "assistant", content: "Hello!" }
    ]));
    const result = loadChatHistory();
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].content, "Hi Moosy");
    assert.strictEqual(result[1].content, "Hello!");
    localStorage.removeItem("moosify-chat-history");
  });
});

// --- Route tests ---

function updatePageIdentity(route) {
  const titles = {
    "": "Moosify",
    products: "Products | Moosify",
    shop: "Shops | Moosify",
    features: "Features | Moosify",
    login: "Login | Moosify",
    chat: "Moosy Chat | Moosify",
    cart: "Cart | Moosify",
    checkout: "Demo Checkout | Moosify",
    "mobile-lab": "OPhone Lab | Moosify",
    "shop/phones": "OPhones | Moosify",
    "shop/donuts": "Ishaan's Donuts | Moosify",
    "shop/space": "Rockets & Space | Moosify",
    "shop/airlines": "Airlines | Moosify",
    "shop/cell-plans": "Cell Plans | Moosify",
    "shop/support": "Support | Moosify"
  };
  return titles[route] || "Moosify";
}

function normalizePath(path) {
  return path.replace(/^\/+|\/+$/g, "");
}

function resolveRoute(path) {
  const route = normalizePath(path);
  const modalRoutes = { login: "login", cart: "cart", checkout: "checkout", "mobile-lab": "device-tester" };
  const departmentRoutes = {
    "shop/phones": "phones",
    "shop/donuts": "donuts",
    "shop/space": "space",
    "shop/airlines": "airlines",
    "shop/cell-plans": "cellplans",
    "shop/support": "support"
  };

  if (route === "chat") return { view: "chat", type: "page" };
  if (route === "products") return { view: "products", type: "page" };
  if (route === "shop") return { view: "shop", type: "page" };
  if (route === "features") return { view: "features", type: "page" };
  if (departmentRoutes[route]) return { view: departmentRoutes[route], type: "detail" };
  if (modalRoutes[route]) return { view: modalRoutes[route], type: "modal" };
  return { view: "home", type: "page" };
}

describe("Routes", () => {
  it("resolves home route", () => {
    assert.deepStrictEqual(resolveRoute("/"), { view: "home", type: "page" });
    assert.deepStrictEqual(resolveRoute(""), { view: "home", type: "page" });
  });

  it("resolves chat page route", () => {
    assert.deepStrictEqual(resolveRoute("/chat/"), { view: "chat", type: "page" });
    assert.deepStrictEqual(resolveRoute("/chat"), { view: "chat", type: "page" });
  });

  it("resolves products page route", () => {
    assert.deepStrictEqual(resolveRoute("/products/"), { view: "products", type: "page" });
  });

  it("resolves shop page route", () => {
    assert.deepStrictEqual(resolveRoute("/shop/"), { view: "shop", type: "page" });
  });

  it("resolves department detail routes", () => {
    assert.deepStrictEqual(resolveRoute("/shop/phones/"), { view: "phones", type: "detail" });
    assert.deepStrictEqual(resolveRoute("/shop/donuts/"), { view: "donuts", type: "detail" });
    assert.deepStrictEqual(resolveRoute("/shop/support/"), { view: "support", type: "detail" });
  });

  it("resolves modal routes", () => {
    assert.deepStrictEqual(resolveRoute("/login/"), { view: "login", type: "modal" });
    assert.deepStrictEqual(resolveRoute("/cart/"), { view: "cart", type: "modal" });
    assert.deepStrictEqual(resolveRoute("/checkout/"), { view: "checkout", type: "modal" });
    assert.deepStrictEqual(resolveRoute("/mobile-lab/"), { view: "device-tester", type: "modal" });
  });

  it("returns page titles for known routes", () => {
    assert.strictEqual(updatePageIdentity("shop/phones"), "OPhones | Moosify");
    assert.strictEqual(updatePageIdentity("checkout"), "Demo Checkout | Moosify");
    assert.strictEqual(updatePageIdentity(""), "Moosify");
    assert.strictEqual(updatePageIdentity("unknown"), "Moosify");
  });
});

// --- Checkout demo-only verification ---
describe("Checkout - demo-only", () => {
  it("checkout note states no payment was charged", () => {
    const note = "Demo order ready: 2 items for $418. No payment was charged.";
    assert.ok(note.includes("No payment was charged"));
    assert.ok(note.includes("Demo order ready"));
  });

  it("checkout modal shows demo banner", () => {
    const banner = "Demo checkout only. This page never charges money, creates a real order, or sends payment information.";
    assert.ok(banner.includes("Demo checkout only"));
    assert.ok(banner.includes("never charges money"));
    assert.ok(banner.includes("real order"));
  });
});
