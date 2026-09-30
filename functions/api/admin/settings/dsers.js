import { json, readJson, getSetting, setSetting } from '../../../../lib/util.js';

// Stores the column headers of the DSers CSV templates (import_products / import_orders)
// so exports match the template the user downloaded from DSers exactly.
export async function onRequestGet({ env }) {
  return json({ templates: (await getSetting(env, 'dsers_templates')) || { products: [], orders: [] } });
}

export async function onRequestPut({ request, env }) {
  const b = (await readJson(request)) || {};
  const clean = (a) => (Array.isArray(a) ? a.map((s) => String(s).slice(0, 100)).filter(Boolean).slice(0, 80) : []);
  const cur = (await getSetting(env, 'dsers_templates')) || { products: [], orders: [] };
  const next = {
    products: b.products !== undefined ? clean(b.products) : cur.products,
    orders: b.orders !== undefined ? clean(b.orders) : cur.orders,
  };
  await setSetting(env, 'dsers_templates', next);
  return json({ templates: next });
}
