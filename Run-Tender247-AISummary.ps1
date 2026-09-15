# Run-Tender247-AISummary.ps1
#
# Daily Task Scheduler entry: Indian first, then Global (same date / account).
#
# Skip logic (Supabase URLs are canonical — not local downloads/):
#   Indian: skip when BOTH documents_zip_url AND ai_summary_url are set
#   Global: skip when documents_zip_url is set (AI Summary optional / documents-first)
#   Otherwise: download from portal, upload to Azure, store URL in Supabase
#
# Date rule (IST):
#   00:00 - 05:59 = yesterday
#   06:00 onward  = today

$ErrorActionPreference = "Stop"

$ProjectRoot = "C:\Users\goura\Desktop\tender-automation"
$AccountId = 2

$Now = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
    (Get-Date),
    "India Standard Time"
)

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
Write-Host " Tender247 Daily: Indian then Global"
Write-Host "=============================================="
Write-Host "Current IST : $($Now.ToString('yyyy-MM-dd HH:mm:ss'))"
Write-Host "Target Date : $TargetDate"
Write-Host "Account ID  : $AccountId"
Write-Host "Project     : $ProjectRoot"
Write-Host "=============================================="
Write-Host ""

Write-Host "--- INDIAN (AI Summary + Documents) ---"
& $npm run pipeline:tender247:ai-summary:indian -- `
    "--date=$TargetDate" `
    "--account-id=$AccountId" `
    "--region=INDIAN"

$ExitCode = $LASTEXITCODE
if ($ExitCode -ne 0) {
    Write-Host ""
    Write-Error "Indian AI Summary pipeline FAILED. Exit code: $ExitCode"
    exit $ExitCode
}

Write-Host ""
Write-Host "--- GLOBAL (Documents-first; skip if documents_zip_url set) ---"
& $npm run pipeline:tender247:ai-summary:global -- `
    "--date=$TargetDate" `
    "--account-id=$AccountId" `
    "--region=GLOBAL"

$ExitCode = $LASTEXITCODE
if ($ExitCode -ne 0) {
    Write-Host ""
    Write-Error "Global documents pipeline FAILED. Exit code: $ExitCode"
    exit $ExitCode
}

Write-Host ""
Write-Host "=============================================="
Write-Host " INDIAN + GLOBAL COMPLETED"
Write-Host " Target Date : $TargetDate"
Write-Host " Finished    : $(Get-Date)"
Write-Host "=============================================="

exit 0
