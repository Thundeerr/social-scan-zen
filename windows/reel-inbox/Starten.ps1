$ErrorActionPreference = 'Stop'
$state = Join-Path $env:LOCALAPPDATA 'InstaScanner\ReelInbox'
$config = Get-Content -LiteralPath (Join-Path $state 'config.json') -Raw | ConvertFrom-Json
$stopFile = Join-Path $state 'STOP'
if (Test-Path -LiteralPath $stopFile) { Write-Host 'Helfer gestoppt. Fortsetzen.ps1 verwenden.'; exit }
$secret = Get-Content -LiteralPath (Join-Path $state 'token.dpapi') -Raw | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:REEL_INBOX_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:REEL_INBOX_STOP = $stopFile
  & $config.python (Join-Path $state 'helper.py')
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Item Env:\REEL_INBOX_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:\REEL_INBOX_STOP -ErrorAction SilentlyContinue
}
