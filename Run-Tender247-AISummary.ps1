$ErrorActionPreference = "Stop"

$ProjectDir = "C:\Users\goura\OneDrive\Desktop\tender-automation"

# This pipeline MUST always use Tender247 Account 2
$AccountId = 2

$Now = Get-Date

# 09:00 AM onward = today's scraped_date
$TargetDate = $Now.ToString("yyyy-MM-dd")

# Midnight and 03:00 AM belong to previous day's batch
if ($Now.Hour -lt 9) {
    $TargetDate = $Now.AddDays(-1).ToString("yyyy-MM-dd")
}

Set-Location $ProjectDir

Write-Host "============================================"
Write-Host "Tender247 Document + AI Summary Pipeline"
Write-Host "Run Time     : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Scraped Date : $TargetDate"
Write-Host "Account ID   : $AccountId"
Write-Host "Project Dir  : $ProjectDir"
Write-Host "============================================"

# Safety checks
if ([string]::IsNullOrWhiteSpace($TargetDate)) {
    Write-Host "ERROR: TargetDate is empty."
    exit 1
}

if ($AccountId -ne 2) {
    Write-Host "ERROR: This scheduled pipeline must use Account ID 2."
    exit 1
}

Write-Host ""
Write-Host "Executing:"
Write-Host "npm run pipeline:tender247:ai-summary -- --date=$TargetDate --account-id=$AccountId"
Write-Host ""

# IMPORTANT:
# No --skip-upsert
# Account ID is always explicitly passed as 2
& npm.cmd run pipeline:tender247:ai-summary -- "--date=$TargetDate" "--account-id=$AccountId"

$ExitCode = $LASTEXITCODE

Write-Host ""
Write-Host "============================================"
Write-Host "Pipeline Finished"
Write-Host "Finished     : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Scraped Date : $TargetDate"
Write-Host "Account ID   : $AccountId"
Write-Host "Exit Code    : $ExitCode"
Write-Host "============================================"

exit $ExitCode