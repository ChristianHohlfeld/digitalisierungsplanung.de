param([switch]$CompileOnly)

$ErrorActionPreference = "Stop"
$sourcePath = Join-Path $PSScriptRoot "ZustandRecorder.cs"
$source = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8

try {
    Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies @(
        "System.Windows.Forms",
        "System.Drawing",
        "WindowsBase",
        "UIAutomationClient",
        "UIAutomationTypes",
        "System.Web.Extensions"
    )
    if (-not $CompileOnly) {
        [ZustandProcessRecorder.Program]::Run()
    }
} catch {
    if ($CompileOnly) {
        Write-Error $_
        exit 1
    }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "Der Zustand-Recorder konnte nicht gestartet werden.`r`n`r`n$($_.Exception.Message)",
        "Zustand Prozessaufnahme",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}
