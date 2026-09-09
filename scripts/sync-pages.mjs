import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
const pages = {
  "404.html": "Moosify",
  "products/index.html": "Products | Moosify",
  "shop/index.html": "Shops | Moosify",
  "features/index.html": "Features | Moosify",
  "login/index.html": "Login | Moosify",
  "chat/index.html": "Moosy Chat | Moosify",
  "cart/index.html": "Cart | Moosify",
  "checkout/index.html": "Demo Checkout | Moosify",
  "mobile-lab/index.html": "OPhone Lab | Moosify",
  "shop/phones/index.html": "OPhones | Moosify",
  "shop/donuts/index.html": "Ishaan's Donuts | Moosify",
  "shop/space/index.html": "Rockets & Space | Moosify",
  "shop/airlines/index.html": "Airlines | Moosify",
  "shop/cell-plans/index.html": "Cell Plans | Moosify",
  "shop/support/index.html": "Support | Moosify"
};

for (const [relativePath, title] of Object.entries(pages)) {
  const output = new URL(`../${relativePath}`, import.meta.url);
  await mkdir(dirname(output.pathname), { recursive: true });
  const page = source.replace("<title>Moosify</title>", `<title>${title}</title>`);
  await writeFile(output, page);
}
