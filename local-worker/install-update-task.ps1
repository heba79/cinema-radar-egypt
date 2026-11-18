# Registers a daily, hidden auto-update of this laptop copy (local-worker\update.ps1).
# Runs at $At each day, or as soon as the laptop is next on if it was off/asleep then.
#   powershell -ExecutionPolicy Bypass -File local-worker\install-update-task.ps1
# Remove:  Unregister-ScheduledTask -TaskName CinemaRadarAutoUpdate -Confirm:$false
param([string]$At = "04:00")
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot "update.ps1"
$vbs = Join-Path $PSScriptRoot "update-hidden.vbs"
@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$root"
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$script""", 0, True
"@ | Set-Content -Path $vbs -Encoding ASCII

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`"" -WorkingDirectory $root
$daily = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName "CinemaRadarAutoUpdate" -Action $action -Trigger $daily -Settings $settings `
  -Description "Cinema Radar Egypt: daily fast-forward of this copy to GitHub main (git + npm ci when needed)." -Force | Out-Null

Write-Host "Installed: updates daily at $At. Logs: $PSScriptRoot\logs\update-*.log"
