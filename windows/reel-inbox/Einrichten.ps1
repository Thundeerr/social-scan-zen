param(
  [Parameter(Mandatory=$true)][string]$Python,
  [Parameter(Mandatory=$true)][string]$Ffmpeg,
  [Parameter(Mandatory=$true)][string]$Ffprobe,
  [Security.SecureString]$Token,
  [switch]$Autostart
)
$ErrorActionPreference = 'Stop'
$state = Join-Path $env:USERPROFILE '.local\share\InstaScanner\ReelInbox'
foreach ($tool in @($Python,$Ffmpeg,$Ffprobe)) { if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw 'Werkzeugpfad nicht gefunden.' } }
if (Test-Path -LiteralPath (Join-Path $state 'config.json')) { throw 'Bereits eingerichtet. Zuerst Deinstallieren.ps1 ausführen; Medien bleiben erhalten.' }
New-Item -ItemType Directory -Path $state -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $state /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Zugriffsschutz konnte nicht gesetzt werden.' }
& $Python -m venv (Join-Path $state 'venv')
if ($LASTEXITCODE -ne 0) { throw 'Python-Einrichtung fehlgeschlagen.' }
$runtime = Join-Path $state 'venv\Scripts\python.exe'
& $runtime -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Downloadwerkzeug konnte nicht installiert werden.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'helper.py') -Destination (Join-Path $state 'helper.py')
Copy-Item -LiteralPath $Ffmpeg -Destination (Join-Path $state 'ffmpeg.exe')
Copy-Item -LiteralPath $Ffprobe -Destination (Join-Path $state 'ffprobe.exe')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Starten.ps1') -Destination (Join-Path $state 'Starten.ps1')
foreach ($name in @('Stoppen.ps1','Fortsetzen.ps1','Deinstallieren.ps1','README.md')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $state $name)
}
foreach ($name in @('Stoppen','Fortsetzen','Deinstallieren')) {
  ('@echo off' + "`r`n" + 'powershell.exe -NoProfile -File "%~dp0' + $name + '.ps1"' + "`r`npause`r`n") | Set-Content -LiteralPath (Join-Path $state ($name + '.cmd')) -Encoding ascii
}
$secret = if ($Token) { $Token } else { Read-Host 'PC-Schlüssel aus Reel Inbox eingeben (verdeckt)' -AsSecureString }
# DPAPI: decryptable only by this Windows user on this PC.
$secret | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $state 'token.dpapi')
@{ instance = [guid]::NewGuid().ToString(); python=$runtime; ffmpeg=(Join-Path $state 'ffmpeg.exe'); ffprobe=(Join-Path $state 'ffprobe.exe') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'config.json') -Encoding utf8
if ($Autostart) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "' + (Join-Path $state 'Starten.ps1') + '"')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName 'InstaScanner Reel Inbox' -Description 'Holt ausschließlich Reel-Inbox-Aufträge ausgehend ab. Stoppen.ps1 stoppt; Deinstallieren.ps1 entfernt die Kopplung. Keine Veröffentlichungen.' -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
}
Write-Host 'Eingerichtet. Starten.ps1 startet den Helfer; Stoppen.ps1 stoppt ihn. Autostart:' $Autostart
