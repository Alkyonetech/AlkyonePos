# Sakura POS — Evrensel APK / De-branding Spec

> Hedef (kesin): **tek APK her Android cihaza kurulup çalışır, sunucu yine local.** Markaya özellik yapan tek şey gömülü config olduğu için bu bir **patch**, rewrite değil. Bu doküman `sakura-pos-webview-fix.md`'nin üstüne biner; onu önce uygula.

## Tek ilke
**Build-time config → runtime config.** Derlemeye hiçbir cihaz/marka/kurulum özel değer gömülmez. Gömülü olan üç şey (IP, rol, ekran) runtime'a taşınır.

---

## Part A — Android tarafı: runtime config

### A1. Config persistUt
`SharedPreferences` (veya DataStore) altında sakla:
- `server_url` (auto-discover + manuel giriş — mevcut mekanizman buraya bağlanır)
- `role` → `admin` | `garson`

### A2. İlk-açılış setup ekranı
Launch'ta config eksikse setup göster:
- **Sunucu:** otomatik keşif dener; bulamazsa manuel IP:port girişi.
- **Rol:** admin / garson seçimi. Route bundan türetilir (`/admin` | `/garson`).
- Kaydet → normal akışa geç.

Config varsa setup'ı atla, doğrudan yükle.

### A3. Ayarlar (config değiştirme)
Gizli erişim (gear ya da 5-tap logo) + **PIN kapısı** — garson cihazında personel sunucu/rolü bozmasın. Sadece admin PIN'i sunucu/rol değiştirebilir.

### A4. webview-fix ile birleşme
`loadWithHealthCheck` şunu yükler: `"$server_url" + routeFromRole(role)`. `resolveServerUrl()` ve `route` placeholder'ları artık persist edilen config'ten beslenir. Health-check + tanı ekranı zaten fix'te.

---

## Part B — Universal APK mekanikleri

- **minSdk = 24** (Android 7, ~%97 kapsam). Daha eski cihaz zorunluysa 21, ama gereksiz yere düşürme.
- **targetSdk = güncel** (zorunlu; cleartext'i doğru ele almaya zorlar — fix hallediyor).
- **Tek universal APK.** WebView app'inde NDK/native lib yok → ABI split gereksiz. Native lib eklediysen "markaya özel"in gerçek kaynağı odur, çıkar.
- **Tek release keystore**, tüm güncellemelerde aynısı — yoksa güncelleme eski sürümün üstüne kurulmaz.
- **Dağıtım = sideload:** APK'yı kendi host'unda yayınla (ör. alkyonetech.com.tr), cihazda "bilinmeyen kaynak" izni, indir-kur. "Direkt indir çalıştır" bu demek; Play Store değil.

---

## Part C — "Ekran" bağımsızlığı: bu APK'da DEĞİL, web tarafında

Kritik: /admin ve /garson tek bir cihazın ekranı için sabit layout'la yazıldıysa, hiçbir Android değişikliği düzeltmez.
- Served sayfalarda `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- Sabit px yerine relative birim (%, rem, vw/vh) + flex/grid.
- Farklı en-boy oranlarında (telefon/tablet, portre/yatay) test.

Bu iş **Electron/web tarafında.** Wrapper evrensel olsa bile içerik sabitse "her ekranda çalışmaz."

---

## Non-goals
- Cloud / sunucusuz standalone **yok** (hedef local-only kaldı).
- Vendor SDK / kiosk / launcher bağımlılığı **yok** — bir daha markaya özel build yok.
- Build-time'a gömülü tek bir cihaz/kurulum değeri **kalmaz.**

---

## Sıra
1. `sakura-pos-webview-fix.md`'yi uygula → **deploy et, bir eski + bir yeni cihazda aç, çıkan hatayı oku.** (Bu hâlâ yapılmadı; her şeyin kapısı bu.)
2. Part A (runtime config + setup) → Part B (APK ayarları).
3. Part C'yi web ekibine/Electron tarafına ayrı iş olarak ver.
4. **Kabul kriteri:** aynı APK, en az iki farklı marka + farklı ekran boyutunda cihaza kurulur; ilk açılış config sorar; rol+sunucu kalıcıdır; içerik her ekranda düzgün render olur.
