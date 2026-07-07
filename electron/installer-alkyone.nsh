; Alkyone POS — NSIS installer ek script (port 3100).
!macro customInstall
  DetailPrint "Windows Firewall kurali ekleniyor (Alkyone POS, TCP 3100)..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS" dir=in action=allow protocol=TCP localport=3100 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS" dir=out action=allow protocol=TCP localport=3100 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS mDNS" dir=in action=allow protocol=UDP localport=5353 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS Discovery"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS Discovery" dir=out action=allow protocol=UDP remoteport=5354 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Alkyone POS Discovery" dir=in action=allow protocol=UDP localport=5354 profile=any'
!macroend

!macro customUnInstall
  DetailPrint "Windows Firewall kurali siliniyor..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Alkyone POS Discovery"'
!macroend
