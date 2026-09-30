# Reembir — חנות דרופשיפינג (AliExpress + PayPal + Cloudflare)

חנות אונליין מלאה שרצה בחינם על Cloudflare: קטלוג מוצרים, עגלה, תשלום ב-PayPal (כולל כרטיס אשראי),
העברת ההזמנה לאליאקספרס, משיכת מספר מעקב ושליחתו ללקוח במייל.

```
לקוח משלם ב-PayPal ──► ההזמנה נשמרת (D1) ──► התראה אליך (מייל/טלגרם)
                                             │
             ┌───────────────────────────────┴───────────────────────────┐
     עם AliExpress API:                                          בלי API (מצב ידני):
     לחיצה אחת (או אוטומטי) → הזמנה נוצרת                        פותחים את המוצר, מדביקים כתובת,
     באליאקספרס עם כתובת הלקוח                                   מזמינים ומעדכנים מספר הזמנה
             └───────────────────────────────┬───────────────────────────┘
                     מספר מעקב (אוטומטי כל 6 שעות או ידני) ──► מייל ללקוח + דף מעקב באתר
```

## מה עולה כסף ומה לא

| רכיב | עלות |
|---|---|
| אחסון האתר + השרת (Cloudflare Pages + Functions) | חינם (100,000 בקשות ביום) |
| מסד נתונים (Cloudflare D1) | חינם (5GB) |
| הדומיין reembir.com | כבר שלך |
| AliExpress Dropshipping API | חינם (צריך אישור) |
| מיילים ללקוחות (Resend) | חינם עד 3,000 מיילים בחודש |
| התראות בטלגרם, סנכרון אוטומטי (GitHub Actions) | חינם |
| **PayPal** | **עמלה על כל מכירה** (בערך 3–4.5% + סכום קבוע). אין דרך לקבל תשלומים בלי עמלה |
| **המוצרים עצמם באליאקספרס** | אתה משלם לספק על כל הזמנה מהכסף שהלקוח שילם לך |

---

## התקנה, שלב אחר שלב

### 1. העלאה ל-Cloudflare Pages

1. ב-Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** ובחר את הריפו `shop`.
2. הגדרות build:
   - Framework preset: `None`
   - Build command: (ריק)
   - Build output directory: `public`
3. עדיין לא לפרוס. קודם צריך ליצור את מסד הנתונים (שלב 2).

### 2. מסד נתונים (D1)

במחשב עם Node.js:

```bash
npm install
npx wrangler login
npx wrangler d1 create reembir-shop      # מחזיר database_id
```

הדבק את ה-`database_id` ב-`wrangler.toml` (במקום `REPLACE_WITH_YOUR_D1_DATABASE_ID`) ועשה commit.
אחר כך צור את הטבלאות:

```bash
npm run db:init
```

> בלי מחשב: אפשר ליצור את ה-DB בדשבורד (**Storage & Databases → D1 → Create**), להריץ את התוכן של `schema.sql` בלשונית **Console**,
> ולערוך את `wrangler.toml` ישירות ב-GitHub.

### 3. משתני סביבה וסודות

ב-Cloudflare: **הפרויקט → Settings → Variables and Secrets** → הוסף כ-**Secret** (מוצפן):

| שם | חובה | מה זה |
|---|---|---|
| `ADMIN_PASSWORD` | ✔ | סיסמה לדף הניהול `/admin` (לפחות 10 תווים, ארוכה ואקראית) |
| `PAYPAL_CLIENT_ID` | ✔ | מ-PayPal (שלב 5) |
| `PAYPAL_CLIENT_SECRET` | ✔ | מ-PayPal (שלב 5) |
| `PAYPAL_WEBHOOK_ID` | מומלץ | מ-PayPal (שלב 5) |
| `AE_APP_KEY`, `AE_APP_SECRET` | לא חובה | מ-AliExpress (שלב 6) |
| `RESEND_API_KEY`, `EMAIL_FROM` | מומלץ | מיילים ללקוחות (שלב 7). למשל `EMAIL_FROM` = `Reembir <orders@reembir.com>` |
| `ADMIN_EMAIL` | מומלץ | לאן לשלוח לך התראה על הזמנה חדשה |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | לא חובה | התראות לטלגרם (שלב 8) |

הגדרות רגילות (מטבע, שער דולר, מכפיל רווח, משלוח, מייל ליצירת קשר, הזמנה אוטומטית) נמצאות ב-`[vars]` שב-`wrangler.toml`. כל אחת מוסברת שם.

עכשיו אפשר לפרוס: **Deployments → Retry deployment** (או push חדש).

### 4. חיבור הדומיין

**הפרויקט → Custom domains → Set up a custom domain** → `reembir.com` (וגם `www.reembir.com` אם רוצים).
הדומיין כבר ב-Cloudflare, אז ה-DNS מוגדר אוטומטית.

### 5. PayPal

1. היכנס ל-<https://developer.paypal.com> עם החשבון העסקי.
2. **Apps & Credentials**. מומלץ להתחיל ב-**Sandbox** לבדיקות:
   - Create App → העתק Client ID ו-Secret.
   - הגדר `PAYPAL_ENV = "sandbox"` ב-`wrangler.toml` ובצע קנייה עם חשבון בדיקה (Sandbox accounts).
3. כשהכל עובד: עבור ל-**Live**, צור App, החלף את המפתחות ל-Live והחזר `PAYPAL_ENV = "live"`.
4. **Webhook** (רשת ביטחון למקרה שהלקוח סגר את הדפדפן באמצע): באפליקציה → Add Webhook:
   - URL: `https://reembir.com/api/paypal/webhook`
   - אירועים: `Checkout order approved`, `Payment capture completed`, `Payment capture refunded`,
     `Payment capture reversed`, `Customer dispute created`
   - העתק את ה-Webhook ID ל-`PAYPAL_WEBHOOK_ID`.

כפתורי PayPal מאפשרים גם תשלום בכרטיס אשראי בלי חשבון PayPal (תלוי במדינת הלקוח).

### 6. אליאקספרס

**מצב ידני (עובד מהיום הראשון):** לא צריך כלום. אחרי תשלום תקבל התראה. בדף ההזמנה בניהול יש כפתור "פתח באליאקספרס",
כתובת מוכנה להעתקה, ושדות למספר הזמנה ולמספר מעקב. כשמכניסים מספר מעקב, הלקוח מקבל מייל.

**מצב אוטומטי (API רשמי, חינם):**
1. הירשם כמפתח ב-<https://openservice.aliexpress.com> עם חשבון האליאקספרס שממנו תזמין.
2. **App Console → Create App** מסוג **Dropshipping** (או "Affiliates/Dropshipping"). האישור לוקח בדרך כלל כמה ימים.
3. בהגדרות האפליקציה הגדר Callback URL: `https://reembir.com/api/ae/callback`
4. העתק App Key ו-App Secret ל-`AE_APP_KEY` / `AE_APP_SECRET` ופרוס מחדש.
5. בניהול → **הגדרות → חיבור חשבון אליאקספרס** ואשר. (החיבור תקף לכמה חודשים. כשהוא פג, לוחצים שוב.)

מה מקבלים:
- **ייבוא מוצר** מקישור, כולל תמונות, צבעים ומידות, עלות, מלאי ומחיר מוצע.
- **הזמנה בלחיצה** (או אוטומטית אחרי כל תשלום עם `AE_AUTO_ORDER = "true"`).
- **תשלום לספק:** ההזמנה נוצרת בחשבון שלך ב-AliExpress, ומשלמים עליה ב-My Orders (אפשר כמה הזמנות ביחד).
  עם `AE_TRY_TO_PAY = "true"` אליאקספרס ינסה לחייב אוטומטית את אמצעי התשלום השמור בחשבון.
- **מספרי מעקב** נמשכים אוטומטית כל 6 שעות (שלב 9) או בלחיצה, והלקוח מקבל מייל.

> ⚠️ ה-API של אליאקספרס נבדק מול שרת דמה ולא מול החשבון האמיתי שלך. אם הזמנה אוטומטית נכשלת,
> תקבל התראה עם הודעת השגיאה, ואפשר תמיד להזמין ידנית מאותו דף.

### 7. מיילים (Resend, חינם)

1. הירשם ב-<https://resend.com> → **Domains → Add** `reembir.com` → הוסף את רשומות ה-DNS שהם נותנים ב-Cloudflare DNS.
2. **API Keys → Create** → שמור ב-`RESEND_API_KEY`. הגדר `EMAIL_FROM` ו-`ADMIN_EMAIL`.

לקבלת מיילים ל-`support@reembir.com`: ב-Cloudflare → **Email → Email Routing** (חינם) הפנה אותו ל-Gmail שלך.

### 8. התראות טלגרם (לא חובה)

צור בוט אצל [@BotFather](https://t.me/BotFather) ושמור את ה-token ב-`TELEGRAM_BOT_TOKEN`.
שלח לבוט הודעה, ואז פתח `https://api.telegram.org/bot<TOKEN>/getUpdates` והעתק את `chat.id` ל-`TELEGRAM_CHAT_ID`.

### 9. סנכרון מעקב אוטומטי

ב-GitHub → **Settings → Secrets and variables → Actions** הוסף `SITE_URL` (`https://reembir.com`) ו-`ADMIN_PASSWORD`.
ה-workflow ב-`.github/workflows/sync-tracking.yml` ירוץ כל 6 שעות.

### 10. לפני השקה

- [ ] מלא את פרטי העסק ב-`public/terms.html` (שם, מספר עוסק, כתובת). חוק הגנת הצרכן מחייב אותם במכירה מרחוק.
- [ ] בדוק ועדכן את `shipping.html`, `returns.html`, `privacy.html`.
- [ ] עדכן `CONTACT_EMAIL` ב-`wrangler.toml`.
- [ ] בצע קנייה מלאה ב-Sandbox, ואז קנייה אמיתית קטנה ב-Live והחזר כספי מדף הניהול.
- [ ] (מומלץ) הגן על `/admin` עם **Cloudflare Zero Trust → Access** (חינם עד 50 משתמשים), כשכבה נוספת מעל הסיסמה.

---

## עבודה יומיומית

1. **הוספת מוצר:** ניהול → מוצרים → הדבק קישור אליאקספרס → ייבוא → תרגם שם ותיאור לעברית, בדוק מחיר → שמירה.
   בלי API: "מוצר חדש ידני" (שם, מחיר, קישורי תמונות, מזהה מוצר מאליאקספרס).
2. **הזמנה נכנסה** (התראה): ניהול → הזמנות → "שולם — להזמין מהספק" → לחיצה על "הזמן אוטומטית באליאקספרס", או הזמנה ידנית.
3. **שלם** על ההזמנה באליאקספרס (אם לא מופעל תשלום אוטומטי).
4. **מעקב:** נמשך לבד. או מדביקים מספר מעקב ולוחצים שמירה, והלקוח מקבל מייל.
5. **בעיה/החזר:** בדף ההזמנה → החזר כספי (מלא או חלקי) ישירות ב-PayPal.

סטטוסים: `ממתין לתשלום` → `שולם` → `הוזמן מהספק` → `נשלח` → `נמסר` (או `בוטל` / `הוחזר`).

## פיתוח מקומי

```bash
npm install
cp .dev.vars.example .dev.vars   # ומלא ערכים (PAYPAL_ENV=sandbox)
npm run db:init:local
npm run dev                      # http://localhost:8788  ,  ניהול: /admin/
```

## מבנה הקוד

```
public/                 האתר (HTML/CSS/JS סטטי, בלי build)
  index/product/cart/order/track.html, דפי מדיניות
  admin/                פאנל ניהול
functions/api/          ה-API (Cloudflare Pages Functions)
  products, checkout/create, checkout/capture, order, paypal/webhook, ae/callback
  admin/*               מוגן בסיסמה: מוצרים, ייבוא, הזמנות, החזרים, סנכרון
lib/                    paypal.js, aliexpress.js, orders.js, notify.js, util.js
schema.sql              טבלאות D1
```

אבטחה: המחיר תמיד מחושב מחדש בשרת לפי מסד הנתונים (הלקוח לא יכול לשנות מחיר), הסכום שנגבה ב-PayPal
מאומת מול ההזמנה לפני סימון "שולם", ה-webhook מאומת מול PayPal, ותיאורי מוצרים מסוננים לפני הצגה.
