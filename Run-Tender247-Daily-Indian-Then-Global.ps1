# Tender247 daily AI Summary — Indian then Global (same date, same account).
# Schedule this once daily; do not run two separate deployments.
#
# Usage:
#   .\Run-Tender247-Daily-Indian-Then-Global.ps1
#   .\Run-Tender247-Daily-Indian-Then-Global.ps1 -Date 2026-09-15
#   .\Run-Tender247-Daily-Indian-Then-Global.ps1 -Date 2026-09-15 -AccountId 2

param(
  [string]$Date = "",
  [string]$AccountId = "2"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

if (-not $Date) {
  $tz = [TimeZoneInfo]::FindSystemTimeZoneById("India Standard Time")
  $nowIst = [TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz)
  if ($nowIst.Hour -lt 6) {
    $Date = $nowIst.AddDays(-1).ToString("yyyy-MM-dd")
  } else {
    $Date = $nowIst.ToString("yyyy-MM-dd")
  }
}

Write-Host ""
Write-Host "=============================================="
Write-Host " Tender247 Daily: Indian then Global"
Write-Host " Date=$Date Account=$AccountId"
Write-Host "=============================================="
Write-Host ""

Write-Host "--- INDIAN ---"
& $npm run pipeline:tender247:ai-summary:indian -- `
  "--date=$Date" `
  "--account-id=$AccountId" `
  "--region=INDIAN"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Indian pipeline FAILED. Exit code: $LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "--- GLOBAL ---"
& $npm run pipeline:tender247:ai-summary:global -- `
  "--date=$Date" `
  "--account-id=$AccountId" `
  "--region=GLOBAL"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Global pipeline FAILED. Exit code: $LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "=============================================="
Write-Host " Daily Indian + Global COMPLETE for $Date"
Write-Host "=============================================="
exit 0
