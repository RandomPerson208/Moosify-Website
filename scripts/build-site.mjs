// Builds the static website into dist/ (or OUT_DIR) for Vercel.
// It copies only the public site files (never tests, server code, node_modules or
// secrets) and fills in the three settings the pages need:
//   apiUrl           - the Worker address that answers chat and logins
//   chatStatus       - "up" (default) or "down"
//   googleClientId   - turns Google sign-in on when set
// Defaults for the first two come from scripts/site-config.json (both values are
// public: they are already visible in the page). Environment variables override them:
// API_URL, GOOGLE_CLIENT_ID and CHAT_STATUS, the same names the Pages workflow used.
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = process.env.OUT_DIR ? process.env.OUT_DIR : join(root, "dist");

const publicEntries = [
  "index.html", "404.html", "google0dc127fce4c14c1e.html",
  "art.png", "download.png", "moosy-ceo-cutout.png",
  "assets", "Ophones", "products", "shop", "features", "login", "chat", "cart", "checkout", "mobile-lab"
];

const defaults = JSON.parse(await readFile(join(root, "scripts", "site-config.json"), "utf8"));
const apiUrl = (process.env.API_URL || defaults.apiUrl || "").trim();
const chatStatus = (process.env.CHAT_STATUS || "up").trim() || "up";
const googleClientId = (process.env.GOOGLE_CLIENT_ID || defaults.googleClientId || "").trim();

// A production site without a backend address would quietly lose its AI chat and
// login, so stop the deploy instead of shipping it.
if (process.env.VERCEL_ENV === "production" && !apiUrl) {
  console.error("ERROR: no API address. Set apiUrl in scripts/site-config.json or API_URL in Vercel.");
  process.exit(1);
}
if (!apiUrl) console.warn("Warning: no API address, so chat will use the local guide.");
if (!googleClientId) console.warn("Warning: no Google client ID, so Google sign-in will be off.");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
for (const entry of publicEntries) {
  const from = join(root, entry);
  if (!existsSync(from)) throw new Error(`Missing site file or folder: ${entry}`);
  await cp(from, join(outDir, entry), { recursive: true, filter: (src) => !src.endsWith(".DS_Store") });
}

async function* htmlFiles(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) yield* htmlFiles(path);
    else if (item.name.endsWith(".html")) yield path;
  }
}

let patched = 0;
for await (const file of htmlFiles(outDir)) {
  const html = await readFile(file, "utf8");
  const next = html
    .replaceAll('"__API_URL_PLACEHOLDER__"', JSON.stringify(apiUrl))
    .replaceAll('"__CHAT_STATUS_PLACEHOLDER__"', JSON.stringify(chatStatus))
    .replaceAll('"__GOOGLE_CLIENT_ID_PLACEHOLDER__"', JSON.stringify(googleClientId));
  if (next !== html) {
    await writeFile(file, next);
    patched += 1;
  }
}
console.log(`Built site into ${outDir} (${patched} pages configured).`);
