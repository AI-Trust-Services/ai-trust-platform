<#
.SYNOPSIS
  Install the AI Trust Platform (standalone) on ANY Kubernetes cluster, natively on Windows.
.DESCRIPTION
  1. Copy prerequisites\config.env.example to prerequisites\config.env and edit it.
  2. Point kubectl at your target cluster (KUBECONFIG / kubectl config use-context).
  3. pwsh .\scripts\powershell\deploy.ps1
.PARAMETER SkipBuild   Reuse already-pushed/loaded images (skip docker build).
.PARAMETER SkipIngress Skip the ingress wiring step.
#>
[CmdletBinding()]
param([switch]$SkipBuild, [switch]$SkipIngress)
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\lib.ps1"

Write-Host ""
Write-Host "######################################################################"
Write-Host "#  AI Trust Platform - standalone install (PowerShell)"
Write-Host "######################################################################"

$cfg = Import-Config

# --- prerequisites ---
$tools = @("kubectl","python3","docker")
if ($cfg.INGRESS_MODE -eq "kind") { $tools += "kind" }
Test-Tools $tools
$pyOut = & python3 -c "import yaml" 2>&1
if ($LASTEXITCODE -ne 0) { Die "python3 'yaml' module missing or python3 not on PATH ($pyOut). Run: pip install pyyaml" }
try { Invoke-Kubectl cluster-info *> $null; Write-Ok "cluster reachable" } catch { Die "kubectl cannot reach a cluster — set KUBECONFIG/KUBE_CONTEXT" }

$K = Join-Path $script:ConfigD "k8s-app"
$OUT = Join-Path $script:State "k8s-app"; New-Item -ItemType Directory -Force -Path $OUT | Out-Null

# --- 1. build/push (delegates to the bash script via any available bash, else does it inline) ---
if (-not $SkipBuild) {
  Write-Log "Building + publishing images…"
  Invoke-BuildImages $cfg
} else { Write-Log "SkipBuild — using already-published images." }

# --- 2. generate secrets ---
$secrets = @{
  POSTGRES_PASSWORD           = if ($cfg.POSTGRES_PASSWORD)           {$cfg.POSTGRES_PASSWORD}           else {New-HexSecret 16}
  KEYCLOAK_ADMIN_PASSWORD     = if ($cfg.KEYCLOAK_ADMIN_PASSWORD)     {$cfg.KEYCLOAK_ADMIN_PASSWORD}     else {New-HexSecret 16}
  APP_ADMIN_PASSWORD          = if ($cfg.APP_ADMIN_PASSWORD)          {$cfg.APP_ADMIN_PASSWORD}          else {New-HexSecret 12}
  MINIO_ROOT_PASSWORD         = if ($cfg.MINIO_ROOT_PASSWORD)         {$cfg.MINIO_ROOT_PASSWORD}         else {New-HexSecret 16}
  KEYCLOAK_CLIENT_SECRET      = if ($cfg.KEYCLOAK_CLIENT_SECRET)      {$cfg.KEYCLOAK_CLIENT_SECRET}      else {New-HexSecret 16}
  USERS_BACKEND_CLIENT_SECRET = if ($cfg.USERS_BACKEND_CLIENT_SECRET) {$cfg.USERS_BACKEND_CLIENT_SECRET} else {New-HexSecret 16}
  COOKIE_SECRET               = New-HexSecret 16
}
Set-Content -Path (Join-Path $script:State "admin-credentials.txt") -Value @("APP_ADMIN_USERNAME=admin","APP_ADMIN_PASSWORD=$($secrets.APP_ADMIN_PASSWORD)")

# vars available to templates
$tv = $cfg.Clone()
foreach ($k in $secrets.Keys) { $tv[$k] = $secrets[$k] }

# --- 3. namespace + config + secret ---
Write-Log "Namespace + config + secret…"
Invoke-Apply (Convert-Manifest (Join-Path $K "00-namespace.yaml") $cfg)
Invoke-Apply (Expand-Template  (Join-Path $K "02-secret-config.tmpl") $tv)
foreach ($f in @("01-cm-ch-config","01-cm-otelcol","01-cm-pg-init")) {
  Invoke-Apply (Convert-Manifest (Join-Path $K "$f.yaml") $cfg)
}

# --- 4. infra ---
Write-Log "Infra (Postgres, ClickHouse, MinIO, RabbitMQ, Keycloak)…"
$infra = Join-Path $OUT "10-infra.yaml"; Set-Content $infra (Convert-Manifest (Join-Path $K "10-infra.yaml") $cfg)
Set-PinAndStorage $infra $cfg
Invoke-Kubectl apply -f $infra | Out-Null
Invoke-Kubectl -n $cfg.APP_NS set env deploy/keycloak "KC_HOSTNAME=$($cfg.APP_URL)/keycloak" "KC_HOSTNAME_STRICT=false" "KC_HTTP_RELATIVE_PATH=/keycloak" *> $null
Invoke-Kubectl -n $cfg.APP_NS patch deploy keycloak --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/keycloak/realms/master"}]' *> $null

# --- 5. init Jobs (pin before apply — immutable) ---
Write-Log "Init Jobs…"
$jobs = Join-Path $OUT "20-jobs.yaml"; Set-Content $jobs (Convert-Manifest (Join-Path $K "20-jobs.yaml") $cfg)
Set-PinAndStorage $jobs $cfg
Invoke-Kubectl apply -f $jobs | Out-Null

# --- 6. app workloads ---
Write-Log "App backends + frontends + workers + shell + oauth2-proxy…"
foreach ($f in @("30-app","40-workers-shell-proxy")) {
  $p = Join-Path $OUT "$f.yaml"; Set-Content $p (Convert-Manifest (Join-Path $K "$f.yaml") $cfg); Set-PinAndStorage $p $cfg
  Invoke-Kubectl apply -f $p | Out-Null
}
$cookieSecure = if ($cfg.TLS_MODE -eq "none" -and $cfg.INGRESS_MODE -ne "gateway") { "false" } else { "true" }
$u = $cfg.APP_URL
# NB: the $(VAR) tokens are Kubernetes downward-env references resolved by kubelet, not shell/PowerShell.
# Use SINGLE quotes for those two so PowerShell passes them verbatim (no expansion, no escape char).
$proxyArgs = @("--provider=oidc","--client-id=oauth2-proxy",'--client-secret=$(KEYCLOAK_CLIENT_SECRET)',
  "--oidc-issuer-url=http://keycloak:8080/keycloak/realms/ai-trust",
  "--login-url=$u/keycloak/realms/ai-trust/protocol/openid-connect/auth",
  "--redeem-url=http://keycloak:8080/keycloak/realms/ai-trust/protocol/openid-connect/token",
  "--oidc-jwks-url=http://keycloak:8080/keycloak/realms/ai-trust/protocol/openid-connect/certs",
  "--skip-oidc-discovery=true","--insecure-oidc-skip-issuer-verification=true",
  "--redirect-url=$u/oauth2/callback","--upstream=http://shell:80","--http-address=0.0.0.0:4180",
  '--cookie-secret=$(OAUTH2_PROXY_COOKIE_SECRET)',"--cookie-secure=$cookieSecure","--email-domain=*",
  "--pass-authorization-header=true","--backend-logout-url=http://keycloak:8080/keycloak/realms/ai-trust/protocol/openid-connect/logout")
$patch = @{ op="replace"; path="/spec/template/spec/containers/0/args"; value=$proxyArgs } | ConvertTo-Json -Depth 5 -Compress
Invoke-Kubectl -n $cfg.APP_NS patch deploy oauth2-proxy --type=json -p "[$patch]" *> $null

Write-Log "Waiting for the app to settle (first boot ~5-8 min)…"
Invoke-Kubectl -n $cfg.APP_NS rollout status deploy/oauth2-proxy --timeout=600s
Invoke-Kubectl -n $cfg.APP_NS rollout status deploy/shell        --timeout=300s

# --- 7. ingress ---
if (-not $SkipIngress) { Invoke-Ingress $cfg $tv }

Write-Ok "DONE - AI Trust Platform at $($cfg.APP_URL)"
Write-Host "   Bootstrap admin password: $(Join-Path $script:State 'admin-credentials.txt')"
