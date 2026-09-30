import { json, bad, readJson, parseOrder, logEvent, trackingUrl } from '../../../../lib/util.js';
import { emailShipped } from '../../../../lib/notify.js';

// POST {updates: [{id, status?, aeOrderIds?: [], tracking?: [{number, carrier}]}], notify?: bool}
// AliExpress order ids and tracking numbers are merged into what the order already has.
export async function onRequestPost({ request, env }) {
  const b = (await readJson(request)) || {};
  if (!Array.isArray(b.updates) || b.updates.length > 500) return bad('Bad request');
  const results = [];
  for (const u of b.updates) {
    const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(String(u.id || '')).first();
    if (!row) {
      results.push({ id: u.id, error: 'not found' });
      continue;
    }
    const o = parseOrder(row, { admin: true });
    const aeOrderIds = [...new Set([...o.aeOrderIds, ...(u.aeOrderIds || []).map((s) => String(s).trim()).filter(Boolean)])];
    const tracking = [...o.tracking];
    for (const t of u.tracking || []) {
      const number = String(t.number || '').trim();
      if (number && !tracking.some((x) => x.number === number)) tracking.push({ number, carrier: String(t.carrier || '').trim(), url: trackingUrl(number) });
    }
    let status = u.status || o.status;
    if (!u.status && ['paid', 'ordered'].includes(o.status)) {
      if (tracking.length) status = 'shipped';
      else if (aeOrderIds.length) status = 'ordered';
    }
    const newTracking = tracking.length > o.tracking.length;
    const changed = status !== o.status || newTracking || aeOrderIds.length !== o.aeOrderIds.length;
    if (changed) {
      await env.DB.prepare("UPDATE orders SET status = ?, ae_order_ids = ?, tracking = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(status, JSON.stringify(aeOrderIds), JSON.stringify(tracking), o.id)
        .run();
      await logEvent(env, o.id, `Bulk update: status ${status}; AE ${aeOrderIds.join(',') || '-'}; tracking ${tracking.map((t) => t.number).join(',') || '-'}`);
    }
    let emailed = false;
    if (newTracking && b.notify !== false) {
      emailed = await emailShipped(env, { ...o, tracking });
      if (emailed) await logEvent(env, o.id, 'Shipping email sent to customer');
    }
    results.push({ id: o.id, changed, status, emailed });
  }
  return json({ ok: true, results });
}
