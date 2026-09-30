import { json, parseOrder } from '../../../../lib/util.js';

export async function onRequestGet({ request, env }) {
  const status = new URL(request.url).searchParams.get('status');
  const stmt = status
    ? env.DB.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT 300').bind(status)
    : env.DB.prepare("SELECT * FROM orders WHERE status != 'pending' ORDER BY created_at DESC LIMIT 300");
  const { results } = await stmt.all();
  const counts = await env.DB.prepare('SELECT status, COUNT(*) AS n, SUM(total) AS sum FROM orders GROUP BY status').all();
  return json({ orders: results.map((r) => parseOrder(r, { admin: true })), counts: counts.results });
}
