import { config, parseOrder, logEvent, trackingUrl, round2 } from './util.js';
import { capturePaypalOrder, getPaypalOrder } from './paypal.js';
import { placeOrder, getOrder as getAeOrder, aeConfigured } from './aliexpress.js';
import { notifyAdmin, emailOrderConfirmation, emailShipped } from './notify.js';

export async function loadOrder(env, id) {
  return env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
}

// Capture a PayPal order (idempotent) and, when successful, mark our order as paid.
export async function captureAndFinalize(env, row, ctx) {
  if (row.status !== 'pending') return { ok: true, already: true };
  let pp;
  try {
    pp = await capturePaypalOrder(env, row.paypal_order_id);
  } catch (e) {
    if (e.issue === 'ORDER_ALREADY_CAPTURED') pp = await getPaypalOrder(env, row.paypal_order_id);
    else throw e;
  }
  return finalizeFromPaypal(env, row, pp, ctx);
}

export async function finalizeFromPaypal(env, row, pp, ctx) {
  const unit = pp.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (pp.status !== 'COMPLETED' || !capture || capture.status !== 'COMPLETED') {
    await logEvent(env, row.id, `PayPal status ${pp.status} / capture ${capture?.status || 'none'}`);
    return { ok: false, status: capture?.status || pp.status };
  }
  const amount = Number(capture.amount?.value);
  const currency = capture.amount?.currency_code;
  const customId = capture.custom_id || unit?.custom_id;
  if (round2(amount) !== round2(row.total) || currency !== row.currency || (customId && customId !== row.id)) {
    await logEvent(env, row.id, `AMOUNT MISMATCH: paid ${amount} ${currency} (custom_id ${customId}) expected ${row.total} ${row.currency}`);
    await notifyAdmin(env, `בעיה בתשלום ${row.id}`, `סכום ששולם ${amount} ${currency} לא תואם ${row.total} ${row.currency}. בדוק ידנית.`);
    return { ok: false, status: 'MISMATCH' };
  }
  const upd = await env.DB.prepare(
    "UPDATE orders SET status = 'paid', paypal_capture_id = ?, paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'pending'"
  )
    .bind(capture.id, row.id)
    .run();
  if (!upd.meta?.changes) return { ok: true, already: true };
  await logEvent(env, row.id, `Paid via PayPal, capture ${capture.id}`);

  const order = parseOrder(await loadOrder(env, row.id), { admin: true });
  const after = async () => {
    await emailOrderConfirmation(env, order);
    const lines = order.items.map((i) => `• ${i.title}${i.variantName ? ' (' + i.variantName + ')' : ''} ×${i.qty}${i.aeProductId ? ` https://www.aliexpress.com/item/${i.aeProductId}.html` : ''}`).join('\n');
    const a = order.address;
    await notifyAdmin(
      env,
      `הזמנה חדשה ${order.id} — ${order.total} ${order.currency}`,
      `${lines}\n\n${order.name}\n${a.address1} ${a.address2 || ''}\n${a.city} ${a.zip || ''} ${a.country}\n${order.phone}\n${order.email}\n\n${config(env).siteUrl}/admin/`
    );
    if (config(env).aeAutoOrder && aeConfigured(env)) {
      try {
        await fulfillOnAliExpress(env, order.id);
      } catch (e) {
        await notifyAdmin(env, `הזמנה אוטומטית באליאקספרס נכשלה ${order.id}`, String(e.message || e));
      }
    }
  };
  if (ctx?.waitUntil) ctx.waitUntil(after());
  else await after();
  return { ok: true };
}

export async function fulfillOnAliExpress(env, orderId) {
  const row = await loadOrder(env, orderId);
  if (!row) throw new Error('Order not found');
  if (row.status !== 'paid') throw new Error(`Order status is "${row.status}", expected "paid"`);
  const order = parseOrder(row, { admin: true });
  const ids = await placeOrder(env, order, { tryToPay: config(env).aeTryToPay });
  await env.DB.prepare("UPDATE orders SET status = 'ordered', ae_order_ids = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(JSON.stringify(ids), orderId)
    .run();
  await logEvent(env, orderId, `Placed on AliExpress: ${ids.join(', ')}${config(env).aeTryToPay ? '' : ' — remember to pay it on AliExpress'}`);
  return ids;
}

// Pull tracking numbers from AliExpress for an order that was placed there.
export async function syncOrder(env, orderId) {
  const row = await loadOrder(env, orderId);
  const order = parseOrder(row, { admin: true });
  if (!order.aeOrderIds.length) return { changed: false };
  const known = new Set(order.tracking.map((t) => t.number));
  const tracking = [...order.tracking];
  let finished = order.aeOrderIds.length > 0;
  for (const aeId of order.aeOrderIds) {
    const info = await getAeOrder(env, aeId);
    for (const l of info.logistics) {
      if (!known.has(l.number)) {
        known.add(l.number);
        tracking.push({ number: l.number, carrier: l.carrier, url: trackingUrl(l.number) });
      }
    }
    if (info.status !== 'FINISH') finished = false;
  }
  let status = order.status;
  if (finished && tracking.length) status = 'delivered';
  else if (tracking.length && order.status === 'ordered') status = 'shipped';
  const changed = status !== order.status || tracking.length !== order.tracking.length;
  if (changed) {
    await env.DB.prepare("UPDATE orders SET status = ?, tracking = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(status, JSON.stringify(tracking), orderId)
      .run();
    await logEvent(env, orderId, `Sync: status ${status}, tracking ${tracking.map((t) => t.number).join(', ')}`);
    if (tracking.length > order.tracking.length) await emailShipped(env, { ...order, tracking });
  }
  return { changed, status, tracking };
}
