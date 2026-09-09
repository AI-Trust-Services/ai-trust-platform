<#
.SYNOPSIS  Day-2 update: build latest APP_GIT_REF, roll the app, re-run migrations (native Windows wrapper).
.DESCRIPTION Delegates to scripts\update.sh via any available bash (Git Bash / WSL).
             Pass -Rollback with $env:ROLLBACK_TO set to a prior tag to roll back.
#>
param([switch]$Rollback)
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\lib.ps1"
$cfg = Import-Config
Sync-BashEnv $cfg
# Forward ROLLBACK_TO to the bash subshell (update.sh reads it for --rollback).
if ($env:ROLLBACK_TO -and -not ($env:WSLENV -split ':' | Where-Object { $_ -eq 'ROLLBACK_TO' })) {
  $env:WSLENV = (@($env:WSLENV, 'ROLLBACK_TO') | Where-Object { $_ }) -join ':'
}
$sh = Find-Bash
$script = Join-Path (Split-Path $PSScriptRoot -Parent) "update.sh"
if (-not $sh) { Die "update needs a POSIX shell (Git Bash or WSL) for scripts/update.sh." }
$extra = @(); if ($Rollback) { $extra += "--rollback" }
if ($sh -eq "wsl") { & wsl bash (ConvertTo-WslPath $script) @extra }
else { & $sh $script @extra }
