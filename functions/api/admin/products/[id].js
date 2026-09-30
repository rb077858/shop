import { json, bad, parseProduct, readJson } from '../../../../lib/util.js';
import { cleanProductInput } from '../../../../lib/products.js';

export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(params.id).first();
  if (!row) return bad('Not found', 404);
  return json({ product: parseProduct(row, { admin: true }) });
}

export async function onRequestPut({ request, env, params }) {
  let p;
  try {
    p = cleanProductInput((await readJson(request)) || {});
  } catch (e) {
    return bad(e.message);
  }
  const r = await env.DB.prepare(
    `UPDATE products SET ae_product_id = ?, title = ?, description = ?, images = ?, price = ?, compare_at_price = ?, cost_usd = ?,
     variants = ?, active = ?, sort = ?, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(p.aeProductId, p.title, p.description, JSON.stringify(p.images), p.price, p.compareAtPrice, p.costUsd, JSON.stringify(p.variants), p.active, p.sort, params.id)
    .run();
  if (!r.meta?.changes) return bad('Not found', 404);
  return json({ ok: true });
}

export async function onRequestDelete({ env, params }) {
  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
