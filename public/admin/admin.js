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
  const views = { orders: id ? () => orderView(id) : ordersView, products: id ? () => productEditor(id) : productsView, dsers: dsersView, settings: settingsView };
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
    ${count('paid') ? `<p class="notice">⚠️ יש ${count('paid')} הזמנות ששולמו וממתינות להזמנה מהספק. <a href="#dsers">לייצוא ל-DSers ←</a></p>` : ''}
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
        <p><button class="btn small secondary" id="copy">העתק כתובת</button> <span class="muted">${esc(o.email)}</span></p>
        ${/[\u0590-\u05FF]/.test(addrText) ? '<p class="notice" style="margin:0 0 10px">הכתובת כתובה בעברית. לפני שליחה ל-DSers / אליאקספרס כדאי לתרגם אותה לאנגלית בעריכה למטה.</p>' : ''}
        <details><summary style="cursor:pointer">עריכת פרטי משלוח (באנגלית)</summary>
          <form class="fields" id="addrForm" style="margin-top:12px">
            <label class="full">שם מלא<input name="name" dir="ltr" value="${esc(o.name)}"></label>
            <label>טלפון<input name="phone" dir="ltr" value="${esc(o.phone)}"></label>
            <label>מדינה (קוד, למשל IL)<input name="country" dir="ltr" value="${esc(a.country)}"></label>
            <label class="full">רחוב ומספר<input name="address1" dir="ltr" value="${esc(a.address1)}"></label>
            <label class="full">דירה / כניסה<input name="address2" dir="ltr" value="${esc(a.address2 || '')}"></label>
            <label>עיר<input name="city" dir="ltr" value="${esc(a.city)}"></label>
            <label>מחוז / Province<input name="state" dir="ltr" value="${esc(a.state || '')}"></label>
            <label>מיקוד<input name="zip" dir="ltr" value="${esc(a.zip || '')}"></label>
            <div class="full"><button class="btn small" id="saveAddr" type="button">שמירת כתובת</button></div>
          </form></details></div>
      <div class="panel"><h3 style="margin-top:0">יומן</h3><div class="events">${events.map((e) => `<div>${esc(e.created_at)} — ${esc(e.message)}</div>`).join('')}</div></div>
    </div>
    <div class="stack">
      <div class="panel stack"><h2 style="margin:0">טיפול בהזמנה</h2>
        ${o.status === 'paid' ? `<p class="notice" style="margin:0">דרך DSers: עבור ללשונית <a href="#dsers">DSers</a> וייצא את ההזמנות ששולמו לקובץ.</p>` : ''}
        ${o.status === 'paid' ? (aeOk
          ? `<button class="btn" id="fulfill">🚀 הזמן אוטומטית באליאקספרס</button><p class="muted" style="margin:0">ההזמנה תיווצר בחשבון האליאקספרס שלך עם כתובת הלקוח. ${status.config.aeTryToPay ? 'אליאקספרס ינסה לחייב אוטומטית.' : 'אחר כך יש לשלם עליה ב-AliExpress → My Orders.'}</p>`
          : `<p class="muted" style="margin:0">או הזמנה ידנית: פתח את המוצר באליאקספרס, בחר את אותה אפשרות וכמות, הדבק את הכתובת כ"כתובת חדשה", שלם — ואז הדבק כאן את מספר ההזמנה של אליאקספרס ושנה סטטוס ל"הוזמן מהספק".</p>`) : ''}
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
  act($('saveAddr'), async () => {
    const f = Object.fromEntries(new FormData($('addrForm')));
    await api(`/orders/${o.id}`, { method: 'PUT', body: { name: f.name, phone: f.phone, address: { address1: f.address1, address2: f.address2, city: f.city, state: f.state, zip: f.zip, country: f.country } } });
    toast('הכתובת נשמרה ✔'); orderView(id);
  });
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

// ---------------- DSers (CSV store) ----------------
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCSV = (headers, rows) => [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

let xlsxLib;
const loadXlsx = () => (xlsxLib ||= new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = '/admin/vendor/xlsx.full.min.js';
  s.onload = () => res(window.XLSX);
  s.onerror = () => rej(new Error('לא ניתן לטעון את קורא קובצי האקסל. שמור את הקובץ כ-CSV ונסה שוב.'));
  document.head.append(s);
}));

// Reads .csv / .xlsx / .xls into an array of rows (array of strings).
async function readTable(file) {
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    return rows.map((r) => r.map((c) => (typeof c === 'number' ? (Number.isInteger(c) ? BigInt(Math.round(c)).toString() : String(c)) : String(c ?? '')).trim()))
      .filter((r) => r.some(Boolean));
  }
  return parseCSV(await file.text()).map((r) => r.map((c) => String(c).trim()));
}

// Column roles we know how to fill. First exact (normalized) names, then keyword rules.
const PRODUCT_ROLES = [
  ['supplierSku', ['suppliersku', 'skusuppliersku', 'supplierskuid', 'aliexpresssku'], (n) => n.includes('supplier') && n.includes('sku')],
  ['supplierUrl', ['supplierurl', 'supplierlink', 'aliexpressurl', 'aliexpresslink', 'productlink', 'producturl', 'url', 'link'], (n) => (n.includes('url') || n.includes('link')) && !n.includes('image') && !n.includes('img')],
  ['productId', ['productid', 'productsid', 'storeproductid', 'id'], (n) => n.includes('product') && n.includes('id')],
  ['sku', ['sku', 'productsku', 'storesku', 'variantsku', 'skuid', 'skucode'], (n) => n.includes('sku') && !n.includes('title') && !n.includes('name')],
  ['variantTitle', ['skutitle', 'skuname', 'varianttitle', 'variantname', 'variant', 'option', 'options', 'specification', 'skuattribute'], (n) => n.includes('variant') || (n.includes('sku') && (n.includes('title') || n.includes('name')))],
  ['title', ['title', 'producttitle', 'productname', 'name'], (n) => n.includes('title') || n.includes('name')],
  ['price', ['price', 'skuprice', 'saleprice', 'variantprice', 'productprice'], (n) => n.includes('price')],
  ['image', ['image', 'imageurl', 'productimage', 'skuimage', 'variantimage', 'img', 'picture', 'imagesrc'], (n) => n.includes('image') || n.includes('img')],
  ['stock', ['stock', 'inventory', 'inventoryquantity', 'qty', 'quantity'], (n) => n.includes('stock') || n.includes('inventory')],
];
const ORDER_ROLES = [
  ['blank', ['aliexpressordernumber', 'aliexpressorderno', 'trackingnumber', 'trackingno', 'status', 'orderstatus', 'cpf', 'taxnumber', 'passportno', 'vatno', 'rut'], (n) => n.includes('aliexpress') || n.includes('tracking') || n.includes('tax') || n.includes('passport')],
  ['orderNumber', ['ordernumber', 'orderno', 'orderid', 'order', 'ordername'], (n) => n.startsWith('order') && !n.includes('memo') && !n.includes('date')],
  ['date', ['date', 'orderdate', 'createdat', 'createtime', 'ordertime'], (n) => n.includes('date') || n.includes('time')],
  ['countryCode', ['countrycode', 'countryiso'], (n) => n.includes('country') && n.includes('code')],
  ['phoneCountry', ['phonecountry', 'phonecountrycode', 'countrycallingcode', 'phonecode'], (n) => n.includes('phone') && (n.includes('country') || n.includes('code'))],
  ['country', ['country', 'countryname', 'countryregion'], (n) => n.includes('country')],
  ['province', ['province', 'state', 'provincestate', 'region', 'stateprovince'], (n) => n.includes('province') || n.includes('state')],
  ['city', ['city', 'town'], (n) => n.includes('city')],
  ['address2', ['address2', 'addressline2', 'address02', 'apartment'], (n) => n.includes('address') && n.includes('2')],
  ['address', ['address', 'address1', 'addressline1', 'street', 'detailaddress'], (n) => n.includes('address') && !n.includes('mail')],
  ['zip', ['zip', 'zipcode', 'postcode', 'postalcode'], (n) => n.includes('zip') || n.includes('post')],
  ['productId', ['productid', 'productsid'], (n) => n.includes('product') && n.includes('id')],
  ['sku', ['sku', 'productsku', 'variantsku', 'skucode'], (n) => n.includes('sku')],
  ['qty', ['productcount', 'quantity', 'qty', 'count', 'productquantity'], (n) => n.includes('count') || n.includes('quantity') || n.includes('qty')],
  ['memo', ['ordermemo', 'memo', 'note', 'notes', 'remark', 'remarks'], (n) => n.includes('memo') || n.includes('note') || n.includes('remark')],
  ['contactPerson', ['contactperson', 'contact', 'contactname'], (n) => n.includes('contact')],
  ['fullName', ['fullname', 'name', 'customername', 'receiver', 'receivername', 'recipient', 'firstname'], (n) => n.includes('name')],
  ['mobile', ['mobileno', 'mobile', 'phone', 'phonenumber', 'mobilephone', 'tel', 'telephone', 'mobilenumber'], (n) => n.includes('mobile') || n.includes('phone') || n.includes('tel')],
  ['email', ['email', 'mail', 'emailaddress'], (n) => n.includes('mail')],
];
function roleOf(header, roles) {
  const n = norm(header);
  for (const [role, exact] of roles) if (exact.includes(n)) return role;
  for (const [role, , rule] of roles) if (rule(n)) return role;
  return null;
}

const DEFAULT_PRODUCT_HEADERS = ['Product id', 'SKU', 'Supplier url'];
const DEFAULT_ORDER_HEADERS = ['Order number', 'Date', 'Country', 'Province', 'City', 'Address', 'Address2', 'Zip', 'Product id', 'SKU', 'Product count', 'Order memo', 'Contact person', 'Mobile no', 'Email'];
const PHONE_CODES = { IL: '972', US: '1', CA: '1', GB: '44', DE: '49', FR: '33', AU: '61' };

const skuOf = (productId, variantId) => (variantId ? `${productId}-${variantId}` : productId);
const clean = (s) => String(s ?? '').replace(/[^\p{L}\p{N} ,.\-\/]/gu, ' ').replace(/\s+/g, ' ').trim();
const countryName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; } };
const hasHebrew = (s) => /[֐-׿]/.test(s || '');
function phoneLocal(phone, country) {
  let d = String(phone || '').replace(/\D/g, '');
  const cc = PHONE_CODES[country];
  if (cc && d.startsWith(cc) && d.length > 9) d = d.slice(cc.length);
  if (d.startsWith('0')) d = d.slice(1);
  return { cc, local: d };
}

function productRows(products, headers) {
  const roles = headers.map((h) => roleOf(h, PRODUCT_ROLES));
  const rows = [];
  for (const p of products) {
    const variants = p.variants.length ? p.variants : [null];
    for (const v of variants) {
      const val = {
        productId: p.id,
        sku: skuOf(p.id, v?.id),
        supplierUrl: p.aeProductId ? `https://www.aliexpress.com/item/${p.aeProductId}.html` : '',
        supplierSku: '',
        title: p.title,
        variantTitle: v?.name || '',
        price: v?.price ?? p.price,
        image: v?.image || p.images[0] || '',
        stock: v?.disabled ? 0 : 999,
      };
      rows.push(roles.map((r) => (r ? val[r] ?? '' : '')));
    }
  }
  return rows;
}

function orderRows(orders, headers) {
  const roles = headers.map((h) => roleOf(h, ORDER_ROLES));
  const rows = [];
  for (const o of orders) {
    const a = o.address;
    const { cc, local } = phoneLocal(o.phone, a.country);
    for (const i of o.items) {
      const val = {
        orderNumber: o.id,
        date: (o.paidAt || o.createdAt).slice(0, 10),
        country: countryName(a.country),
        countryCode: a.country,
        province: clean(a.state || a.city),
        city: clean(a.city),
        address: clean(a.address1),
        address2: clean(a.address2) || clean(a.city),
        zip: String(a.zip || '').replace(/[^\dA-Za-z -]/g, ''),
        productId: i.productId,
        sku: skuOf(i.productId, i.variantId),
        qty: i.qty,
        memo: `Order ${o.id}. Please do not include invoice or price.`,
        contactPerson: clean(o.name),
        fullName: clean(o.name),
        mobile: cc ? `+${cc}${local}` : String(o.phone).replace(/[^\d+]/g, ''),
        phoneCountry: cc ? `+${cc}` : '',
        email: o.email,
        blank: '',
      };
      rows.push(roles.map((r) => (r ? val[r] ?? '' : '')));
    }
  }
  return rows;
}

async function dsersView() {
  const [{ templates }, { products }, { orders: paid }, { orders: all }] = await Promise.all([
    api('/settings/dsers'), api('/products'), api('/orders?status=paid'), api('/orders'),
  ]);
  const pHeaders = templates.products.length ? templates.products : DEFAULT_PRODUCT_HEADERS;
  const oHeaders = templates.orders.length ? templates.orders : DEFAULT_ORDER_HEADERS;
  const unmapped = (headers, roles) => headers.filter((h) => !roleOf(h, roles));
  const warn = (o) => {
    const w = [];
    const s = [o.name, o.address.address1, o.address.address2, o.address.city, o.address.state].join(' ');
    if (hasHebrew(s)) w.push('כתובת בעברית');
    if (!o.address.zip) w.push('אין מיקוד');
    return w;
  };
  const noSupplier = products.filter((p) => !p.aeProductId).length;

  app.innerHTML = `<h1>DSers — חנות CSV</h1>
  <p class="muted">כך זה עובד: מעלים ל-DSers קובץ מוצרים (פעם אחת לכל מוצר חדש) ← מחברים כל מוצר לספק באליאקספרס בתוך DSers ←
  כל כמה זמן מייצאים מכאן את ההזמנות ששולמו ומעלים ל-DSers ← DSers מזמין מאליאקספרס ← מורידים מ-DSers את מספרי המעקב ומעלים אותם כאן, והלקוחות מקבלים מייל.</p>

  <div class="panel stack" style="margin-bottom:20px">
    <h2 style="margin:0">שלב 0 — תבניות DSers (מומלץ, פעם אחת)</h2>
    <p class="muted" style="margin:0">ב-DSers → CSV Upload יש כפתורים להורדת קובץ התבנית של מוצרים (import_products) ושל הזמנות (import_orders).
    העלה אותם כאן, והקבצים שנייצא יהיו בדיוק באותן עמודות. בלי זה נשתמש בעמודות ברירת המחדל.</p>
    <div class="two">
      <div class="stack"><b>תבנית מוצרים ${templates.products.length ? '<span class="ok">✔ נטענה</span>' : '<span class="muted">(ברירת מחדל)</span>'}</b>
        <div class="muted" dir="ltr" style="font-size:13px">${pHeaders.map(esc).join(' | ')}</div>
        ${unmapped(pHeaders, PRODUCT_ROLES).length ? `<div class="muted" style="font-size:13px">עמודות שיישארו ריקות: <span dir="ltr">${unmapped(pHeaders, PRODUCT_ROLES).map(esc).join(', ')}</span></div>` : ''}
        <input type="file" id="tplP" accept=".csv,.xlsx,.xls"></div>
      <div class="stack"><b>תבנית הזמנות ${templates.orders.length ? '<span class="ok">✔ נטענה</span>' : '<span class="muted">(ברירת מחדל)</span>'}</b>
        <div class="muted" dir="ltr" style="font-size:13px">${oHeaders.map(esc).join(' | ')}</div>
        ${unmapped(oHeaders, ORDER_ROLES).length ? `<div class="muted" style="font-size:13px">עמודות שיישארו ריקות: <span dir="ltr">${unmapped(oHeaders, ORDER_ROLES).map(esc).join(', ')}</span></div>` : ''}
        <input type="file" id="tplO" accept=".csv,.xlsx,.xls"></div>
    </div>
    ${templates.products.length || templates.orders.length ? '<div><button class="link-btn" id="tplReset">חזרה לעמודות ברירת המחדל</button></div>' : ''}
  </div>

  <div class="panel stack" style="margin-bottom:20px">
    <h2 style="margin:0">שלב 1 — ייצוא מוצרים ל-DSers</h2>
    <p class="muted" style="margin:0">${products.length} מוצרים, ${products.reduce((s, p) => s + Math.max(1, p.variants.length), 0)} שורות (שורה לכל צבע/מידה). כל שורה מקבלת SKU קבוע שמזהה אותה גם בהזמנות.
    ${noSupplier ? `<br>⚠️ ל-${noSupplier} מוצרים אין מזהה מוצר של אליאקספרס — תצטרך לחבר אותם לספק ידנית ב-DSers.` : ''}</p>
    <div><button class="btn" id="expP" ${products.length ? '' : 'disabled'}>⬇️ הורדת קובץ מוצרים</button></div>
  </div>

  <div class="panel stack" style="margin-bottom:20px">
    <h2 style="margin:0">שלב 2 — ייצוא הזמנות ששולמו</h2>
    ${paid.length ? `<div class="overflow"><table class="list"><thead><tr><th><input type="checkbox" id="allO" checked style="width:auto"></th><th>הזמנה</th><th>לקוח</th><th>פריטים</th><th>בעיות</th></tr></thead><tbody>
      ${paid.map((o) => `<tr><td><input type="checkbox" class="selO" value="${esc(o.id)}" checked style="width:auto"></td><td><a href="#orders/${esc(o.id)}">${esc(o.id)}</a></td><td>${esc(o.name)}<div class="muted" style="font-size:13px">${esc(o.address.city)}</div></td>
        <td>${o.items.map((i) => `${esc(i.title)}${i.variantName ? ' (' + esc(i.variantName) + ')' : ''} ×${i.qty}`).join('<br>')}</td>
        <td>${warn(o).map((w) => `<span class="bad">${w}</span>`).join('<br>') || '<span class="ok">✔</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      ${paid.some((o) => warn(o).length) ? '<p class="notice" style="margin:0">להזמנות עם כתובת בעברית: לחץ על מספר ההזמנה ← "עריכת פרטי משלוח" ← כתוב באנגלית ← שמור. אליאקספרס לא תמיד מקבל כתובות בעברית.</p>' : ''}
      <div class="toolbar" style="margin:0"><button class="btn" id="expO">⬇️ הורדת קובץ הזמנות</button>
        <button class="btn secondary" id="markO">סמן את המסומנות כ"הוזמן מהספק"</button></div>
      <p class="muted" style="margin:0;font-size:13px">אחרי שהעלית את הקובץ ל-DSers וההזמנות נקלטו שם — לחץ "סמן כהוזמן מהספק", כדי שלא ייוצאו שוב בפעם הבאה.</p>`
    : '<p class="muted" style="margin:0">אין כרגע הזמנות ששולמו שממתינות לספק. 🎉</p>'}
  </div>

  <div class="panel stack">
    <h2 style="margin:0">שלב 3 — ייבוא מספרי מעקב מ-DSers</h2>
    <p class="muted" style="margin:0">העלה את הקובץ שהורדת מ-DSers (CSV או Excel) שיש בו את מספר ההזמנה שלנו (מתחיל ב-R) ואת מספר המעקב ו/או מספר ההזמנה באליאקספרס.</p>
    <input type="file" id="trk" accept=".csv,.xlsx,.xls">
    <div id="trkOut"></div>
  </div>`;

  const saveTpl = async (key, file) => {
    try {
      const rows = await readTable(file);
      const headerRow = rows[0] || [];
      if (!headerRow.filter(Boolean).length) throw new Error('לא נמצאה שורת כותרות בקובץ');
      await api('/settings/dsers', { method: 'PUT', body: { [key]: headerRow.filter(Boolean) } });
      toast('התבנית נשמרה ✔'); dsersView();
    } catch (e) { toast('❌ ' + e.message); }
  };
  document.getElementById('tplP').onchange = (e) => e.target.files[0] && saveTpl('products', e.target.files[0]);
  document.getElementById('tplO').onchange = (e) => e.target.files[0] && saveTpl('orders', e.target.files[0]);
  const reset = document.getElementById('tplReset');
  if (reset) reset.onclick = async () => { await api('/settings/dsers', { method: 'PUT', body: { products: [], orders: [] } }); dsersView(); };

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('expP').onclick = () => download(`dsers_products_${today}.csv`, toCSV(pHeaders, productRows(products, pHeaders)));
  const selected = () => [...document.querySelectorAll('.selO:checked')].map((c) => c.value);
  const allO = document.getElementById('allO');
  if (allO) allO.onchange = () => document.querySelectorAll('.selO').forEach((c) => (c.checked = allO.checked));
  const expO = document.getElementById('expO');
  if (expO) expO.onclick = () => {
    const ids = selected();
    if (!ids.length) return toast('לא נבחרו הזמנות');
    download(`dsers_orders_${today}.csv`, toCSV(oHeaders, orderRows(paid.filter((o) => ids.includes(o.id)), oHeaders)));
  };
  const markO = document.getElementById('markO');
  if (markO) markO.onclick = async () => {
    const ids = selected();
    if (!ids.length) return toast('לא נבחרו הזמנות');
    if (!confirm(`לסמן ${ids.length} הזמנות כ"הוזמן מהספק"?`)) return;
    await api('/orders/bulk', { method: 'POST', body: { updates: ids.map((id) => ({ id, status: 'ordered' })) } });
    toast('עודכן ✔'); dsersView();
  };

  document.getElementById('trk').onchange = async (e) => {
    const out = document.getElementById('trkOut');
    const file = e.target.files[0];
    if (!file) return;
    let rows;
    try { rows = await readTable(file); } catch (x) { out.innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
    if (rows.length < 2) { out.innerHTML = '<p class="error">הקובץ ריק</p>'; return; }
    const headers = rows[0];
    const guess = (test) => headers.findIndex((h) => test(norm(h)));
    let col = {
      ours: guess((n) => ['ordernumber', 'orderno', 'storeordernumber', 'shopifyordernumber', 'ordername', 'orderid'].includes(n)),
      ae: guess((n) => n.includes('aliexpress') || n.includes('supplierorder') || n.startsWith('aeorder')),
      tracking: guess((n) => n.includes('tracking') || n.includes('logisticsno') || n.includes('waybill')),
      carrier: guess((n) => (n.includes('carrier') || n.includes('logisticscompany') || n.includes('shippingcompany') || n.includes('shippingmethod') || n.includes('logisticsservice')) && !n.includes('no')),
    };
    if (col.ours < 0) {
      // fall back to the column whose values look like our order ids
      col.ours = headers.findIndex((_, i) => rows.slice(1, 20).some((r) => /\bR[A-Z0-9]{7}\b/.test(String(r[i] || '').toUpperCase())));
    }
    const known = new Map(all.map((o) => [o.id, o]));
    const sel = (key, label) => `<label>${label}<select data-col="${key}"><option value="-1">— אין —</option>${headers.map((h, i) => `<option value="${i}" ${col[key] === i ? 'selected' : ''}>${esc(h || `עמודה ${i + 1}`)}</option>`).join('')}</select></label>`;
    const build = () => {
      const map = new Map();
      for (const r of rows.slice(1)) {
        const m = String(r[col.ours] ?? '').toUpperCase().match(/R[A-Z0-9]{7}/);
        if (!m) continue;
        const u = map.get(m[0]) || { id: m[0], aeOrderIds: [], tracking: [] };
        const ae = col.ae >= 0 ? String(r[col.ae] || '').replace(/[^\dA-Za-z]/g, '') : '';
        if (ae && !u.aeOrderIds.includes(ae)) u.aeOrderIds.push(ae);
        const trk = col.tracking >= 0 ? String(r[col.tracking] || '').trim() : '';
        if (trk && !u.tracking.some((t) => t.number === trk)) u.tracking.push({ number: trk, carrier: col.carrier >= 0 ? String(r[col.carrier] || '').trim() : '' });
        map.set(m[0], u);
      }
      return [...map.values()];
    };
    const render = () => {
      const updates = build();
      const good = updates.filter((u) => known.has(u.id) && (u.aeOrderIds.length || u.tracking.length));
      out.innerHTML = `<div class="fields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:12px 0">
        ${sel('ours', 'מספר ההזמנה שלנו (R...)')}${sel('ae', 'מספר הזמנה באליאקספרס')}${sel('tracking', 'מספר מעקב')}${sel('carrier', 'חברת שילוח')}</div>
        <div class="overflow"><table class="list"><thead><tr><th>הזמנה</th><th>אליאקספרס</th><th>מעקב</th><th>מצב</th></tr></thead><tbody>
        ${updates.slice(0, 200).map((u) => `<tr><td>${esc(u.id)}</td><td dir="ltr">${u.aeOrderIds.map(esc).join('<br>')}</td><td dir="ltr">${u.tracking.map((t) => esc(t.number)).join('<br>')}</td>
          <td>${!known.has(u.id) ? '<span class="bad">לא נמצאה אצלנו</span>' : !(u.aeOrderIds.length || u.tracking.length) ? '<span class="muted">אין נתונים</span>' : known.get(u.id).tracking.length >= u.tracking.length && u.tracking.every((t) => known.get(u.id).tracking.some((x) => x.number === t.number)) && u.tracking.length ? '<span class="muted">כבר מעודכן</span>' : '<span class="ok">יעודכן</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">לא נמצאו מספרי הזמנות שלנו בעמודה שנבחרה</td></tr>'}
        </tbody></table></div>
        <label style="display:flex;gap:8px;align-items:center;margin:12px 0"><input type="checkbox" id="trkNotify" checked style="width:auto"> לשלוח ללקוחות מייל עם מספר המעקב</label>
        <button class="btn" id="trkApply" ${good.length ? '' : 'disabled'}>עדכון ${good.length} הזמנות</button>`;
      out.querySelectorAll('[data-col]').forEach((s) => (s.onchange = () => { col[s.dataset.col] = +s.value; render(); }));
      document.getElementById('trkApply').onclick = async (ev) => {
        ev.target.disabled = true;
        try {
          const r = await api('/orders/bulk', { method: 'POST', body: { updates: good, notify: document.getElementById('trkNotify').checked } });
          const changed = r.results.filter((x) => x.changed).length;
          const mailed = r.results.filter((x) => x.emailed).length;
          toast(`עודכנו ${changed} הזמנות, נשלחו ${mailed} מיילים`);
          dsersView();
        } catch (x) { toast('❌ ' + x.message); ev.target.disabled = false; }
      };
    };
    render();
  };
}

if (pw) api('/status').then((s) => { status = s; start(); }).catch(() => loginView());
else loginView();
