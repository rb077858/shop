// Shared storefront helpers.
const CART_KEY = 'reembir_cart_v1';

let configPromise;
export function getConfig() {
  configPromise ||= fetch('/api/config').then((r) => r.json());
  return configPromise;
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `שגיאה (${res.status})`), { data });
  return data;
}

export function money(n, currency) {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: currency || 'ILS' }).format(n);
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function getCart() {
  try {
    const c = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(c) ? c : [];
  } catch {
    return [];
  }
}

export function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {}
  renderCartCount();
}

export function addToCart(item) {
  const cart = getCart();
  const found = cart.find((c) => c.productId === item.productId && c.variantId === item.variantId);
  if (found) found.qty = Math.min(20, found.qty + item.qty);
  else cart.push(item);
  saveCart(cart);
}

export function renderCartCount() {
  const n = getCart().reduce((s, i) => s + i.qty, 0);
  document.querySelectorAll('[data-cart-count]').forEach((el) => {
    el.textContent = n;
    el.hidden = !n;
  });
}

// Whitelist sanitizer for product descriptions imported from suppliers.
const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H2', 'H3', 'H4', 'IMG', 'SPAN', 'DIV', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH']);
export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const walk = (node) => {
    for (const el of [...node.children]) {
      if (!ALLOWED.has(el.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'LINK', 'META'].includes(el.tagName)) el.remove();
        else {
          walk(el);
          el.replaceWith(...el.childNodes);
        }
        continue;
      }
      for (const a of [...el.attributes]) {
        const keep = el.tagName === 'IMG' && a.name === 'src' && /^https:\/\//.test(a.value);
        if (!keep) el.removeAttribute(a.name);
      }
      if (el.tagName === 'IMG') el.setAttribute('loading', 'lazy');
      walk(el);
    }
  };
  walk(doc.body.firstChild);
  return doc.body.firstChild.innerHTML;
}

function layout(config) {
  const header = document.createElement('header');
  header.className = 'site';
  header.innerHTML = `<div class="wrap">
    <a class="logo" href="/">${esc(config.storeName)}</a>
    <nav class="nav">
      <a href="/" class="hide-sm">חנות</a>
      <a href="/track.html">מעקב הזמנה</a>
      <a href="/contact.html" class="hide-sm">צור קשר</a>
      <a href="/cart.html" class="cart-link">🛒 עגלה<span class="badge" data-cart-count hidden>0</span></a>
    </nav></div>`;
  document.body.prepend(header);
  const footer = document.createElement('footer');
  footer.className = 'site';
  footer.innerHTML = `<div class="wrap">
    <div>© ${new Date().getFullYear()} ${esc(config.storeName)} · תשלום מאובטח באמצעות PayPal</div>
    <nav><a href="/shipping.html">משלוחים</a><a href="/returns.html">החזרות וביטולים</a><a href="/terms.html">תקנון</a><a href="/privacy.html">פרטיות</a><a href="/contact.html">צור קשר</a></nav>
  </div>`;
  document.body.append(footer);
  document.querySelectorAll('[data-store-name]').forEach((el) => (el.textContent = config.storeName));
  document.querySelectorAll('[data-contact-email]').forEach((el) => {
    el.textContent = config.contactEmail;
    if (el.tagName === 'A') el.href = `mailto:${config.contactEmail}`;
  });
  renderCartCount();
}

getConfig().then(layout);
