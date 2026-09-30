import { json, bad, readJson } from '../../../lib/util.js';
import { loadOrder, captureAndFinalize } from '../../../lib/orders.js';

export async function onRequestPost({ request, env, waitUntil }) {
  const body = await readJson(request);
  const row = body?.orderId ? await loadOrder(env, String(body.orderId)) : null;
  if (!row || row.paypal_order_id !== body.paypalOrderId) return bad('Order not found', 404);
  try {
    const r = await captureAndFinalize(env, row, { waitUntil });
    if (!r.ok) {
      return json({ error: 'התשלום לא הושלם. אם חויבתם, צרו איתנו קשר עם מספר ההזמנה ' + row.id, status: r.status }, 402);
    }
    return json({ ok: true, orderId: row.id, token: row.token });
  } catch (e) {
    if (e.issue === 'INSTRUMENT_DECLINED') return json({ error: 'אמצעי התשלום נדחה, נסו אמצעי אחר', restart: true }, 402);
    return bad('שגיאה באישור התשלום: ' + e.message, 502);
  }
}
