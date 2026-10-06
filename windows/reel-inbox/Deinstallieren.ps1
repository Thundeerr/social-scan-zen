$ErrorActionPreference = 'Stop'
$state = Join-Path $env:LOCALAPPDATA 'InstaScanner\ReelInbox'
& (Join-Path $PSScriptRoot 'Stoppen.ps1')
$task = Get-ScheduledTask -TaskName 'InstaScanner Reel Inbox' -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask -InputObject $task; Unregister-ScheduledTask -InputObject $task -Confirm:$false }
# Remove only named local credentials. Keep binaries/logs for inspection and all media.
foreach ($name in @('token.dpapi','config.json')) {
  $path = Join-Path $state $name
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
}
Write-Host 'Autostart und lokale Kopplung entfernt. Medien, Prüfbelege und Programmdateien bleiben erhalten. Im Handy zusätzlich PC-Zugriff widerrufen.'
