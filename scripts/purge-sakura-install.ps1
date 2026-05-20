# SAKURA POS — TUM KURULUM IZLERINI SIL
# YONETICI OLARAK CALISTIR (Sag tik > Yonetici olarak calistir)
#
# Korunan: C:\Users\yilma\Desktop\sakura\ (kaynak kod)
# Silinen: kurulu uygulama, AppData, kayit defteri, firewall, kisayollar

$ErrorActionPreference = 'Continue'

Write-Host '== Sakura POS kalintilarini temizleme ==' -ForegroundColor Cyan
Write-Host ''

# 1) Calisan process'leri sonlandir
Write-Host '[1/7] Process sonlandiriliyor...' -ForegroundColor Yellow
foreach ($name in 'SakuraPOS', 'SakuraPOS-Launcher', 'Uninstall SakuraPOS') {
  Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# 2) Uninstaller calistir (varsa) — registry + firewall + Program Files temizler
Write-Host '[2/7] NSIS uninstaller (sessiz) deneniyor...' -ForegroundColor Yellow
$uninst = 'C:\Program Files\SakuraPOS\Uninstall SakuraPOS.exe'
if (Test-Path $uninst) {
  try {
    Start-Process -FilePath $uninst -ArgumentList '/allusers', '/S' -Wait -NoNewWindow
    Write-Host '  Uninstaller bitti' -ForegroundColor Green
  } catch {
    Write-Host "  Uninstaller hatasi: $_" -ForegroundColor Red
  }
}
Start-Sleep -Seconds 2

# 3) Program Files SakuraPOS sil (uninstaller eksik kalmissa)
Write-Host '[3/7] C:\Program Files\SakuraPOS siliniyor...' -ForegroundColor Yellow
if (Test-Path 'C:\Program Files\SakuraPOS') {
  Remove-Item -Recurse -Force 'C:\Program Files\SakuraPOS' -ErrorAction SilentlyContinue
  if (Test-Path 'C:\Program Files\SakuraPOS') {
    Write-Host '  HATA: Program Files SakuraPOS hala duruyor (kullaniyor olabilir)' -ForegroundColor Red
  } else {
    Write-Host '  Silindi' -ForegroundColor Green
  }
} else {
  Write-Host '  Yok (zaten temiz)' -ForegroundColor Green
}

# 4) AppData siliniyor (kullanici verisi: cache, settings)
Write-Host '[4/7] AppData siliniyor...' -ForegroundColor Yellow
$appdataPaths = @(
  "$env:APPDATA\sakura-pos",
  "$env:APPDATA\SakuraPOS",
  "$env:LOCALAPPDATA\sakura-pos",
  "$env:LOCALAPPDATA\SakuraPOS",
  "$env:LOCALAPPDATA\Programs\SakuraPOS"
)
foreach ($p in $appdataPaths) {
  if (Test-Path $p) {
    Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
    Write-Host "  Silindi: $p" -ForegroundColor Green
  }
}

# 5) Kisayollari sil
Write-Host '[5/7] Kisayollar siliniyor...' -ForegroundColor Yellow
$shortcuts = @(
  "$env:USERPROFILE\Desktop\Sakura POS.lnk",
  "$env:USERPROFILE\Desktop\SakuraPOS.lnk",
  "$env:PUBLIC\Desktop\Sakura POS.lnk",
  "$env:PUBLIC\Desktop\SakuraPOS.lnk",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Sakura POS.lnk",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\SakuraPOS.lnk",
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Sakura POS.lnk",
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\SakuraPOS.lnk"
)
foreach ($s in $shortcuts) {
  if (Test-Path $s) {
    Remove-Item -Force $s -ErrorAction SilentlyContinue
    Write-Host "  Silindi: $s" -ForegroundColor Green
  }
}

# 6) Kayit defteri (autostart + uninstall)
Write-Host '[6/7] Kayit defteri temizleniyor...' -ForegroundColor Yellow
$regPaths = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\SakuraPOS',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\Sakura POS',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run\SakuraPOS',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run\Sakura POS'
)
foreach ($r in $regPaths) {
  if (Test-Path $r) {
    Remove-Item $r -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    # Run anahtarinin ALTINDAKI value silmek icin parent + value name
  }
}
# Run anahtarinda value olarak SakuraPOS varsa sil
foreach ($base in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run') {
  try {
    $props = Get-ItemProperty -Path $base -ErrorAction SilentlyContinue
    if ($props) {
      foreach ($name in ($props.PSObject.Properties.Name | Where-Object { $_ -like '*Sakura*' })) {
        Remove-ItemProperty -Path $base -Name $name -ErrorAction SilentlyContinue
        Write-Host "  Run kaydi silindi: $base\$name" -ForegroundColor Green
      }
    }
  } catch {}
}

# Uninstall registry — productName=SakuraPOS olan tum girdileri bul
foreach ($base in 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall') {
  try {
    Get-ChildItem -Path $base -ErrorAction SilentlyContinue | ForEach-Object {
      $dn = (Get-ItemProperty -Path $_.PSPath -Name DisplayName -ErrorAction SilentlyContinue).DisplayName
      if ($dn -like '*Sakura*POS*' -or $dn -like '*SakuraPOS*') {
        Remove-Item -Path $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  Uninstall kaydi silindi: $dn" -ForegroundColor Green
      }
    }
  } catch {}
}

# 7) Firewall kurallarini sil
Write-Host '[7/7] Firewall kurallari siliniyor...' -ForegroundColor Yellow
$rulesToDelete = @('Sakura POS', 'Sakura POS Discovery', 'Sakura POS mDNS', 'SakuraPOS', 'Sakura')
foreach ($rule in $rulesToDelete) {
  $output = & netsh advfirewall firewall delete rule name="$rule" 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  Silindi: $rule" -ForegroundColor Green
  }
}

Write-Host ''
Write-Host '== Temizlik bitti ==' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Durum kontrolu:'
$leftover = @()
if (Test-Path 'C:\Program Files\SakuraPOS') { $leftover += 'C:\Program Files\SakuraPOS' }
if (Test-Path "$env:APPDATA\sakura-pos") { $leftover += "$env:APPDATA\sakura-pos" }
if ($leftover.Count -gt 0) {
  Write-Host '  KALAN:' -ForegroundColor Red
  $leftover | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
} else {
  Write-Host '  Tum kalintilar temizlendi.' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Korunan: C:\Users\yilma\Desktop\sakura\ (kaynak kod)' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Bu pencereyi kapatmak icin Enter tuslayin...'
Read-Host
