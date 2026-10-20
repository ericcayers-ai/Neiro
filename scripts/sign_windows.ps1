<#
.SYNOPSIS
  Sign Neiro Windows artifacts with an Authenticode certificate.

.DESCRIPTION
  Dev/test use: point -PfxPath/-Password (or NEIRO_SIGN_PFX /
  NEIRO_SIGN_PASSWORD) at a code-signing certificate. A self-signed certificate
  produces a valid signature but an untrusted chain; that is expected and
  `signtool verify /pa` will fail with "not trusted". Release builds need a
  publicly trusted OV/EV code-signing certificate.

  The certificate and password are never written into the repo.

.EXAMPLE
  $env:NEIRO_SIGN_PFX = "$env:TEMP\neiro-dev.pfx"
  $env:NEIRO_SIGN_PASSWORD = "..."
  ./scripts/sign_windows.ps1 -Files src-tauri/target/release/bundle/msi/*.msi
#>
param(
  [Parameter(Mandatory = $true)][string[]]$Files,
  [string]$PfxPath = $env:NEIRO_SIGN_PFX,
  [string]$Password = $env:NEIRO_SIGN_PASSWORD,
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'

if (-not $PfxPath -or -not (Test-Path -LiteralPath $PfxPath)) {
  throw "PFX not found. Set NEIRO_SIGN_PFX or pass -PfxPath (never commit it)."
}
if (-not $Password) {
  throw "Password missing. Set NEIRO_SIGN_PASSWORD or pass -Password."
}

$signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $signtool) {
  $kits = 'C:\Program Files (x86)\Windows Kits\10\bin'
  $signtool = Get-ChildItem $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $signtool) { throw 'signtool.exe not found (install Windows SDK).' }

Write-Host "signtool: $signtool"

foreach ($file in $Files) {
  $resolved = (Resolve-Path -LiteralPath $file).Path
  Write-Host "signing: $resolved"

  & $signtool sign /f $PfxPath /p $Password /fd SHA256 /tr $TimestampUrl /td SHA256 $resolved
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "timestamped signing failed; retrying without a timestamp"
    & $signtool sign /f $PfxPath /p $Password /fd SHA256 $resolved
  }
  if ($LASTEXITCODE -ne 0) { throw "signing failed for $resolved" }

  $sig = Get-AuthenticodeSignature -LiteralPath $resolved
  Write-Host ("  status: {0}; signer: {1}" -f $sig.Status, $sig.SignerCertificate.Subject)
}
