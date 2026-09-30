import { json, config } from '../../../lib/util.js';
import { aeStatus } from '../../../lib/aliexpress.js';

export async function onRequestGet({ env }) {
  const c = config(env);
  return json({
    config: c,
    paypal: { configured: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET), env: env.PAYPAL_ENV || 'live', webhook: !!env.PAYPAL_WEBHOOK_ID },
    email: { configured: !!(env.RESEND_API_KEY && env.EMAIL_FROM), adminEmail: env.ADMIN_EMAIL || '' },
    telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    aliexpress: await aeStatus(env),
  });
}
