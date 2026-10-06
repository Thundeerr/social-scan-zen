$state = Join-Path $env:LOCALAPPDATA 'InstaScanner\ReelInbox'
if (Test-Path -LiteralPath $state) { New-Item -ItemType File -Path (Join-Path $state 'STOP') -Force | Out-Null }
Write-Host 'Stopp angefordert. Laufender Download endet spätestens nach seinem Zeitlimit. Vor Dateiablage wird der Stopp geprüft. Autostart bleibt bis Fortsetzen.ps1 gesperrt.'
