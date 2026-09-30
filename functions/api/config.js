import { json, config } from '../../lib/util.js';

export const onRequestGet = ({ env }) => {
  const c = config(env);
  return json({
    storeName: c.storeName,
    currency: c.currency,
    countries: c.countries,
    shippingFee: c.shippingFee,
    freeShippingOver: c.freeShippingOver,
    contactEmail: c.contactEmail,
    paypalClientId: env.PAYPAL_CLIENT_ID || '',
  });
};
