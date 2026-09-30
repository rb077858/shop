const app = document.getElementById('app');
const KEY = 'reembir_admin_pw';
let pw = (() => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } })();
let status = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n, c) => (n == null ? '' : new Intl.NumberFormat('he-IL', { style: 'currency', currency: c || status?.config.currency || 'ILS' }).format(n));
const STATUS = { pending: 'ממתין לתשלום', paid: 'שולם — להזמין מהספק', ordered: 'הוזמן מהספק', shipped: 'נשלח', delivered: 'נמסר', cancelled: 'בוטל', refunded: 'הוחזר' };

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

async function api(path, opts = {}) {
  const res = await fetch('/api/admin' + path, {
    ...opts,
    headers: { authorization: `Bearer ${pw}`, 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error('סיסמה שגויה'); }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function logout() {
  pw = '';
  try { sessionStorage.removeItem(KEY); } catch {}
  document.getElementById('tabs').hidden = true;
  loginView();
}
document.getElementById('logout').onclick = logout;

function loginView(err = '') {
  app.innerHTML = `<form class="panel stack" id="login" style="max-width:380px;margin:40px auto">
    <h1>כניסה לניהול</h1><label>סיסמה<input type="password" name="pw" required autofocus></label>
    <button class="btn">כניסה</button><p class="error">${esc(err)}</p></form>`;
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    pw = e.target.pw.value;
    try {
      status = await api('/status');
      try { sessionStorage.setItem(KEY, pw); } catch {}
      start();
    } catch (x) { loginView(x.message); }
  };
}

function start() {
  document.getElementById('tabs').hidden = false;
  window.onhashchange = route;
  route();
}

function route() {
  const [tab, id] = (location.hash.slice(1) || 'orders').split('/');
  document.querySelectorAll('[data-tab]').forEach((a) => (a.style.color = a.dataset.tab === tab ? 'var(--text)' : ''));
  const views = { orders: id ? () => orderView(id) : ordersView, products: id ? () => productEditor(id) : productsView, settings: settingsView };
  (views[tab] || ordersView)().catch((e) => (app.innerHTML = `<p class="error">${esc(e.message)}</p>`));
}

// ---------------- Orders ----------------
async function ordersView() {
  const filter = new URLSearchParams(location.search).get('status') || '';
  const { orders, counts } = await api('/orders' + (filter ? `?status=${filter}` : ''));
  const count = (s) => counts.find((c) => c.status === s)?.n || 0;
  const revenue = counts.filter((c) => !['pending', 'cancelled', 'refunded'].includes(c.status)).reduce((s, c) => s + (c.sum || 0), 0);
  app.innerHTML = `<h1>הזמנות</h1>
    <div class="toolbar">
      ${['', 'paid', 'ordered', 'shipped', 'delivered', 'refunded', 'pending'].map((s) => `<a class="btn small ${s === filter ? '' : 'secondary'}" href="?status=${s}#orders">${s ? STATUS[s] : 'הכל'}${s ? ` (${count(s)})` : ''}</a>`).join('')}
      <span class="muted" style="margin-inline-start:auto">סה״כ מכירות: <b>${money(revenue)}</b></span>
    </div>
    ${count('paid') ? `<p class="notice">⚠️ יש ${count('paid')} הזמנות ששולמו וממתינות להזמנה מאליאקספרס.</p>` : ''}
    <div class="overflow"><table class="list"><thead><tr><th>הזמנה</th><th>תאריך</th><th>לקוח</th><th class="hide-sm">פריטים</th><th>סכום</th><th>סטטוס</th></tr></thead><tbody>
    ${orders.map((o) => `<tr class="click" data-id="${esc(o.id)}"><td><b>${esc(o.id)}</b></td><td>${esc((o.paidAt || o.createdAt).slice(0, 16))}</td><td>${esc(o.name)}</td>
      <td class="hide-sm">${o.items.reduce((s, i) => s + i.qty, 0)}</td><td>${money(o.total, o.currency)}</td><td><span class="pill ${o.status}">${STATUS[o.status] || o.status}</span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">אין הזמנות</td></tr>'}
    </tbody></table></div>`;
  app.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => (location.hash = `orders/${tr.dataset.id}`)));
}

async function orderView(id) {
  const { order: o, events } = await api(`/orders/${encodeURIComponent(id)}`);
  const a = o.address;
  const addrText = [o.name, a.address1, a.address2, `${a.city}${a.state ? ', ' + a.state : ''} ${a.zip || ''}`.trim(), a.country, o.phone].filter(Boolean).join('\n');
  const aeOk = status.aliexpress.connected;
  const costUsd = o.items.reduce((s, i) => s + (i.cost || 0) * i.qty, 0);
  app.innerHTML = `<p><a href="#orders">→ חזרה להזמנות</a></p>
  <h1>הזמנה ${esc(o.id)} <span class="pill ${o.status}">${STATUS[o.status]}</span></h1>
  <div class="two">
    <div class="stack">
      <div class="panel"><h2 style="margin-top:0">פריטים</h2>
        ${o.items.map((i) => `<div class="line"><img src="${esc(i.image)}" alt=""><div><b>${esc(i.title)}</b><div class="meta">${esc(i.variantName || '')} × ${i.qty}${i.cost ? ` · עלות ~$${(i.cost * i.qty).toFixed(2)}` : ''}</div>
          ${i.aeProductId ? `<a class="btn small secondary" style="margin-top:6px" target="_blank" rel="noopener" href="https://www.aliexpress.com/item/${esc(i.aeProductId)}.html">פתח באליאקספרס ↗</a>` : '<span class="muted">אין קישור אליאקספרס</span>'}</div>
          <div>${money(i.price * i.qty, o.currency)}</div></div>`).join('')}
        <div class="totals" style="margin-top:10px"><div><span>משלוח</span><span>${money(o.shipping, o.currency)}</span></div><div class="grand"><span>סה״כ שולם</span><span>${money(o.total, o.currency)}</span></div>
        ${costUsd ? `<div class="muted"><span>עלות משוערת</span><span>$${costUsd.toFixed(2)} ≈ ${money(costUsd * status.config.usdRate, o.currency)}</span></div>` : ''}</div>
      </div>
      <div class="panel"><h2 style="margin-top:0">כתובת למשלוח</h2><pre class="addr" id="addr">${esc(addrText)}</pre>
        <p><button class="btn small secondary" id="copy">העתק כתובת</button> <span class="muted">${esc(o.email)}</span></p></div>
      <div class="panel"><h3 style="margin-top:0">יומן</h3><div class="events">${events.map((e) => `<div>${esc(e.created_at)} — ${esc(e.message)}</div>`).join('')}</div></div>
    </div>
    <div class="stack">
      <div class="panel stack"><h2 style="margin:0">טיפול בהזמנה</h2>
        ${o.status === 'paid' ? (aeOk
          ? `<button class="btn" id="fulfill">🚀 הזמן אוטומטית באליאקספרס</button><p class="muted" style="margin:0">ההזמנה תיווצר בחשבון האליאקספרס שלך עם כתובת הלקוח. ${status.config.aeTryToPay ? 'אליאקספרס ינסה לחייב אוטומטית.' : 'אחר כך יש לשלם עליה ב-AliExpress → My Orders.'}</p>`
          : `<p class="notice" style="margin:0">הזמנה ידנית: פתח את המוצר באליאקספרס, בחר את אותה אפשרות וכמות, הדבק את הכתובת כ"כתובת חדשה", שלם — ואז הדבק כאן את מספר ההזמנה של אליאקספרס ושנה סטטוס ל"הוזמן מהספק".</p>`) : ''}
        <label>סטטוס<select id="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>מספרי הזמנה באליאקספרס (אחד בכל שורה)<textarea id="aeIds" dir="ltr" rows="2">${esc(o.aeOrderIds.join('\n'))}</textarea></label>
        <label>מספרי מעקב (שורה לכל אחד: מספר ואחריו רווח ושם חברה אופציונלי)<textarea id="tracking" dir="ltr" rows="2">${esc(o.tracking.map((t) => `${t.number} ${t.carrier || ''}`.trim()).join('\n'))}</textarea></label>
        <label>הערות פנימיות<textarea id="notes" rows="2">${esc(o.notes || '')}</textarea></label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="notify" checked style="width:auto"> שלח ללקוח מייל כשנוסף מספר מעקב</label>
        <div class="toolbar"><button class="btn" id="save">שמירה</button>
          ${o.aeOrderIds.length && aeOk ? '<button class="btn secondary" id="sync">🔄 משוך מעקב מאליאקספרס</button>' : ''}
          <button class="btn secondary" id="resend">שלח שוב מייל ללקוח</button></div>
      </div>
      <div class="panel stack"><h3 style="margin:0">החזר כספי</h3>
        <p class="muted" style="margin:0">מבצע החזר ב-PayPal ישירות ללקוח. השאר ריק להחזר מלא.</p>
        <div class="toolbar" style="margin:0"><input id="refundAmt" type="number" step="0.01" placeholder="${o.total}" style="max-width:140px"><button class="btn danger small" id="refund" ${o.paypalCaptureId ? '' : 'disabled'}>החזר כספי</button></div>
        <p class="muted" style="margin:0;font-size:13px">PayPal: ${esc(o.paypalOrderId || '-')} / ${esc(o.paypalCaptureId || '-')}</p>
      </div>
    </div>
  </div>`;
  const $ = (s) => document.getElementById(s);
  const act = (btn, fn) => { if (!btn) return; btn.onclick = async () => { btn.disabled = true; try { await fn(); } catch (e) { toast('❌ ' + e.message); } btn.disabled = false; }; };
  $('copy').onclick = () => navigator.clipboard.writeText(addrText).then(() => toast('הכתובת הועתקה'));
  act($('save'), async () => {
    await api(`/orders/${o.id}`, { method: 'PUT', body: {
      status: $('status').value,
      aeOrderIds: $('aeIds').value.split(/\s+/).filter(Boolean),
      tracking: $('tracking').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [number, ...rest] = l.split(/\s+/); return { number, carrier: rest.join(' ') }; }),
      notes: $('notes').value, notify: $('notify').checked } });
    toast('נשמר ✔'); orderView(id);
  });
  act($('fulfill'), async () => { const r = await api(`/orders/${o.id}/fulfill`, { method: 'POST' }); toast('הוזמן באליאקספרס: ' + r.aeOrderIds.join(', ')); orderView(id); });
  act($('sync'), async () => { const r = await api(`/orders/${o.id}/sync`, { method: 'POST' }); toast(r.changed ? 'עודכן ✔' : 'אין עדכון חדש'); orderView(id); });
  act($('resend'), async () => { const r = await api(`/orders/${o.id}/resend`, { method: 'POST' }); toast(r.ok ? 'נשלח ✔' : 'המייל לא נשלח (בדוק הגדרות Resend)'); });
  act($('refund'), async () => {
    const amount = $('refundAmt').value;
    if (!confirm(`לבצע החזר של ${amount || o.total} ${o.currency} ל-${o.name}?`)) return;
    await api(`/orders/${o.id}/refund`, { method: 'POST', body: { amount: amount || null } });
    toast('ההחזר בוצע ✔'); orderView(id);
  });
}

// ---------------- Products ----------------
let draft = null;

async function productsView() {
  const { products } = await api('/products');
  app.innerHTML = `<h1>מוצרים</h1>
  <div class="panel stack" style="margin-bottom:20px">
    <h2 style="margin:0">ייבוא מאליאקספרס</h2>
    ${status.aliexpress.connected
      ? `<div class="toolbar" style="margin:0"><input id="aeUrl" dir="ltr" placeholder="https://www.aliexpress.com/item/1005....html" style="flex:1;min-width:240px"><button class="btn" id="import">ייבוא</button></div>
         <p class="muted" style="margin:0">המוצר ייטען עם כל התמונות, האפשרויות והמחירים (מחיר מוצע = עלות × ${status.config.usdRate} × ${status.config.multiplier}). תוכל לערוך לפני השמירה.</p>`
      : `<p class="muted" style="margin:0">חשבון אליאקספרס לא מחובר — ייבוא אוטומטי לא זמין. אפשר להוסיף מוצר ידנית, או לחבר את ה-API ב<a href="#settings">הגדרות</a>.</p>`}
    <div><button class="btn secondary" id="new">+ מוצר חדש ידני</button></div>
  </div>
  <div class="overflow"><table class="list"><thead><tr><th></th><th>מוצר</th><th>מחיר</th><th class="hide-sm">עלות $</th><th>פעיל</th><th></th></tr></thead><tbody>
  ${products.map((p) => `<tr><td><img src="${esc(p.images[0] || '')}" alt=""></td><td><a href="#products/${p.id}">${esc(p.title)}</a><div class="muted" style="font-size:13px">${p.variants.length} אפשרויות</div></td>
    <td>${money(p.price)}</td><td class="hide-sm">${p.costUsd ?? ''}</td><td>${p.active ? '✔' : '—'}</td>
    <td><a class="btn small secondary" href="/product.html?id=${p.id}" target="_blank">צפייה</a></td></tr>`).join('') || '<tr><td colspan="6" class="muted">אין מוצרים עדיין</td></tr>'}
  </tbody></table></div>`;
  document.getElementById('new').onclick = () => { draft = { title: '', price: '', images: [], variants: [], active: true, description: '' }; location.hash = 'products/new'; };
  const imp = document.getElementById('import');
  if (imp) imp.onclick = async () => {
    imp.disabled = true; imp.textContent = 'טוען…';
    try { draft = (await api('/import', { method: 'POST', body: { url: document.getElementById('aeUrl').value } })).draft; location.hash = 'products/new'; }
    catch (e) { toast('❌ ' + e.message); imp.disabled = false; imp.textContent = 'ייבוא'; }
  };
}

async function productEditor(id) {
  let p;
  if (id === 'new') { p = draft || { title: '', price: '', images: [], variants: [], active: true }; }
  else p = (await api(`/products/${id}`)).product;
  const vRow = (v, i) => `<tr data-i="${i}"><td>${v.image ? `<img src="${esc(v.image)}" alt="">` : ''}</td>
    <td><input data-f="name" value="${esc(v.name)}"></td><td><input data-f="price" type="number" step="0.01" value="${v.price ?? ''}" style="width:100px"></td>
    <td class="hide-sm">${v.cost != null ? '$' + v.cost : ''}${v.stock != null ? ` · מלאי ${v.stock}` : ''}</td>
    <td><input type="checkbox" data-f="disabled" ${v.disabled ? 'checked' : ''} style="width:auto"></td><td><button class="link-btn" data-del="${i}">מחק</button></td></tr>`;
  app.innerHTML = `<p><a href="#products">→ חזרה למוצרים</a></p><h1>${id === 'new' ? 'מוצר חדש' : 'עריכת מוצר'}</h1>
  <form class="stack" id="pf">
    <div class="panel fields" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <label class="full" style="grid-column:1/-1">שם המוצר (מומלץ לתרגם לעברית)<input name="title" value="${esc(p.title)}" required></label>
      <label>מחיר מכירה (${status.config.currency})<input name="price" type="number" step="0.01" value="${p.price ?? ''}" required></label>
      <label>מחיר לפני הנחה (להצגה, לא חובה)<input name="compareAtPrice" type="number" step="0.01" value="${p.compareAtPrice ?? ''}"></label>
      <label>מזהה מוצר באליאקספרס<input name="aeProductId" dir="ltr" value="${esc(p.aeProductId || '')}" placeholder="1005..."></label>
      <label>עלות בדולרים (לחישוב רווח)<input name="costUsd" type="number" step="0.01" value="${p.costUsd ?? ''}"></label>
      <label>סדר הצגה (מספר קטן = ראשון)<input name="sort" type="number" value="${p.sort || 0}"></label>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''} style="width:auto"> מוצג בחנות</label>
      <label style="grid-column:1/-1">תמונות (קישור https בכל שורה, הראשונה היא הראשית)<textarea name="images" dir="ltr" rows="4">${esc((p.images || []).join('\n'))}</textarea></label>
      <label style="grid-column:1/-1">תיאור (HTML מותר)<textarea name="description" rows="8" dir="auto">${esc(p.description || '')}</textarea></label>
    </div>
    <div class="panel"><h2 style="margin-top:0">אפשרויות (צבע / מידה)</h2>
      <p class="muted">מוצר בלי אפשרויות — השאר ריק. סמן "אזל" כדי להסתיר אפשרות.</p>
      <div class="overflow"><table class="list vt"><thead><tr><th></th><th>שם</th><th>מחיר</th><th class="hide-sm">עלות</th><th>אזל</th><th></th></tr></thead><tbody id="vbody">${(p.variants || []).map(vRow).join('')}</tbody></table></div>
      <p><button type="button" class="btn small secondary" id="addV">+ הוסף אפשרות</button> <button type="button" class="btn small secondary" id="bulk">החל מחיר ראשי על כל האפשרויות</button></p>
    </div>
    <div class="toolbar"><button class="btn">שמירה</button>${id !== 'new' ? '<button type="button" class="btn danger" id="del">מחיקת מוצר</button>' : ''}</div>
  </form>`;
  const variants = (p.variants || []).map((v) => ({ ...v }));
  const vbody = document.getElementById('vbody');
  const readRows = () => vbody.querySelectorAll('tr').forEach((tr) => {
    const v = variants[+tr.dataset.i];
    v.name = tr.querySelector('[data-f=name]').value;
    v.price = tr.querySelector('[data-f=price]').value;
    v.disabled = tr.querySelector('[data-f=disabled]').checked;
    if (!v.skuAttr && Object.keys(v.options || {}).length <= 1) v.options = { 'אפשרות': v.name };
  });
  const redraw = () => (vbody.innerHTML = variants.map(vRow).join(''));
  vbody.onclick = (e) => { if (e.target.dataset.del != null) { readRows(); variants.splice(+e.target.dataset.del, 1); redraw(); } };
  document.getElementById('addV').onclick = () => { readRows(); variants.push({ id: String(Date.now()), name: '', price: document.querySelector('[name=price]').value, options: {} }); redraw(); };
  document.getElementById('bulk').onclick = () => { readRows(); const pr = document.querySelector('[name=price]').value; variants.forEach((v) => (v.price = pr)); redraw(); };
  const del = document.getElementById('del');
  if (del) del.onclick = async () => { if (confirm('למחוק את המוצר?')) { await api(`/products/${id}`, { method: 'DELETE' }); location.hash = 'products'; } };
  document.getElementById('pf').onsubmit = async (e) => {
    e.preventDefault(); readRows();
    const f = e.target;
    const body = {
      title: f.title.value, price: f.price.value, compareAtPrice: f.compareAtPrice.value, aeProductId: f.aeProductId.value, costUsd: f.costUsd.value,
      sort: f.sort.value, active: f.active.checked, images: f.images.value.split(/\s+/).filter(Boolean), description: f.description.value,
      variants: variants.filter((v) => v.name.trim()),
    };
    try {
      if (id === 'new') { const r = await api('/products', { method: 'POST', body }); draft = null; toast('נשמר ✔'); location.hash = `products/${r.id}`; }
      else { await api(`/products/${id}`, { method: 'PUT', body }); toast('נשמר ✔'); }
    } catch (x) { toast('❌ ' + x.message); }
  };
}

// ---------------- Settings ----------------
async function settingsView() {
  status = await api('/status');
  const s = status;
  const row = (ok, label, detail = '') => `<div class="line" style="grid-template-columns:28px 1fr"><span class="${ok ? 'ok' : 'bad'}">${ok ? '✔' : '✘'}</span><div><b>${label}</b><div class="meta">${detail}</div></div></div>`;
  const d = (ms) => (ms ? new Date(ms).toLocaleDateString('he-IL') : '');
  app.innerHTML = `<h1>הגדרות וחיבורים</h1>
  <div class="two">
    <div class="panel">
      ${row(s.paypal.configured, `PayPal (${s.paypal.env})`, s.paypal.configured ? (s.paypal.webhook ? 'מחובר + Webhook' : 'מחובר. מומלץ להגדיר גם PAYPAL_WEBHOOK_ID') : 'הגדר PAYPAL_CLIENT_ID ו-PAYPAL_CLIENT_SECRET')}
      ${row(s.aliexpress.configured, 'AliExpress API — מפתחות', s.aliexpress.configured ? 'AE_APP_KEY מוגדר' : 'לא חובה. בלי זה עובדים במצב ידני')}
      ${row(s.aliexpress.connected, 'AliExpress — חשבון מחובר', s.aliexpress.connected ? `${esc(s.aliexpress.account)} · בתוקף עד ${d(s.aliexpress.expiresAt)} (חידוש עד ${d(s.aliexpress.refreshExpiresAt)})` : 'לחץ "חיבור" למטה')}
      ${row(s.email.configured, 'מיילים ללקוחות (Resend)', s.email.configured ? `התראות מנהל ל: ${esc(s.email.adminEmail || '—')}` : 'הגדר RESEND_API_KEY ו-EMAIL_FROM')}
      ${row(s.telegram, 'התראות טלגרם', s.telegram ? 'פעיל' : 'לא חובה')}
      ${row(true, 'הזמנה אוטומטית אחרי תשלום', s.config.aeAutoOrder ? 'פעיל (AE_AUTO_ORDER=true)' : 'כבוי — ההזמנה מאליאקספרס בלחיצה אחת מדף ההזמנה')}
    </div>
    <div class="panel stack">
      <h2 style="margin:0">אליאקספרס</h2>
      <p class="muted" style="margin:0">החיבור נותן לאפליקציה הרשאה ליצור הזמנות ולמשוך מעקב בחשבון האליאקספרס שלך. יש לחדש פעם בכמה חודשים.</p>
      <div class="toolbar" style="margin:0">
        <button class="btn" id="connect" ${s.aliexpress.configured ? '' : 'disabled'}>${s.aliexpress.connected ? 'חיבור מחדש' : 'חיבור חשבון אליאקספרס'}</button>
        <button class="btn secondary" id="syncAll" ${s.aliexpress.connected ? '' : 'disabled'}>🔄 משוך מעקב לכל ההזמנות</button>
      </div>
      <p class="muted" style="margin:0;font-size:13px">Callback URL להגדרה באפליקציה: <code dir="ltr">${esc(s.config.siteUrl)}/api/ae/callback</code></p>
      <h2 style="margin:12px 0 0">תמחור</h2>
      <p class="muted" style="margin:0">מטבע ${esc(s.config.currency)} · שער דולר ${s.config.usdRate} · מכפיל ${s.config.multiplier} · משלוח ${s.config.shippingFee || 'חינם'}${s.config.freeShippingOver ? ` (חינם מעל ${s.config.freeShippingOver})` : ''}. משנים ב-wrangler.toml או במשתני הסביבה ב-Cloudflare.</p>
    </div>
  </div>`;
  document.getElementById('connect').onclick = async () => { try { location.href = (await api('/ae/connect', { method: 'POST' })).url; } catch (e) { toast('❌ ' + e.message); } };
  document.getElementById('syncAll').onclick = async (e) => {
    e.target.disabled = true;
    try { const r = await api('/sync-all', { method: 'POST' }); toast(`נבדקו ${r.results?.length || 0} הזמנות, עודכנו ${r.results?.filter((x) => x.changed).length || 0}`); }
    catch (x) { toast('❌ ' + x.message); }
    e.target.disabled = false;
  };
}

if (pw) api('/status').then((s) => { status = s; start(); }).catch(() => loginView());
else loginView();
