# Tender247 Global: separate Excel + documents (AI Summary optional)
# Downloads Tender247_GLOBAL_YYYY-MM-DD.xlsx, upserts source_region=GLOBAL,
# then downloads document zips. Portal AI Summary is skipped for Global.
#
# Usage (PowerShell):
#   .\Run-Tender247-Global-AISummary.ps1
#   .\Run-Tender247-Global-AISummary.ps1 -Date 2026-09-15
#   .\Run-Tender247-Global-AISummary.ps1 -Date 2026-09-15 -AccountId 2
#   .\Run-Tender247-Global-AISummary.ps1 -Date 2026-09-15 -SkipUpsert
#   .\Run-Tender247-Global-AISummary.ps1 -Date 2026-09-15 -Force
#   .\Run-Tender247-Global-AISummary.ps1 -Date 2026-09-15 -Limit 1

param(
  [string]$Date = "",
  [string]$AccountId = "2",
  [string]$Limit = "",
  [switch]$SkipUpsert,
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

# IST business date: before 06:00 use yesterday (same rule as Indian script).
if (-not $Date) {
  $tz = [TimeZoneInfo]::FindSystemTimeZoneById("India Standard Time")
  $nowIst = [TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz)
  if ($nowIst.Hour -lt 6) {
    $Date = $nowIst.AddDays(-1).ToString("yyyy-MM-dd")
  } else {
    $Date = $nowIst.ToString("yyyy-MM-dd")
  }
}

Write-Host "TENDER247_GLOBAL_DOCUMENTS_DATE=$Date"
Write-Host "TENDER247_GLOBAL_DOCUMENTS_ACCOUNT=$AccountId"
Write-Host "TENDER247_GLOBAL_MODE=documents-first (AI Summary skipped)"

$npmArgs = @(
  "run",
  "pipeline:tender247:ai-summary:global",
  "--",
  "--date=$Date",
  "--account-id=$AccountId",
  "--region=GLOBAL"
)

if ($Limit) { $npmArgs += "--limit=$Limit" }
if ($SkipUpsert) { $npmArgs += "--skip-upsert" }
if ($Force) { $npmArgs += "--force" }
if ($DryRun) { $npmArgs += "--dry-run" }

& $npm @npmArgs
exit $LASTEXITCODE
