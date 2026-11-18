# Brings this laptop copy up to date with GitHub's main branch (run daily by the
# CinemaRadarAutoUpdate task, or by hand). Safe by design:
#  - only fast-forwards `main`; any other branch, local edits or diverged history -> skipped
#  - waits for a running worker to finish, then holds run.lock so no worker starts mid-update
#  - reinstalls packages only when package-lock.json changed
#   powershell -ExecutionPolicy Bypass -File local-worker\update.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $PSScriptRoot "logs"
$lock = Join-Path $PSScriptRoot "run.lock"
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs ("update-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
function Write-Log($msg) { "$(Get-Date -Format 'HH:mm:ss') $msg" | Tee-Object -FilePath $log -Append | Write-Host }
function Invoke-Git { $out = & git -C $root @args 2>&1; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed: $out" }; $out }

$held = $false
try {
  $branch = (Invoke-Git rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -ne "main") { Write-Log "skipped: this copy is on branch '$branch', not main"; exit 0 }
  if (Invoke-Git status --porcelain --untracked-files=no) { Write-Log "skipped: files were edited by hand in this copy"; exit 0 }

  Invoke-Git fetch --quiet origin main | Out-Null
  $local = (Invoke-Git rev-parse HEAD).Trim(); $remote = (Invoke-Git rev-parse origin/main).Trim()
  if ($local -eq $remote) { Write-Log "up to date ($($local.Substring(0,7)))"; exit 0 }
  & git -C $root merge-base --is-ancestor HEAD origin/main
  if ($LASTEXITCODE -ne 0) { Write-Log "skipped: this copy has commits GitHub doesn't (not a simple update)"; exit 0 }

  # wait up to 15 min for a running worker (its lock counts while < 20 min old)
  $deadline = (Get-Date).AddMinutes(15)
  while ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -lt 20) {
    if ((Get-Date) -gt $deadline) { Write-Log "skipped: worker still running after 15 min; will retry next time"; exit 0 }
    Start-Sleep -Seconds 20
  }
  Set-Content -Path $lock -Value "auto-update" -Encoding ASCII; $held = $true

  $lockChanged = [bool](Invoke-Git diff --name-only HEAD origin/main -- package-lock.json)
  Invoke-Git merge --ff-only --quiet origin/main | Out-Null
  Write-Log "updated $($local.Substring(0,7)) -> $($remote.Substring(0,7))"
  if ($lockChanged) {
    Push-Location $root
    try { & npm ci --no-audit --no-fund 2>&1 | Out-File -Append $log; if ($LASTEXITCODE -ne 0) { throw "npm ci failed (see log)" } }
    finally { Pop-Location }
    Write-Log "packages reinstalled"
  }
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"; exit 1
} finally {
  if ($held -and (Test-Path $lock)) { Remove-Item $lock -Force }
}
