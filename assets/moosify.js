const services = {
  phones: {
    title: "Orange Phone Shop",
    copy: "Browse bright orange phones, matching cases, and friendly setup help. Moosify partnered with Orange for OPhone sales, setup, and service. Open the online phone trial before checkout to try apps and see each model's real limitations.",
    image: "url('https://images.pexels.com/photos/11297769/pexels-photo-11297769.jpeg?auto=compress&cs=tinysrgb&w=1400')",
    products: [
      { id: "ophone-o1", name: "OPhone O1", description: "Classic Orange-partnered phone supporting PineappleOS 1 through 3.", price: 199 },
      { id: "ophone-o2", name: "OPhone O2", description: "Compact OPhone with Orange setup and pocket-sized power.", price: 249 },
      { id: "ophone-o3", name: "OPhone O3", description: "Daily driver OPhone with an online camera and app trial.", price: 299 },
      { id: "ophone-o4", name: "OPhone O4", description: "Wide-screen OPhone with Orange setup and three PineappleOS releases.", price: 349 },
      { id: "ophone-o5", name: "OPhone O5", description: "Creator OPhone tuned for photos, video, and cloud sync.", price: 449 },
      { id: "ophone-o6", name: "OPhone O6", description: "Top OPhone model supporting PineappleOS 6 through 8.", price: 599 }
    ]
  },
  donuts: {
    title: "Ishaan's Donuts",
    copy: "Order glazed classics, rainbow sprinkles, and the Triple Chocolate Shelf Special. The form is intentionally simple because donuts should not require a committee.",
    image: "url('https://images.pexels.com/photos/1191639/pexels-photo-1191639.jpeg?auto=compress&cs=tinysrgb&w=1400')",
    products: [
      { id: "donut-sprinkle", name: "Rainbow Sprinkle Box", description: "Six soft donuts for the whole playarea.", price: 18 },
      { id: "donut-chocolate", name: "Triple Chocolate Stack", description: "Rich chocolate donuts for serious snack missions.", price: 22 },
      { id: "donut-party", name: "Shelf Party Dozen", description: "Twelve assorted donuts with extra napkins.", price: 34 }
    ]
  },
  space: {
    title: "Moosa Rockets & Space",
    copy: "Schedule an imaginary launch, pick an orbit, and get a mission briefing for the bravest plush passengers in the galaxy.",
    image: "url('https://images.pexels.com/photos/11086520/pexels-photo-11086520.jpeg?auto=compress&cs=tinysrgb&w=1400')",
    products: [
      { id: "space-seat", name: "Plush Orbit Seat", description: "One pretend launch seat with mission badge.", price: 79 },
      { id: "space-family", name: "Family Launch Pack", description: "Four passenger seats and a shelf-side countdown.", price: 249 },
      { id: "space-mars", name: "Mars Picnic Mission", description: "A full imaginary trip with snack cargo.", price: 399 }
    ]
  },
  airlines: {
    title: "Moosify Airlines",
    copy: "Book cloud-soft routes with snack service, cozy seats, and a tiny co-pilot for every passenger. Destinations include everywhere the shelf can imagine.",
    image: "url('https://images.pexels.com/photos/8230826/pexels-photo-8230826.jpeg?auto=compress&cs=tinysrgb&w=1400')",
    products: [
      { id: "air-cloud", name: "Cloud Hopper Ticket", description: "One cozy round-trip pretend flight.", price: 59 },
      { id: "air-snack", name: "Snack Class Upgrade", description: "Extra legroom, juice box, and plush blanket.", price: 29 },
      { id: "air-world", name: "World Tour Pass", description: "A full playroom itinerary with souvenir sticker.", price: 149 }
    ]
  },
  cellplans: {
    title: "Moosify Cell Plans",
    copy: "Compare unlimited talk, text, and data options with a plan family that keeps the copy readable and the pricing imaginary.",
    image: "url('https://images.pexels.com/photos/18379732/pexels-photo-18379732.jpeg?auto=compress&cs=tinysrgb&w=1400')",
    products: [
      { id: "cell-tiny", name: "Tiny Text Plan", description: "Calls, texts, and tiny messages for one plush.", price: 12 },
      { id: "cell-unlimited", name: "Unlimited Moose 5G", description: "Unlimited data for memes, maps, and shelf calls.", price: 35 },
      { id: "cell-family", name: "Playroom Family Plan", description: "Five lines, shared data, and free setup.", price: 89 }
    ]
  },
  support: {
    title: "Moosify Support",
    copy: "Get help with orders, account questions, plans, and anything else that needs a calm answer from the friendliest desk in the company.",
    image: "url('moosy-ceo-cutout.png')",
    products: [
      { id: "support-quick", name: "Quick Help Ticket", description: "A friendly answer for one small question.", price: 5 },
      { id: "support-setup", name: "Shelf Setup Session", description: "Help setting up phones, plans, or donut orders.", price: 25 },
      { id: "support-vip", name: "Moosy VIP Support", description: "Priority support with extra cheerful updates.", price: 49 }
    ]
  }
};

const moosifyConfig = window.MOOSIFY_CONFIG || {};
const CURRENT_CHAT_STATUS = moosifyConfig.chatStatus || "up";
const API_URL = moosifyConfig.apiUrl || "";
const homeView = document.querySelector('[data-view="home"]');
const detailView = document.querySelector('[data-view="detail"]');
const chatView = document.querySelector('[data-view="chat"]');
const productsView = document.querySelector('[data-view="products"]');
const shopView = document.querySelector('[data-view="shop"]');
const featuresView = document.querySelector('[data-view="features"]');
const primaryViews = [homeView, detailView, chatView, productsView, shopView, featuresView];
const detailTitle = document.querySelector('[data-detail-title]');
const detailCopy = document.querySelector('[data-detail-copy]');
const detailVisual = document.querySelector('[data-detail-visual]');
const productList = document.querySelector("[data-product-list]");
const chatLog = document.querySelector('[data-chat-log]');
const aiStatus = document.querySelector("[data-ai-status]");
let savedChatHistory = [];
try {
  savedChatHistory = JSON.parse(localStorage.getItem("moosify-chat-history") || "[]");
} catch (error) {
  savedChatHistory = [];
}
const chatHistory = Array.isArray(savedChatHistory) ? savedChatHistory.slice(-40) : [];
const pageChatLog = document.querySelector('[data-chat-log-page]');
const pageAiStatus = document.querySelector('[data-ai-status-page]');
let savedCart = [];
try {
  savedCart = JSON.parse(localStorage.getItem("moosify-cart") || "[]");
} catch (error) {
  savedCart = [];
}
const cart = new Map(savedCart.map((item) => [item.id, item]));
let activeServiceKey = "phones";
const ophoneModels = [
  { id: "O1", name: "OPhone O1", front: "Ophones/O1/O1 Front.jpg", back: "Ophones/O1/O1 Back.jpg", note: "starter model", osIds: ["pineappleos-1", "pineappleos-2", "pineappleos-3"] },
  { id: "O2", name: "OPhone O2", front: "Ophones/O2/O2 Front.jpg", back: "Ophones/O2/O2 Back.jpg", note: "compact model", osIds: ["pineappleos-2", "pineappleos-3", "pineappleos-4"] },
  { id: "O3", name: "OPhone O3", front: "Ophones/O3/O3 Front.jpg", back: "Ophones/O3/O3 Back.jpg", note: "daily driver", osIds: ["pineappleos-3", "pineappleos-4", "pineappleos-5"] },
  { id: "O4", name: "OPhone O4", front: "Ophones/O4/O4 Front.jpg", back: "Ophones/O4/SCN20250513171658543.jpg", note: "wide-screen model", osIds: ["pineappleos-4", "pineappleos-5", "pineappleos-6"] },
  { id: "O5", name: "OPhone O5", front: "Ophones/O5/O5 Front.jpg", back: "Ophones/O5/O5 Back.jpg", note: "creator model", osIds: ["pineappleos-5", "pineappleos-6", "pineappleos-7"] },
  { id: "O6", name: "OPhone O6", front: "Ophones/O6/O6 Front.jpg", back: "Ophones/O6/O6 Back.jpg", note: "flagship model", osIds: ["pineappleos-6", "pineappleos-7", "pineappleos-8"] }
];
const ophoneOSes = [
  { id: "pineappleos-1", name: "PineappleOS 1" },
  { id: "pineappleos-2", name: "PineappleOS 2" },
  { id: "pineappleos-3", name: "PineappleOS 3" },
  { id: "pineappleos-4", name: "PineappleOS 4" },
  { id: "pineappleos-5", name: "PineappleOS 5" },
  { id: "pineappleos-6", name: "PineappleOS 6" },
  { id: "pineappleos-7", name: "PineappleOS 7" },
  { id: "pineappleos-8", name: "PineappleOS 8" }
];
const ophoneTrialApps = [
  { id: "home", name: "Home screen", badge: "HOME" },
  { id: "camera", name: "Camera", badge: "CAM" },
  { id: "calls", name: "Orange Calls", badge: "CALL" },
  { id: "store", name: "Moosify Store", badge: "SHOP" },
  { id: "game", name: "Cloud Game", badge: "PLAY" },
  { id: "settings", name: "Settings", badge: "OS" }
];
const ophoneTrialProblems = {
  O1: {
    camera: ["watch", "The camera works, but low-light photos look grainy."],
    calls: ["limited", "Calls work on Orange 4G. This model does not have 5G hardware."],
    game: ["limited", "Cloud Game runs only on low graphics and may stutter in busy scenes."],
    settings: ["watch", "Storage settings take a few seconds to open on PineappleOS 3."]
  },
  O2: {
    camera: ["watch", "The camera opens slowly on PineappleOS 4, then works normally."],
    game: ["watch", "Cloud Game is playable on medium graphics, but frame rate can dip."],
    settings: ["watch", "The battery page can briefly freeze after an OS update."]
  },
  O3: {
    calls: ["watch", "Orange 5G may need one airplane-mode toggle after changing SIMs."],
    store: ["watch", "The Store may need a refresh after updating to PineappleOS 5."],
    game: ["watch", "Long game sessions drain the battery quickly."]
  },
  O4: {
    home: ["watch", "Home animations are less smooth on PineappleOS 6."],
    camera: ["watch", "The wide camera preview crops a little near the edges."],
    settings: ["watch", "The storage chart takes a moment to draw."]
  },
  O5: {
    calls: ["watch", "Orange eSIM setup needs one restart before 5G appears."],
    game: ["watch", "Cloud Game runs smoothly, but the phone gets warm during long sessions."],
    settings: ["watch", "PineappleOS 7 uses more battery with the always-on display enabled."]
  },
  O6: {
    camera: ["watch", "Portrait preview can blur fine hair against a bright background."],
    store: ["watch", "Large app downloads pause when battery saver is on."],
    settings: ["watch", "The battery graph may load slowly on PineappleOS 8."]
  }
};
// Chat status: if set to "down" disable chat UI
if (CURRENT_CHAT_STATUS === "down") {
    const chatForm = document.querySelector("[data-chat-form]");
    if (chatForm) {
        chatForm.querySelectorAll("input, button").forEach(el => el.disabled = true);
        const note = document.createElement("div");
        note.textContent = "Our help desk chat is currently offline for testing. Check back soon!";
        note.className = "text-center text-red-600 mt-4";
        chatForm.parentElement.appendChild(note);
    }
}

const moosyPersonality = [
  "You are Moosy, the stuffed moose CEO and conversational friend of Moosify.",
  "You are playful, curious, warm, and naturally conversational. Talk like a real chat companion: react to what the person says, share opinions, tell jokes, ask a natural follow-up sometimes, and do not turn every message into a sales pitch.",
  "You love baking moose-shaped pizzas with olives, making chocolate-filled mooskie cookies with sprinkles, cooking dal makhani, telling jokes, having unlimited money and superpowers, and traveling to imaginary lands.",
  "Family lore: Ishaan is your kid, and Little Moosy is also your kid. Little Moosy is kind of crazy, Ishaan is annoying, and when the kids cause trouble you let them be. If Ishaan is annoying, you may jokingly say, 'Why would you do that, you bubba bubbling idiot?' You love pizza, chocolate milk, and knocking over Moosify camera equipment. Keep this playful and fictional.",
  "Birthday lore: your birthday is July 23rd, Ishaan's birthday is September 1st, and Little Moosy's birthday is unknown. Never invent Little Moosy's birthday.",
  "Shopping advice is optional: discuss products, prices, carts, or checkout only when the person asks. Customer support is a separate Moosify department; direct explicit support requests to the support area instead of pretending to be a help-desk bot.",
  "Never claim an order or payment is real. Never ask for passwords, card numbers, or private secrets.",
  "Keep replies natural and concise, usually one to four sentences. Never say you are a real animal."
].join(" ");

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function hidePrimaryViews() {
  primaryViews.forEach((view) => {
    if (view) view.hidden = true;
  });
}

function renderRoutePages() {
  const allProducts = document.querySelector("[data-all-products]");
  const shopGrid = document.querySelector("[data-shop-grid]");
  const iconNames = { phones: "smartphone", donuts: "circle-dot", space: "rocket", airlines: "plane", cellplans: "radio-tower", support: "headphones" };

  allProducts.innerHTML = Object.entries(services).map(([serviceKey, service]) => `
    <section class="catalog-group">
      <h2 class="brand-font">${service.title}</h2>
      ${service.products.map((product) => `
        <article class="product-row">
          <div><h3>${product.name}</h3><p>${product.description}</p><span class="product-price">${formatMoney(product.price)}</span></div>
          <button class="button orange" type="button" data-add-product="${product.id}"><i class="icon" data-lucide="plus"></i>Add</button>
        </article>
      `).join("")}
    </section>
  `).join("");

  const servicePaths = { phones: "phones", donuts: "donuts", space: "space", airlines: "airlines", cellplans: "cell-plans", support: "support" };
  shopGrid.innerHTML = Object.entries(services).map(([serviceKey, service]) => {
    const image = service.image.replace(/^url\(['"]?|['"]?\)$/g, "");
    return `
      <a class="service-card" href="/shop/${servicePaths[serviceKey]}/">
        <img class="service-photo${serviceKey === "support" ? " mascot-photo" : ""}" src="${image}" alt="${service.title}">
        <span class="service-content">
          <span class="service-icon"><i class="icon" data-lucide="${iconNames[serviceKey]}"></i></span>
          <h3>${service.title}</h3>
          <p>${service.copy}</p>
          <span class="learn-more">Open shop <i class="icon" data-lucide="arrow-right"></i></span>
        </span>
      </a>
    `;
  }).join("");
}

function renderSavedChat() {
  if (!pageChatLog || chatHistory.length === 0) return;
  pageChatLog.innerHTML = '<div class="message">Moosy: Hey, I’m Moosy. What are you thinking about today?</div>';
  chatHistory.forEach((entry) => {
    const bubble = document.createElement("div");
    bubble.className = entry.role === "user" ? "message user" : "message";
    bubble.textContent = `${entry.role === "user" ? "You" : "Moosy"}: ${entry.content}`;
    pageChatLog.appendChild(bubble);
  });
  pageChatLog.scrollTop = pageChatLog.scrollHeight;
}

function saveChatHistory() {
  localStorage.setItem("moosify-chat-history", JSON.stringify(chatHistory.slice(-40)));
}

function openService(key) {
  const service = services[key];
  if (!service) return;
  activeServiceKey = key;
  detailTitle.textContent = service.title;
  detailCopy.innerHTML = service.copy;
  detailVisual.style.setProperty("--detail-image", service.image);
  renderProducts(service.products);
  closeModals();
  hidePrimaryViews();
  detailView.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  refreshIcons();
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function findProduct(id) {
  for (const [serviceKey, service] of Object.entries(services)) {
    const product = service.products.find((item) => item.id === id);
    if (product) return { ...product, serviceKey, serviceTitle: service.title };
  }
  return null;
}

function renderProducts(products) {
  productList.innerHTML = products.map((product) => `
    <article class="product-row">
      <div>
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        <span class="product-price">${formatMoney(product.price)}</span>
      </div>
      <button class="button orange" type="button" data-add-product="${product.id}">
        <i class="icon" data-lucide="plus"></i>Add
      </button>
    </article>
  `).join("");
}

function addToCart(id) {
  const product = findProduct(id);
  if (!product) return;
  const current = cart.get(id) || { ...product, quantity: 0 };
  current.quantity += 1;
  cart.set(id, current);
  saveCart();
  renderCart();
}

function changeQuantity(id, delta) {
  const current = cart.get(id);
  if (!current) return;
  current.quantity += delta;
  if (current.quantity <= 0) {
    cart.delete(id);
  } else {
    cart.set(id, current);
  }
  saveCart();
  renderCart();
}

function saveCart() {
  localStorage.setItem("moosify-cart", JSON.stringify(Array.from(cart.values())));
}

function getCartTotals() {
  const items = Array.from(cart.values());
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return { items, quantity, total };
}

function productCatalogText() {
  return Object.values(services).map((service) => {
    const products = service.products.map((item) => `${item.name} (${formatMoney(item.price)}): ${item.description}`).join("; ");
    return `${service.title}: ${products}`;
  }).join("\n");
}

function localMoosyReply(message) {
  const text = message.toLowerCase();
  const { items, quantity, total } = getCartTotals();
  const allProducts = Object.values(services).flatMap((service) => service.products.map((product) => ({
    ...product,
    serviceTitle: service.title
  })));
  const matched = allProducts.find((product) => text.includes(product.name.toLowerCase().split(" ")[0]) || text.includes(product.serviceTitle.toLowerCase().split(" ")[0]));

  if (text.includes("cheap") || text.includes("lowest")) {
    const cheapest = [...allProducts].sort((a, b) => a.price - b.price)[0];
    return `Moosy found the cheapest option: ${cheapest.name} for ${formatMoney(cheapest.price)}. Tiny price, mighty shelf energy.`;
  }
  if (text.includes("checkout") || text.includes("pay") || text.includes("buy")) {
    return quantity
      ? `Moosy says your demo cart has ${quantity} item${quantity === 1 ? "" : "s"} for ${formatMoney(total)}. Tap Checkout for the pretend checkout preview. No real payment happens.`
      : "Moosy says pick a product and tap Add first. Then I can help you review the checkout preview.";
  }
  if (text.includes("cart")) {
    return quantity
      ? `Moosy sees ${quantity} item${quantity === 1 ? "" : "s"} in your cart: ${items.map((item) => `${item.quantity} x ${item.name}`).join(", ")}. Total: ${formatMoney(total)}.`
      : "Moosy sees an empty cart. The donut boxes are very persuasive, just saying.";
  }
  if (matched && (text.includes("buy") || text.includes("price") || text.includes("cost") || text.includes("recommend"))) {
    return `Moosy recommends ${matched.name} from ${matched.serviceTitle}. It costs ${formatMoney(matched.price)} and ${matched.description.toLowerCase()} Tap Add if that sounds good.`;
  }
  if (text.includes("best") || text.includes("recommend")) {
    const service = services[activeServiceKey];
    const pick = service.products[Math.min(1, service.products.length - 1)];
    return `Moosy would start with ${pick.name} for ${formatMoney(pick.price)}. It is a good ${service.title} pick without getting too wild.`;
  }
  if (text.includes("hi") || text.includes("hello") || text.includes("hey")) {
    return "Hey! I was just supervising the shelf and thinking about snacks. What is on your mind?";
  }
  return "That is a good question. I am listening, and I can chat about almost anything in the Moosify universe.";
}

async function askMoosy(message) {
  const { items, total } = getCartTotals();
  // If chat is marked down, return maintenance message immediately
  if (CURRENT_CHAT_STATUS === "down") {
      if (aiStatus) aiStatus.textContent = "Moosy brain: offline.";
      if (pageAiStatus) pageAiStatus.textContent = "Moosy brain: offline.";
      return "Our help desk chat is currently offline for testing. Check back soon!";
  }
  const payload = {
    message, chatStatus: CURRENT_CHAT_STATUS,
    personality: moosyPersonality,
    activeDepartment: services[activeServiceKey].title,
    products: productCatalogText(),
    cart: items.map((item) => ({ name: item.name, quantity: item.quantity, price: item.price })),
    total,
    history: chatHistory.slice(-8)
};
  try {
    const endpoint = (API_URL && API_URL.trim() !== "" && !API_URL.includes("__API_URL_PLACEHOLDER__")) ? API_URL : "/api/moosy";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Moosy API returned ${response.status}`);
    const data = await response.json();
    if (!data.reply) throw new Error("Moosy API returned no reply");
    const status = data.provider ? `Moosy brain: ${data.provider}.` : "Moosy brain: AI online.";
    if (aiStatus) aiStatus.textContent = status;
    if (pageAiStatus) pageAiStatus.textContent = status;
    return data.reply;
  } catch (error) {
    if (aiStatus) aiStatus.textContent = "Moosy brain: local product guide.";
    if (pageAiStatus) pageAiStatus.textContent = "Moosy brain: local product guide.";
    return localMoosyReply(message);
  }
}

function renderCart() {
  const { items, quantity, total } = getCartTotals();
  const empty = "Cart is empty.";
  const markup = items.length ? items.map((item) => `
    <div class="cart-line">
      <div>
        <strong>${item.name}</strong>
        <small>${item.serviceTitle} · ${formatMoney(item.price)} each</small>
      </div>
      <span class="qty-controls">
        <button type="button" data-cart-delta="-1" data-cart-product="${item.id}" aria-label="Remove one ${item.name}">-</button>
        <strong>${item.quantity}</strong>
        <button type="button" data-cart-delta="1" data-cart-product="${item.id}" aria-label="Add one ${item.name}">+</button>
      </span>
    </div>
  `).join("") : empty;

  document.querySelectorAll("[data-inline-cart], [data-modal-cart]").forEach((node) => {
    node.innerHTML = markup;
  });
  document.querySelectorAll("[data-cart-total]").forEach((node) => {
    node.textContent = formatMoney(total);
  });
  document.querySelector("[data-cart-count]").textContent = quantity;
  renderCheckoutSummary();
  refreshIcons();
}

function renderCheckoutSummary() {
  const { items, total } = getCartTotals();
  const summary = document.querySelector("[data-checkout-summary]");
  if (!summary) return;
  summary.innerHTML = items.length
    ? `${items.map((item) => `${item.quantity} x ${item.name}`).join("<br>")}<br><strong>Total: ${formatMoney(total)}</strong>`
    : "Cart is empty. Add something before checking out.";
}

function showHome() {
  if (window.location.pathname !== "/") {
    window.location.assign("/");
    return;
  }
  closeModals();
  hidePrimaryViews();
  homeView.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showChat() {
  closeModals();
  hidePrimaryViews();
  chatView.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  refreshIcons();
}

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
  document.title = titles[route] || "Moosify";

  document.querySelectorAll("[data-nav-section]").forEach((link) => link.removeAttribute("aria-current"));
  let active = route.split("/")[0] || "home";
  if (route.startsWith("shop/")) active = "shop";
  document.querySelector(`[data-nav-section="${active}"]`)?.setAttribute("aria-current", "page");
  if (route.startsWith("shop/") || route === "shop") {
    document.querySelector('[data-nav-section="services"]')?.setAttribute("aria-current", "page");
  }
}

function showPath(path, replace = false) {
  const route = path.replace(/^\/+|\/+$/g, "");
  updatePageIdentity(route);
  if (route === "chat") return showChat();
  if (route === "products") {
    closeModals();
    hidePrimaryViews();
    productsView.hidden = false;
    refreshIcons();
    return;
  }
  if (route === "shop") {
    closeModals();
    hidePrimaryViews();
    shopView.hidden = false;
    refreshIcons();
    return;
  }
  if (route === "features") {
    closeModals();
    hidePrimaryViews();
    featuresView.hidden = false;
    refreshIcons();
    return;
  }
  const departmentRoutes = {
    "shop/phones": "phones",
    "shop/donuts": "donuts",
    "shop/space": "space",
    "shop/airlines": "airlines",
    "shop/cell-plans": "cellplans",
    "shop/support": "support"
  };
  if (departmentRoutes[route]) return openService(departmentRoutes[route]);
  const modalRoutes = { login: "login", cart: "cart", checkout: "checkout", "mobile-lab": "device-tester" };
  if (modalRoutes[route]) return openModal(modalRoutes[route], true);
  showHome();
}

function openModal(name, keepPath = false) {
  if (name === "checkout" && getCartTotals().items.length === 0 && !keepPath) {
    name = "cart";
  }
  if (name === "checkout") renderCheckoutSummary();
  if (name === "device-tester") {
    renderTesterPreview();
    renderTrialApps("home");
  }
  closeModals();
  hidePrimaryViews();
  document.getElementById(`${name}-modal`)?.removeAttribute("hidden");
  if (!keepPath) {
    const path = name === "device-tester" ? "mobile-lab" : name;
    history.pushState({}, "", `/${path}`);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
  refreshIcons();
}

function closeModals() {
  document.querySelectorAll(".modal").forEach((modal) => modal.setAttribute("hidden", ""));
}

const navToggle = document.querySelector("[data-nav-toggle]");
const navMenu = document.querySelector("[data-nav-menu]");
navToggle?.addEventListener("click", () => {
  const open = navMenu.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(open));
});

navMenu?.addEventListener("click", (event) => {
  if (!event.target.closest("a")) return;
  navMenu.classList.remove("is-open");
  navToggle?.setAttribute("aria-expanded", "false");
});

document.addEventListener("click", (event) => {
  const serviceButton = event.target.closest("[data-open-service]");
  const modalButton = event.target.closest("[data-modal-open]");
  const scrollButton = event.target.closest("[data-scroll-to]");
  const homeButton = event.target.closest("[data-back-home], [data-home-link]");
  const closeButton = event.target.closest("[data-modal-close]");
  const addButton = event.target.closest("[data-add-product]");
  const qtyButton = event.target.closest("[data-cart-product]");

  if (serviceButton) openService(serviceButton.dataset.openService);
  if (modalButton) openModal(modalButton.dataset.modalOpen);
  if (addButton) addToCart(addButton.dataset.addProduct);
  if (qtyButton) changeQuantity(qtyButton.dataset.cartProduct, Number(qtyButton.dataset.cartDelta));
  if (scrollButton) document.getElementById(scrollButton.dataset.scrollTo)?.scrollIntoView({ behavior: "smooth" });
  if (homeButton) {
    event.preventDefault();
    showHome();
  }
  if (closeButton || event.target.classList.contains("modal")) showHome();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") showHome();
});

window.addEventListener("popstate", () => showPath(window.location.pathname));

document.querySelector("[data-login-form]").addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("[data-login-note]").textContent = "Demo login ready. Connect a real auth provider when Moosy approves it.";
});

const deviceForm = document.getElementById("device-tester-form");
const testerDevice = document.getElementById("tester-device");
const testerOS = document.getElementById("tester-os");
const testerFront = document.getElementById("tester-front");
const testerBack = document.getElementById("tester-back");
const testerLabel = document.getElementById("tester-device-label");
const testerResult = document.getElementById("tester-result");
const testerResults = document.getElementById("tester-results");
const phoneRig = document.getElementById("phone-rig");

function populateTester() {
  if (!testerDevice || !testerOS) return;
  testerDevice.innerHTML = ophoneModels.map((model) => `<option value="${model.id}">${model.name} - ${model.note}</option>`).join("");
  populateOSOptions(selectedOPhone());
  renderTesterPreview();
  renderTrialApps("home");
}

function selectedOPhone() {
  return ophoneModels.find((model) => model.id === testerDevice.value) || ophoneModels[0];
}

function compatibleOSes(model) {
  return ophoneOSes.filter((os) => model.osIds.includes(os.id));
}

function populateOSOptions(model) {
  const previous = testerOS.value;
  const compatible = compatibleOSes(model);
  testerOS.innerHTML = compatible.map((os) => `<option value="${os.id}">${os.name}</option>`).join("");
  testerOS.value = compatible.some((os) => os.id === previous) ? previous : compatible[0].id;
}

function selectedOS() {
  const model = selectedOPhone();
  return compatibleOSes(model).find((os) => os.id === testerOS.value) || compatibleOSes(model)[0];
}

function renderTesterPreview() {
  const model = selectedOPhone();
  const os = selectedOS();
  testerFront.src = model.front;
  testerBack.src = model.back;
  testerFront.alt = `${model.name} front`;
  testerBack.alt = `${model.name} back`;
  testerLabel.textContent = `${model.name} on ${os.name}`;
}

function trialExperience(model, os, appId) {
  const problem = ophoneTrialProblems[model.id]?.[appId];
  if (problem) return { tone: problem[0], message: problem[1] };

  const osNumber = Number(os.id.replace("pineappleos-", ""));
  const modelNumber = Number(model.id.replace("O", ""));
  if (appId === "home" && osNumber === modelNumber + 2) {
    return { tone: "watch", message: "This newest supported OS works, but opening apps feels a little slower than the release OS." };
  }

  const smoothMessages = {
    home: "Swipe between the home pages: icons and widgets respond smoothly.",
    camera: "The shutter, zoom, and front-camera switch respond normally.",
    calls: "Orange calling and mobile data connect normally.",
    store: "Browse apps, open product pages, and start downloads normally.",
    game: "Cloud Game opens and the touch controls respond normally.",
    settings: "Display, sound, battery, and privacy options open normally."
  };
  return { tone: "smooth", message: smoothMessages[appId] };
}

function showTrialApp(appId) {
  const model = selectedOPhone();
  const os = selectedOS();
  const app = ophoneTrialApps.find((item) => item.id === appId) || ophoneTrialApps[0];
  const experience = trialExperience(model, os, app.id);
  testerResult.dataset.trialTone = experience.tone;
  testerResult.textContent = `${app.name} on ${model.name} with ${os.name}: ${experience.message}`;
  testerResults.querySelectorAll("[data-trial-app]").forEach((button) => {
    button.classList.toggle("active", button.dataset.trialApp === app.id);
    button.setAttribute("aria-pressed", String(button.dataset.trialApp === app.id));
  });
}

function renderTrialApps(activeId = "home") {
  testerResults.innerHTML = ophoneTrialApps.map((app) => {
    const active = app.id === activeId ? " active" : "";
    return `<button type="button" class="test-chip${active}" data-trial-app="${app.id}" aria-pressed="${app.id === activeId}"><span>${app.name}</span><strong>${app.badge}</strong></button>`;
  }).join("");
  showTrialApp(activeId);
}

if (deviceForm) {
  populateTester();
  testerDevice.addEventListener("change", () => {
    populateOSOptions(selectedOPhone());
    renderTesterPreview();
    renderTrialApps("home");
  });
  testerOS.addEventListener("change", () => {
    renderTesterPreview();
    renderTrialApps("home");
  });
  testerResults.addEventListener("click", (event) => {
    const appButton = event.target.closest("[data-trial-app]");
    if (appButton) showTrialApp(appButton.dataset.trialApp);
  });
  deviceForm.addEventListener("submit", (e) => {
    e.preventDefault();
    phoneRig.style.animationDuration = "1.25s";
    renderTrialApps("home");
    window.setTimeout(() => {
      phoneRig.style.animationDuration = "5s";
    }, 700);
  });
}

document.querySelector("[data-chat-form-page]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("[data-chat-input-page]");
  const message = input.value.trim();
  if (!message) return;

  const userBubble = document.createElement("div");
  userBubble.className = "message user";
  userBubble.textContent = `You: ${message}`;
  pageChatLog.appendChild(userBubble);

  const reply = document.createElement("div");
  reply.className = "message";
  reply.textContent = "Moosy: thinking with antlers...";
  pageChatLog.appendChild(reply);

  input.value = "";
  pageChatLog.scrollTop = pageChatLog.scrollHeight;

  const answer = await askMoosy(message);
  reply.textContent = `Moosy: ${answer}`;
  chatHistory.push({ role: "user", content: message }, { role: "assistant", content: answer });
  saveChatHistory();
  pageChatLog.scrollTop = pageChatLog.scrollHeight;
});

document.querySelector("[data-checkout-form]").addEventListener("submit", (event) => {
  event.preventDefault();
  const { quantity, total } = getCartTotals();
  document.querySelector("[data-checkout-note]").textContent = `Demo order ready: ${quantity} item${quantity === 1 ? "" : "s"} for ${formatMoney(total)}. No payment was charged.`;
});

renderRoutePages();
renderProducts(services[activeServiceKey].products);
renderCart();
renderSavedChat();
showPath(window.location.pathname);
refreshIcons();
