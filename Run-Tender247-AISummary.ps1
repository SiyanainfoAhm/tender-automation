# Run-Tender247-AISummary.ps1

$ErrorActionPreference = "Stop"

$ProjectRoot = "C:\Users\goura\Desktop\tender-automation"
$AccountId = 2

$Now = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
    (Get-Date),
    "India Standard Time"
)

# -----------------------------------------
# DATE RULE
#
# 00:00 - 05:59 = yesterday
# 06:00 onward  = today
# -----------------------------------------

if ($Now.Hour -lt 6) {
    $TargetDate = $Now.Date.AddDays(-1).ToString("yyyy-MM-dd")
}
else {
    $TargetDate = $Now.Date.ToString("yyyy-MM-dd")
}

Set-Location $ProjectRoot

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

Write-Host ""
Write-Host "=============================================="
Write-Host " Tender247 AI Summary"
Write-Host "=============================================="
Write-Host "Current IST : $($Now.ToString('yyyy-MM-dd HH:mm:ss'))"
Write-Host "Target Date : $TargetDate"
Write-Host "Account ID  : $AccountId"
Write-Host "Project     : $ProjectRoot"
Write-Host "=============================================="
Write-Host ""

& $npm run pipeline:tender247:ai-summary -- `
    "--date=$TargetDate" `
    "--account-id=$AccountId"

$ExitCode = $LASTEXITCODE

if ($ExitCode -ne 0) {
    Write-Host ""
    Write-Error "AI Summary pipeline FAILED. Exit code: $ExitCode"
    exit $ExitCode
}

Write-Host ""
Write-Host "=============================================="
Write-Host " AI SUMMARY COMPLETED"
Write-Host " Target Date : $TargetDate"
Write-Host " Finished    : $(Get-Date)"
Write-Host "=============================================="

exit 0