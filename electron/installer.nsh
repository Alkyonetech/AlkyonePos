; Alkyone POS — NSIS installer ek script
; electron-builder package.json'da "nsis.include": "electron/installer.nsh" ile baglanir.
;
; Yaptigi: kurulumda Windows Firewall'a port 3000 (TCP, in/out) ve uygulama
; izni ekler; kaldirmada bu kurallari siler. UAC zaten installer'da elevated.
; v1.8.0: rebrand — eski "Sakura POS" kurallari da temizlenir.

!macro customInstall
  DetailPrint "Windows Firewall kurali ekleniyor (Alkyone POS, TCP 3000)..."
  ; Eski Sakura POS kurallarini temizle (v1.7.x'ten yukseltme)
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS Discovery"'
  ; Yeni Alkyone POS kurallari
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS" dir=in action=allow protocol=TCP localport=3000 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS" dir=out action=allow protocol=TCP localport=3000 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS mDNS" dir=in action=allow protocol=UDP localport=5353 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS Discovery"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS Discovery" dir=out action=allow protocol=UDP remoteport=5354 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS Discovery" dir=in action=allow protocol=UDP localport=5354 profile=any'
!macroend

!macro customUnInstall
  DetailPrint "Windows Firewall kurali siliniyor..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sakura POS Discovery"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS Discovery"'
!macroend
