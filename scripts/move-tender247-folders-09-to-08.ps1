param(
    [switch]$DryRun,

    [string]$SourceDate = "2026-10-09",

    [string]$TargetDate = "2026-10-08",

    [int]$DelayMs = 300,

    [int]$MaxRetries = 8
)

$ErrorActionPreference = "Stop"

# ============================================================
# FINAL TENDER247 PHYSICAL SHAREPOINT MOVE
#
# AUTHORITY:
#   Canonical Supabase tender scraped_date = 2026-10-08
#
# ACTION:
#   Move matching physical Tender247 documents/folders from
#   SharePoint 2026-10-09 -> 2026-10-08.
#
# THIS SCRIPT:
#   - DOES NOT update Supabase
#   - DOES NOT update document_urls
#   - DOES NOT update mirror
#   - DOES NOT call Tender247 API
#   - DOES NOT delete the 2026-10-09 date folder
#
# ============================================================


# ============================================================
# CONFIG
# ============================================================

$Tender247BasePath =
    "companies/siyana-info-solutions-pvt-ltd_a1b2c3d4-e5f6-7890-abcd-ef1234567890/tender-artifacts/tender247"

$ReportDir =
    ".\scripts\tender247-recovery"

New-Item `
    -ItemType Directory `
    -Force `
    -Path $ReportDir |
Out-Null


# ============================================================
# HELPERS
# ============================================================

function Require-Env {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $item =
        Get-Item "Env:$Name" `
            -ErrorAction SilentlyContinue

    if (
        -not $item -or
        [string]::IsNullOrWhiteSpace(
            $item.Value
        )
    ) {
        throw (
            "Required environment variable missing: " +
            $Name
        )
    }

    return $item.Value
}


function Encode-GraphPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    return (
        $Path.Split("/") |
        ForEach-Object {
            [Uri]::EscapeDataString($_)
        }
    ) -join "/"
}


function Get-ObjectProperty {
    param(
        $Object,

        [string[]]$Names
    )

    foreach ($name in $Names) {

        if (
            $null -ne
            $Object.PSObject.Properties[$name]
        ) {

            $value =
                $Object.$name

            if (
                $null -ne $value -and
                -not [string]::IsNullOrWhiteSpace(
                    "$value"
                )
            ) {
                return $value
            }
        }
    }

    return $null
}


function Get-HttpStatus {
    param($ErrorRecord)

    try {
        return [int](
            $ErrorRecord.Exception.Response.StatusCode
        )
    }
    catch {
        return $null
    }
}


# ============================================================
# MICROSOFT GRAPH
# ============================================================

function Invoke-Graph {
    param(
        [Parameter(Mandatory)]
        [ValidateSet(
            "GET",
            "POST",
            "PATCH",
            "DELETE"
        )]
        [string]$Method,

        [Parameter(Mandatory)]
        [string]$Uri,

        $Body = $null
    )

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
                        -Depth 30 `
                        -Compress
            }

            return Invoke-RestMethod @params
        }
        catch {

            $status =
                Get-HttpStatus $_

            $retryAfter = $null

            try {

                $retryAfter =
                    $_.Exception.Response.Headers[
                        "Retry-After"
                    ]
            }
            catch {
            }


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
                "Retry $attempt/$MaxRetries " +
                "after $sleepSeconds second(s)."
            )


            Start-Sleep `
                -Seconds $sleepSeconds
        }
    }
}


function Get-GraphItem {
    param(
        [string]$DriveId,

        [string]$ItemId
    )

    return Invoke-Graph `
        -Method GET `
        -Uri (
            "https://graph.microsoft.com/v1.0/" +
            "drives/$DriveId/items/$ItemId"
        )
}


function Get-GraphFolderByPath {
    param(
        [string]$DriveId,

        [string]$Path
    )

    $encoded =
        Encode-GraphPath $Path


    return Invoke-Graph `
        -Method GET `
        -Uri (
            "https://graph.microsoft.com/v1.0/" +
            "drives/$DriveId/root:/$encoded"
        )
}


function Try-GetGraphFolderByPath {
    param(
        [string]$DriveId,

        [string]$Path
    )

    try {

        return Get-GraphFolderByPath `
            -DriveId $DriveId `
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


function Get-GraphChildren {
    param(
        [string]$DriveId,

        [string]$FolderId
    )

    $items = @()


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

            foreach ($item in $page.value) {
                $items += $item
            }
        }


        $uri =
            $page.'@odata.nextLink'
    }


    return $items
}


function New-GraphFolder {
    param(
        [string]$DriveId,

        [string]$ParentId,

        [string]$FolderName
    )

    return Invoke-Graph `
        -Method POST `
        -Uri (
            "https://graph.microsoft.com/v1.0/" +
            "drives/$DriveId/items/$ParentId/children"
        ) `
        -Body @{
            name = $FolderName

            folder = @{}

            "@microsoft.graph.conflictBehavior" =
                "fail"
        }
}


function Move-GraphItem {
    param(
        [string]$DriveId,

        [string]$ItemId,

        [string]$TargetParentId
    )

    return Invoke-Graph `
        -Method PATCH `
        -Uri (
            "https://graph.microsoft.com/v1.0/" +
            "drives/$DriveId/items/$ItemId"
        ) `
        -Body @{
            parentReference = @{
                id = $TargetParentId
            }
        }
}


# ============================================================
# SUPABASE
#
# READ ONLY.
# ============================================================

function Invoke-SupabaseGetPaged {
    param(
        [string]$BaseUrl,

        [string]$ServiceRoleKey,

        [string]$RelativeUrl
    )

    $offset = 0

    $pageSize = 1000


    while ($true) {

        $headers = @{
            apikey =
                $ServiceRoleKey

            Authorization =
                "Bearer $ServiceRoleKey"
        }


        if ($RelativeUrl.Contains("?")) {

            $uri =
                "$BaseUrl/rest/v1/$RelativeUrl" +
                "&limit=$pageSize" +
                "&offset=$offset"
        }
        else {

            $uri =
                "$BaseUrl/rest/v1/$RelativeUrl" +
                "?limit=$pageSize" +
                "&offset=$offset"
        }


        Write-Host (
            "Supabase page: offset=$offset " +
            "limit=$pageSize"
        )


        $response =
            Invoke-WebRequest `
                -Method GET `
                -Uri $uri `
                -Headers $headers `
                -UseBasicParsing `
                -ErrorAction Stop


        $content =
            "$($response.Content)"


        if (
            [string]::IsNullOrWhiteSpace(
                $content
            )
        ) {
            break
        }


        $parsed =
            $content |
            ConvertFrom-Json


        $rows = @()


        foreach ($row in @($parsed)) {
            $rows += $row
        }


        Write-Host (
            "Supabase rows returned: " +
            "$($rows.Count)"
        )


        if ($rows.Count -eq 0) {
            break
        }


        foreach ($row in $rows) {
            Write-Output $row
        }


        if ($rows.Count -lt $pageSize) {
            break
        }


        $offset += $pageSize
    }
}


# ============================================================
# ENVIRONMENT
# ============================================================

$null =
    Require-Env "GRAPH_ACCESS_TOKEN"


$driveId =
    Require-Env "SHAREPOINT_DRIVE_ID"


$canonicalUrl = (
    Require-Env "SUPABASE_URL"
).TrimEnd("/")


$canonicalKey =
    Require-Env "SUPABASE_SERVICE_ROLE_KEY"


# ============================================================
# PATHS
# ============================================================

$sourceDatePath =
    "$Tender247BasePath/$SourceDate"


$targetDatePath =
    "$Tender247BasePath/$TargetDate"


$expectedSourceFragment =
    "$Tender247BasePath/$SourceDate"


# ============================================================
# HEADER
# ============================================================

Write-Host ""

Write-Host (
    "============================================================"
)

Write-Host (
    "Tender247 FINAL physical SharePoint recovery"
)

Write-Host (
    "============================================================"
)

Write-Host (
    "Supabase scraped_date : $TargetDate"
)

Write-Host (
    "Physical source       : $SourceDate"
)

Write-Host (
    "Physical target       : $TargetDate"
)

Write-Host (
    "Dry run               : $DryRun"
)

Write-Host (
    "Database writes       : NONE"
)

Write-Host (
    "Tender247 API calls   : NONE"
)

Write-Host (
    "============================================================"
)

Write-Host ""


# ============================================================
# STEP 1
# VERIFY DRIVE AND DATE FOLDERS
# ============================================================

Write-Host (
    "[1/6] Verifying TenderDocs and date folders..."
)


$drive =
    Invoke-Graph `
        -Method GET `
        -Uri (
            "https://graph.microsoft.com/v1.0/" +
            "drives/$driveId"
        )


if ($drive.name -ne "TenderDocs") {

    throw (
        "Unexpected drive '$($drive.name)'. " +
        "Expected TenderDocs."
    )
}


$sourceDateFolder =
    Get-GraphFolderByPath `
        -DriveId $driveId `
        -Path $sourceDatePath


$targetDateFolder =
    Get-GraphFolderByPath `
        -DriveId $driveId `
        -Path $targetDatePath


Write-Host (
    "Drive  : $($drive.name)"
)


Write-Host (
    "Source : $($sourceDateFolder.webUrl)"
)


Write-Host (
    "Target : $($targetDateFolder.webUrl)"
)


# ============================================================
# STEP 2
# READ ALL TENDER247 DOCUMENTS FOR SCRAPED DATE 08
#
# DO NOT FILTER BY storage_url.
#
# storage_url has already been corrected.
# Physical Graph path determines whether a file still needs moving.
# ============================================================

Write-Host ""

Write-Host (
    "[2/6] Reading TENDER247 documents " +
    "for scraped_date=$TargetDate..."
)


$select =
    "*,agenttender_tenders!inner(" +
    "id,scraped_date" +
    ")"


$relativeUrl =
    "agenttender_tender_documents" +
    "?select=$([Uri]::EscapeDataString($select))" +
    "&external_source=eq.TENDER247" +
    "&agenttender_tenders.scraped_date=eq.$TargetDate"


$allTargetDateDocs =
    @(
        Invoke-SupabaseGetPaged `
            -BaseUrl $canonicalUrl `
            -ServiceRoleKey $canonicalKey `
            -RelativeUrl $relativeUrl
    )


Write-Host ""

Write-Host (
    "Candidate canonical documents: " +
    "$($allTargetDateDocs.Count)"
)


# ============================================================
# STEP 3
# FIND WHICH DOCUMENTS ARE STILL PHYSICALLY UNDER 09
# ============================================================

Write-Host ""

Write-Host (
    "[3/6] Resolving actual SharePoint locations..."
)


$physicalWrongDateDocs = @()

$graphErrors = @()

$counter = 0


foreach ($doc in $allTargetDateDocs) {

    $counter++


    $driveItemId =
        Get-ObjectProperty `
            -Object $doc `
            -Names @(
                "sharepoint_drive_item_id",
                "drive_item_id",
                "storage_item_id",
                "sharepoint_item_id"
            )


    if (-not $driveItemId) {

        # No physical DriveItem -> nothing to move.
        continue
    }


    try {

        $item =
            Get-GraphItem `
                -DriveId $driveId `
                -ItemId "$driveItemId"


        $parentPath =
            "$($item.parentReference.path)".Replace(
                "\",
                "/"
            )


        $itemUrl =
            "$($item.webUrl)".Replace(
                "\",
                "/"
            )


        $physicallyUnderSource =
            (
                $parentPath -like
                "*$expectedSourceFragment*"
            ) -or
            (
                $itemUrl -like
                "*$expectedSourceFragment*"
            )


        if ($physicallyUnderSource) {

            $tenderId =
                "$($doc.tender_id)"


            if (
                [string]::IsNullOrWhiteSpace(
                    $tenderId
                ) -and
                $doc.agenttender_tenders
            ) {

                $tenderId =
                    "$($doc.agenttender_tenders.id)"
            }


            $physicalWrongDateDocs +=
                [PSCustomObject]@{

                    CanonicalDocumentId =
                        "$($doc.id)"

                    CanonicalTenderId =
                        $tenderId

                    DriveItemId =
                        "$driveItemId"

                    FileName =
                        "$($item.name)"

                    WebUrl =
                        "$($item.webUrl)"

                    ParentFolderId =
                        "$($item.parentReference.id)"

                    ParentPath =
                        "$($item.parentReference.path)"
                }
        }
    }
    catch {

        $graphErrors +=
            [PSCustomObject]@{

                DocumentId =
                    "$($doc.id)"

                DriveItemId =
                    "$driveItemId"

                Error =
                    $_.Exception.Message
            }
    }


    if (($counter % 100) -eq 0) {

        Write-Host (
            "Resolved $counter/" +
            "$($allTargetDateDocs.Count) - " +
            "physical $SourceDate docs: " +
            "$($physicalWrongDateDocs.Count)"
        )
    }


    if ($DelayMs -gt 0) {

        Start-Sleep `
            -Milliseconds $DelayMs
    }
}


Write-Host ""

Write-Host (
    "Physically wrong-date docs : " +
    "$($physicalWrongDateDocs.Count)"
)


Write-Host (
    "Graph lookup errors        : " +
    "$($graphErrors.Count)"
)


if ($graphErrors.Count -gt 0) {

    $graphErrors |
        Export-Csv `
            "$ReportDir\physical-graph-errors.csv" `
            -NoTypeInformation


    throw (
        "Graph resolution contains errors. " +
        "No move performed."
    )
}


if ($physicalWrongDateDocs.Count -eq 0) {

    Write-Host ""

    Write-Host (
        "SUCCESS: no scraped-date-$TargetDate " +
        "documents remain physically under $SourceDate."
    )

    exit 0
}


# ============================================================
# STEP 4
# GROUP BY PHYSICAL TENDER FOLDER
# ============================================================

Write-Host ""

Write-Host (
    "[4/6] Building tender-folder move plans..."
)


$groups =
    @(
        $physicalWrongDateDocs |
        Group-Object ParentFolderId
    )


$plans = @()

$planErrors = @()


foreach ($group in $groups) {

    try {

        $sourceFolder =
            Get-GraphItem `
                -DriveId $driveId `
                -ItemId $group.Name


        $folderName =
            "$($sourceFolder.name)"


        $affectedDocs =
            @($group.Group)


        $tenderIds =
            @(
                $affectedDocs.CanonicalTenderId |
                Where-Object {
                    -not [string]::IsNullOrWhiteSpace(
                        "$_"
                    )
                } |
                Sort-Object -Unique
            )


        if ($tenderIds.Count -ne 1) {

            throw (
                "Folder '$folderName' maps to " +
                "$($tenderIds.Count) tenders."
            )
        }


        $children =
            @(
                Get-GraphChildren `
                    -DriveId $driveId `
                    -FolderId $sourceFolder.id
            )


        $affectedIds =
            @(
                $affectedDocs.DriveItemId |
                Sort-Object -Unique
            )


        $unaffectedChildren =
            @(
                $children |
                Where-Object {
                    $_.id -notin $affectedIds
                }
            )


        $targetTenderPath =
            "$targetDatePath/$folderName"


        $targetFolder =
            Try-GetGraphFolderByPath `
                -DriveId $driveId `
                -Path $targetTenderPath


        if (
            -not $targetFolder -and
            $unaffectedChildren.Count -eq 0
        ) {

            $mode =
                "MOVE_WHOLE_FOLDER"
        }
        else {

            $mode =
                "MOVE_AFFECTED_DOCUMENTS"
        }


        $plans +=
            [PSCustomObject]@{

                TenderId =
                    $tenderIds[0]

                SourceFolderId =
                    "$($sourceFolder.id)"

                SourceFolderName =
                    $folderName

                SourceFolderUrl =
                    "$($sourceFolder.webUrl)"

                TargetFolderId =
                    if ($targetFolder) {
                        "$($targetFolder.id)"
                    }
                    else {
                        $null
                    }

                TargetTenderPath =
                    $targetTenderPath

                Mode =
                    $mode

                AffectedCount =
                    $affectedDocs.Count

                UnaffectedCount =
                    $unaffectedChildren.Count

                Documents =
                    $affectedDocs
            }
    }
    catch {

        $planErrors +=
            [PSCustomObject]@{

                ParentFolderId =
                    $group.Name

                Error =
                    $_.Exception.Message
            }
    }


    if ($DelayMs -gt 0) {

        Start-Sleep `
            -Milliseconds $DelayMs
    }
}


if ($planErrors.Count -gt 0) {

    $planErrors |
        Export-Csv `
            "$ReportDir\physical-plan-errors.csv" `
            -NoTypeInformation


    throw (
        "Move planning failed. " +
        "No files have been moved."
    )
}


$wholeFolderPlans =
    @(
        $plans |
        Where-Object {
            $_.Mode -eq
            "MOVE_WHOLE_FOLDER"
        }
    )


$selectivePlans =
    @(
        $plans |
        Where-Object {
            $_.Mode -eq
            "MOVE_AFFECTED_DOCUMENTS"
        }
    )


$plans |
    Select-Object `
        TenderId,
        SourceFolderName,
        Mode,
        AffectedCount,
        UnaffectedCount |
    Export-Csv `
        "$ReportDir\physical-move-plan.csv" `
        -NoTypeInformation


Write-Host ""

Write-Host (
    "Physical tender folders : " +
    "$($plans.Count)"
)


Write-Host (
    "Whole-folder moves      : " +
    "$($wholeFolderPlans.Count)"
)


Write-Host (
    "Selective moves         : " +
    "$($selectivePlans.Count)"
)


# ============================================================
# DRY RUN
# ============================================================

if ($DryRun) {

    Write-Host ""

    Write-Host (
        "============================================================"
    )

    Write-Host (
        "FINAL PHYSICAL DRY RUN"
    )

    Write-Host (
        "============================================================"
    )

    Write-Host (
        "Supabase target-date docs  : " +
        "$($allTargetDateDocs.Count)"
    )

    Write-Host (
        "Still physically under 09  : " +
        "$($physicalWrongDateDocs.Count)"
    )

    Write-Host (
        "Tender folders             : " +
        "$($plans.Count)"
    )

    Write-Host (
        "Whole-folder moves         : " +
        "$($wholeFolderPlans.Count)"
    )

    Write-Host (
        "Selective moves            : " +
        "$($selectivePlans.Count)"
    )

    Write-Host (
        "Graph errors               : 0"
    )

    Write-Host (
        "Plan errors                : 0"
    )

    Write-Host ""

    Write-Host "NO FILES MOVED."
    Write-Host "NO DATABASE UPDATED."
    Write-Host "NO TENDER247 API CALLED."

    Write-Host (
        "============================================================"
    )

    exit 0
}


# ============================================================
# STEP 5
# LIVE PHYSICAL MOVE
# ============================================================

Write-Host ""

Write-Warning (
    "LIVE PHYSICAL MOVE STARTING"
)


$movedWholeFolders = 0

$movedDocuments = 0

$alreadyInTarget = 0

$conflicts = @()

$failures = @()


Write-Host ""

Write-Host (
    "[5/6] Moving scraped-date-$TargetDate " +
    "content into $TargetDate..."
)


foreach ($plan in $plans) {

    Write-Host ""

    Write-Host (
        "------------------------------------------------------------"
    )

    Write-Host (
        "Tender ID : $($plan.TenderId)"
    )

    Write-Host (
        "Folder    : $($plan.SourceFolderName)"
    )

    Write-Host (
        "Mode      : $($plan.Mode)"
    )

    Write-Host (
        "Docs      : $($plan.AffectedCount)"
    )


    try {

        $targetFolderId =
            $plan.TargetFolderId


        # ========================================================
        # CASE A
        # MOVE COMPLETE TENDER FOLDER
        # ========================================================

        if (
            $plan.Mode -eq
            "MOVE_WHOLE_FOLDER"
        ) {

            $movedFolder =
                Move-GraphItem `
                    -DriveId $driveId `
                    -ItemId $plan.SourceFolderId `
                    -TargetParentId $targetDateFolder.id


            $movedWholeFolders++


            Write-Host (
                "Moved whole folder -> ${TargetDate}: " +
                "$($movedFolder.webUrl)"
            )
        }


        # ========================================================
        # CASE B
        # TARGET FOLDER EXISTS OR SOURCE CONTAINS EXTRA CONTENT
        # MOVE ONLY SCRAPED-DATE-08 DOCUMENTS
        # ========================================================

        else {

            if (
                [string]::IsNullOrWhiteSpace(
                    "$targetFolderId"
                )
            ) {

                try {

                    $createdFolder =
                        New-GraphFolder `
                            -DriveId $driveId `
                            -ParentId $targetDateFolder.id `
                            -FolderName $plan.SourceFolderName


                    $targetFolderId =
                        "$($createdFolder.id)"
                }
                catch {

                    $existing =
                        Try-GetGraphFolderByPath `
                            -DriveId $driveId `
                            -Path $plan.TargetTenderPath


                    if (-not $existing) {
                        throw
                    }


                    $targetFolderId =
                        "$($existing.id)"
                }
            }


            $targetChildren =
                @(
                    Get-GraphChildren `
                        -DriveId $driveId `
                        -FolderId $targetFolderId
                )


            foreach ($doc in $plan.Documents) {

                $current =
                    Get-GraphItem `
                        -DriveId $driveId `
                        -ItemId $doc.DriveItemId


                $currentParent =
                    "$($current.parentReference.id)"


                # Already correct physically.
                if (
                    $currentParent -eq
                    $targetFolderId
                ) {

                    $alreadyInTarget++


                    Write-Host (
                        "Already in target: " +
                        "$($doc.FileName)"
                    )

                    continue
                }


                # Avoid blindly overwriting a same-name file.
                $sameNameTarget =
                    @(
                        $targetChildren |
                        Where-Object {
                            $_.name -eq
                            $current.name
                        }
                    )


                if ($sameNameTarget.Count -gt 0) {

                    $conflicts +=
                        [PSCustomObject]@{

                            TenderId =
                                $plan.TenderId

                            SourceItem =
                                $doc.DriveItemId

                            FileName =
                                $doc.FileName

                            Reason =
                                "Same filename already exists in target folder"
                        }


                    Write-Warning (
                        "Same-name target already exists: " +
                        "$($doc.FileName)"
                    )


                    continue
                }


                Move-GraphItem `
                    -DriveId $driveId `
                    -ItemId $doc.DriveItemId `
                    -TargetParentId $targetFolderId |
                Out-Null


                $movedDocuments++


                $targetChildren +=
                    [PSCustomObject]@{
                        id =
                            $doc.DriveItemId

                        name =
                            $doc.FileName
                    }


                Write-Host (
                    "Moved document: " +
                    "$($doc.FileName)"
                )


                if ($DelayMs -gt 0) {

                    Start-Sleep `
                        -Milliseconds $DelayMs
                }
            }
        }
    }
    catch {

        $failures +=
            [PSCustomObject]@{

                TenderId =
                    $plan.TenderId

                Folder =
                    $plan.SourceFolderName

                Error =
                    $_.Exception.Message
            }


        Write-Error (
            "Move failed for '$($plan.SourceFolderName)': " +
            "$($_.Exception.Message)"
        )


        break
    }


    if ($DelayMs -gt 0) {

        Start-Sleep `
            -Milliseconds $DelayMs
    }
}


if ($conflicts.Count -gt 0) {

    $conflicts |
        Export-Csv `
            "$ReportDir\physical-move-conflicts.csv" `
            -NoTypeInformation
}


if ($failures.Count -gt 0) {

    $failures |
        Export-Csv `
            "$ReportDir\physical-move-failures.csv" `
            -NoTypeInformation


    throw (
        "Physical move stopped because of a Graph failure. " +
        "The script can be safely rerun because physical " +
        "locations are rediscovered on every execution."
    )
}


# ============================================================
# STEP 6
# VERIFY PHYSICAL LOCATION
# ============================================================

Write-Host ""

Write-Host (
    "[6/6] Verifying remaining $TargetDate " +
    "documents under $SourceDate..."
)


$remainingPhysical = @()


foreach ($doc in $physicalWrongDateDocs) {

    try {

        $item =
            Get-GraphItem `
                -DriveId $driveId `
                -ItemId $doc.DriveItemId


        $parentPath =
            "$($item.parentReference.path)".Replace(
                "\",
                "/"
            )


        $itemUrl =
            "$($item.webUrl)".Replace(
                "\",
                "/"
            )


        if (
            (
                $parentPath -like
                "*$expectedSourceFragment*"
            ) -or
            (
                $itemUrl -like
                "*$expectedSourceFragment*"
            )
        ) {

            $remainingPhysical +=
                [PSCustomObject]@{

                    TenderId =
                        $doc.CanonicalTenderId

                    DriveItemId =
                        $doc.DriveItemId

                    FileName =
                        "$($item.name)"

                    WebUrl =
                        "$($item.webUrl)"
                }
        }
    }
    catch {

        $remainingPhysical +=
            [PSCustomObject]@{

                TenderId =
                    $doc.CanonicalTenderId

                DriveItemId =
                    $doc.DriveItemId

                FileName =
                    $doc.FileName

                WebUrl =
                    "VERIFY_ERROR: " +
                    $_.Exception.Message
            }
    }


    if ($DelayMs -gt 0) {

        Start-Sleep `
            -Milliseconds $DelayMs
    }
}


if ($remainingPhysical.Count -gt 0) {

    $remainingPhysical |
        Export-Csv `
            "$ReportDir\remaining-physical-under-$SourceDate.csv" `
            -NoTypeInformation
}


Write-Host ""

Write-Host (
    "============================================================"
)

Write-Host (
    "PHYSICAL RECOVERY SUMMARY"
)

Write-Host (
    "============================================================"
)

Write-Host (
    "Initial physical wrong docs : " +
    "$($physicalWrongDateDocs.Count)"
)

Write-Host (
    "Whole tender folders moved  : " +
    "$movedWholeFolders"
)

Write-Host (
    "Individual documents moved  : " +
    "$movedDocuments"
)

Write-Host (
    "Already in target           : " +
    "$alreadyInTarget"
)

Write-Host (
    "Same-name conflicts         : " +
    "$($conflicts.Count)"
)

Write-Host (
    "Failures                    : " +
    "$($failures.Count)"
)

Write-Host (
    "Remaining physically in 09  : " +
    "$($remainingPhysical.Count)"
)

Write-Host (
    "Database writes             : 0"
)

Write-Host (
    "Tender247 API calls         : 0"
)

Write-Host (
    "============================================================"
)


if ($remainingPhysical.Count -eq 0) {

    Write-Host ""

    Write-Host (
        "SUCCESS: all TENDER247 documents whose " +
        "Supabase tender scraped_date=$TargetDate " +
        "have been moved out of $SourceDate."
    )
}
else {

    Write-Warning (
        "$($remainingPhysical.Count) item(s) " +
        "still remain physically under $SourceDate."
    )

    Write-Host (
        "See: " +
        "$ReportDir\remaining-physical-under-$SourceDate.csv"
    )

    if ($conflicts.Count -gt 0) {

        Write-Host (
            "Conflicts: " +
            "$ReportDir\physical-move-conflicts.csv"
        )
    }
}


Write-Host ""

Write-Host (
    "The $SourceDate DATE folder itself was NOT deleted."
)

Write-Host ""