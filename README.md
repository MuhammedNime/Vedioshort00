# استوديو شورتس الأسئلة (YouTube Shorts Quiz Studio)

استوديو متكامل لصناعة فيديوهات **يوتيوب شورتس (9:16 - 1080×1920)** للأسئلة والألغاز بأربع خيارات، مع تحكم كامل في التصميم، المؤقت العدّاد، المؤثرات الصوتية، المونتاج بالذكاء الاصطناعي، وتصدير الفيديو مباشرة بجودة عالية.

---

## المميزات الأساسية
- **أداء سريع وسلس (60fps):** رسم مباشر ومخفف للخلفيات والنصوص والمؤقت دون تقطيع في المعاينة أو التصدير.
- **مطابقة 1:1 بين المعاينة والتصدير:** الفيديو المصدّر يطابق تماماً ما تراه في المعاينة مع تزامن صوتي-مرئي دقيق.
- **ثيمات القنوات الجاهزة:** الثيم الرملي (`channelSand`)، الكحلي (`channelNavy`)، والزمردي (`channelEmerald`) مع شاشات النهاية ومطابقة لون المؤقت للخلفية.
- **تطبيق ويب تقدمي (PWA) + Android APK:** جاهز للتثبيت المباشر على الهاتف أو التحويل إلى APK عبر GitHub Actions و Capacitor.

---

## 1. رفع المشروع إلى GitHub واستخراج ملف APK تلقائياً (بدون الحاجة لتثبيت Android Studio)

المشروع مجهّز بملف بناء تلقائي في `.github/workflows/build-android-apk.yml`. بمجرد رفع الكود على GitHub:

```bash
git init
git add .
git commit -m "Initial commit: Shorts Quiz Studio"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

1. افتح مستودعك على GitHub ثم اذهب إلى تبويب **Actions**.
2. اختر تشغيل **Build Android APK** (سيبدأ تلقائياً عند كل `push`، أو شغّله يدوياً من **Run workflow**).
3. بعد انتهاء البناء بنجاح، ستجد ملفات الـ APK في مكانين:
   - قسم **Releases** في المستودع (`releases/latest`) للتحميل المباشر: **`shorts-quiz-studio-release.apk`** و **`shorts-quiz-studio-debug.apk`**.
   - قسم **Artifacts** داخل صفحة الـ Action بعنوان **`shorts-quiz-studio-apk`**.

### لماذا يطلب أندرويد حذف التطبيق عند كل تحديث وكيف تجعله يظهر «تحديث» مباشرة؟
- **في ملفات الـ APK (GitHub Actions / Android Studio):** أندرويد يرفض تحديث أي APK فوق النسخة السابقة إذا تغيّر **مفتاح التوقيع (Keystore)** أو لم يرتفع **`versionCode`**.
  - تم ضبط الـ workflow ليرفع `versionCode` تلقائياً في كل بناء (`github.run_number`).
  - **الحل الدائم للتحديث فوق النسخة السابقة دون حذف:** احفظ ملف توقيع ثابت واحد (`release.keystore`) داخل GitHub Secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) وبنفس اسم الحزمة (`com.shortsquiz.studio`). عندها سيظهر لك زر **«تحديث» (Update)** مباشرة وتبقى جميع مشاريعك وأعمالك محفوظة.
- **الحل الأسهل بدون APK متكرر:** ثبّت التطبيق من Chrome عبر زر **تثبيت التطبيق (PWA)** أو افتح رابط الاستوديو المنشور — عندها تصل التحديثات تلقائياً في الخلفية **دون حذف أو إعادة تثبيت**.
- **النسخ الاحتياطي الشامل:** يمكنك دائماً حفظ كل مشاريعك وستايلاتك في ملف واحد من **المشاريع > حفظ كل شيء** واستعادتها بضغطة واحدة في أي وقت.

---

## 2. البناء المحلي لملف APK عبر Android Studio (اختياري)

```bash
npm install
npm run build
npm run android:init
npm run cap:sync
npm run cap:open
```

ثم من Android Studio اختر:
**Build > Build Bundle(s) / APK(s) > Build APK(s)**.

---

## 3. تشغيل المشروع محلياً للتطوير أو كخادم ويب

```bash
npm install
npm run dev
```

سيعمل التطبيق وخادم الذكاء الاصطناعي على المنفذ `http://localhost:3000`.
> **ملاحظة لتوليد الأسئلة بالذكاء الاصطناعي داخل الـ APK:**
> أضف متغير البيئة `GEMINI_API_KEY` عند نشر الخادم (`server.ts`) على استضافة مثل Render أو Railway أو Cloud Run، ثم ضع رابط الخادم في متغير مستودع GitHub (`Settings > Secrets and variables > Actions > Variables`) باسم `VITE_API_BASE_URL` حتى يتصل تطبيق الـ APK بالخادم. أما تعديل الأسئلة، القوالب، الأصوات، وتصدير الفيديو فيعملون محلياً بالكامل بدون إنترنت.
