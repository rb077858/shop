import { json, bad, parseOrder, readJson, logEvent, trackingUrl } from '../../../../lib/util.js';
import { emailShipped } from '../../../../lib/notify.js';

const STATUSES = ['pending', 'paid', 'ordered', 'shipped', 'delivered', 'cancelled', 'refunded'];

export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(params.id).first();
  if (!row) return bad('Not found', 404);
  const { results } = await env.DB.prepare('SELECT message, created_at FROM order_events WHERE order_id = ? ORDER BY id DESC').bind(params.id).all();
  return json({ order: parseOrder(row, { admin: true }), events: results });
}

// PUT {status?, aeOrderIds?, tracking?: [{number, carrier}], notes?, notify?}
export async function onRequestPut({ request, env, params }) {
  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(params.id).first();
  if (!row) return bad('Not found', 404);
  const cur = parseOrder(row, { admin: true });
  const b = (await readJson(request)) || {};
  const status = b.status ?? cur.status;
  if (!STATUSES.includes(status)) return bad('Bad status');
  const aeOrderIds = Array.isArray(b.aeOrderIds) ? b.aeOrderIds.map((s) => String(s).trim()).filter(Boolean) : cur.aeOrderIds;
  const tracking = Array.isArray(b.tracking)
    ? b.tracking
        .filter((t) => t && String(t.number || '').trim())
        .map((t) => ({ number: String(t.number).trim(), carrier: String(t.carrier || '').trim(), url: trackingUrl(String(t.number).trim()) }))
    : cur.tracking;
  const notes = b.notes ?? cur.notes;
  await env.DB.prepare("UPDATE orders SET status = ?, ae_order_ids = ?, tracking = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, JSON.stringify(aeOrderIds), JSON.stringify(tracking), notes, params.id)
    .run();
  await logEvent(env, params.id, `Admin update: status ${status}; AE ${aeOrderIds.join(',') || '-'}; tracking ${tracking.map((t) => t.number).join(',') || '-'}`);
  const newTracking = tracking.some((t) => !cur.tracking.find((x) => x.number === t.number));
  if (b.notify !== false && newTracking) {
    const sent = await emailShipped(env, { ...cur, tracking });
    if (sent) await logEvent(env, params.id, 'Shipping email sent to customer');
  }
  return json({ ok: true });
}
