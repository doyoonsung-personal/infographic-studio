# Sets Infographic Studio's secrets on the Cloudflare Pages project.
# Run it yourself:  powershell -ExecutionPolicy Bypass -File scripts\set-secrets.ps1
#
# - APP_PASSWORD comes from .dev.vars (change it there first if you want a different one).
# - DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL come from your Windows environment.
# - ELEVENLABS_API_KEY, ROUTINE_FIRE_URL, ROUTINE_TOKEN are asked for; press Enter to skip any.
# Values are never printed. Secrets take effect on the next deployment.

$ErrorActionPreference = 'Stop'
$acct = '89affce72d1ca381411a3c78c02aa7b0'
$project = 'infographic-studio'

function From-Env($name) {
  foreach ($scope in 'Process', 'User', 'Machine') {
    $v = [Environment]::GetEnvironmentVariable($name, $scope)
    if ($v) { return $v }
  }
  return $null
}

function Ask-Secret($label) {
  $s = Read-Host "$label (Enter to skip)" -AsSecureString
  $v = [Net.NetworkCredential]::new('', $s).Password
  if ($v) { return $v.Trim() } else { return $null }
}

$email = From-Env 'CLOUDFLARE_EMAIL'
$key = From-Env 'CLOUDFLARE_API_KEY'
if (-not $email -or -not $key) { throw 'CLOUDFLARE_EMAIL / CLOUDFLARE_API_KEY are not set.' }

$devVars = Join-Path $PSScriptRoot '..\.dev.vars'
$password = ((Get-Content $devVars) | Where-Object { $_ -like 'APP_PASSWORD=*' }) -replace '^APP_PASSWORD=', ''

$eleven = Ask-Secret 'ElevenLabs API key (starts with sk_)'
while ($eleven -and -not $eleven.StartsWith('sk_')) {
  Write-Host "That is not an ElevenLabs API key (it should start with 'sk_'; the shorter ID shown in the key list will not work)." -ForegroundColor Yellow
  $eleven = Ask-Secret 'ElevenLabs API key (starts with sk_)'
}
if ($eleven) { Write-Host "ElevenLabs key accepted ($($eleven.Length) characters, starts with sk_)." -ForegroundColor Green }

$values = [ordered]@{
  APP_PASSWORD       = $password
  DASHSCOPE_API_KEY  = From-Env 'DASHSCOPE_API_KEY'
  DASHSCOPE_BASE_URL = From-Env 'DASHSCOPE_BASE_URL'
  ELEVENLABS_API_KEY = $eleven
  ROUTINE_FIRE_URL   = Ask-Secret 'Routine API trigger URL'
  ROUTINE_TOKEN      = Ask-Secret 'Routine API token'
}

$vars = @{}
foreach ($k in $values.Keys) {
  if ($values[$k]) { $vars[$k] = @{ type = 'secret_text'; value = $values[$k] } }
}

$headers = @{ 'X-Auth-Email' = $email; 'X-Auth-Key' = $key; 'Content-Type' = 'application/json' }
$body = @{ deployment_configs = @{ production = @{ env_vars = $vars }; preview = @{ env_vars = $vars } } } | ConvertTo-Json -Depth 6
$r = Invoke-RestMethod "https://api.cloudflare.com/client/v4/accounts/$acct/pages/projects/$project" -Method Patch -Headers $headers -Body $body

$names = $r.result.deployment_configs.production.env_vars.PSObject.Properties.Name -join ', '
Write-Host "Saved. Variables now on the project: $names"
Write-Host 'They take effect on the next deployment.'
