import { json, parseProduct, readJson, randomId, bad } from '../../../../lib/util.js';
import { cleanProductInput } from '../../../../lib/products.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY sort ASC, created_at DESC').all();
  return json({ products: results.map((r) => parseProduct(r, { admin: true })) });
}

export async function onRequestPost({ request, env }) {
  let p;
  try {
    p = cleanProductInput((await readJson(request)) || {});
  } catch (e) {
    return bad(e.message);
  }
  const id = randomId(8).toLowerCase();
  await env.DB.prepare(
    `INSERT INTO products (id, ae_product_id, title, description, images, price, compare_at_price, cost_usd, variants, active, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, p.aeProductId, p.title, p.description, JSON.stringify(p.images), p.price, p.compareAtPrice, p.costUsd, JSON.stringify(p.variants), p.active, p.sort)
    .run();
  return json({ id });
}
