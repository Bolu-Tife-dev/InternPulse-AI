# Verifies the Authenticode signature of a built Windows installer.
# Usage: pwsh scripts/verify-signature.ps1 -Path "release\*.exe"
param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

$exe = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
if (-not $exe) { $exe = Get-ChildItem -Path $Path | Select-Object -First 1 }
if (-not $exe) { Write-Error "No file matched: $Path"; exit 1 }

$sig = Get-AuthenticodeSignature $exe.FullName
Write-Output "File:      $($exe.FullName)"
Write-Output "Status:    $($sig.Status)"
if ($sig.SignerCertificate) {
    Write-Output "Signer:    $($sig.SignerCertificate.Subject)"
    Write-Output "Expires:   $($sig.SignerCertificate.NotAfter.ToString('u'))"
    Write-Output "Timestamp: $($sig.TimeStamperCertificate.Subject)"
}

if ($sig.Status -eq "Valid") { exit 0 }
Write-Output "NOT SIGNED OR INVALID — see docs/CODE_SIGNING.md"
exit 2
