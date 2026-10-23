$ErrorActionPreference = "Stop"

# ============================================================
# FINAL 127 DIRECT DRIVEITEM RECOVERY
# - Creates missing 2026-10-08/<TenderId> folders
# - Moves existing DriveItems (does NOT copy)
# - Automatically refreshes Graph token on 401
# - Retries 408 / 429 / 5xx
# - Safe to rerun
# ============================================================

$DriveId = $env:SHAREPOINT_DRIVE_ID

$TargetBasePath =
    "companies/siyana-info-solutions-pvt-ltd_a1b2c3d4-e5f6-7890-abcd-ef1234567890/tender-artifacts/tender247/2026-10-08"

$CsvPath =
    ".\scripts\tender247-recovery\remaining-physical-under-2026-10-09.csv"

$ReportDir =
    ".\scripts\tender247-recovery"

$TenantId =
    "25ff3e19-eb6b-4343-af6d-1f96004e62ab"

$ClientId =
    "81c78beb-8256-4874-90af-72541175f8a9"

$MaxRetries = 8
$DelayMs = 300

New-Item `
    -ItemType Directory `
    -Force `
    -Path $ReportDir |
    Out-Null


# ============================================================
# VALIDATE ENV
# ============================================================

if ([string]::IsNullOrWhiteSpace($DriveId)) {
    throw "SHAREPOINT_DRIVE_ID missing"
}

if (
    [string]::IsNullOrWhiteSpace(
        $env:MICROSOFT_GRAPH_CLIENT_SECRET
    )
) {
    throw "MICROSOFT_GRAPH_CLIENT_SECRET missing"
}

if (-not (Test-Path $CsvPath)) {
    throw "Remaining CSV not found: $CsvPath"
}


# ============================================================
# HELPERS
# ============================================================

function Get-HttpStatus {

    param($ErrorRecord)

    try {
        return [int]$ErrorRecord.Exception.Response.StatusCode
    }
    catch {
        return $null
    }
}


function Refresh-GraphToken {

    Write-Host "Refreshing Microsoft Graph token..."

    $tokenResponse =
        Invoke-RestMethod `
            -Method Post `
            -Uri (
                "https://login.microsoftonline.com/" +
                "$TenantId/oauth2/v2.0/token"
            ) `
            -ContentType "application/x-www-form-urlencoded" `
            -Body @{
                client_id     = $ClientId
                client_secret =
                    $env:MICROSOFT_GRAPH_CLIENT_SECRET
                scope =
                    "https://graph.microsoft.com/.default"
                grant_type =
                    "client_credentials"
            } `
            -ErrorAction Stop

    $env:GRAPH_ACCESS_TOKEN =
        "$($tokenResponse.access_token)"

    if (
        [string]::IsNullOrWhiteSpace(
            $env:GRAPH_ACCESS_TOKEN
        )
    ) {
        throw "Graph token refresh returned no access token."
    }

    Write-Host "Graph token refreshed."
}


function Encode-GraphPath {

    param([string]$Path)

    return (
        $Path.Split("/") |
        ForEach-Object {
            [Uri]::EscapeDataString($_)
        }
    ) -join "/"
}


function Invoke-Graph {

    param(
        [ValidateSet("GET","PATCH","POST")]
        [string]$Method,

        [string]$Uri,

        $Body = $null
    )

    $refreshedAfter401 = $false

    for (
        $attempt = 1;
        $attempt -le $MaxRetries;
        $attempt++
    ) {

        try {

            $headers = @{
                Authorization =
                    "Bearer $env:GRAPH_ACCESS_TOKEN"
            }

            $params = @{
                Method      = $Method
                Uri         = $Uri
                Headers     = $headers
                ErrorAction = "Stop"
            }

            if ($null -ne $Body) {

                $params.ContentType =
                    "application/json"

                $params.Body =
                    $Body |
                    ConvertTo-Json `
                        -Depth 20 `
                        -Compress
            }

            return Invoke-RestMethod @params
        }
        catch {

            $status =
                Get-HttpStatus $_

            # --------------------------------------------
            # TOKEN EXPIRED
            # --------------------------------------------

            if (
                $status -eq 401 -and
                -not $refreshedAfter401
            ) {

                Write-Warning (
                    "Graph returned 401. " +
                    "Refreshing token and retrying."
                )

                Refresh-GraphToken

                $refreshedAfter401 = $true

                continue
            }

            # --------------------------------------------
            # RETRY TRANSIENT ERRORS
            # --------------------------------------------

            $retryable =
                $status -in @(
                    408,
                    429,
                    500,
                    502,
                    503,
                    504
                )

            if (
                -not $retryable -or
                $attempt -eq $MaxRetries
            ) {
                throw
            }

            $retryAfter = $null

            try {

                $retryAfter =
                    $_.Exception.Response.Headers[
                        "Retry-After"
                    ]
            }
            catch {
            }

            if ($retryAfter) {

                try {
                    $sleepSeconds =
                        [int]$retryAfter
                }
                catch {
                    $sleepSeconds = 5
                }
            }
            else {

                $sleepSeconds =
                    [Math]::Min(
                        60,
                        [Math]::Pow(
                            2,
                            $attempt
                        )
                    )
            }

            Write-Warning (
                "Graph HTTP $status. " +
                "Retry $attempt/$MaxRetries after " +
                "$sleepSeconds second(s)."
            )

            Start-Sleep `
                -Seconds $sleepSeconds
        }
    }
}


function Get-GraphItem {

    param([string]$ItemId)

    return Invoke-Graph `
        -Method GET `
        -Uri (
            "https://graph.microsoft.com/v1.0/" +
            "drives/$DriveId/items/$ItemId"
        )
}


function Get-FolderByPath {

    param([string]$Path)

    $encoded =
        Encode-GraphPath $Path

    return Invoke-Graph `
        -Method GET `
        -Uri (
            "https://graph.microsoft.com/v1.0/" +
            "drives/$DriveId/root:/$encoded"
        )
}


function Try-GetFolderByPath {

    param([string]$Path)

    try {

        return Get-FolderByPath `
            -Path $Path
    }
    catch {

        $status =
            Get-HttpStatus $_

        if ($status -eq 404) {
            return $null
        }

        throw
    }
}


function Get-Children {

    param([string]$FolderId)

    $all = @()

    $uri =
        "https://graph.microsoft.com/v1.0/" +
        "drives/$DriveId/items/$FolderId/" +
        "children?`$top=999"

    while ($uri) {

        $page =
            Invoke-Graph `
                -Method GET `
                -Uri $uri

        if ($page.value) {
            $all += @($page.value)
        }

        $uri =
            $page.'@odata.nextLink'
    }

    return $all
}


function Ensure-TargetTenderFolder {

    param(
        [string]$TenderId,
        [string]$TargetBaseFolderId
    )

    $targetPath =
        "$TargetBasePath/$TenderId"

    $existing =
        Try-GetFolderByPath `
            -Path $targetPath

    if ($existing) {
        return $existing
    }

    Write-Host (
        "Target folder missing. Creating: " +
        "2026-10-08/$TenderId"
    )

    try {

        return Invoke-Graph `
            -Method POST `
            -Uri (
                "https://graph.microsoft.com/v1.0/" +
                "drives/$DriveId/items/" +
                "$TargetBaseFolderId/children"
            ) `
            -Body @{
                name =
                    $TenderId

                folder =
                    @{}

                "@microsoft.graph.conflictBehavior" =
                    "fail"
            }
    }
    catch {

        # In case folder got created between GET and POST

        $existing =
            Try-GetFolderByPath `
                -Path $targetPath

        if ($existing) {
            return $existing
        }

        throw
    }
}


# ============================================================
# START WITH FRESH GRAPH TOKEN
# ============================================================

Refresh-GraphToken


# ============================================================
# LOAD INPUT
# ============================================================

$rows =
    @(Import-Csv $CsvPath)

$targetBaseFolder =
    Get-FolderByPath `
        -Path $TargetBasePath


Write-Host ""
Write-Host "============================================================"
Write-Host "FINAL 127 DIRECT DRIVEITEM RECOVERY"
Write-Host "============================================================"
Write-Host "Rows from remaining CSV :" $rows.Count
Write-Host ""


# ============================================================
# MOVE ITEMS
# ============================================================

$moved = 0
$alreadyCorrect = 0
$conflicts = @()
$failures = @()

$index = 0


foreach ($row in $rows) {

    $index++

    $tenderId =
        "$($row.TenderId)".Trim()

    $driveItemId =
        "$($row.DriveItemId)".Trim()


    if (
        [string]::IsNullOrWhiteSpace($tenderId) -or
        [string]::IsNullOrWhiteSpace($driveItemId)
    ) {

        $failures +=
            [PSCustomObject]@{
                TenderId =
                    $tenderId

                DriveItemId =
                    $driveItemId

                FileName =
                    $row.FileName

                Error =
                    "Missing TenderId or DriveItemId"
            }

        continue
    }


    try {

        Write-Host ""
        Write-Host (
            "[$index/$($rows.Count)] Tender: $tenderId"
        )

        Write-Host (
            "File: $($row.FileName)"
        )


        # --------------------------------------------
        # ENSURE TARGET TENDER FOLDER EXISTS
        # --------------------------------------------

        $targetFolder =
            Ensure-TargetTenderFolder `
                -TenderId $tenderId `
                -TargetBaseFolderId $targetBaseFolder.id


        # --------------------------------------------
        # GET CURRENT DRIVE ITEM
        # --------------------------------------------

        $item =
            Get-GraphItem `
                -ItemId $driveItemId


        # --------------------------------------------
        # ALREADY CORRECT
        # --------------------------------------------

        if (
            "$($item.parentReference.id)" -eq
            "$($targetFolder.id)"
        ) {

            $alreadyCorrect++

            Write-Host (
                "Already physically correct."
            )

            continue
        }


        # --------------------------------------------
        # CHECK SAME-NAME CONFLICT
        # --------------------------------------------

        $targetChildren =
            @(
                Get-Children `
                    -FolderId $targetFolder.id
            )

        $sameName =
            @(
                $targetChildren |
                Where-Object {

                    $_.name -eq $item.name -and
                    $_.id -ne $item.id
                }
            )


        if ($sameName.Count -gt 0) {

            $conflicts +=
                [PSCustomObject]@{

                    TenderId =
                        $tenderId

                    DriveItemId =
                        $driveItemId

                    FileName =
                        $item.name

                    ExistingTargetItemId =
                        $sameName[0].id
                }

            Write-Warning (
                "Same-name file already exists " +
                "in target. Skipped."
            )

            continue
        }


        # --------------------------------------------
        # MOVE EXISTING DRIVE ITEM
        # THIS IS A MOVE, NOT A COPY
        # --------------------------------------------

        Invoke-Graph `
            -Method PATCH `
            -Uri (
                "https://graph.microsoft.com/v1.0/" +
                "drives/$DriveId/items/$driveItemId"
            ) `
            -Body @{
                parentReference = @{
                    id =
                        $targetFolder.id
                }
            } |
            Out-Null


        $moved++


        Write-Host (
            "MOVED -> 2026-10-08/$tenderId"
        )


        Start-Sleep `
            -Milliseconds $DelayMs
    }
    catch {

        $failures +=
            [PSCustomObject]@{

                TenderId =
                    $tenderId

                DriveItemId =
                    $driveItemId

                FileName =
                    $row.FileName

                Error =
                    $_.Exception.Message
            }


        Write-Warning (
            "FAILED: $($_.Exception.Message)"
        )
    }
}


# ============================================================
# VERIFY ACTUAL PARENT IDS
# ============================================================

Write-Host ""
Write-Host "Verifying actual parent IDs..."


$remaining = @()


foreach ($row in $rows) {

    try {

        $tenderId =
            "$($row.TenderId)".Trim()

        $driveItemId =
            "$($row.DriveItemId)".Trim()


        $targetFolder =
            Ensure-TargetTenderFolder `
                -TenderId $tenderId `
                -TargetBaseFolderId $targetBaseFolder.id


        $item =
            Get-GraphItem `
                -ItemId $driveItemId


        if (
            "$($item.parentReference.id)" -ne
            "$($targetFolder.id)"
        ) {

            $remaining +=
                [PSCustomObject]@{

                    TenderId =
                        $tenderId

                    DriveItemId =
                        $driveItemId

                    FileName =
                        $item.name

                    CurrentParentId =
                        $item.parentReference.id

                    ExpectedParentId =
                        $targetFolder.id

                    CurrentWebUrl =
                        $item.webUrl
                }
        }
    }
    catch {

        $remaining +=
            [PSCustomObject]@{

                TenderId =
                    $row.TenderId

                DriveItemId =
                    $row.DriveItemId

                FileName =
                    $row.FileName

                CurrentParentId =
                    "VERIFY_ERROR"

                ExpectedParentId =
                    ""

                CurrentWebUrl =
                    $_.Exception.Message
            }
    }


    Start-Sleep `
        -Milliseconds $DelayMs
}


# ============================================================
# SAVE REPORTS
# ============================================================

if ($conflicts.Count -gt 0) {

    $conflicts |
        Export-Csv `
            "$ReportDir\final-127-conflicts.csv" `
            -NoTypeInformation `
            -Encoding UTF8
}


if ($failures.Count -gt 0) {

    $failures |
        Export-Csv `
            "$ReportDir\final-127-failures.csv" `
            -NoTypeInformation `
            -Encoding UTF8
}


if ($remaining.Count -gt 0) {

    $remaining |
        Export-Csv `
            "$ReportDir\final-127-remaining.csv" `
            -NoTypeInformation `
            -Encoding UTF8
}


# ============================================================
# SUMMARY
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "FINAL 127 CLEANUP SUMMARY"
Write-Host "============================================================"

Write-Host "Input items       :" $rows.Count
Write-Host "Moved             :" $moved
Write-Host "Already correct   :" $alreadyCorrect
Write-Host "Conflicts         :" $conflicts.Count
Write-Host "Failures          :" $failures.Count
Write-Host "Still not in 08   :" $remaining.Count

Write-Host "============================================================"
Write-Host ""


if ($remaining.Count -eq 0) {

    Write-Host (
        "SUCCESS: all remaining DriveItems are " +
        "physically inside their 2026-10-08 tender folders."
    )
}
else {

    Write-Warning (
        "$($remaining.Count) DriveItems still require attention."
    )
}