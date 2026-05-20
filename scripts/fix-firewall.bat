@echo off
REM ============================================================
REM  Sakura POS - Firewall Kural Onarici
REM ------------------------------------------------------------
REM  Restoran/POS makinesinde Wi-Fi "Public" siniflandiginda
REM  eski "Domain,Private" kurallari uygulanmaz; tabletler ne
REM  IP'yi bulur ne TCP 3000'e baglanir. Bu script kurallari
REM  silip "profile=any" olarak yeniden kurar (tum profiller).
REM
REM  Calistirma: bu dosyaya cift tikla.
REM  UAC bir kez sorar (yetki gerekir).
REM ============================================================
chcp 65001 >nul

REM --- Self-elevate (yetki yoksa UAC ile yeniden cagir) ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Yonetici yetkisi gerekiyor. UAC penceresi acilacak...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

title Sakura POS - Firewall Onarici
color 0B
echo.
echo ============================================================
echo   SAKURA POS - FIREWALL KURAL ONARICI
echo ============================================================
echo.
echo Mevcut Wi-Fi/Ethernet profilleri:
powershell -NoProfile -Command "Get-NetConnectionProfile | Select-Object Name, NetworkCategory, InterfaceAlias | Format-Table -AutoSize"
echo.
echo ------------------------------------------------------------
echo  1) Eski Sakura POS kurallari siliniyor...
echo ------------------------------------------------------------
netsh advfirewall firewall delete rule name="Sakura POS" >nul 2>&1
netsh advfirewall firewall delete rule name="Sakura POS mDNS" >nul 2>&1
netsh advfirewall firewall delete rule name="Sakura POS Discovery" >nul 2>&1
echo    Temizlik tamam.
echo.

echo ------------------------------------------------------------
echo  2) Yeni kurallar ekleniyor (profile=ANY - tum aglar)
echo ------------------------------------------------------------
set ERRORS=0

netsh advfirewall firewall add rule name="Sakura POS" dir=in action=allow protocol=TCP localport=3000 profile=any
if %errorlevel% neq 0 set /a ERRORS+=1

netsh advfirewall firewall add rule name="Sakura POS" dir=out action=allow protocol=TCP localport=3000 profile=any
if %errorlevel% neq 0 set /a ERRORS+=1

netsh advfirewall firewall add rule name="Sakura POS mDNS" dir=in action=allow protocol=UDP localport=5353 profile=any
if %errorlevel% neq 0 set /a ERRORS+=1

netsh advfirewall firewall add rule name="Sakura POS Discovery" dir=in action=allow protocol=UDP localport=5354 profile=any
if %errorlevel% neq 0 set /a ERRORS+=1

netsh advfirewall firewall add rule name="Sakura POS Discovery" dir=out action=allow protocol=UDP remoteport=5354 profile=any
if %errorlevel% neq 0 set /a ERRORS+=1

echo.
echo ------------------------------------------------------------
echo  3) Dogrulama (kurallar profile=Any mi?)
echo ------------------------------------------------------------
powershell -NoProfile -Command "Get-NetFirewallRule -DisplayName 'Sakura POS*' -ErrorAction SilentlyContinue | Select-Object DisplayName, Direction, Profile, Enabled | Format-Table -AutoSize"

echo.
echo ------------------------------------------------------------
echo  4) Aktif aglar Public mu?  (Public ise kurallarimiz yine
echo     calisir cunku profile=any, fakat Private tavsiye edilir)
echo ------------------------------------------------------------
powershell -NoProfile -Command "Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Public' | Select-Object Name, InterfaceAlias | Format-Table -AutoSize"

echo.
set /p MAKEPRIVATE="Aktif aglari Private yapayim mi? (E/H): "
if /i "%MAKEPRIVATE%"=="E" (
    powershell -NoProfile -Command "Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Public' | ForEach-Object { Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private; Write-Host ('  -> ' + $_.Name + ' Private yapildi') }"
)

echo.
echo ============================================================
if %ERRORS% equ 0 (
    color 0A
    echo   TAMAM - Tum kurallar profile=ANY olarak kuruldu.
    echo   Tabletlerden tekrar baglanti deneyebilirsiniz.
) else (
    color 0C
    echo   UYARI - %ERRORS% komutta hata olustu.
    echo   Yukaridaki ciktiyi okuyun veya destege fotograf gonderin.
)
echo ============================================================
echo.
pause
