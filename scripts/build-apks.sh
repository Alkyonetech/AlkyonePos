#!/usr/bin/env bash
# Marka-parametrik APK build (Linux/mac). Iki rol (garson + yonetici) release APK.
#   ./scripts/build-apks.sh alkyone
#   ./scripts/build-apks.sh sakura
# Gerekli: JDK 17 (JAVA_HOME) + Android SDK (ANDROID_SDK_ROOT, platform android-34,
# build-tools 34.0.0). Yoksa Android Studio ile kurun veya cmdline-tools indirin.
set -euo pipefail
BRAND="${1:-alkyone}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "$BRAND" in alkyone|sakura) ;; *) echo "Gecersiz marka: $BRAND (alkyone|sakura)"; exit 1;; esac
command -v java >/dev/null || { echo "HATA: java (JDK 17) bulunamadi. JAVA_HOME ayarlayin."; exit 1; }
: "${ANDROID_SDK_ROOT:?HATA: ANDROID_SDK_ROOT ayarli degil (Android SDK yolu)}"

echo "[apk:$BRAND] Gradle build: -PposBrand=$BRAND (garson + yonetici release)"
cd "$ROOT/android"
echo "sdk.dir=$ANDROID_SDK_ROOT" > local.properties
./gradlew --no-daemon -PposBrand="$BRAND" :app:assembleGarsonRelease :app:assembleYoneticiRelease

OUT="$ROOT/dist/apk/$BRAND"; mkdir -p "$OUT"
find app/build/outputs/apk -name '*.apk' -exec cp {} "$OUT/" \;
echo "[apk:$BRAND] BUILD BASARILI. APK'lar -> $OUT"
ls -lh "$OUT"/*.apk
