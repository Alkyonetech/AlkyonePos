# Sakura POS — WebView Siyah Ekran Fix (Sınıf A)

> Teşhis: siyah ekran yeni cihazlar dahil her yerde → **Sınıf A (config/bağlantı)**, eski WebView motoru (Sınıf B) değil. Bu baseline tüm Sınıf A nedenlerini tek seferde kapatır ve siyah ekranı bir failure mode olarak kaldırır: bundan sonra her hata ekrana yazılır.

## Kapatılan nedenler
- **A-1 Cleartext (API 28+):** local `http://` engeli → blanket cleartext izni (manuel IP girişi scoped config'i imkânsız kılıyor).
- **A-2 JS / DOM storage kapalı:** SPA + localStorage boş render → ikisi de açılır.
- **A-3 Hata görünmezliği (kök sorun):** `onReceivedError`/`onReceivedHttpError` → siyah yerine tanı ekranı.
- **Lifecycle:** sunucu ayağa kalkmadan yükleme → health-check + retry.
- **Debug:** `setWebContentsDebuggingEnabled` → `chrome://inspect` açık.

---

## 1. `res/xml/network_security_config.xml` (yeni dosya)

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Manuel IP girişi keyfi olduğu için domain-scope imkansız; LAN güvenli kabul edilip blanket cleartext. -->
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
```

## 2. `AndroidManifest.xml` (application etiketine ekle)

```xml
<application
    android:networkSecurityConfig="@xml/network_security_config"
    android:usesCleartextTraffic="true"
    android:hardwareAccelerated="true"
    ... >
```

`<uses-permission android:name="android.permission.INTERNET" />` ekli olmalı.

## 3. `MainActivity.kt` (WebView baseline + tanı katmanı)

```kotlin
import android.os.Bundle
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.*
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var serverUrl: String = ""   // auto/manuel keşiften gelir
    private var route: String = "/admin" // rol: /admin veya /garson

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true) // chrome://inspect

        webView = WebView(this)
        setContentView(webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.addJavascriptInterface(object {
            @JavascriptInterface fun retry() { runOnUiThread { loadWithHealthCheck() } }
        }, "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(v: WebView?, req: WebResourceRequest?, e: WebResourceError?) {
                if (req?.isForMainFrame == true) showError("${e?.errorCode} ${e?.description}\n${req.url}")
            }
            override fun onReceivedHttpError(v: WebView?, req: WebResourceRequest?, r: WebResourceResponse?) {
                if (req?.isForMainFrame == true) showError("HTTP ${r?.statusCode}\n${req.url}")
            }
        }

        serverUrl = resolveServerUrl()  // mevcut auto + manuel mekanizman
        loadWithHealthCheck()
    }

    private fun loadWithHealthCheck(attempt: Int = 0) {
        lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) { ping(serverUrl) }
            when {
                ok -> webView.loadUrl("$serverUrl$route")
                attempt < 3 -> { delay(1500L * (attempt + 1)); loadWithHealthCheck(attempt + 1) }
                else -> showError("Sunucuya ulaşılamadı:\n$serverUrl")
            }
        }
    }

    private fun ping(base: String): Boolean = try {
        (URL(base).openConnection() as HttpURLConnection).run {
            connectTimeout = 2000; readTimeout = 2000; requestMethod = "HEAD"
            responseCode in 200..499  // sunucu cevap veriyorsa yeter
        }
    } catch (e: Exception) { false }

    private fun showError(msg: String) {
        val html = """
            <html><body style="background:#0b0b0b;color:#eaeaea;font-family:sans-serif;
              display:flex;flex-direction:column;justify-content:center;align-items:center;
              height:100vh;margin:0;text-align:center;padding:24px">
              <h2>Bağlantı Hatası</h2>
              <pre style="opacity:.7;white-space:pre-wrap">$msg</pre>
              <button onclick="AndroidBridge.retry()"
                style="padding:12px 28px;margin-top:20px;border:0;border-radius:8px;
                background:#e0e0e0;font-size:16px">Tekrar Dene</button>
            </body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    // resolveServerUrl(): mevcut otomatik + manuel giriş mantığın buraya bağlanır.
    private fun resolveServerUrl(): String = serverUrl
}
```

---

## Uygulama notları (Claude Code için)
- `resolveServerUrl()` ve `route` (`/admin` vs `/garson`) mevcut rol/keşif mantığına bağlanacak — bu baseline onları placeholder tutuyor.
- `lifecycleScope` için `androidx.lifecycle:lifecycle-runtime-ktx` ve coroutines bağımlılığı gerekli.
- Bu baseline **rewrite değil**; mevcut Activity'ye config + WebViewClient + health-check katmanının uygulanmasıdır.

## Tek doğrulama adımı (kod sonrası)
Bir eski VE bir yeni cihazda aç. Artık siyah yerine ya uygulama ya da hata ekranı gelecek. Hata ekranı çıkarsa **mesajı oku** — kök neden orada yazıyor. Hâlâ şüphe varsa `chrome://inspect` ile konsolu teyit et. Bu noktadan sonra tahmin yok, sadece okunan hata var.
