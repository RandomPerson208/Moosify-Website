// A tiny stand-in for a Cloudflare D1 binding, backed by Node's built-in SQLite,
// so tests can run the real SQL in migrations/ without a Cloudflare account.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));

export function createFakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(migrationsDir + file, "utf8"));
  }

  function statement(sql, params = []) {
    return {
      bind: (...values) => statement(sql, values),
      async run() {
        const info = db.prepare(sql).run(...params);
        return { success: true, meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
      },
      async all() {
        return { results: db.prepare(sql).all(...params).map((row) => ({ ...row })), success: true };
      },
      async first() {
        const row = db.prepare(sql).get(...params);
        return row ? { ...row } : null;
      }
    };
  }

  return {
    prepare: (sql) => statement(sql),
    // Like D1, a batch is one transaction: all statements apply or none do.
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    // test-only helper
    rows: (sql, ...params) => db.prepare(sql).all(...params).map((row) => ({ ...row }))
  };
}
