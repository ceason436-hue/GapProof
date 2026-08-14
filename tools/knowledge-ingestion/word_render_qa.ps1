param(
    [Parameter(Mandatory = $true)] [string] $InputRoot,
    [Parameter(Mandatory = $true)] [string] $ManifestPath,
    [Parameter(Mandatory = $true)] [string] $OutputRoot,
    [Parameter(Mandatory = $true)] [string] $ResultsPath
)

$ErrorActionPreference = 'Stop'
$inputResolved = (Resolve-Path -LiteralPath $InputRoot).Path
$manifestResolved = (Resolve-Path -LiteralPath $ManifestPath).Path
$outputResolved = [System.IO.Path]::GetFullPath($OutputRoot)
[System.IO.Directory]::CreateDirectory($outputResolved) | Out-Null

$manifest = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestResolved | ConvertFrom-Json
$docxRecords = @($manifest.files | Where-Object { $_.extension -eq '.docx' })

# Select one sample for each inferred role/class and one for each top-level source directory.
$selected = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$docxRecords | Group-Object classification | ForEach-Object {
    $sample = $_.Group | Sort-Object { $_.size_bytes } | Select-Object -Last 1
    if ($null -ne $sample) { [void] $selected.Add([string] $sample.relative_path) }
}
$docxRecords | Group-Object { ([string] $_.relative_path -split '/')[0] } | ForEach-Object {
    $sample = $_.Group | Sort-Object { $_.size_bytes } | Select-Object -Last 1
    if ($null -ne $sample) { [void] $selected.Add([string] $sample.relative_path) }
}

$word = $null
$results = [System.Collections.Generic.List[object]]::new()
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    try { $word.AutomationSecurity = 3 } catch {}

    $index = 0
    foreach ($record in $docxRecords) {
        $index++
        $relative = [string] $record.relative_path
        $source = Join-Path $inputResolved ($relative -replace '/', [System.IO.Path]::DirectorySeparatorChar)
        $doc = $null
        $status = 'failed'
        $pageCount = $null
        $pdfRelative = $null
        $errorText = $null
        $isSample = $selected.Contains($relative)
        try {
            $doc = $word.Documents.Open($source, $false, $true)
            $doc.Repaginate()
            $pageCount = [int] $doc.ComputeStatistics(2)
            $status = 'paginated'
            if ($isSample) {
                $safeClass = ([string] $record.classification) -replace '[^A-Za-z0-9_-]', '_'
                $pdfName = '{0:D3}-{1}.pdf' -f $index, $safeClass
                $pdfPath = Join-Path $outputResolved $pdfName
                $doc.ExportAsFixedFormat($pdfPath, 17)
                $pdfRelative = $pdfName
                $status = 'rendered'
            }
        } catch {
            $errorText = $_.Exception.Message
        } finally {
            if ($null -ne $doc) {
                try { $doc.Close(0) } catch {}
                [void] [Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc)
            }
        }
        $results.Add([pscustomobject]@{
            relative_path = $relative
            status = $status
            page_count = $pageCount
            page_count_method = 'microsoft_word_compute_statistics'
            selected_for_visual_qa = $isSample
            rendered_pdf = $pdfRelative
            visual_status = $(if ($isSample -and $status -eq 'rendered') { 'rendered_not_reviewed' } else { 'not_visually_reviewed' })
            renderer = 'microsoft_word_fallback'
            error = $errorText
        })
    }
} finally {
    if ($null -ne $word) {
        try { $word.Quit() } catch {}
        [void] [Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

$payload = [ordered]@{
    generated_at = [DateTimeOffset]::UtcNow.ToString('o')
    renderer = 'microsoft_word_fallback'
    note = 'Bundled documents renderer was attempted first but LibreOffice/soffice was unavailable.'
    files = $results
}
$json = $payload | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($ResultsPath), $json + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Output ("paginated={0}; rendered_samples={1}; failed={2}" -f @(
    ($results | Where-Object { $_.status -in @('paginated', 'rendered') }).Count,
    ($results | Where-Object { $_.status -eq 'rendered' }).Count,
    ($results | Where-Object { $_.status -eq 'failed' }).Count
))
