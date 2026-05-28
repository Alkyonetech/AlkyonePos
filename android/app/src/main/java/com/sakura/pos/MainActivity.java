package com.sakura.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.ConnectivityManager;
import android.net.DhcpInfo;
import android.net.Network;
import android.net.NetworkRequest;
import android.net.Uri;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "SAKURA";
    private static final String PREFS = "sakura";
    private static final String PREF_IP = "server_ip";
    private static final String PREF_OEM_HINTED = "oem_hinted";
    private static final String PREF_BATTERY_HINTED = "battery_hinted";
    private static final int REQ_NOTIF_PERMISSION = 1001;
    private static final int REQ_INSTALL_PERMISSION = 1002;
    private String pendingApkUrl = null;
    private static final int PORT = 3000;
    private static final int DISCOVERY_PORT = 5354;
    private static final int UDP_LISTEN_TIMEOUT_MS = 6000;
    private static final int MDNS_TIMEOUT_MS = 4000;
    private static final int CONNECT_TIMEOUT_MS = 3000;
    private static final int SUBNET_SCAN_TIMEOUT_MS = 800;
    private static final int MAX_RECONNECT_DELAY = 30000;
    // Tüm keşif zinciri için son çare süresi — bundan sonra mutlaka manuel IP iste.
    private static final int DISCOVERY_WATCHDOG_MS = 40000;

    private final Handler handler = new Handler(Looper.getMainLooper());

    private WebView webView;
    private android.widget.TextView splashView;
    private SharedPreferences prefs;
    private final String startPath = BuildConfig.START_PATH;

    private String serverUrl = "";
    private final AtomicBoolean connected = new AtomicBoolean(false);

    // mDNS state
    private NsdManager nsdManager;
    private NsdManager.DiscoveryListener mdnsListener;
    private boolean mdnsResolved = false;

    // Reconnect
    private int reconnectDelay = 1000;
    private Runnable reconnectRunnable;

    // Manuel IP diyalogu açık mı (watchdog ile terminal yolun çift açmasını önler)
    private boolean manualIpDialogShown = false;

    // APK update download
    private long apkDownloadId = -1L;
    private BroadcastReceiver downloadReceiver;

    // Network change
    private ConnectivityManager.NetworkCallback netCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        installCrashLogger();
        super.onCreate(savedInstanceState);

        try {
            prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

            // Sadece Poco / Xiaomi / Redmi (MIUI / HyperOS) icin destekleniyor.
            if (!isSupportedDevice()) {
                showUnsupportedDeviceDialog();
                return;
            }

            // WebView multi-process veri dizini cakismasi (bazi MIUI/HyperOS surumlerinde
            // ayni paket icin iki process baslatilirsa "Using WebView from more than one
            // process at once with the same data directory is not supported" diye coker)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    String suffix = android.app.Application.getProcessName();
                    if (suffix != null && !suffix.equals(getPackageName())) {
                        WebView.setDataDirectorySuffix(suffix.replace(':', '_'));
                    }
                }
            } catch (Throwable ignored) {}

            // WebView yuklu/etkin mi? LineageOS GMS'siz buildlarda WebView paketi
            // disabled olabiliyor — bu durumda setupWebView() RuntimeException atar.
            if (!ensureWebViewAvailable()) return;

            setupWebView();
            // hideSystemUI'yi 500ms ertele — Funtouch OS'da setDecorFitsSystemWindows
            // erken cagrilirsa WebView 0 yuksekligiyle layout'lanabiliyor.
            handler.postDelayed(() -> { try { hideSystemUI(); } catch (Throwable ignored) {} }, 500);
            try { registerNetworkCallback(); } catch (Throwable ignored) {}
            try { registerDownloadReceiver(); } catch (Throwable ignored) {}

            // Android 13+ DownloadManager bildirimleri icin POST_NOTIFICATIONS izni
            requestNotificationPermissionIfNeeded();

            // Ilk acilista MIUI/HyperOS/Honor/Vivo gibi cihazlarda autostart + pil
            // optimizasyonu istisnasi yonlendir — kullanici onaylamazsa bile uygulama
            // calismaya devam eder; sadece arkaplandan dirilmesi guvenilmez olur.
            handler.postDelayed(this::maybeShowOemHints, 3500);

            String savedIp = prefs.getString(PREF_IP, "");
            Log.i(TAG, "onCreate done. savedIp='" + savedIp + "' role=" + BuildConfig.ROLE + " startPath=" + startPath);
            if (!savedIp.isEmpty()) {
                // Kayitli IP'yi tek seferde dogrula; basarisiz olursa SIL ve yeniden kesfet.
                final String savedIpFinal = savedIp;
                serverUrl = "http://" + savedIp + ":" + PORT;
                Log.i(TAG, "Using saved IP, validating: " + serverUrl);
                tryConnect(() -> {
                    Log.w(TAG, "Saved IP " + savedIpFinal + " unreachable, clearing and rediscovering");
                    prefs.edit().remove(PREF_IP).apply();
                    serverUrl = "";
                    discoverServer();
                });
            } else {
                Log.i(TAG, "No saved IP, discoverServer()");
                discoverServer();
            }

            showLastCrashIfAny();
        } catch (Throwable t) {
            writeCrashLog("onCreate", t);
            Toast.makeText(this, "Baslatma hatasi: " + t.getClass().getSimpleName() + " — " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    // ===== POCO / XIAOMI / REDMI UYUMLULUK =====

    /**
     * Uygulama yalnizca Poco / Xiaomi / Redmi (MIUI / HyperOS) cihazlarda calisir.
     * Diger uretici/ROM'lar startup'ta engellenir.
     */
    private boolean isSupportedDevice() {
        String mfr = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        String brand = Build.BRAND == null ? "" : Build.BRAND.toLowerCase();
        String[] allowed = {"xiaomi", "redmi", "poco"};
        for (String s : allowed) {
            if (mfr.contains(s) || brand.contains(s)) return true;
        }
        return false;
    }

    private void showUnsupportedDeviceDialog() {
        new AlertDialog.Builder(this)
            .setTitle("Desteklenmeyen cihaz")
            .setMessage("Sakura POS bu surumde yalnizca Poco / Xiaomi / Redmi "
                + "(MIUI / HyperOS) cihazlarda calisir.\n\n"
                + "Tespit edilen: " + Build.MANUFACTURER + " " + Build.MODEL)
            .setPositiveButton("Cikis", (d, w) -> finish())
            .setCancelable(false)
            .show();
    }


    /**
     * WebView paketi yuklu ve etkin mi kontrol et. LineageOS GMS-free buildlarda
     * veya kullanici WebView'i devre disi biraktigi cihazlarda WebView constructor
     * AndroidRuntimeException atar — bunu erkenden yakalayip kullaniciya net mesaj
     * gosteriyoruz.
     */
    private boolean ensureWebViewAvailable() {
        try {
            String pkg = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                // getCurrentWebViewPackage() — reflection (sinif farkli OEM ROM'larinda eksik olabiliyor)
                try {
                    java.lang.reflect.Method m = WebView.class.getMethod("getCurrentWebViewPackage");
                    Object info = m.invoke(null);
                    if (info != null) {
                        java.lang.reflect.Field f = info.getClass().getField("packageName");
                        Object v = f.get(info);
                        if (v != null) pkg = v.toString();
                    }
                } catch (Throwable ignored) {}
            }
            // Sondaj: gercek bir WebView instance olustur — yoksa exception fırlar
            new WebView(this).destroy();
            Log.i(TAG, "WebView ok. provider=" + pkg);
            return true;
        } catch (Throwable t) {
            writeCrashLog("webview-missing", t);
            new AlertDialog.Builder(this)
                .setTitle("Android System WebView yuklu degil")
                .setMessage("Bu cihazda WebView devre disi veya eksik. "
                    + "Lutfen Play Store'dan 'Android System WebView' uygulamasini "
                    + "yukleyin/etkinlestirin.\n\n"
                    + "LineageOS/AOSP icin: Bromite WebView veya Mulch WebView kurun.\n\n"
                    + "Detay: " + t.getClass().getSimpleName())
                .setPositiveButton("Play Store'u Ac", (d, w) -> {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW,
                            Uri.parse("market://details?id=com.google.android.webview")));
                    } catch (Throwable e) {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW,
                                Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.webview")));
                        } catch (Throwable ignored) {}
                    }
                })
                .setNegativeButton("Cikis", (d, w) -> finish())
                .setCancelable(false)
                .show();
            return false;
        }
    }

    /** Android 13+ DownloadManager bildirim gostermeli — POST_NOTIFICATIONS runtime izni gerekir. */
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF_PERMISSION);
                }
            } catch (Throwable ignored) {}
        }
    }

    /**
     * MIUI / HyperOS aggressive killing'i devre disi birakmak icin kullaniciyi
     * autostart + pil + saf mod ayarlarina yonlendir. Bir kez gosterilir.
     */
    private void maybeShowOemHints() {
        try {
            if (prefs.getBoolean(PREF_OEM_HINTED, false)) return;
            new AlertDialog.Builder(this)
                .setTitle("HyperOS / MIUI ayarlari")
                .setMessage("Sakura POS'un sorunsuz calismasi icin:\n\n"
                    + "  1) Pil optimizasyonu istisnasi (asagida acilacak)\n"
                    + "  2) Guvenlik > Izinler > 'Otomatik baslat' → AKTIF\n"
                    + "  3) Son uygulamalar ekraninda Sakura'u kilitleyin (asagi cek -> kilit)\n"
                    + "  4) Ayarlar > Gizlilik koruma > Ozel izinler > "
                    + "'Kisitlanmis uygulamalar' listesinden Sakura'u CIKARIN\n"
                    + "  5) HyperOS 2 Saf Mod (Pure Mode) AKTIFSE kapatin — yoksa "
                    + "imzasiz APK acilmaz\n"
                    + "  6) Ayarlar > Ekran > 'Karanlik mod her uygulamada' KAPALI olmali "
                    + "(WebView beyaz ekran olur)\n\n"
                    + "Bu uyariyi sadece bir kez gorursunuz.")
                .setPositiveButton("Devam", (d, w) -> {
                    requestBatteryOptimizationExemption();
                    handler.postDelayed(this::openOemAutostartSettings, 1200);
                    prefs.edit().putBoolean(PREF_OEM_HINTED, true).apply();
                })
                .setNegativeButton("Atla", (d, w) ->
                    prefs.edit().putBoolean(PREF_OEM_HINTED, true).apply())
                .show();
        } catch (Throwable t) {
            writeCrashLog("oem-hints", t);
        }
    }

    private void requestBatteryOptimizationExemption() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
            if (prefs.getBoolean(PREF_BATTERY_HINTED, false)) return;
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null) return;
            String pkg = getPackageName();
            if (pm.isIgnoringBatteryOptimizations(pkg)) {
                prefs.edit().putBoolean(PREF_BATTERY_HINTED, true).apply();
                return;
            }
            // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS bazi OEM'lerde bloklu;
            // resolve etmiyorsa genel pil ayarlari sayfasina dus.
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + pkg));
            if (i.resolveActivity(getPackageManager()) != null) {
                startActivity(i);
            } else {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                if (fallback.resolveActivity(getPackageManager()) != null) startActivity(fallback);
            }
            prefs.edit().putBoolean(PREF_BATTERY_HINTED, true).apply();
        } catch (Throwable t) {
            writeCrashLog("battery-opt", t);
        }
    }

    /** MIUI / HyperOS autostart ayar sayfasini ac. */
    private void openOemAutostartSettings() {
        String[][] candidates = new String[][]{
            {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
            {"com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity"},
            {"com.miui.securitycenter", "com.miui.appmanager.ApplicationsDetailsActivity"}
        };
        for (String[] pair : candidates) {
            try {
                Intent i = new Intent();
                i.setComponent(new ComponentName(pair[0], pair[1]));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (i.resolveActivity(getPackageManager()) != null) {
                    showToast("Lutfen Sakura POS uygulamalarini 'autostart' listesine ekleyin");
                    startActivity(i);
                    return;
                }
            } catch (Throwable ignored) {}
        }
        // Son care: uygulama detay ayarlari
        try {
            Intent appDetails = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName()));
            appDetails.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(appDetails);
        } catch (Throwable ignored) {}
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                            @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // POST_NOTIFICATIONS reddi sorun degil — DownloadManager calismaya devam eder,
        // sadece progress bildirimi gozukmez.
    }

    // ===== CRASH LOGGER =====

    private void installCrashLogger() {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try { writeCrashLog("uncaught", throwable); } catch (Throwable ignored) {}
            if (prev != null) prev.uncaughtException(thread, throwable);
        });
    }

    private void writeCrashLog(String tag, Throwable t) {
        try {
            File dir = getExternalFilesDir(null);
            if (dir == null) dir = getFilesDir();
            File f = new File(dir, "crash.log");
            java.io.StringWriter sw = new java.io.StringWriter();
            t.printStackTrace(new java.io.PrintWriter(sw));
            String content = "[" + new java.util.Date() + "] " + tag + " | "
                + Build.MANUFACTURER + " " + Build.MODEL + " API " + Build.VERSION.SDK_INT + "\n"
                + sw.toString() + "\n";
            try (java.io.FileWriter fw = new java.io.FileWriter(f, true)) { fw.write(content); }
        } catch (Throwable ignored) {}
    }

    private void showLastCrashIfAny() {
        try {
            File dir = getExternalFilesDir(null);
            if (dir == null) dir = getFilesDir();
            final File f = new File(dir, "crash.log");
            if (!f.exists() || f.length() == 0) return;
            handler.postDelayed(() -> {
                try {
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader br = new BufferedReader(new java.io.FileReader(f))) {
                        String line; int n = 0;
                        while ((line = br.readLine()) != null && n++ < 60) sb.append(line).append('\n');
                    }
                    new AlertDialog.Builder(this)
                        .setTitle("Onceki cokme kaydi")
                        .setMessage(sb.toString())
                        .setPositiveButton("Sil", (d, w) -> f.delete())
                        .setNegativeButton("Kapat", null)
                        .show();
                } catch (Throwable ignored) {}
            }, 2000);
        } catch (Throwable ignored) {}
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        try { WebView.setWebContentsDebuggingEnabled(true); } catch (Throwable ignored) {}

        // Koyu arkaplan: HyperOS/MIUI beyaz pencere flash'i ve WebView ilk
        // boyama bos beyaz kalmasi sorununu engeller.
        final int BG_DARK = 0xFF0F0F1A;

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(BG_DARK);

        // Yerel splash overlay — WebView ilk frame'i basana kadar gorunur.
        // Boylece kullanici beyaz ekran yerine "Sakura yukleniyor..." gorur.
        final android.widget.TextView splash = new android.widget.TextView(this);
        splash.setText("Sakura " + (BuildConfig.ROLE.equals("garson") ? "Garson" : "Yonetici") + "\nYukleniyor...");
        splash.setTextColor(0xFFE8B4B8);
        splash.setTextSize(18);
        splash.setGravity(android.view.Gravity.CENTER);
        splash.setBackgroundColor(BG_DARK);
        FrameLayout.LayoutParams splashLp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        splash.setLayoutParams(splashLp);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(BG_DARK);
        // HyperOS/MIUI WebView donanim katmaninda zaman zaman tamamen beyaz render
        // ediyor (bilinen GPU bug). YAZILIM katmani biraz daha yavas ama hep cizer.
        try { webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null); } catch (Throwable ignored) {}
        // WebView'i once gizle — onPageCommitVisible'da gosterecegiz; bu sayede
        // bos beyaz/yari yuklu sayfa kullaniciya hic flash etmez.
        webView.setVisibility(View.INVISIBLE);

        root.addView(webView);
        root.addView(splash);
        setContentView(root);
        this.splashView = splash;

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        // Cache: HyperOS Memory Cleaner pasif kalan WebView process'ini oldurebiliyor;
        // tekrar acildiginda cache yardimiyla daha hizli render olsun. Server zaten
        // no-cache header'lariyla taze icerigi zorluyor.
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        try { android.webkit.CookieManager.getInstance().removeAllCookies(null); } catch (Throwable ignored) {}
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(false);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(true);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // HyperOS / MIUI sistem zorla karanlik modu WebView'i bos beyaz render
        // ediyor — kesinlikle kapat.
        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
                WebSettingsCompat.setForceDark(ws, WebSettingsCompat.FORCE_DARK_OFF);
            }
        } catch (Throwable ignored) {}
        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK_STRATEGY)) {
                WebSettingsCompat.setForceDarkStrategy(ws,
                    WebSettingsCompat.DARK_STRATEGY_WEB_THEME_DARKENING_ONLY);
            }
        } catch (Throwable ignored) {}

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    connected.set(false);
                    String msg = "Baglanti hatasi (" + error.getErrorCode() + "): " + error.getDescription();
                    showToast(msg);
                    writeCrashLog("webview", new RuntimeException(msg + " | url=" + request.getUrl()));
                    scheduleReconnect();
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                             android.webkit.WebResourceResponse errorResponse) {
                if (request.isForMainFrame()) {
                    showToast("HTTP " + errorResponse.getStatusCode() + " — " + request.getUrl());
                }
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                Log.i(TAG, "onPageStarted: " + url);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                Log.i(TAG, "onPageCommitVisible: " + url);
                // Ilk piksel basildi — splash'i gizle, WebView'i goster.
                handler.post(() -> {
                    view.setVisibility(View.VISIBLE);
                    if (splashView != null) splashView.setVisibility(View.GONE);
                });
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                Log.i(TAG, "onPageFinished: " + url);
                // Yedek: onPageCommitVisible bazi WebView versiyonlarinda tetiklenmiyor.
                handler.post(() -> {
                    if (view.getVisibility() != View.VISIBLE) view.setVisibility(View.VISIBLE);
                    if (splashView != null) splashView.setVisibility(View.GONE);
                });
                view.evaluateJavascript(
                    "(function(){return document.body ? document.body.innerText.length : -1;})()",
                    value -> {
                        try {
                            int len = Integer.parseInt(value);
                            if (len <= 0) showToast("Sayfa bos yuklendi: " + url);
                        } catch (Exception ignored) {}
                    });
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                writeCrashLog("renderer-gone", new RuntimeException("WebView renderer crashed; recreating"));
                handler.post(() -> {
                    try { ((ViewGroup) view.getParent()).removeView(view); } catch (Throwable ignored) {}
                    setupWebView();
                    if (!serverUrl.isEmpty()) tryConnect();
                });
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.endsWith(".apk")) {
                    downloadAndInstallApk(url);
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage cm) {
                if (cm.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.ERROR) {
                    String s = "JS HATA: " + cm.message() + " (" + cm.sourceId() + ":" + cm.lineNumber() + ")";
                    writeCrashLog("js", new RuntimeException(s));
                    handler.post(() -> Toast.makeText(MainActivity.this, s, Toast.LENGTH_LONG).show());
                }
                return true;
            }
        });
    }

    // ===== SUNUCU KESFET =====
    // Sira: UDP broadcast dinle -> mDNS -> sakura.local hostname -> /24 subnet tara -> manuel IP

    private void discoverServer() {
        setSplashSub("Sunucu araniyor...");
        // GLOBAL GUVENLIK AGI: keşif zincirindeki herhangi bir adım sessizce
        // asılı kalsa bile (MIUI/HyperOS NSD/UDP tuhaflıkları) kullanıcı sonsuz
        // "Yukleniyor..." ekranında kalmasın — en geç bu süre sonunda manuel IP
        // iste. connected olduysa veya manuel diyalog zaten açıldıysa hiçbir şey
        // yapmaz.
        handler.postDelayed(() -> {
            if (!connected.get() && !manualIpDialogShown) {
                showToast("Otomatik bulunamadi — adresi elle girin");
                askManualIp();
            }
        }, DISCOVERY_WATCHDOG_MS);
        tryUdpDiscovery(() ->
            tryMdns(() ->
                tryHostname(() ->
                    trySubnetScan(() -> handler.post(this::askManualIp)))));
    }

    private void tryHostname(Runnable onFail) {
        setSplashSub("sakura.local deneniyor...");
        serverUrl = "http://sakura.local:" + PORT;
        tryConnect(onFail);
    }

    /** Splash alt satırını güncelle — kullanıcı ilerlemeyi görsün, donmuş sanmasın. */
    private void setSplashSub(String sub) {
        handler.post(() -> {
            if (splashView != null) {
                splashView.setText("Sakura "
                    + (BuildConfig.ROLE.equals("garson") ? "Garson" : "Yonetici")
                    + "\n" + sub);
            }
        });
    }

    private void tryUdpDiscovery(Runnable onFail) {
        setSplashSub("Ag yayini dinleniyor...");
        new Thread(() -> {
            WifiManager.MulticastLock mcLock = null;
            DatagramSocket sock = null;
            try {
                WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifi != null) {
                    mcLock = wifi.createMulticastLock("sakura-discovery");
                    mcLock.setReferenceCounted(false);
                    mcLock.acquire();
                }
                sock = new DatagramSocket(null);
                sock.setReuseAddress(true);
                sock.setBroadcast(true);
                sock.bind(new java.net.InetSocketAddress(DISCOVERY_PORT));
                sock.setSoTimeout(UDP_LISTEN_TIMEOUT_MS);

                byte[] buf = new byte[4096];
                long deadline = System.currentTimeMillis() + UDP_LISTEN_TIMEOUT_MS;
                while (System.currentTimeMillis() < deadline) {
                    try {
                        DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                        sock.receive(pkt);
                        String msg = new String(pkt.getData(), 0, pkt.getLength());
                        JSONObject json = new JSONObject(msg);
                        if (!"sakura-pos".equals(json.optString("app"))) continue;
                        int port = json.optInt("port", PORT);
                        String senderIp = pkt.getAddress().getHostAddress();
                        String ip = senderIp;
                        // Sunucunun yayinladigi IP listesinden cihazla AYNI alt aga (/24)
                        // ait olani sec; yoksa paketin geldigi IP'yi kullan.
                        org.json.JSONArray ips = json.optJSONArray("ips");
                        String myIp = getLocalIp();
                        String myPrefix = myIp != null && myIp.lastIndexOf('.') > 0
                            ? myIp.substring(0, myIp.lastIndexOf('.') + 1) : null;
                        if (ips != null && ips.length() > 0) {
                            String best = null;
                            for (int k = 0; k < ips.length(); k++) {
                                String cand = ips.optString(k, null);
                                if (cand == null) continue;
                                if (myPrefix != null && cand.startsWith(myPrefix)) { best = cand; break; }
                            }
                            ip = best != null ? best : (myPrefix != null ? senderIp : ips.optString(0, senderIp));
                        }
                        Log.i(TAG, "UDP discovery hit. sender=" + senderIp + " serverIps=" + ips + " selected=" + ip);
                        serverUrl = "http://" + ip + ":" + port;
                        prefs.edit().putString(PREF_IP, ip).apply();
                        handler.post(() -> {
                            showToast("Sunucu bulundu: " + serverUrl);
                            tryConnect();
                        });
                        return;
                    } catch (java.net.SocketTimeoutException te) {
                        break;
                    } catch (Exception ignored) { /* paket bozuk, devam et */ }
                }
                handler.post(onFail);
            } catch (Exception e) {
                writeCrashLog("udp-discovery", e);
                handler.post(onFail);
            } finally {
                if (sock != null) try { sock.close(); } catch (Exception ignored) {}
                if (mcLock != null) try { mcLock.release(); } catch (Exception ignored) {}
            }
        }, "sakura-udp-discovery").start();
    }

    private void trySubnetScan(Runnable onFail) {
        new Thread(() -> {
            try {
                String localIp = getLocalIp();
                if (localIp == null) { handler.post(onFail); return; }
                int lastDot = localIp.lastIndexOf('.');
                if (lastDot < 0) { handler.post(onFail); return; }
                String prefix = localIp.substring(0, lastDot + 1);

                setSplashSub("Ag taraniyor (" + prefix + "1-254)...");

                ExecutorService pool = Executors.newFixedThreadPool(40);
                final AtomicBoolean found = new AtomicBoolean(false);
                final java.util.concurrent.atomic.AtomicReference<String> hit =
                    new java.util.concurrent.atomic.AtomicReference<>(null);

                for (int i = 1; i <= 254; i++) {
                    final String candidate = prefix + i;
                    pool.submit(() -> {
                        if (found.get()) return;
                        if (probe(candidate, PORT, SUBNET_SCAN_TIMEOUT_MS)) {
                            if (found.compareAndSet(false, true)) hit.set(candidate);
                        }
                    });
                }
                pool.shutdown();
                pool.awaitTermination(15, TimeUnit.SECONDS);

                if (found.get() && hit.get() != null) {
                    String ip = hit.get();
                    serverUrl = "http://" + ip + ":" + PORT;
                    prefs.edit().putString(PREF_IP, ip).apply();
                    handler.post(() -> {
                        showToast("Sunucu bulundu (tarama): " + serverUrl);
                        tryConnect();
                    });
                } else {
                    handler.post(onFail);
                }
            } catch (Exception e) {
                writeCrashLog("subnet-scan", e);
                handler.post(onFail);
            }
        }, "sakura-subnet-scan").start();
    }

    private boolean probe(String ip, int port, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL("http://" + ip + ":" + port + "/api/health");
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            return code == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String getLocalIp() {
        try {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                int ipInt = wifi.getConnectionInfo().getIpAddress();
                if (ipInt != 0) {
                    return String.format(java.util.Locale.US, "%d.%d.%d.%d",
                        ipInt & 0xff, (ipInt >> 8) & 0xff, (ipInt >> 16) & 0xff, (ipInt >> 24) & 0xff);
                }
            }
            // Wi-Fi yoksa NetworkInterface'den IPv4 ara
            java.util.Enumeration<java.net.NetworkInterface> ifs = java.net.NetworkInterface.getNetworkInterfaces();
            while (ifs.hasMoreElements()) {
                java.net.NetworkInterface ni = ifs.nextElement();
                if (ni.isLoopback() || !ni.isUp()) continue;
                java.util.Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a instanceof java.net.Inet4Address && !a.isLoopbackAddress()) {
                        return a.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private void tryMdns(Runnable onFail) {
        // Tek seferlik fail yönlendirici. MIUI/HyperOS'ta discoverServices bazen
        // NE onDiscoveryStarted NE onStartDiscoveryFailed çağırıyor; eski kodda
        // timeout yalnızca onDiscoveryStarted içinde kuruluyordu -> mDNS adımı
        // sonsuza dek asılı kalıp zincir hiç ilerlemiyordu (splash'te kilitlenme).
        final AtomicBoolean routed = new AtomicBoolean(false);
        final Runnable failOnce = () -> {
            if (routed.compareAndSet(false, true)) {
                stopMdns();
                handler.post(onFail);
            }
        };
        // HER ZAMAN kurulan watchdog — callback hiç gelmese bile zincir ilerler.
        handler.postDelayed(() -> { if (!mdnsResolved) failOnce.run(); }, MDNS_TIMEOUT_MS);
        setSplashSub("mDNS ile araniyor...");
        try {
            nsdManager = (NsdManager) getSystemService(Context.NSD_SERVICE);
            mdnsResolved = false;

            mdnsListener = new NsdManager.DiscoveryListener() {
                @Override public void onStartDiscoveryFailed(String s, int e) { failOnce.run(); }
                @Override public void onStopDiscoveryFailed(String s, int e) {}
                @Override public void onDiscoveryStopped(String s) {}

                @Override
                public void onDiscoveryStarted(String s) {
                    handler.postDelayed(() -> {
                        if (!mdnsResolved) failOnce.run();
                    }, MDNS_TIMEOUT_MS);
                }

                @Override
                public void onServiceFound(NsdServiceInfo info) {
                    if (info.getServiceName() != null && info.getServiceName().toLowerCase().contains("sakura")) {
                        nsdManager.resolveService(info, new NsdManager.ResolveListener() {
                            @Override public void onResolveFailed(NsdServiceInfo si, int err) {}

                            @Override
                            public void onServiceResolved(NsdServiceInfo si) {
                                if (mdnsResolved) return;
                                mdnsResolved = true;
                                String host = si.getHost() != null ? si.getHost().getHostAddress() : null;
                                int port = si.getPort() > 0 ? si.getPort() : PORT;
                                if (host == null) return;
                                serverUrl = "http://" + host + ":" + port;
                                prefs.edit().putString(PREF_IP, host).apply();
                                stopMdns();
                                handler.post(() -> tryConnect());
                            }
                        });
                    }
                }

                @Override public void onServiceLost(NsdServiceInfo info) {}
            };

            nsdManager.discoverServices("_http._tcp.", NsdManager.PROTOCOL_DNS_SD, mdnsListener);
        } catch (Exception e) {
            failOnce.run();
        }
    }

    private void stopMdns() {
        if (nsdManager != null && mdnsListener != null) {
            try { nsdManager.stopServiceDiscovery(mdnsListener); } catch (Exception ignored) {}
            mdnsListener = null;
        }
    }

    // ===== BAGLANTI =====

    private void tryConnect() { tryConnect(null); }

    private void tryConnect(Runnable onFail) {
        Log.i(TAG, "tryConnect: " + serverUrl);
        new Thread(() -> {
            try {
                URL url = new URL(serverUrl + "/api/health");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(CONNECT_TIMEOUT_MS);
                int code = conn.getResponseCode();
                conn.disconnect();

                Log.i(TAG, "tryConnect health response: HTTP " + code);
                if (code == 200) {
                    connected.set(true);
                    reconnectDelay = 1000;
                    handler.post(() -> {
                        Log.i(TAG, "Loading " + serverUrl + startPath);
                        // Yerel splash overlay zaten ekranda; dogrudan gercek URL'i yukle.
                        if (splashView != null) {
                            splashView.setVisibility(View.VISIBLE);
                            splashView.setText("Sakura " + (BuildConfig.ROLE.equals("garson") ? "Garson" : "Yonetici")
                                + "\n" + serverUrl);
                        }
                        if (webView != null) webView.setVisibility(View.INVISIBLE);
                        webView.loadUrl(serverUrl + startPath);
                        checkVersion();
                    });
                } else {
                    throw new Exception("HTTP " + code);
                }
            } catch (Exception e) {
                Log.w(TAG, "tryConnect failed: " + e.getClass().getSimpleName() + " " + e.getMessage());
                connected.set(false);
                if (onFail != null) handler.post(onFail);
                else scheduleReconnect();
            }
        }).start();
    }

    private void scheduleReconnect() {
        if (reconnectRunnable != null) handler.removeCallbacks(reconnectRunnable);
        reconnectRunnable = () -> tryConnect(() -> {
            reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
            scheduleReconnect();
        });
        handler.postDelayed(reconnectRunnable, reconnectDelay);
    }

    // ===== MANUEL IP =====

    private void askManualIp() {
        if (manualIpDialogShown || isFinishing()) return;
        manualIpDialogShown = true;
        setSplashSub("Adres bekleniyor...");
        EditText input = new EditText(this);
        input.setHint("192.168.1.XXX");
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        String savedIp = prefs.getString(PREF_IP, "");
        if (!savedIp.isEmpty()) input.setText(savedIp);

        new AlertDialog.Builder(this)
            .setTitle("Sunucu Adresi")
            .setMessage("Sakura POS sunucusunun IP adresini girin:")
            .setView(input)
            .setPositiveButton("Baglan", (d, w) -> {
                manualIpDialogShown = false; // diyalog kapandı; tekrar açılabilir
                String ip = input.getText().toString().trim();
                if (!ip.isEmpty()) {
                    prefs.edit().putString(PREF_IP, ip).apply();
                    serverUrl = "http://" + ip + ":" + PORT;
                    setSplashSub(ip + " baglaniliyor...");
                    tryConnect(() -> {
                        showToast("Baglanilamadi, tekrar deneyin");
                        handler.postDelayed(this::askManualIp, 1000);
                    });
                } else {
                    handler.postDelayed(this::askManualIp, 300);
                }
            })
            .setNeutralButton("Tekrar Ara", (d, w) -> {
                manualIpDialogShown = false;
                discoverServer();
            })
            .setCancelable(false)
            .show();
    }

    // ===== VERSIYON KONTROL =====

    private void checkVersion() {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(serverUrl + "/api/version");
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(CONNECT_TIMEOUT_MS);

                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                }

                JSONObject json = new JSONObject(sb.toString());
                String minVer = json.optString("minApkVersion", "0.0.0");
                String latestVer = json.optString("apkVersion", minVer);
                String currentVer = BuildConfig.VERSION_NAME;

                if (compareVersions(currentVer, minVer) < 0) {
                    handler.post(() -> showUpdateDialog(latestVer, true));
                } else if (compareVersions(currentVer, latestVer) < 0) {
                    handler.post(() -> showUpdateDialog(latestVer, false));
                }
            } catch (Exception ignored) {
                // Silent — server may not expose /api/version yet
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private int compareVersions(String v1, String v2) {
        String[] a = v1.split("\\.");
        String[] b = v2.split("\\.");
        int n = Math.max(a.length, b.length);
        for (int i = 0; i < n; i++) {
            int x = i < a.length ? safeInt(a[i]) : 0;
            int y = i < b.length ? safeInt(b[i]) : 0;
            if (x != y) return x - y;
        }
        return 0;
    }

    private int safeInt(String s) {
        try { return Integer.parseInt(s); } catch (Exception e) { return 0; }
    }

    private void showUpdateDialog(String version, boolean mandatory) {
        String apkUrl = serverUrl + "/updates/apk/" + BuildConfig.ROLE + "-" + version + ".apk";
        AlertDialog.Builder b = new AlertDialog.Builder(this)
            .setTitle(mandatory ? "Guncelleme Zorunlu" : "Yeni Surum Var")
            .setMessage("Surum: " + version + (mandatory ? "\n(Devam etmek icin guncelleme zorunlu)" : ""))
            .setPositiveButton("Indir & Kur", (d, w) -> downloadAndInstallApk(apkUrl))
            .setCancelable(false);
        if (!mandatory) b.setNegativeButton("Sonra", (d, w) -> d.dismiss());
        b.show();
    }

    // ===== APK INDIR & KUR =====

    private void downloadAndInstallApk(String url) {
        // Android 8+ "Bilinmeyen kaynaklardan yukleme" izni — uygulama bazinda
        // verilmesi sart. Yoksa kullaniciyi ayar sayfasina yonlendir, gelince
        // pendingApkUrl ile devam et.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                if (!getPackageManager().canRequestPackageInstalls()) {
                    pendingApkUrl = url;
                    new AlertDialog.Builder(this)
                        .setTitle("Kurulum izni gerekli")
                        .setMessage("Sakura POS guncellemesi yukleyebilmek icin 'Bu kaynaktan "
                            + "yuklemeye izin ver' ayarini acmaniz gerekiyor.")
                        .setPositiveButton("Ayarlari Ac", (d, w) -> {
                            try {
                                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + getPackageName()));
                                startActivityForResult(i, REQ_INSTALL_PERMISSION);
                            } catch (Throwable t) {
                                showToast("Ayar acilamadi — Ayarlar > Uygulamalar > Sakura > "
                                    + "Bilinmeyen uygulamalari yukle");
                            }
                        })
                        .setNegativeButton("Iptal", null)
                        .show();
                    return;
                }
            } catch (Throwable ignored) {}
        }
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            String fileName = "sakura-" + BuildConfig.ROLE + "-" + System.currentTimeMillis() + ".apk";

            // Eski indirmeyi temizle
            File downloads = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (downloads != null) {
                File[] olds = downloads.listFiles((d, n) -> n.startsWith("sakura-") && n.endsWith(".apk"));
                if (olds != null) for (File f : olds) f.delete();
            }

            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("Sakura POS Guncelleme");
            req.setDescription("Yeni surum indiriliyor...");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            req.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);

            apkDownloadId = dm.enqueue(req);
            showToast("Indiriliyor...");
        } catch (Exception e) {
            showToast("Indirme baslatilamadi: " + e.getMessage());
        }
    }

    private void registerDownloadReceiver() {
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != apkDownloadId) return;

                DownloadManager dm = (DownloadManager) ctx.getSystemService(DOWNLOAD_SERVICE);
                DownloadManager.Query q = new DownloadManager.Query().setFilterById(id);
                try (Cursor c = dm.query(q)) {
                    if (c != null && c.moveToFirst()) {
                        int statusIdx = c.getColumnIndex(DownloadManager.COLUMN_STATUS);
                        int uriIdx = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
                        if (statusIdx >= 0 && c.getInt(statusIdx) == DownloadManager.STATUS_SUCCESSFUL && uriIdx >= 0) {
                            String localUri = c.getString(uriIdx);
                            if (localUri != null) installApk(Uri.parse(localUri));
                        } else {
                            showToast("Indirme basarisiz");
                        }
                    }
                }
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, filter);
        }
    }

    private void installApk(Uri localUri) {
        try {
            File file = new File(Uri.parse(localUri.toString()).getPath());
            Uri apkUri = FileProvider.getUriForFile(
                this, getPackageName() + ".fileprovider", file);

            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(install);
        } catch (Exception e) {
            showToast("Kurulum baslatilamadi: " + e.getMessage());
        }
    }

    // ===== NETWORK CHANGE LISTENER =====

    private void registerNetworkCallback() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            NetworkRequest req = new NetworkRequest.Builder().build();
            netCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    if (!connected.get() && !serverUrl.isEmpty()) {
                        handler.post(() -> tryConnect());
                    }
                }

                @Override
                public void onLost(Network network) {
                    connected.set(false);
                }
            };
            cm.registerNetworkCallback(req, netCallback);
        } catch (Exception ignored) {}
    }

    // ===== IMMERSIVE MODE =====

    private void hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    // ===== LIFECYCLE =====

    @Override public void onBackPressed() { /* kiosk: devre disi */ }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_INSTALL_PERMISSION && pendingApkUrl != null) {
            String url = pendingApkUrl;
            pendingApkUrl = null;
            // Kullanici ayarlardan dondu — izin verilip verilmediginden bagimsiz
            // tekrar dene; canRequestPackageInstalls() yine kontrol eder.
            handler.postDelayed(() -> downloadAndInstallApk(url), 300);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUI();
        if (!connected.get() && !serverUrl.isEmpty()) tryConnect();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUI();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopMdns();
        if (netCallback != null) {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
                cm.unregisterNetworkCallback(netCallback);
            } catch (Exception ignored) {}
        }
        if (downloadReceiver != null) {
            try { unregisterReceiver(downloadReceiver); } catch (Exception ignored) {}
        }
        if (reconnectRunnable != null) handler.removeCallbacks(reconnectRunnable);
    }

    private void showToast(String msg) {
        handler.post(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }
}
