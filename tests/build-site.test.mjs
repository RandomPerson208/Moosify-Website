import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/build-site.mjs", import.meta.url));
let out;

function build(env = {}) {
  return spawnSync(process.execPath, [script], {
    env: { PATH: process.env.PATH, OUT_DIR: out, ...env },
    encoding: "utf8"
  });
}

function allFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? allFiles(join(dir, item.name), `${prefix}${item.name}/`) : [`${prefix}${item.name}`]
  );
}

describe("Static site build (Vercel)", () => {
  before(() => { out = mkdtempSync(join(tmpdir(), "moosify-site-")); });
  after(() => { rmSync(out, { recursive: true, force: true }); });

  it("fills in the Worker URL, chat status and Google client ID on every page", () => {
    const result = build({ API_URL: "https://api.example.com", CHAT_STATUS: "down", GOOGLE_CLIENT_ID: "abc.apps.googleusercontent.com" });
    assert.strictEqual(result.status, 0, result.stderr);
    for (const page of ["index.html", "404.html", "shop/phones/index.html", "chat/index.html", "checkout/index.html"]) {
      const html = readFileSync(join(out, page), "utf8");
      assert.match(html, /apiUrl: "https:\/\/api\.example\.com"/, page);
      assert.match(html, /chatStatus: "down"/, page);
      assert.match(html, /googleClientId: "abc\.apps\.googleusercontent\.com"/, page);
      assert.doesNotMatch(html, /__[A-Z_]+_PLACEHOLDER__/, page);
    }
  });

  it("defaults chat to up and leaves login and API empty when nothing is set", () => {
    const result = build();
    assert.strictEqual(result.status, 0, result.stderr);
    const html = readFileSync(join(out, "index.html"), "utf8");
    assert.match(html, /chatStatus: "up"/);
    assert.match(html, /apiUrl: ""/);
    assert.match(html, /googleClientId: ""/);
  });

  it("includes every page route and the shared assets", () => {
    build({ API_URL: "https://api.example.com" });
    for (const file of [
      "index.html", "404.html", "google0dc127fce4c14c1e.html", "assets/moosify.js", "assets/moosify.css",
      "login/index.html", "chat/index.html", "cart/index.html", "checkout/index.html", "products/index.html",
      "shop/index.html", "features/index.html", "mobile-lab/index.html", "shop/phones/index.html"
    ]) {
      assert.ok(existsSync(join(out, file)), file);
    }
  });

  it("never publishes source code, tests, secrets or config", () => {
    build({ API_URL: "https://api.example.com" });
    const files = allFiles(out);
    const forbidden = /(^|\/)(\.env|\.git|node_modules|tests|migrations|scripts|server\.mjs|cloudflare-worker\.js|accounts\.js|moosy-prompt\.js|wrangler\.toml|package(-lock)?\.json|vercel\.json|\.DS_Store)(\/|$)/;
    assert.deepStrictEqual(files.filter((file) => forbidden.test(file)), []);
  });

  it("fails a production deploy that has no API_URL, but only warns elsewhere", () => {
    const production = build({ VERCEL_ENV: "production" });
    assert.notStrictEqual(production.status, 0);
    assert.match(production.stderr, /API_URL is not set/);
    const preview = build({ VERCEL_ENV: "preview" });
    assert.strictEqual(preview.status, 0, preview.stderr);
    const ok = build({ VERCEL_ENV: "production", API_URL: "https://api.example.com" });
    assert.strictEqual(ok.status, 0, ok.stderr);
  });
});
