export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export const bad = (error, status = 400) => json({ error }, status);

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomId(len = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const round2 = (n) => Math.round(Number(n) * 100) / 100;

export function config(env) {
  return {
    storeName: env.STORE_NAME || 'Reembir',
    siteUrl: (env.SITE_URL || 'https://shop.reembir.com').replace(/\/$/, ''),
    currency: env.STORE_CURRENCY || 'ILS',
    shipTo: env.SHIP_TO_COUNTRY || 'IL',
    countries: String(env.SHIP_COUNTRIES || env.SHIP_TO_COUNTRY || 'IL').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    usdRate: Number(env.USD_RATE || 3.7),
    multiplier: Number(env.PRICE_MULTIPLIER || 2.5),
    shippingFee: Number(env.SHIPPING_FEE || 0),
    freeShippingOver: Number(env.FREE_SHIPPING_OVER || 0),
    contactEmail: env.CONTACT_EMAIL || '',
    aeAutoOrder: env.AE_AUTO_ORDER === 'true',
    aeTryToPay: env.AE_TRY_TO_PAY === 'true',
  };
}

export function shippingFor(env, subtotal) {
  const c = config(env);
  if (c.freeShippingOver > 0 && subtotal >= c.freeShippingOver) return 0;
  return round2(c.shippingFee);
}

// Price suggestion: USD cost -> store currency with markup, rounded to x9.90 style.
export function suggestPrice(env, costUsd) {
  const c = config(env);
  const raw = Number(costUsd) * c.usdRate * c.multiplier;
  if (!raw) return 0;
  return Math.max(Math.ceil(raw) - 0.1, 0.9);
}

export async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
    .bind(key, JSON.stringify(value))
    .run();
}

export function safeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseProduct(row, { admin = false } = {}) {
  if (!row) return null;
  const p = {
    id: row.id,
    title: row.title,
    description: row.description || '',
    images: JSON.parse(row.images || '[]'),
    price: row.price,
    compareAtPrice: row.compare_at_price,
    variants: JSON.parse(row.variants || '[]'),
    active: !!row.active,
    sort: row.sort,
  };
  if (admin) {
    p.aeProductId = row.ae_product_id;
    p.costUsd = row.cost_usd;
    p.createdAt = row.created_at;
  } else {
    p.variants = p.variants.map(({ cost, skuAttr, ...v }) => v);
  }
  return p;
}

export function parseOrder(row, { admin = false } = {}) {
  if (!row) return null;
  const o = {
    id: row.id,
    status: row.status,
    email: row.email,
    name: row.name,
    phone: row.phone,
    address: JSON.parse(row.address),
    items: JSON.parse(row.items),
    subtotal: row.subtotal,
    shipping: row.shipping,
    total: row.total,
    currency: row.currency,
    tracking: JSON.parse(row.tracking || '[]'),
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
  if (admin) {
    o.token = row.token;
    o.paypalOrderId = row.paypal_order_id;
    o.paypalCaptureId = row.paypal_capture_id;
    o.aeOrderIds = JSON.parse(row.ae_order_ids || '[]');
    o.notes = row.notes;
    o.updatedAt = row.updated_at;
  } else {
    o.items = o.items.map(({ cost, skuAttr, aeProductId, ...i }) => i);
  }
  return o;
}

export async function logEvent(env, orderId, message) {
  await env.DB.prepare('INSERT INTO order_events (order_id, message) VALUES (?, ?)').bind(orderId, String(message).slice(0, 2000)).run();
}

export function trackingUrl(number) {
  return `https://t.17track.net/en#nums=${encodeURIComponent(number)}`;
}

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
