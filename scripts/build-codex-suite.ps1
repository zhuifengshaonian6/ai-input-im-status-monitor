param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$modulePaths = @(
  (Join-Path $Root "codex-plus-plus/status-model-auto-switch.js"),
  (Join-Path $Root "codex-plus-plus/codex-task-recovery.js")
)
$target = Join-Path $Root "codex-plus-plus/codex-status-suite.js"
$header = @"
/*
@codex-plus-script
name: AI.INPUT.IM Codex Status Suite
description: Monitor model health, switch to the first healthy model, and resume interrupted Codex tasks.
version: 0.4.0
author: AI.INPUT.IM Status Monitor
*/

"@

$modules = foreach ($path in $modulePaths) {
  $source = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  $source -replace "(?s)^/\*.*?\*/\s*", ""
}

Set-Content -LiteralPath $target -Value ($header + ($modules -join "`n")) -Encoding UTF8
