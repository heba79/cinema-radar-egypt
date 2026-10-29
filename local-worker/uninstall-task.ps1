# Stops the laptop worker from running automatically (the website keeps working).
#   powershell -ExecutionPolicy Bypass -File local-worker\uninstall-task.ps1
Unregister-ScheduledTask -TaskName "CinemaRadarLocalWorker" -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed the CinemaRadarLocalWorker task."
