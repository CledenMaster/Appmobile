# Tunnels adb reverse pour TOUS les appareils connectes (emulateur + telephone reel).
#
# Avec ces tunnels, un seul hote "localhost" fonctionne partout, sans dependre du
# reseau ni du pare-feu Windows :
#   - API app    : localhost:4000  (adb reverse tcp:4000 tcp:4000)
#   - MinIO      : localhost:9000  (adb reverse tcp:9000 tcp:9000)
#   - Metro      : localhost:8081  (adb reverse tcp:8081 tcp:8081)
#
# A lancer AVANT la demo, pour chaque appareil branche (USB debugging autorise).
# Le reverse est perdu si adb redemarre : relancer ce script dans ce cas.

$ErrorActionPreference = 'SilentlyContinue'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { $adb = "adb" }

$devices = & $adb devices |
  Where-Object { $_ -match "`tdevice$" } |
  ForEach-Object { ($_ -split "`t")[0] }

if (-not $devices) {
  Write-Output "Aucun appareil connecte (verifier USB debugging / emulateur)."
  exit 1
}

foreach ($d in $devices) {
  $ports = 4000, 9000, 8081
  $ok = $true
  foreach ($port in $ports) {
    $out = & $adb -s $d reverse tcp:$port tcp:$port 2>&1
    if ($LASTEXITCODE -ne 0) { $ok = $false }
  }
  # Verification
  $listed = (& $adb -s $d reverse --list) -join '; '
  $status = if ($ok) { "OK" } else { "ERREUR" }
  Write-Output "$d : tunnels 4000/9000/8081 -> $status"
  Write-Output "   actifs: $listed"
}
