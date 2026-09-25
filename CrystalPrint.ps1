param(
    [string]$SaleId = ""
)

# ── CHANGE THIS PATH TO MATCH YOUR ACTUAL LOCATION ──────────
$rptFile     = "C:\Projects\ProductManager\cashbill.rpt"
$sqlServer   = "DESKTOP-7R3PM7R"
$sqlDatabase = "ProductsmanageDB"
$sqlUser     = "sa"
$sqlPassword = "123"

Write-Host "INFO: SaleId     = $SaleId"
Write-Host "INFO: RPT file   = $rptFile"
Write-Host "INFO: SQL Server = $sqlServer"

# ── Validate inputs ─────────────────────────────────────────
if ($SaleId -eq "") {
    Write-Error "ERROR: No SaleId passed to script"
    exit 1
}

if (!(Test-Path $rptFile)) {
    Write-Error "ERROR: cashbill.rpt not found at: $rptFile"
    exit 1
}

# ── Test Crystal Reports COM registration ───────────────────
Write-Host "INFO: Testing Crystal Reports COM object..."
try {
    $testCR = New-Object -ComObject "CrystalRuntime.Application.1"
    Write-Host "INFO: Crystal Reports COM found OK"
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($testCR) | Out-Null
} catch {
    Write-Error "ERROR: Crystal Reports Runtime NOT installed or COM not registered. Install SAP Crystal Reports Runtime. Details: $_"
    exit 1
}

# ── Print ────────────────────────────────────────────────────
try {
    Write-Host "INFO: Opening report..."
    $crApp  = New-Object -ComObject "CrystalRuntime.Application.1"
    $report = $crApp.OpenReport($rptFile, 1)

    Write-Host "INFO: Setting database login for all tables..."
    $tables = $report.Database.Tables
    for ($i = 1; $i -le $tables.Count; $i++) {
        $table = $tables.Item($i)
        $table.SetLogOnInfo($sqlServer, $sqlDatabase, $sqlUser, $sqlPassword)
        Write-Host "INFO: Table $i login set"
    }

    $report.SetParameterValue("SaleId", $SaleId)
    Write-Host "INFO: Record filter set to SaleId = $SaleId"

    Write-Host "INFO: Sending to printer..."
    $report.PrintOut($true, 1, $false, 0, 0)

    Write-Host "SUCCESS: Bill printed for SaleId $SaleId"

    $report.Close()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($report) | Out-Null
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($crApp)  | Out-Null
    [System.GC]::Collect()
    exit 0

} catch {
    Write-Error "PRINT FAILED: $_"
    exit 1
}