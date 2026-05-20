# Non-interactive APK build (debug imzasi).
# Bir kerelik: JDK17 + Android SDK indirir, sonra gradle ile iki flavor APK'si uretir.
# Production imzasi icin: scripts\setup-android.ps1 (keystore olusturur).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ROOT = Split-Path -Parent $PSScriptRoot
$SDK_ROOT = Join-Path $env:USERPROFILE 'android-sdk'
$JDK_HOME = Join-Path $env:USERPROFILE 'jdk-17'

function Log($m) { Write-Host "[apk] $m" -ForegroundColor Cyan }

# ===== JDK 17 =====
$javaBin = Join-Path $JDK_HOME 'bin\java.exe'
if (-not (Test-Path $javaBin)) {
  Log 'Microsoft OpenJDK 17 indiriliyor (~190MB)...'
  $jdkZip = "$env:TEMP\jdk17.zip"
  Invoke-WebRequest -Uri 'https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip' -OutFile $jdkZip -UseBasicParsing
  if (Test-Path $JDK_HOME) { Remove-Item $JDK_HOME -Recurse -Force }
  New-Item -ItemType Directory -Path $JDK_HOME | Out-Null
  Log 'JDK aciliyor...'
  Expand-Archive -Path $jdkZip -DestinationPath $JDK_HOME -Force
  $inner = Get-ChildItem -Path $JDK_HOME -Directory | Select-Object -First 1
  if ($inner) {
    Get-ChildItem $inner.FullName | Move-Item -Destination $JDK_HOME -Force
    Remove-Item $inner.FullName -Recurse -Force
  }
  Remove-Item $jdkZip
  Log "JDK kuruldu: $JDK_HOME"
} else {
  Log "JDK mevcut: $JDK_HOME"
}
$env:JAVA_HOME = $JDK_HOME
$env:PATH = "$JDK_HOME\bin;$env:PATH"

# ===== Android cmdline-tools =====
$sdkmgr = "$SDK_ROOT\cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkmgr)) {
  Log 'Android cmdline-tools indiriliyor (~150MB)...'
  $tzip = "$env:TEMP\cmdline-tools.zip"
  Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile $tzip -UseBasicParsing
  $unzipDir = "$env:TEMP\sakura-cmdtools"
  if (Test-Path $unzipDir) { Remove-Item $unzipDir -Recurse -Force }
  Expand-Archive -Path $tzip -DestinationPath $unzipDir -Force
  New-Item -ItemType Directory -Path "$SDK_ROOT\cmdline-tools\latest" -Force | Out-Null
  Get-ChildItem "$unzipDir\cmdline-tools" | Move-Item -Destination "$SDK_ROOT\cmdline-tools\latest" -Force
  Remove-Item $tzip
  Remove-Item $unzipDir -Recurse -Force
  Log "cmdline-tools kuruldu: $SDK_ROOT"
}
$env:ANDROID_HOME = $SDK_ROOT
$env:ANDROID_SDK_ROOT = $SDK_ROOT
[Environment]::SetEnvironmentVariable('JAVA_HOME', $JDK_HOME, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $SDK_ROOT, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $SDK_ROOT, 'User')

# ===== SDK paketleri =====
$plat = "$SDK_ROOT\platforms\android-34"
$bt = "$SDK_ROOT\build-tools\34.0.0"
if (-not (Test-Path $plat) -or -not (Test-Path $bt)) {
  Log 'SDK lisanslari kabul ediliyor...'
  # Birden fazla lisans var; 30 satir 'y' gonder
  $ys = ('y' * 1 + "`n") * 30
  $ys | & cmd /c "`"$sdkmgr`" --licenses" 2>&1 | Out-Null
  Log 'SDK paketleri indiriliyor (platform-tools, android-34, build-tools 34.0.0 ~600MB)...'
  & cmd /c "`"$sdkmgr`" `"platform-tools`" `"platforms;android-34`" `"build-tools;34.0.0`""
  if ($LASTEXITCODE -ne 0) { throw "SDK paket kurulumu basarisiz: $LASTEXITCODE" }
} else {
  Log 'SDK paketleri mevcut'
}

# ===== Gradle build =====
Log 'Gradle ile APK build basliyor (debug + release iki flavor)...'
Push-Location (Join-Path $ROOT 'android')
# local.properties android sdk yolunu gradle'a soyler
"sdk.dir=$($SDK_ROOT -replace '\\','\\')" | Set-Content -Path 'local.properties' -Encoding ascii
& cmd /c 'gradlew.bat --no-daemon :app:assembleGarsonRelease :app:assembleYoneticiRelease'
$exit = $LASTEXITCODE
Pop-Location
if ($exit -ne 0) { throw "Gradle build basarisiz: $exit" }

Log 'BUILD BASARILI. APK dosyalari:'
Get-ChildItem -Path (Join-Path $ROOT 'android\app\build\outputs\apk') -Recurse -Filter '*.apk' | ForEach-Object {
  $size = [Math]::Round($_.Length / 1MB, 2)
  Write-Host "  $($_.FullName)  ($size MB)"
}
