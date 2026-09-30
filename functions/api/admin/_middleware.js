import { bad, safeEqual } from '../../../lib/util.js';

export async function onRequest({ request, env, next }) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 10) return bad('ADMIN_PASSWORD is not set (min 10 chars)', 503);
  const auth = request.headers.get('authorization') || '';
  if (!safeEqual(auth.replace(/^Bearer\s+/i, ''), env.ADMIN_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 500));
    return bad('Unauthorized', 401);
  }
  try {
    return await next();
  } catch (e) {
    return bad(e.message || String(e), 500);
  }
}
