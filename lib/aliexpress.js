// AliExpress Open Platform (Dropshipping API) client.
// Docs: https://openservice.aliexpress.com/doc/api.htm
import { getSetting, setSetting } from './util.js';

const DEFAULT_GATEWAY = 'https://api-sg.aliexpress.com';

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function aeConfigured(env) {
  return !!(env.AE_APP_KEY && env.AE_APP_SECRET);
}

// apiPath: "/auth/token/create" style for system APIs (sent to /rest), or null for business methods (sent to /sync)
async function signedRequest(env, { method, apiPath, params }) {
  const all = { app_key: env.AE_APP_KEY, sign_method: 'sha256', timestamp: String(Date.now()), ...params };
  if (method) all.method = method;
  for (const k of Object.keys(all)) {
    if (all[k] == null) delete all[k];
    else if (typeof all[k] === 'object') all[k] = JSON.stringify(all[k]);
    else all[k] = String(all[k]);
  }
  const base = (apiPath || '') + Object.keys(all).sort().map((k) => k + all[k]).join('');
  all.sign = await hmacSha256Hex(env.AE_APP_SECRET, base);
  const url = apiPath ? `${env.AE_API_BASE || DEFAULT_GATEWAY}/rest${apiPath}` : `${env.AE_API_BASE || DEFAULT_GATEWAY}/sync`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(all).toString(),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`AliExpress: invalid response (${res.status}): ${text.slice(0, 200)}`);
  }
  const err = data.error_response || (data.code && data.code !== '0' && data.code !== 0 ? data : null);
  if (err) throw new Error(`AliExpress error ${err.code || ''}: ${err.msg || err.message || err.sub_msg || JSON.stringify(err).slice(0, 300)}`);
  return data;
}

// ---- OAuth (connect your AliExpress buyer account to the app) ----

export function authorizeUrl(env, redirectUri, state) {
  const q = new URLSearchParams({ response_type: 'code', force_auth: 'true', redirect_uri: redirectUri, client_id: env.AE_APP_KEY, state });
  return `${env.AE_API_BASE || DEFAULT_GATEWAY}/oauth/authorize?${q}`;
}

function storeToken(env, data) {
  const now = Date.now();
  const token = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Number(data.expire_time) || now + Number(data.expires_in || 0) * 1000,
    refreshExpiresAt: Number(data.refresh_token_valid_time) || now + Number(data.refresh_expires_in || 0) * 1000,
    account: data.account || data.user_nick || data.seller_id || '',
    updatedAt: now,
  };
  if (!token.accessToken) throw new Error('AliExpress did not return an access token: ' + JSON.stringify(data).slice(0, 300));
  return setSetting(env, 'ae_token', token).then(() => token);
}

export async function exchangeCode(env, code) {
  const data = await signedRequest(env, { apiPath: '/auth/token/create', params: { code } });
  return storeToken(env, data);
}

async function refreshToken(env, token) {
  const data = await signedRequest(env, { apiPath: '/auth/token/refresh', params: { refresh_token: token.refreshToken } });
  return storeToken(env, data);
}

export async function aeStatus(env) {
  const token = await getSetting(env, 'ae_token');
  return {
    configured: aeConfigured(env),
    connected: !!token?.accessToken,
    account: token?.account || '',
    expiresAt: token?.expiresAt || null,
    refreshExpiresAt: token?.refreshExpiresAt || null,
  };
}

async function session(env) {
  if (!aeConfigured(env)) throw new Error('AliExpress API is not configured (AE_APP_KEY / AE_APP_SECRET)');
  let token = await getSetting(env, 'ae_token');
  if (!token?.accessToken) throw new Error('AliExpress account is not connected. Connect it from the admin settings tab.');
  if (token.expiresAt && token.expiresAt < Date.now() + 24 * 3600_000 && token.refreshToken) {
    token = await refreshToken(env, token);
  }
  return token.accessToken;
}

export async function aeCall(env, method, params = {}) {
  const data = await signedRequest(env, { method, params: { session: await session(env), ...params } });
  return unwrap(data);
}

// ---- response helpers (AliExpress wraps arrays in odd single-key objects) ----

function unwrap(data) {
  const key = Object.keys(data).find((k) => k.endsWith('_response'));
  const r = key ? data[key] : data;
  return r.result ?? r;
}

export function asArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1) return asArray(v[keys[0]]);
    return [v];
  }
  return [v];
}

// ---- business calls ----

export function parseProductId(input) {
  const s = String(input || '').trim();
  const m = s.match(/item\/(\d{6,})/) || s.match(/(?:productId|product_id)=(\d{6,})/) || s.match(/^(\d{6,})$/);
  return m ? m[1] : null;
}

export async function getProduct(env, productId, shipTo) {
  const r = await aeCall(env, 'aliexpress.ds.product.get', {
    product_id: productId,
    ship_to_country: shipTo,
    target_currency: 'USD',
    target_language: 'en',
  });
  const base = r.ae_item_base_info_dto || {};
  const images = String(r.ae_multimedia_info_dto?.image_urls || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const skus = asArray(r.ae_item_sku_info_dtos);
  const variants = skus.map((s) => {
    const props = asArray(s.ae_sku_property_dtos);
    const options = {};
    let image = '';
    for (const p of props) {
      const name = p.sku_property_name || 'Option';
      options[name] = p.property_value_definition_name || p.sku_property_value || String(p.property_value_id || '');
      if (p.sku_image) image = p.sku_image;
    }
    const cost = Number(s.offer_sale_price || s.sku_price || 0);
    const stock = Number(s.sku_available_stock ?? s.ipm_sku_stock ?? 0);
    return {
      id: String(s.sku_id || s.id),
      skuAttr: s.sku_attr || s.id || '',
      name: Object.values(options).join(' / ') || 'Default',
      options,
      cost,
      image,
      stock,
    };
  });
  return {
    aeProductId: String(productId),
    title: base.subject || `AliExpress ${productId}`,
    description: base.detail || '',
    images,
    variants,
  };
}

// Pick the cheapest available shipping method for an item (prefers tracked methods).
export async function cheapestShipping(env, { productId, qty, shipTo }) {
  const r = await aeCall(env, 'aliexpress.logistics.buyer.freight.calculate', {
    param_aeop_freight_calculate_for_buyer_d_t_o: {
      country_code: shipTo,
      product_id: Number(productId),
      product_num: qty,
      send_goods_country_code: 'CN',
    },
  });
  const list = asArray(r.aeop_freight_calculate_result_for_buyer_d_t_o_list || r.aeop_freight_calculate_result_for_buyer_dtolist)
    .filter((o) => o && o.service_name && !o.error_code)
    .map((o) => ({ name: o.service_name, amount: Number(o.freight?.amount ?? (o.freight?.cent ?? 0) / 100), tracked: String(o.tracking_available) === 'true' }));
  if (!list.length) return null;
  list.sort((a, b) => (b.tracked - a.tracked) || a.amount - b.amount);
  return list[0].name;
}

const PHONE_CODES = { IL: '+972', US: '+1', GB: '+44', DE: '+49', FR: '+33', CA: '+1', AU: '+61' };

export async function placeOrder(env, order, { tryToPay = false } = {}) {
  const a = order.address;
  const country = a.country;
  let phone = String(order.phone).replace(/[^\d+]/g, '');
  const code = PHONE_CODES[country];
  if (code && phone.startsWith(code)) phone = phone.slice(code.length);
  if (country === 'IL' && phone.startsWith('0')) phone = phone.slice(1);

  const items = [];
  for (const i of order.items) {
    if (!i.aeProductId) throw new Error(`Item "${i.title}" has no AliExpress product id`);
    let shipping = null;
    try {
      shipping = await cheapestShipping(env, { productId: i.aeProductId, qty: i.qty, shipTo: country });
    } catch {
      // fall back to AliExpress default shipping method
    }
    items.push({
      product_id: Number(i.aeProductId),
      product_count: i.qty,
      sku_attr: i.skuAttr || undefined,
      logistics_service_name: shipping || env.AE_DEFAULT_SHIPPING || undefined,
      order_memo: `Order ${order.id}. Please do not include invoice or price.`,
    });
  }

  const r = await aeCall(env, 'aliexpress.ds.order.create', {
    param_place_order_request4_open_api_d_t_o: {
      out_order_id: order.id,
      logistics_address: {
        address: a.address1,
        address2: a.address2 || '',
        city: a.city,
        province: a.state || a.city,
        zip: a.zip || '',
        country,
        contact_person: order.name,
        full_name: order.name,
        mobile_no: phone,
        phone_country: code || '',
        locale: 'en_US',
      },
      product_items: items,
    },
    ds_extend_request: { payment: { pay_currency: 'USD', try_to_pay: tryToPay ? 'true' : 'false' } },
  });
  if (r.is_success === false || r.is_success === 'false') {
    throw new Error(`AliExpress order failed: ${r.error_code || ''} ${r.error_msg || ''}`.trim());
  }
  const ids = asArray(r.order_list).map(String).filter(Boolean);
  if (!ids.length) throw new Error('AliExpress returned no order id: ' + JSON.stringify(r).slice(0, 300));
  return ids;
}

export async function getOrder(env, aeOrderId) {
  const r = await aeCall(env, 'aliexpress.trade.ds.order.get', { single_order_query: { order_id: aeOrderId } });
  const logistics = asArray(r.logistics_info_list)
    .filter((l) => l && l.logistics_no)
    .map((l) => ({ number: String(l.logistics_no), carrier: l.logistics_service || '' }));
  return { status: r.order_status || '', logistics };
}
