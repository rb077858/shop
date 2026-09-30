import { json } from '../../../lib/util.js';
import { syncOrder } from '../../../lib/orders.js';
import { aeConfigured } from '../../../lib/aliexpress.js';

// Pull tracking for all orders placed on AliExpress (called by the admin button or the GitHub Actions cron).
export async function onRequestPost({ env }) {
  if (!aeConfigured(env)) return json({ ok: false, error: 'AliExpress API not configured' });
  const { results } = await env.DB.prepare(
    "SELECT id FROM orders WHERE status IN ('ordered','shipped') AND ae_order_ids != '[]' ORDER BY updated_at ASC LIMIT 40"
  ).all();
  const out = [];
  for (const { id } of results) {
    try {
      out.push({ id, ...(await syncOrder(env, id)) });
    } catch (e) {
      out.push({ id, error: e.message });
    }
  }
  return json({ ok: true, results: out });
}
