import { getSetting, setSetting, escapeHtml } from '../../../lib/util.js';
import { exchangeCode } from '../../../lib/aliexpress.js';

const page = (msg) =>
  new Response(`<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:sans-serif;padding:40px"><h2>${msg}</h2><a href="/admin/">חזרה לניהול</a>`, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

// OAuth redirect target. Register this URL in your AliExpress app: https://YOUR-DOMAIN/api/ae/callback
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const state = await getSetting(env, 'ae_oauth_state');
  if (!state || state.value !== url.searchParams.get('state') || state.expires < Date.now()) return page('קישור החיבור פג תוקף. נסו שוב מדף הניהול.');
  await setSetting(env, 'ae_oauth_state', null);
  const code = url.searchParams.get('code');
  if (!code) return page('אליאקספרס לא החזיר קוד הרשאה.');
  try {
    const t = await exchangeCode(env, code);
    return page(`חשבון אליאקספרס חובר בהצלחה ${escapeHtml(t.account)} ✔`);
  } catch (e) {
    return page('החיבור נכשל: ' + escapeHtml(e.message));
  }
}
