import { json, logEvent } from '../../../lib/util.js';
import { verifyWebhook, getPaypalOrder } from '../../../lib/paypal.js';
import { loadOrder, captureAndFinalize, finalizeFromPaypal } from '../../../lib/orders.js';
import { notifyAdmin } from '../../../lib/notify.js';

// Safety net: if the customer closed the browser right after approving, we still capture and record the payment.
export async function onRequestPost({ request, env, waitUntil }) {
  const event = await request.json().catch(() => null);
  if (!event) return json({ ok: false }, 400);
  if (!(await verifyWebhook(env, request, event).catch(() => false))) return json({ ok: false, error: 'bad signature' }, 401);

  const r = event.resource || {};
  try {
    if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
      const orderId = r.purchase_units?.[0]?.custom_id;
      const row = orderId && (await loadOrder(env, orderId));
      if (row && row.status === 'pending' && row.paypal_order_id === r.id) await captureAndFinalize(env, row, { waitUntil });
    } else if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const row = r.custom_id && (await loadOrder(env, r.custom_id));
      const ppId = r.supplementary_data?.related_ids?.order_id;
      if (row && row.status === 'pending' && ppId && row.paypal_order_id === ppId) {
        await finalizeFromPaypal(env, row, await getPaypalOrder(env, ppId), { waitUntil });
      }
    } else if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED' || event.event_type === 'PAYMENT.CAPTURE.REVERSED') {
      const row = await env.DB.prepare('SELECT id FROM orders WHERE paypal_capture_id = ?')
        .bind(r.links?.find((l) => l.rel === 'up')?.href?.split('/').pop() || r.id)
        .first();
      if (row) {
        await logEvent(env, row.id, `PayPal ${event.event_type} ${r.amount?.value || ''} ${r.amount?.currency_code || ''}`);
        await notifyAdmin(env, `${event.event_type} ${row.id}`, `PayPal: ${r.amount?.value || ''} ${r.amount?.currency_code || ''}`);
      }
    } else if (event.event_type === 'CUSTOMER.DISPUTE.CREATED') {
      await notifyAdmin(env, 'נפתחה מחלוקת ב-PayPal', JSON.stringify(r.disputed_transactions?.map((t) => t.invoice_number || t.seller_transaction_id) || []));
    }
  } catch (e) {
    await notifyAdmin(env, 'שגיאה ב-webhook של PayPal', `${event.event_type}: ${e.message}`);
  }
  return json({ ok: true });
}
