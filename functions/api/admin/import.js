import { json, bad, readJson, config, suggestPrice } from '../../../lib/util.js';
import { getProduct, parseProductId } from '../../../lib/aliexpress.js';

// POST {url} -> product draft fetched from AliExpress (not saved; the admin reviews and saves it)
export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const id = parseProductId(body?.url);
  if (!id) return bad('לא זוהה מזהה מוצר. הדביקו קישור בסגנון https://www.aliexpress.com/item/1005001234567890.html');
  const ae = await getProduct(env, id, config(env).shipTo);
  const variants = ae.variants.map((v) => ({ ...v, price: suggestPrice(env, v.cost), disabled: v.stock === 0 }));
  const costs = ae.variants.map((v) => v.cost).filter((c) => c > 0);
  const costUsd = costs.length ? Math.min(...costs) : 0;
  const price = suggestPrice(env, costUsd);
  return json({
    draft: {
      aeProductId: ae.aeProductId,
      title: ae.title,
      description: ae.description,
      images: ae.images,
      price,
      compareAtPrice: Math.ceil(price * 1.6) - 0.1,
      costUsd,
      variants: variants.length > 1 ? variants : variants.map((v) => ({ ...v, name: 'Default' })),
      active: true,
    },
  });
}
