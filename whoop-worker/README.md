# ربط دفتر الجيم مع WHOOP

كل شي مجاني: منصة مطوّري WHOOP (لأصحاب الاشتراك) والخطة المجانية من Cloudflare Workers.
السيرفر الصغير بيحفظ المفتاح السري تبع WHOOP، وبيجيب نسبة التعافي للتطبيق.

> ⚠️ لا تبعت الـ **Client Secret** لحدا، ولا تحطه بالتطبيق. مكانه بس بإعدادات Cloudflare.

## 1. اعمل الـ Worker
1. dash.cloudflare.com ← **Compute** ← **Workers & Pages** ← **Create application** ← **Start with Hello World!**
2. سمّيه `gym-whoop` واضغط **Deploy**. احفظ الرابط اللي بيطلع (`https://gym-whoop.xxxx.workers.dev`).
3. اضغط **Edit code**، امسح كل الكود الموجود، والصق محتوى ملف [`worker.js`](./worker.js) كامل، واضغط **Deploy**.

## 2. اعمل مخزن التوكنات (KV)
1. من القائمة: **Storage & databases** ← **Workers KV** ← **Create** وسمّيه `gym-whoop-tokens`.
2. ارجع للـ Worker ← **Settings** ← **Bindings** ← **Add** ← **KV namespace**.
3. **Variable name:** `TOKENS` (بالأحرف الكبيرة بالضبط)، واختار `gym-whoop-tokens`، واحفظ.

## 3. سجّل التطبيق عند WHOOP
1. ادخل على developer-dashboard.whoop.com بحساب WHOOP تبعك (إذا طلب، اعمل Team أول).
2. **Create App** وعبّي:
   - **Name:** دفتر الجيم
   - **Scopes:** `read:recovery` و `read:cycles` و `offline`
   - **Redirect URI:** `https://gym-whoop.xxxx.workers.dev/callback` (رابطك أنت + `/callback`)
   - **Privacy Policy** (إذا طلب): `https://islamyaseen91-design.github.io/Gym-app/privacy.html`
3. احفظ، وانسخ **Client ID** و **Client Secret**.

## 4. حطّ المفاتيح بالـ Worker
Worker ← **Settings** ← **Variables and Secrets** ← **Add**:
- `WHOOP_CLIENT_ID` = الـ Client ID
- `WHOOP_CLIENT_SECRET` = الـ Client Secret (اختار النوع **Secret**)

بعدها اضغط **Deploy**. لما تفتح رابط الـ Worker بالمتصفح لازم يطلعلك: `the server is running`.

## 5. اربط من التطبيق
التطبيق ← **الإعدادات** ← **WHOOP** ← الصق رابط الـ Worker ← **اربط WHOOP** ← سجّل دخول ووافق ← بترجع للتطبيق وبيطلعلك «انربط WHOOP ✅».

من هون ورايح، نسبة التعافي وHRV ونبض الراحة بينعبّوا لحالهم كل ما تفتح التطبيق، بعد ما WHOOP يحسب تعافي اليوم.

## مشاكل ممكن تصير
| المشكلة | الحل |
|---|---|
| WHOOP بيقول `redirect_uri` غلط | تأكد إنه الـ Redirect URI بلوحة WHOOP هو رابط الـ Worker + `/callback` بالضبط |
| خطأ `TOKENS is not defined` | الخطوة 2: اسم الربط لازم يكون `TOKENS` |
| خطأ `token_401` | الـ Client ID أو Secret غلط بالخطوة 4 |
| بيقلك «انقطع الربط» | اضغط «اربط WHOOP» من جديد |

إذا غيّرت عنوان التطبيق عن GitHub Pages، ضيف متغيّر `APP_ORIGIN` بالـ Worker فيه العنوان الجديد (مثلاً `https://example.com`).
