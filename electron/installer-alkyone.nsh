; Alkyone POS — NSIS installer ek script (port 3100).
;
; Iki is yapar:
;  1) Marka gecisi: eski "SakuraPOS" kurulumunu (farkli appId oldugu icin yan yana
;     kalir) sessizce kaldirir + eski otomatik-baslatma kaydini ve kisayollari siler.
;     Kullanici verisi (%APPDATA%\SakuraPOS\data) SILINMEZ — uygulama ilk acilista
;     bu veriyi Alkyone dizinine tasir (bkz. electron/main.js -> migrateFromLegacy).
;  2) Windows Firewall kurallarini ekler (TCP 3100 + kesif + 9100 online yakalama).

; Belirli bir registry kokunde/gorunumunde eski Sakura kaldiricisini bul ve calistir.
!macro RemoveLegacySakuraRoot ROOT VIEW
  SetRegView ${VIEW}
  StrCpy $R0 0
  legacyLoop_${ROOT}_${VIEW}:
    EnumRegKey $R1 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R0
    StrCmp $R1 "" legacyDone_${ROOT}_${VIEW}
    IntOp $R0 $R0 + 1
    ReadRegStr $R2 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R1" "DisplayName"
    StrCmp $R2 "SakuraPOS" legacyMatch_${ROOT}_${VIEW}
    StrCmp $R2 "Sakura POS" legacyMatch_${ROOT}_${VIEW}
    Goto legacyLoop_${ROOT}_${VIEW}
  legacyMatch_${ROOT}_${VIEW}:
    ReadRegStr $R3 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R1" "QuietUninstallString"
    StrCmp $R3 "" legacyTryPlain_${ROOT}_${VIEW}
    DetailPrint "Eski kurulum kaldiriliyor: $R2"
    ExecWait '$R3'
    Goto legacyLoop_${ROOT}_${VIEW}
  legacyTryPlain_${ROOT}_${VIEW}:
    ReadRegStr $R3 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R1" "UninstallString"
    StrCmp $R3 "" legacyLoop_${ROOT}_${VIEW}
    DetailPrint "Eski kurulum kaldiriliyor: $R2"
    ExecWait '$R3 /S'
    Goto legacyLoop_${ROOT}_${VIEW}
  legacyDone_${ROOT}_${VIEW}:
!macroend

!macro customInstall
  ; ---- 1) Eski Sakura kurulumunu temizle (veri korunur) ----
  DetailPrint "Eski Sakura POS kurulumu temizleniyor (varsa)..."
  !insertmacro RemoveLegacySakuraRoot HKLM 64
  !insertmacro RemoveLegacySakuraRoot HKLM 32
  !insertmacro RemoveLegacySakuraRoot HKCU 64

  ; Eski otomatik-baslatma kayitlari
  SetRegView 64
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SakuraPOS"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Sakura POS"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "SakuraPOS"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Sakura POS"

  ; Eski kisayollar
  Delete "$DESKTOP\Sakura POS.lnk"
  Delete "$DESKTOP\SakuraPOS.lnk"
  Delete "$SMPROGRAMS\Sakura POS.lnk"
  Delete "$SMPROGRAMS\SakuraPOS.lnk"
  Delete "$SMSTARTUP\Sakura POS.lnk"
  Delete "$SMSTARTUP\SakuraPOS.lnk"

  ; ---- 2) Windows Firewall (Alkyone POS) ----
  DetailPrint "Windows Firewall kurali ekleniyor (Alkyone POS, TCP 3100)..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS" dir=in action=allow protocol=TCP localport=3100 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS" dir=out action=allow protocol=TCP localport=3100 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS mDNS" dir=in action=allow protocol=UDP localport=5353 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS Discovery"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS Discovery" dir=out action=allow protocol=UDP remoteport=5354 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS Discovery" dir=in action=allow protocol=UDP localport=5354 profile=any'
  ; Online siparis yakalama (TCP 9100 RAW baski) — platform cihazi bu porta baglanir
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS Online Capture"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS Online Capture" dir=in action=allow protocol=TCP localport=9100 profile=any'
!macroend

!macro customUnInstall
  DetailPrint "Windows Firewall kurali siliniyor..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS Discovery"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS Online Capture"'
!macroend
