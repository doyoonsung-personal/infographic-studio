# Local dev server: Cloudflare's Pages emulator with local KV, on http://localhost:8788
# Secrets come from .dev.vars (APP_PASSWORD, DEV_MODE) plus your Windows environment
# (DASHSCOPE_*, ELEVENLABS_API_KEY) passed as bindings so they never get written to disk.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$node = Get-ChildItem (Join-Path $root '.tools') -Directory -Filter 'node-*' | Select-Object -First 1
if ($node) { $env:Path = "$($node.FullName);$env:Path" }

function From-Env($name) {
  foreach ($scope in 'Process', 'User', 'Machine') {
    $v = [Environment]::GetEnvironmentVariable($name, $scope)
    if ($v) { return $v }
  }
  return $null
}

$bindings = @()
foreach ($n in 'DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL', 'ELEVENLABS_API_KEY') {
  $v = From-Env $n
  if ($v) { $bindings += '--binding'; $bindings += "$n=$v" }
}
& npx wrangler pages dev --port 8788 --persist-to .wrangler/state @bindings
