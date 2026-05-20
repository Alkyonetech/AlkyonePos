; Sakura POS — NSIS installer ek script
; electron-builder package.json'da "nsis.include": "electron/installer.nsh" ile baglanir.
;
; Yaptigi: kurulumda Windows Firewall'a port 3000 (TCP, in/out) ve uygulama
; izni ekler; kaldirmada bu kurallari siler. UAC zaten installer'da elevated.

!macro customInstall
  DetailPrint "Windows Firewall kurali ekleniyor (Sakura POS, TCP 3000)..."
  ; Sessiz: tek satir; varsa ust uste yazar (netsh ayni isimle silip ekler)
  ; profile=any: restoran/ev Wi-Fi'si Windows tarafindan cogu zaman "Genel/Public"
  ; siniflanir; private,domain ile sinirli kural Public agda uygulanmaz ve
  ; tablet IP'yi bulsa bile TCP 3000'e baglanamaz. any tum profilleri kapsar.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sakura POS" dir=in action=allow protocol=TCP localport=3000 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sakura POS" dir=out action=allow protocol=TCP localport=3000 profile=any'
  ; mDNS (UDP 5353) — sakura.local yayini icin
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sakura POS mDNS" dir=in action=allow protocol=UDP localport=5353 profile=any'
  ; UDP discovery broadcast (5354) — sunucu kendini yayinlar, istemci dinler
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS Discovery"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sakura POS Discovery" dir=out action=allow protocol=UDP remoteport=5354 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sakura POS Discovery" dir=in action=allow protocol=UDP localport=5354 profile=any'
!macroend

!macro customUnInstall
  DetailPrint "Windows Firewall kurali siliniyor..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS Discovery"'
!macroend
