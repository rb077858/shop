import { json, bad, parseProduct } from '../../../lib/util.js';

export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND active = 1').bind(params.id).first();
  if (!row) return bad('Product not found', 404);
  return json({ product: parseProduct(row) }, 200, { 'cache-control': 'public, max-age=60' });
}
