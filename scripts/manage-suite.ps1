param([switch]$Uninstall, [switch]$Check, [ValidateSet("beauty", "extensions", "full")][string]$Bundle)
$ErrorActionPreference = "Stop"
$repo_root = Split-Path $PSScriptRoot -Parent
$script_path = Join-Path $repo_root "scripts\install-suite.mjs"
$node_command = Get-Command node.exe -ErrorAction SilentlyContinue
$old_electron_mode = $env:ELECTRON_RUN_AS_NODE
try {
    if ($node_command) {
        $runtime_path = $node_command.Source
    } else {
        $runtime_path = Join-Path $env:LOCALAPPDATA "Programs\DSH Desktop\DSH Desktop.exe"
        if (-not (Test-Path -LiteralPath $runtime_path)) { throw "Install DSH Desktop or Node.js 22.19+ / 24+ first." }
        $env:ELECTRON_RUN_AS_NODE = "1"
    }
    $script_args = @($script_path)
    if ($Uninstall) { $script_args += "--uninstall" }
    if ($Check) { $script_args += "--check" }
    if ($Bundle) { $script_args += @("--bundle", $Bundle) }
    & $runtime_path @script_args | Out-Host
    $result_code = $LASTEXITCODE
} finally {
    $env:ELECTRON_RUN_AS_NODE = $old_electron_mode
}
exit $result_code
