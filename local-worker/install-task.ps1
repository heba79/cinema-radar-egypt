# Registers the Cinema Radar laptop worker in Windows Task Scheduler.
# Runs at sign-in and then every $Minutes minutes while you're signed in, hidden,
# on battery too. It never wakes the laptop and never runs two copies at once.
#   powershell -ExecutionPolicy Bypass -File local-worker\install-task.ps1
param([int]$Minutes = 10)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$tsx = Join-Path $root "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path $tsx)) { throw "tsx not found - run 'npm install' in $root first" }
if (-not (Test-Path (Join-Path $PSScriptRoot ".env"))) { throw "local-worker\.env missing - see local-worker\README.md" }

# Hidden launcher (no console window popping up every few minutes)
$vbs = Join-Path $PSScriptRoot "run-hidden.vbs"
@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$root"
sh.Run """$node"" ""$tsx"" ""local-worker\run.ts""", 0, True
"@ | Set-Content -Path $vbs -Encoding ASCII

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`"" -WorkingDirectory $root
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Minutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName "CinemaRadarLocalWorker" -Action $action -Trigger @($atLogon, $repeat) -Settings $settings `
  -Description "Cinema Radar Egypt laptop worker: reads Scene/VOX every $Minutes min and reports to the website." -Force | Out-Null

Write-Host "Installed: runs every $Minutes minutes while you're signed in. Logs: $PSScriptRoot\logs"
