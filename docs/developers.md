# Developer notes

Local development (requires Node.js):

```bash
npm install
cp .dev.vars.example .dev.vars          # fill in values, PAYPAL_ENV=sandbox
npx wrangler d1 execute reembir-shop --local --file=schema.sql
npx wrangler pages dev public           # http://localhost:8788 , admin at /admin/
```

Test overrides: `PAYPAL_API_BASE` and `AE_API_BASE` point the PayPal / AliExpress clients at a mock server.

Code layout:

```
public/                 static storefront (no build step)
  admin/                admin panel (admin.js), vendor/xlsx.full.min.js (SheetJS, Apache-2.0) for reading Excel files
functions/api/          Cloudflare Pages Functions
  products, checkout/create, checkout/capture, order, paypal/webhook, ae/callback
  admin/*               password protected (Bearer ADMIN_PASSWORD)
    orders/bulk         bulk status / AliExpress order id / tracking import (used by the DSers screen)
    settings/dsers      stored DSers CSV template headers
lib/                    paypal.js, aliexpress.js, orders.js, notify.js, products.js, util.js
schema.sql              D1 schema
```

DSers CSV: product rows use SKU `<productId>-<variantId>` (or `<productId>` without variants); the order export uses the same SKUs.
Column headers are matched to roles by normalized name (see `PRODUCT_ROLES` / `ORDER_ROLES` in `public/admin/admin.js`),
so uploading the original DSers templates in the admin makes exports follow them exactly.
