let cachedToken = null;

export function paypalBase(env) {
  if (env.PAYPAL_API_BASE) return env.PAYPAL_API_BASE; // testing override
  return env.PAYPAL_ENV === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

async function accessToken(env) {
  if (cachedToken && cachedToken.env === env.PAYPAL_ENV && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new Error('PayPal is not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)');
  const res = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth failed: ${data.error_description || res.status}`);
  cachedToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000, env: env.PAYPAL_ENV };
  return cachedToken.value;
}

export async function paypalFetch(env, path, { method = 'GET', body, requestId } = {}) {
  const token = await accessToken(env);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' };
  if (requestId) headers['paypal-request-id'] = requestId;
  const res = await fetch(`${paypalBase(env)}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const issue = data.details?.[0]?.issue || data.name || res.status;
    const err = new Error(`PayPal ${method} ${path} failed: ${issue} ${data.details?.[0]?.description || data.message || ''}`.trim());
    err.issue = issue;
    err.data = data;
    throw err;
  }
  return data;
}

const fmt = (n) => Number(n).toFixed(2);

export async function createPaypalOrder(env, order, storeName) {
  const addr = order.address;
  return paypalFetch(env, '/v2/checkout/orders', {
    method: 'POST',
    requestId: `create-${order.id}`,
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: order.id,
          custom_id: order.id,
          invoice_id: order.id,
          description: `${storeName} order ${order.id}`.slice(0, 127),
          amount: {
            currency_code: order.currency,
            value: fmt(order.total),
            breakdown: {
              item_total: { currency_code: order.currency, value: fmt(order.subtotal) },
              shipping: { currency_code: order.currency, value: fmt(order.shipping) },
            },
          },
          items: order.items.map((i) => ({
            name: i.title.slice(0, 127),
            description: (i.variantName || '').slice(0, 127) || undefined,
            sku: `${i.productId}${i.variantId ? ':' + i.variantId : ''}`.slice(0, 127),
            quantity: String(i.qty),
            unit_amount: { currency_code: order.currency, value: fmt(i.price) },
            category: 'PHYSICAL_GOODS',
          })),
          shipping: {
            type: 'SHIPPING',
            name: { full_name: order.name.slice(0, 300) },
            address: {
              address_line_1: addr.address1.slice(0, 300),
              address_line_2: (addr.address2 || '').slice(0, 300) || undefined,
              admin_area_2: addr.city.slice(0, 120),
              admin_area_1: (addr.state || '').slice(0, 300) || undefined,
              postal_code: (addr.zip || '').slice(0, 60) || undefined,
              country_code: addr.country,
            },
          },
        },
      ],
      application_context: {
        brand_name: storeName.slice(0, 127),
        shipping_preference: 'SET_PROVIDED_ADDRESS',
        user_action: 'PAY_NOW',
      },
    },
  });
}

export async function capturePaypalOrder(env, paypalOrderId) {
  return paypalFetch(env, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    requestId: `capture-${paypalOrderId}`,
    body: {},
  });
}

export async function getPaypalOrder(env, paypalOrderId) {
  return paypalFetch(env, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
}

export async function refundCapture(env, captureId, amount, currency) {
  const body = amount ? { amount: { value: fmt(amount), currency_code: currency } } : {};
  return paypalFetch(env, `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, { method: 'POST', body });
}

export async function verifyWebhook(env, request, event) {
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const h = (k) => request.headers.get(k);
  const res = await paypalFetch(env, '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      auth_algo: h('paypal-auth-algo'),
      cert_url: h('paypal-cert-url'),
      transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'),
      transmission_time: h('paypal-transmission-time'),
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    },
  });
  return res.verification_status === 'SUCCESS';
}
