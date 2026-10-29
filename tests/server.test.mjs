import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Starts the real local server (server.mjs) and talks to it over HTTP.
const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));
const port = 4300 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
let child;

function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [serverPath], {
      env: { PATH: process.env.PATH, PORT: String(port), ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    proc.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Moosify running")) resolve(proc);
    });
    proc.on("exit", (code) => reject(new Error(`server.mjs exited with ${code}: ${stderr}`)));
  });
}

describe("Local server", () => {
  before(async () => {
    child = await startServer();
  });

  after(() => {
    child?.kill();
  });

  it("serves the home page and shop pages", async () => {
    for (const path of ["/", "/shop/phones/", "/assets/moosify.js"]) {
      const resp = await fetch(`${base}${path}`);
      assert.strictEqual(resp.status, 200, path);
    }
  });

  it("never serves secrets or source files", async () => {
    for (const path of ["/.env", "/.git/HEAD", "/server.mjs", "/package.json", "/node_modules/dotenv/package.json", "/tests/server.test.mjs"]) {
      const resp = await fetch(`${base}${path}`);
      assert.strictEqual(resp.status, 404, path);
    }
  });

  it("answers chat with a flagged fallback when no AI keys are set", async () => {
    const resp = await fetch(`${base}/api/moosy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi" })
    });
    assert.strictEqual(resp.status, 200);
    const data = await resp.json();
    assert.ok(data.reply);
    assert.strictEqual(data.fallback, true);
  });

  it("returns 400 for invalid JSON instead of crashing", async () => {
    const resp = await fetch(`${base}/api/moosy`, { method: "POST", body: "{nope" });
    assert.strictEqual(resp.status, 400);
    const health = await fetch(`${base}/`);
    assert.strictEqual(health.status, 200);
  });
});
