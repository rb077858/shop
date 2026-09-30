import { json, bad, readJson, logEvent, parseOrder } from '../../../../../lib/util.js';
import { fulfillOnAliExpress, syncOrder, loadOrder } from '../../../../../lib/orders.js';
import { refundCapture } from '../../../../../lib/paypal.js';
import { emailOrderConfirmation, emailShipped } from '../../../../../lib/notify.js';

export async function onRequestPost({ request, env, params }) {
  const id = params.id;
  switch (params.action) {
    case 'fulfill': {
      const ids = await fulfillOnAliExpress(env, id);
      return json({ ok: true, aeOrderIds: ids });
    }
    case 'sync':
      return json(await syncOrder(env, id));
    case 'refund': {
      const row = await loadOrder(env, id);
      if (!row?.paypal_capture_id) return bad('No PayPal capture for this order');
      const b = (await readJson(request)) || {};
      const amount = b.amount ? Number(b.amount) : null;
      const r = await refundCapture(env, row.paypal_capture_id, amount, row.currency);
      const full = !amount || amount >= row.total;
      if (full) await env.DB.prepare("UPDATE orders SET status = 'refunded', updated_at = datetime('now') WHERE id = ?").bind(id).run();
      await logEvent(env, id, `Refund ${r.id} ${r.status} ${amount || row.total} ${row.currency}`);
      return json({ ok: true, refund: { id: r.id, status: r.status } });
    }
    case 'resend': {
      const order = parseOrder(await loadOrder(env, id), { admin: true });
      const ok = order.tracking.length ? await emailShipped(env, order) : await emailOrderConfirmation(env, order);
      return json({ ok });
    }
    default:
      return bad('Unknown action', 404);
  }
}
