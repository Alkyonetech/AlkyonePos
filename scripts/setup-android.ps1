# Sakura POS — Android toolchain bootstrap (Windows)
#
# Yaptigi:
#   1. JDK 17 yuklu degilse Microsoft OpenJDK indirir (msi)
#   2. Android cmdline-tools indirip yerlesir (~$HOME\android-sdk)
#   3. SDK Manager ile platform-tools, platforms;android-34, build-tools;34.0.0 kurar
#   4. JAVA_HOME, ANDROID_HOME, PATH ortam degiskenlerini kullaniciya kalici yazar
#   5. Imza icin sakura-release.jks olusturur (interaktif keytool)
#   6. android/keystore.properties olusturur
#   7. gradle assembleRelease tetikler
#
# Kullanim (PowerShell, Yonetici degil — kullanici scope yeterli):
#   powershell -ExecutionPolicy Bypass -File scripts\setup-android.ps1
#
# Tek seferlik: ~1.5GB indirme. Sonraki "npm run release" cagrilarinda yeniden
# calistirmaya gerek yok.

$ErrorActionPreference = 'Stop'

$ROOT = Split-Path -Parent $PSScriptRoot
$SDK_ROOT = Join-Path $env:USERPROFILE 'android-sdk'
$JDK_HOME = Join-Path $env:USERPROFILE 'jdk-17'

function Log($msg) { Write-Host "[setup-android] $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[setup-android] $msg" -ForegroundColor Yellow }

# ===== 1. JDK 17 =====
$javaCmd = Get-Command java -ErrorAction SilentlyContinue
if (-not $javaCmd -or -not ($javaCmd.Version.Major -ge 17)) {
  Log 'JDK 17 bulunamadi, Microsoft OpenJDK indiriliyor...'
  $jdkZip = "$env:TEMP\jdk17.zip"
  Invoke-WebRequest -Uri 'https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip' -OutFile $jdkZip -UseBasicParsing
  if (Test-Path $JDK_HOME) { Remove-Item $JDK_HOME -Recurse -Force }
  New-Item -ItemType Directory -Path $JDK_HOME | Out-Null
  Expand-Archive -Path $jdkZip -DestinationPath $JDK_HOME -Force
  $inner = Get-ChildItem -Path $JDK_HOME -Directory | Select-Object -First 1
  if ($inner) {
    Get-ChildItem $inner.FullName | Move-Item -Destination $JDK_HOME -Force
    Remove-Item $inner.FullName -Recurse -Force
  }
  Remove-Item $jdkZip
  $env:JAVA_HOME = $JDK_HOME
  $env:PATH = "$JDK_HOME\bin;$env:PATH"
  [Environment]::SetEnvironmentVariable('JAVA_HOME', $JDK_HOME, 'User')
  Log "JAVA_HOME = $JDK_HOME (kullanici ortamina yazildi)"
} else {
  Log "JDK 17 mevcut: $($javaCmd.Version)"
  if (-not $env:JAVA_HOME) {
    $env:JAVA_HOME = (Split-Path -Parent (Split-Path -Parent $javaCmd.Source))
  }
}

# ===== 2. Android cmdline-tools =====
if (-not (Test-Path "$SDK_ROOT\cmdline-tools\latest\bin\sdkmanager.bat")) {
  Log 'Android cmdline-tools indiriliyor...'
  $tzip = "$env:TEMP\cmdline-tools.zip"
  Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile $tzip -UseBasicParsing
  $unzipDir = "$env:TEMP\sakura-cmdtools"
  if (Test-Path $unzipDir) { Remove-Item $unzipDir -Recurse -Force }
  Expand-Archive -Path $tzip -DestinationPath $unzipDir -Force
  New-Item -ItemType Directory -Path "$SDK_ROOT\cmdline-tools\latest" -Force | Out-Null
  Get-ChildItem "$unzipDir\cmdline-tools" | Move-Item -Destination "$SDK_ROOT\cmdline-tools\latest" -Force
  Remove-Item $tzip
  Remove-Item $unzipDir -Recurse -Force
  Log "SDK kuruldu: $SDK_ROOT"
} else {
  Log "Android SDK mevcut: $SDK_ROOT"
}

$env:ANDROID_HOME = $SDK_ROOT
$env:ANDROID_SDK_ROOT = $SDK_ROOT
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $SDK_ROOT, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $SDK_ROOT, 'User')

# ===== 3. SDK paketleri =====
$sdkmgr = "$SDK_ROOT\cmdline-tools\latest\bin\sdkmanager.bat"
Log 'SDK paketleri kuruluyor (lisans kabulu otomatik)...'
& $sdkmgr --licenses 2>$null | Out-Null
& cmd /c "echo y|`"$sdkmgr`" `"platform-tools`" `"platforms;android-34`" `"build-tools;34.0.0`""

# ===== 4. Keystore (varsa atla) =====
$keystoreFile = Join-Path $ROOT 'android\sakura-release.jks'
$keystoreProps = Join-Path $ROOT 'android\keystore.properties'
if (-not (Test-Path $keystoreFile)) {
  Warn '----- IMZA KEYSTORE OLUSTURULUYOR -----'
  Warn 'Asagidaki sorulara cevap verin (en az birini doldurun, gerisi bos olabilir).'
  Warn 'NOT: Bu dosyayi (sakura-release.jks) ve sifreyi GUVENLI sakla — kaybolursa'
  Warn 'gelecek APK guncellemeleri kurulamaz, kullanici APK uninstall + reinstall yapmak zorunda kalir.'
  $keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
  $storePass = Read-Host -AsSecureString 'Keystore sifresi'
  $keyPass = Read-Host -AsSecureString 'Key sifresi (storage ile ayni olabilir)'
  $bstrSP = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePass)
  $plainSP = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstrSP)
  $bstrKP = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyPass)
  $plainKP = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstrKP)
  & $keytool -genkey -v -keystore $keystoreFile -alias sakura -keyalg RSA -keysize 2048 `
    -validity 10000 -storepass $plainSP -keypass $plainKP -dname "CN=Sakura POS, O=Sakura, C=TR"
  @"
storeFile=../sakura-release.jks
storePassword=$plainSP
keyAlias=sakura
keyPassword=$plainKP
"@ | Set-Content -Path $keystoreProps -Encoding utf8
  Log "keystore.properties yazildi"
} else {
  Log "Keystore mevcut: $keystoreFile"
}

# ===== 5. Build =====
Log 'Gradle ile APK build basliyor (assembleRelease, iki flavor)...'
Push-Location (Join-Path $ROOT 'android')
& cmd /c 'gradlew.bat :app:assembleGarsonRelease :app:assembleYoneticiRelease'
$exit = $LASTEXITCODE
Pop-Location
if ($exit -ne 0) {
  Warn "Gradle build hata kodu: $exit"
  exit $exit
}

Log 'APK build basarili.'
Log 'Cikti dosyalari:'
Get-ChildItem -Path (Join-Path $ROOT 'android\app\build\outputs\apk') -Recurse -Filter '*.apk' | ForEach-Object { Write-Host "  $($_.FullName)" }
Log 'Simdi: npm run release  ile release/SakuraPOS-x.y.z/ paketini olusturabilirsiniz.'
