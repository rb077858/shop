import { round2 } from './util.js';

const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : round2(v));

export function cleanProductInput(b) {
  const title = String(b.title || '').trim().slice(0, 300);
  const price = num(b.price);
  if (!title) throw new Error('Title is required');
  if (!(price > 0)) throw new Error('Price must be greater than 0');
  const images = (Array.isArray(b.images) ? b.images : String(b.images || '').split(/\s+/))
    .map((s) => String(s).trim())
    .filter((s) => /^https:\/\//.test(s))
    .slice(0, 20);
  const variants = (Array.isArray(b.variants) ? b.variants : []).map((v, i) => ({
    id: String(v.id || i + 1),
    skuAttr: String(v.skuAttr || ''),
    name: String(v.name || '').slice(0, 200) || `Option ${i + 1}`,
    options: v.options && typeof v.options === 'object' ? v.options : { Option: String(v.name || i + 1) },
    price: num(v.price) ?? price,
    cost: num(v.cost),
    image: /^https:\/\//.test(v.image || '') ? v.image : '',
    stock: v.stock == null ? null : Number(v.stock),
    disabled: !!v.disabled,
  }));
  return {
    title,
    description: String(b.description || '').slice(0, 200000),
    images,
    price,
    compareAtPrice: num(b.compareAtPrice),
    costUsd: num(b.costUsd),
    aeProductId: String(b.aeProductId || '').replace(/\D/g, '') || null,
    variants,
    active: b.active === false || b.active === 0 ? 0 : 1,
    sort: Number(b.sort) || 0,
  };
}
