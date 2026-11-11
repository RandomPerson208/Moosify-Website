// Account data for logged-in users, stored in Cloudflare D1 (the DB binding).
// Every function here takes the already-verified session user, so a request can
// only ever touch rows that belong to its own Google account id.

const MAX_CHAT_ROWS = 200;
const MAX_CHAT_RETURNED = 40;
const MAX_CHAT_BATCH = 10;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_CART_ITEMS = 50;
const MAX_ORDERS_RETURNED = 50;
const MAX_ORDERS_STORED = 100;

function ok(body, status = 200) {
  return { status, body };
}

function fail(status, error) {
  return { status, body: { error } };
}

export async function upsertUser(env, user) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, picture, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture = excluded.picture,
       last_login_at = excluded.last_login_at`
  ).bind(user.sub, user.email ?? null, user.name ?? null, user.picture ?? null, now, now).run();
}

function validateCartItems(items, { allowEmpty }) {
  if (!Array.isArray(items) || items.length > MAX_CART_ITEMS) return null;
  if (!allowEmpty && items.length === 0) return null;
  const seen = new Set();
  const clean = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const { id, name, price, quantity } = item;
    if (typeof id !== "string" || id.length === 0 || id.length > 64 || seen.has(id)) return null;
    if (typeof name !== "string" || name.length === 0 || name.length > 120) return null;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 10_000_000) return null;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return null;
    seen.add(id);
    clean.push({ id, name, price, quantity });
  }
  return clean;
}

function validateChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_CHAT_BATCH) return null;
  const clean = [];
  for (const entry of messages) {
    if (!entry || typeof entry !== "object") return null;
    if (entry.role !== "user" && entry.role !== "assistant") return null;
    if (typeof entry.content !== "string" || entry.content.length === 0 || entry.content.length > MAX_MESSAGE_LENGTH) return null;
    clean.push({ role: entry.role, content: entry.content });
  }
  return clean;
}

async function loadCart(env, userId) {
  const { results } = await env.DB.prepare(
    "SELECT product_id AS id, name, price, quantity FROM cart_items WHERE user_id = ? ORDER BY rowid"
  ).bind(userId).all();
  return results;
}

async function loadChat(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT role, content FROM (
       SELECT id, role, content FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ${MAX_CHAT_RETURNED}
     ) ORDER BY id ASC`
  ).bind(userId).all();
  return results;
}

function cartStatements(env, userId, items) {
  const statements = [env.DB.prepare("DELETE FROM cart_items WHERE user_id = ?").bind(userId)];
  for (const item of items) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO cart_items (user_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)"
      ).bind(userId, item.id, item.name, item.price, item.quantity)
    );
  }
  return statements;
}

// Returns { status, body } for account routes, or null when the path is not one of ours.
export async function handleAccountRoute({ request, env, pathname, user, readBody }) {
  const { method } = request;
  const isAccountPath = pathname === "/api/me" || pathname.startsWith("/api/me/") || pathname === "/api/orders";
  if (!isAccountPath) return null;
  if (!env.DB) return fail(503, "Saved accounts are not set up on this server");
  if (!user?.sub) return fail(401, "Authentication required. Please log in.");
  const userId = user.sub;

  if (method === "GET" && pathname === "/api/me/data") {
    const [chat, cart] = await Promise.all([loadChat(env, userId), loadCart(env, userId)]);
    return ok({ chat, cart });
  }

  if (method === "PUT" && pathname === "/api/me/cart") {
    let items;
    try {
      items = validateCartItems((await readBody(request))?.items, { allowEmpty: true });
    } catch (e) {
      return fail(400, e.message);
    }
    if (!items) return fail(400, "Cart must be a list of up to 50 items with id, name, price and quantity");
    await env.DB.batch(cartStatements(env, userId, items));
    return ok({ cart: items });
  }

  if (method === "POST" && pathname === "/api/me/chat") {
    let messages;
    try {
      messages = validateChatMessages((await readBody(request))?.messages);
    } catch (e) {
      return fail(400, e.message);
    }
    if (!messages) return fail(400, "Messages must be 1-10 entries of {role, content}");
    const now = Date.now();
    const statements = messages.map((m) =>
      env.DB.prepare("INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)")
        .bind(userId, m.role, m.content, now)
    );
    // Keep only the most recent rows so one account cannot grow without limit.
    statements.push(
      env.DB.prepare(
        `DELETE FROM chat_messages WHERE user_id = ? AND id NOT IN (
           SELECT id FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ${MAX_CHAT_ROWS}
         )`
      ).bind(userId, userId)
    );
    await env.DB.batch(statements);
    return ok({ saved: messages.length });
  }

  if (method === "DELETE" && pathname === "/api/me/chat") {
    await env.DB.prepare("DELETE FROM chat_messages WHERE user_id = ?").bind(userId).run();
    return ok({ cleared: true });
  }

  if (method === "GET" && pathname === "/api/orders") {
    const { results } = await env.DB.prepare(
      `SELECT id, total_cents, items_json, created_at FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ${MAX_ORDERS_RETURNED}`
    ).bind(userId).all();
    return ok({
      orders: results.map((row) => ({
        id: row.id,
        total: row.total_cents / 100,
        items: JSON.parse(row.items_json),
        createdAt: row.created_at
      }))
    });
  }

  if (method === "POST" && pathname === "/api/orders") {
    let items;
    try {
      items = validateCartItems((await readBody(request))?.items, { allowEmpty: false });
    } catch (e) {
      return fail(400, e.message);
    }
    if (!items) return fail(400, "An order needs 1-50 items with id, name, price and quantity");
    const totalCents = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO orders (user_id, total_cents, items_json, created_at) VALUES (?, ?, ?, ?)")
        .bind(userId, totalCents, JSON.stringify(items), Date.now()),
      env.DB.prepare("DELETE FROM cart_items WHERE user_id = ?").bind(userId),
      // Keep only the newest orders so one account cannot grow without limit.
      env.DB.prepare(
        `DELETE FROM orders WHERE user_id = ? AND id NOT IN (
           SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ${MAX_ORDERS_STORED}
         )`
      ).bind(userId, userId)
    ]);
    return ok({ order: { id: results[0].meta.last_row_id, total: totalCents / 100, items } }, 201);
  }

  if (method === "DELETE" && pathname === "/api/me") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM chat_messages WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM cart_items WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM orders WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId)
    ]);
    return ok({ deleted: true });
  }

  return null;
}
