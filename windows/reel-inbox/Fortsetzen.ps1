$state = Join-Path $env:LOCALAPPDATA 'InstaScanner\ReelInbox'
$stopFile = Join-Path $state 'STOP'
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',('"' + (Join-Path $state 'Starten.ps1') + '"'))
Write-Host 'Helfer gestartet. Status: ' (Join-Path $state 'status.json')
