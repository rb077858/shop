import { json, parseProduct } from '../../../lib/util.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort ASC, created_at DESC').all();
  const products = results.map((r) => {
    const p = parseProduct(r);
    return { id: p.id, title: p.title, image: p.images[0] || '', price: p.price, compareAtPrice: p.compareAtPrice };
  });
  return json({ products }, 200, { 'cache-control': 'public, max-age=60' });
}
