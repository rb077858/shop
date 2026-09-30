import { json, bad, readJson, config, randomId, randomToken, round2, shippingFor, logEvent } from '../../../lib/util.js';
import { createPaypalOrder } from '../../../lib/paypal.js';

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export async function onRequestPost({ request, env }) {
  const c = config(env);
  const body = await readJson(request);
  if (!body || !Array.isArray(body.items) || !body.items.length) return bad('העגלה ריקה');
  if (body.items.length > 30) return bad('יותר מדי פריטים');

  const cu = body.customer || {};
  const customer = {
    name: str(cu.name, 100),
    email: str(cu.email, 150).toLowerCase(),
    phone: str(cu.phone, 30),
    address1: str(cu.address1),
    address2: str(cu.address2),
    city: str(cu.city, 100),
    state: str(cu.state, 100),
    zip: str(cu.zip, 20),
    country: str(cu.country || c.shipTo, 2).toUpperCase(),
  };
  if (customer.name.length < 2) return bad('נא למלא שם מלא');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) return bad('כתובת אימייל לא תקינה');
  if (customer.phone.replace(/\D/g, '').length < 7) return bad('מספר טלפון לא תקין');
  if (customer.address1.length < 3 || customer.city.length < 2) return bad('נא למלא כתובת ועיר');
  if (!c.countries.includes(customer.country)) return bad('אין משלוח למדינה שנבחרה');

  const items = [];
  for (const it of body.items) {
    const qty = Math.floor(Number(it.qty));
    if (!(qty >= 1 && qty <= 20)) return bad('כמות לא תקינה');
    const row = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND active = 1').bind(String(it.productId)).first();
    if (!row) return bad('אחד המוצרים בעגלה כבר לא זמין. נא לעדכן את העגלה.');
    const variants = JSON.parse(row.variants || '[]');
    let variant = null;
    if (variants.length) {
      variant = variants.find((v) => v.id === String(it.variantId));
      if (!variant) return bad(`נא לבחור אפשרות עבור "${row.title}"`);
      if (variant.disabled) return bad(`האפשרות שנבחרה ל"${row.title}" אזלה`);
    }
    items.push({
      productId: row.id,
      variantId: variant?.id || null,
      title: row.title,
      variantName: variant?.name || '',
      image: variant?.image || JSON.parse(row.images || '[]')[0] || '',
      price: round2(variant?.price ?? row.price),
      qty,
      aeProductId: row.ae_product_id || null,
      skuAttr: variant?.skuAttr || '',
      cost: variant?.cost ?? row.cost_usd ?? null,
    });
  }

  const subtotal = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
  const shipping = shippingFor(env, subtotal);
  const total = round2(subtotal + shipping);
  const order = {
    id: `R${randomId(7)}`,
    token: randomToken(),
    ...customer,
    address: { address1: customer.address1, address2: customer.address2, city: customer.city, state: customer.state, zip: customer.zip, country: customer.country },
    items,
    subtotal,
    shipping,
    total,
    currency: c.currency,
  };

  await env.DB.prepare(
    `INSERT INTO orders (id, token, status, email, name, phone, address, items, subtotal, shipping, total, currency)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(order.id, order.token, order.email, order.name, order.phone, JSON.stringify(order.address), JSON.stringify(items), subtotal, shipping, total, order.currency)
    .run();

  let pp;
  try {
    pp = await createPaypalOrder(env, order, c.storeName);
  } catch (e) {
    await logEvent(env, order.id, `PayPal create failed: ${e.message}`);
    return bad('לא ניתן היה ליצור תשלום ב-PayPal. נסו שוב בעוד רגע.', 502);
  }
  await env.DB.prepare('UPDATE orders SET paypal_order_id = ? WHERE id = ?').bind(pp.id, order.id).run();
  return json({ orderId: order.id, paypalOrderId: pp.id, total, currency: order.currency });
}
