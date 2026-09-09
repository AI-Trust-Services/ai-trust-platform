<#
.SYNOPSIS
  Shared helpers for the AI Trust Platform PowerShell deploy (native Windows / PowerShell 7+).
  Dot-source this from deploy.ps1 / reset.ps1 / update.ps1:  . "$PSScriptRoot\lib.ps1"
  Cross-platform: works on Windows PowerShell 5.1+ and PowerShell 7 (Linux/macOS) too.
#>

$script:LibDir  = $PSScriptRoot
$script:Bundle  = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$script:Prereq  = Join-Path $script:Bundle "prerequisites"
$script:ConfigD = Join-Path $script:Bundle "config"
$script:State   = Join-Path $script:Bundle ".state"
New-Item -ItemType Directory -Force -Path $script:State | Out-Null

function Write-Log  { param($m) Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "[ok] $m"   -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "[warn] $m" -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "[error] $m" -ForegroundColor Red }
function Die        { param($m) Write-Err $m; exit 1 }

# Parse prerequisites/config.env into a hashtable and set defaults.
function Import-Config {
  $cfgPath = Join-Path $script:Prereq "config.env"
  if (-not (Test-Path $cfgPath)) { Die "Missing $cfgPath — copy config.env.example to it and fill it in." }
  $cfg = @{}
  foreach ($line in Get-Content $cfgPath) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    if ($t -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $k = $Matches[1]; $v = $Matches[2].Trim()
      # strip surrounding quotes and any trailing inline comment on quoted values
      if ($v -match '^"(.*)"') { $v = $Matches[1] }
      elseif ($v -match "^'(.*)'") { $v = $Matches[1] }
      else { $v = ($v -split '\s+#')[0].Trim() }
      $cfg[$k] = $v
    }
  }
  # defaults
  $defaults = @{
    TENANCY_MODE="single"; APP_NS="ai-trust-app"; TAG="v1"; INGRESS_MODE="ingress";
    TLS_MODE="provided"; IMAGE_PULL_POLICY="IfNotPresent";
    APP_GIT_URL="https://github.com/AI-Trust-Services/ai-trust-platform.git"; APP_GIT_REF="main";
    GATEWAY_LISTENER="terminate-aitrust"; GATEWAY_PORT="8443"; NODE_TAINT="false"
  }
  foreach ($k in $defaults.Keys) { if (-not $cfg.ContainsKey($k) -or $cfg[$k] -eq "") { $cfg[$k] = $defaults[$k] } }

  if (-not $cfg.APP_DOMAIN -or $cfg.APP_DOMAIN -like "*<your*") { Die "Set APP_DOMAIN in config.env." }
  if (-not $cfg.APP_URL    -or $cfg.APP_URL    -like "*<your*") { Die "Set APP_URL in config.env." }
  if ($cfg.INGRESS_MODE -ne "kind" -and (-not $cfg.REGISTRY -or $cfg.REGISTRY -eq "<your-registry>")) {
    Die "Set REGISTRY in config.env (or use INGRESS_MODE=kind)."
  }
  return $cfg
}

# kubectl wrapper honouring an optional KUBE_CONTEXT.
function Invoke-Kubectl {
  param([Parameter(ValueFromRemainingArguments)] $Args)
  if ($env:KUBE_CONTEXT) { & kubectl --context $env:KUBE_CONTEXT @Args }
  else { & kubectl @Args }
}

function Test-Tools {
  param([string[]] $Tools)
  $missing = @()
  foreach ($t in $Tools) { if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { $missing += $t } }
  if ($missing.Count) { Die ("missing tool(s): " + ($missing -join ", ")) }
}

function New-HexSecret { param([int]$Bytes=16)
  $b = New-Object 'System.Byte[]' $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  ($b | ForEach-Object { $_.ToString("x2") }) -join ""
}

# Replace __TOKEN__ placeholders in a template file; returns the rendered text.
function Expand-Template {
  param([string]$Path, [hashtable]$Vars)
  $text = Get-Content -Raw $Path
  foreach ($k in $Vars.Keys) { $text = $text.Replace("__${k}__", [string]$Vars[$k]) }
  return $text
}

# Rewrite k8s-app manifest image refs / namespace / pull policy for the target.
function Convert-Manifest {
  param([string]$Path, [hashtable]$Cfg)
  $text = Get-Content -Raw $Path
  if ($Cfg.INGRESS_MODE -eq "kind") {
    $text = [regex]::Replace($text, 'image: aitrust/([a-z0-9-]+):kind', "image: aitrust/`$1:$($Cfg.TAG)")
    $text = $text.Replace("imagePullPolicy: IfNotPresent", "imagePullPolicy: Never")
  } else {
    $text = [regex]::Replace($text, 'image: aitrust/([a-z0-9-]+):kind', "image: $($Cfg.REGISTRY)/aitrust-`$1:$($Cfg.TAG)")
    $text = $text.Replace("imagePullPolicy: IfNotPresent", "imagePullPolicy: $($Cfg.IMAGE_PULL_POLICY)")
  }
  $text = $text.Replace("namespace: ai-trust-app", "namespace: $($Cfg.APP_NS)")
  return $text
}

# Apply a manifest string to the cluster.
function Invoke-Apply {
  param([string]$Yaml)
  $tmp = Join-Path $script:State ("apply-" + [guid]::NewGuid().ToString("N") + ".yaml")
  Set-Content -Path $tmp -Value $Yaml -Encoding UTF8
  Invoke-Kubectl apply -f $tmp | Out-Null
  Remove-Item $tmp -ErrorAction SilentlyContinue
}

# Inject nodeSelector/toleration/storageClass into a multi-doc YAML file in place.
function Set-PinAndStorage {
  param([string]$File, [hashtable]$Cfg)
  $py = Join-Path (Split-Path $script:LibDir -Parent) "pin_and_storage.py"
  & python3 $py $File ($Cfg.NODE_LABEL_KEY) ($Cfg.NODE_LABEL_VALUE) ($Cfg.NODE_TAINT) ($Cfg.STORAGE_CLASS)
}

# Locate a POSIX bash (Git Bash or WSL) for the few steps that are far simpler in bash
# (many-arg `docker build`, gateway JSON surgery). Returns $null if none is available.
function Find-Bash {
  foreach ($c in @("bash")) { $p = Get-Command $c -ErrorAction SilentlyContinue; if ($p) { return $p.Source } }
  foreach ($p in @("$env:ProgramFiles\Git\bin\bash.exe","$env:ProgramFiles\Git\usr\bin\bash.exe")) {
    if (Test-Path $p) { return $p }
  }
  if (Get-Command wsl -ErrorAction SilentlyContinue) { return "wsl" }
  return $null
}

# Ensure KUBE_CONTEXT (if configured) crosses into the bash subshell. Git Bash inherits
# the process environment directly; WSL needs the name added to WSLENV to forward it.
function Sync-BashEnv {
  param([hashtable]$Cfg)
  if ($Cfg.KUBE_CONTEXT) {
    $env:KUBE_CONTEXT = $Cfg.KUBE_CONTEXT
    if (-not ($env:WSLENV -split ':' | Where-Object { $_ -eq 'KUBE_CONTEXT' })) {
      $env:WSLENV = (@($env:WSLENV, 'KUBE_CONTEXT') | Where-Object { $_ }) -join ':'
    }
  }
}

# Build + push/load images. Delegates to scripts/2-build-images.sh (single source of
# truth for the docker build-args); falls back with a clear message if no bash is found.
function Invoke-BuildImages {
  param([hashtable]$Cfg)
  Sync-BashEnv $Cfg
  $sh = Find-Bash
  $script = Join-Path (Split-Path $script:LibDir -Parent) "2-build-images.sh"
  if (-not $sh) {
    Die "Building images needs a POSIX shell (Git Bash or WSL) for scripts/2-build-images.sh. Install Git for Windows or WSL, OR pre-build/push images elsewhere and re-run with -SkipBuild."
  }
  if ($sh -eq "wsl") { & wsl bash (ConvertTo-WslPath $script) }
  else { & $sh $script }
  if ($LASTEXITCODE -ne 0) { Die "image build/publish failed (exit $LASTEXITCODE)" }
}

# Wire ingress. Delegates to scripts/4-ingress.sh (handles all INGRESS_MODE branches).
function Invoke-Ingress {
  param([hashtable]$Cfg, [hashtable]$Tv)
  Sync-BashEnv $Cfg
  $sh = Find-Bash
  $script = Join-Path (Split-Path $script:LibDir -Parent) "4-ingress.sh"
  if (-not $sh) { Write-Warn "No bash found — skipping ingress. Wire your own to Service oauth2-proxy:8080 in $($Cfg.APP_NS)."; return }
  if ($sh -eq "wsl") { & wsl bash (ConvertTo-WslPath $script) }
  else { & $sh $script }
}

function ConvertTo-WslPath { param([string]$P)
  $full = (Resolve-Path $P).Path
  if ($full -match '^([A-Za-z]):\\(.*)$') { return "/mnt/" + $Matches[1].ToLower() + "/" + ($Matches[2] -replace '\\','/') }
  return $full
}
