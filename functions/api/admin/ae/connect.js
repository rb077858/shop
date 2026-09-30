import { json, bad, config, randomToken, setSetting } from '../../../../lib/util.js';
import { authorizeUrl, aeConfigured } from '../../../../lib/aliexpress.js';

export async function onRequestPost({ env }) {
  if (!aeConfigured(env)) return bad('הגדירו קודם AE_APP_KEY ו-AE_APP_SECRET');
  const state = randomToken();
  await setSetting(env, 'ae_oauth_state', { value: state, expires: Date.now() + 15 * 60_000 });
  return json({ url: authorizeUrl(env, `${config(env).siteUrl}/api/ae/callback`, state) });
}
