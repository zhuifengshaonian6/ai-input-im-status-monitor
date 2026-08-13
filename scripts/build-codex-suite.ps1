param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$modulePaths = @(
  (Join-Path $Root "codex-plus-plus/status-model-auto-switch.js"),
  (Join-Path $Root "codex-plus-plus/codex-task-recovery.js"),
  (Join-Path $Root "codex-plus-plus/codex-status-suite-ui.js")
)
$target = Join-Path $Root "codex-plus-plus/codex-status-suite.js"
$header = @"
/*
@codex-plus-script
name: AI.INPUT.IM Codex Status Suite
description: Monitor model health, switch to the first healthy model, and resume interrupted Codex tasks.
version: 0.5.1
author: AI.INPUT.IM Status Monitor
*/

"@

$modules = foreach ($path in $modulePaths) {
  $source = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  $source -replace "(?s)^/\*.*?\*/\s*", ""
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
$output = ($header + ($modules -join "
")).TrimEnd("`r", "
") + "
"
[System.IO.File]::WriteAllText($target, $output, $utf8)
