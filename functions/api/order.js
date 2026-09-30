import { json, bad, readJson, parseOrder, safeEqual } from '../../lib/util.js';

// GET /api/order?id=..&t=..  -> order status for the customer
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(url.searchParams.get('id') || '').first();
  if (!row || !safeEqual(row.token, url.searchParams.get('t'))) return bad('ההזמנה לא נמצאה', 404);
  return json({ order: parseOrder(row) });
}

// POST /api/order {id, email} -> link token (order lookup form)
export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const id = String(body?.id || '').trim().toUpperCase();
  const email = String(body?.email || '').trim().toLowerCase();
  const row = await env.DB.prepare('SELECT id, token, email, status FROM orders WHERE id = ?').bind(id).first();
  if (!row || row.email !== email || row.status === 'pending') return bad('לא נמצאה הזמנה עם הפרטים האלה', 404);
  return json({ id: row.id, token: row.token });
}
