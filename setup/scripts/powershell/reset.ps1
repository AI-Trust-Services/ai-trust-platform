<#
.SYNOPSIS  Remove the AI Trust Platform app + its ingress (native Windows wrapper).
.DESCRIPTION Delegates to scripts\reset.sh via any available bash (Git Bash / WSL).
#>
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\lib.ps1"
$cfg = Import-Config
Sync-BashEnv $cfg
$sh = Find-Bash
$script = Join-Path (Split-Path $PSScriptRoot -Parent) "reset.sh"
if (-not $sh) { Die "reset needs a POSIX shell (Git Bash or WSL) for scripts/reset.sh." }
if ($sh -eq "wsl") { & wsl bash (ConvertTo-WslPath $script) } else { & $sh $script }
