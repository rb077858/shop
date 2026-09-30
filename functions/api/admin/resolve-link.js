import { json, readJson } from '../../../lib/util.js';
import { resolveProductLink } from '../../../lib/aliexpress.js';

// POST {url} -> {aeProductId} ; accepts full links, bare ids and short share links (a.aliexpress.com/_xxx)
export async function onRequestPost({ request }) {
  const b = (await readJson(request)) || {};
  try {
    return json(await resolveProductLink(b.url));
  } catch {
    return json({ aeProductId: null });
  }
}
