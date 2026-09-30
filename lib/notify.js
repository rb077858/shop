import { config, escapeHtml } from './util.js';

export async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, reply_to: env.CONTACT_EMAIL || undefined }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function notifyAdmin(env, subject, text) {
  const c = config(env);
  await Promise.all([
    sendTelegram(env, `${c.storeName}: ${subject}\n${text}`),
    sendEmail(env, { to: env.ADMIN_EMAIL, subject: `[${c.storeName}] ${subject}`, html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre>` }),
  ]);
}

const money = (n, cur) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: cur }).format(n);

function layout(env, title, body) {
  const c = config(env);
  return `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">
<h2 style="color:#111">${escapeHtml(c.storeName)}</h2><h3>${escapeHtml(title)}</h3>${body}
<p style="color:#777;font-size:13px;margin-top:32px">שאלות? השיבו למייל זה${c.contactEmail ? ' או כתבו ל-' + escapeHtml(c.contactEmail) : ''}.</p></div>`;
}

export function orderLink(env, order) {
  return `${config(env).siteUrl}/order.html?id=${encodeURIComponent(order.id)}&t=${encodeURIComponent(order.token)}`;
}

export async function emailOrderConfirmation(env, order) {
  const rows = order.items
    .map((i) => `<tr><td>${escapeHtml(i.title)}${i.variantName ? ' — ' + escapeHtml(i.variantName) : ''} × ${i.qty}</td><td style="text-align:left">${money(i.price * i.qty, order.currency)}</td></tr>`)
    .join('');
  const body = `<p>שלום ${escapeHtml(order.name)}, תודה על ההזמנה! התשלום התקבל ואנחנו מטפלים בהזמנה.</p>
<p><b>מספר הזמנה:</b> ${escapeHtml(order.id)}</p>
<table style="width:100%;border-collapse:collapse">${rows}
<tr><td>משלוח</td><td style="text-align:left">${order.shipping ? money(order.shipping, order.currency) : 'חינם'}</td></tr>
<tr><td><b>סה"כ</b></td><td style="text-align:left"><b>${money(order.total, order.currency)}</b></td></tr></table>
<p>נשלח לכם מספר מעקב ברגע שהחבילה תצא לדרך. זמן משלוח משוער: 10–25 ימי עסקים.</p>
<p><a href="${orderLink(env, order)}">לצפייה בסטטוס ההזמנה</a></p>`;
  return sendEmail(env, { to: order.email, subject: `אישור הזמנה ${order.id}`, html: layout(env, 'אישור הזמנה', body) });
}

export async function emailShipped(env, order) {
  const t = order.tracking.map((x) => `<li><a href="${escapeHtml(x.url)}">${escapeHtml(x.number)}</a>${x.carrier ? ' (' + escapeHtml(x.carrier) + ')' : ''}</li>`).join('');
  const body = `<p>שלום ${escapeHtml(order.name)}, ההזמנה שלכם ${escapeHtml(order.id)} נשלחה!</p>
<p>מספרי מעקב:</p><ul>${t}</ul>
<p>שימו לב: לוקח לפעמים כמה ימים עד שמספר המעקב מתחיל להתעדכן.</p>
<p><a href="${orderLink(env, order)}">לצפייה בסטטוס ההזמנה</a></p>`;
  return sendEmail(env, { to: order.email, subject: `ההזמנה ${order.id} בדרך אליכם`, html: layout(env, 'ההזמנה נשלחה', body) });
}
