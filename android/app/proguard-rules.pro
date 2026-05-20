# Sakura POS APK — ProGuard kurallari
# Release build minifyEnabled false oldugu surece sadece kabuk olarak duruyor.

# WebView JavaScript bridge kullanilirsa burada sinif tutmak gerekir.
# Suanda JS bridge yok, bu yuzden ozel kural gerekmez.

# JSONObject ve std libs
-keep class org.json.** { *; }

# AndroidX
-keep class androidx.** { *; }
-dontwarn androidx.**
