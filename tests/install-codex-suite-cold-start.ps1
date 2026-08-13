param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Continue"
$codexRoot = Join-Path $env:APPDATA "Codex++"
$registry = Join-Path $codexRoot "user_scripts.json"
$scriptsDir = Join-Path $codexRoot "user_scripts"
$quarantine = Join-Path $codexRoot "quarantine"
$launcher = Join-Path $env:LOCALAPPDATA "Programs\Codex++\codex-plus-plus.exe"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $quarantine "suite-cold-$stamp"
$log = Join-Path $runDir "audit.log"
$backupRegistry = Join-Path $runDir "user_scripts.json"
$suiteSource = Join-Path $ProjectRoot "codex-plus-plus\codex-status-suite.js"
$probe = Join-Path $ProjectRoot "tests\local-codex-probe.cjs"
$targetNames = @(
  "status-model-auto-switch.js",
  "codex-task-recovery.js",
  "codex-status-suite.js"
)

New-Item -ItemType Directory -Force -Path $runDir | Out-Null
Copy-Item -LiteralPath $registry -Destination $backupRegistry -Force
foreach ($name in $targetNames) {
  $path = Join-Path $scriptsDir $name
  if (Test-Path $path) {
    Copy-Item -LiteralPath $path -Destination (Join-Path $runDir $name) -Force
  }
}

function Write-Log([string]$Message) {
  $Message | Add-Content -LiteralPath $log -Encoding UTF8
}

function Stop-CodexRuntime {
  Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq "codex-plus-plus.exe" -and
      $_.ExecutablePath -like "$env:LOCALAPPDATA\Programs\Codex++\*") -or
    $_.ExecutablePath -like "C:\Program Files\WindowsApps\OpenAI.Codex_*"
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 4
}

function Update-Registry {
  $source = Get-Content -LiteralPath $registry -Raw -Encoding UTF8
  $data = $source | ConvertFrom-Json
  $next = [ordered]@{}
  foreach ($property in $data.scripts.psobject.Properties) {
    if ($property.Name -notin @(
      "user:status-model-auto-switch.js",
      "user:codex-task-recovery.js",
      "user:codex-status-suite.js"
    )) {
      $next[$property.Name] = $property.Value
    }
  }
  $next["user:codex-status-suite.js"] = $true
  $data.scripts = [pscustomobject]$next
  $data | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $registry -Encoding UTF8
}

function Restore-Backup {
  Stop-CodexRuntime
  Copy-Item -LiteralPath $backupRegistry -Destination $registry -Force
  foreach ($name in $targetNames) {
    $path = Join-Path $scriptsDir $name
    $backup = Join-Path $runDir $name
    if (Test-Path $backup) {
      Copy-Item -LiteralPath $backup -Destination $path -Force
    } else {
      Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Process -FilePath $launcher -WindowStyle Hidden
}

function Find-DebugPort {
  $cpp = Get-CimInstance Win32_Process |
    Where-Object Name -eq "codex-plus-plus.exe" |
    Sort-Object CreationDate -Descending |
    Select-Object -First 1
  if (-not $cpp) { return $null }
  $main = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "ChatGPT.exe" -and
    $_.ParentProcessId -eq $cpp.ProcessId -and
    $_.CommandLine -notmatch "--type="
  } | Select-Object -First 1
  if ($main -and $main.CommandLine -match "--remote-debugging-port=(\d+)") {
    return $Matches[1]
  }
  return $null
}

function Invoke-Probe([string]$Port) {
  $output = & node $probe $Port both 2>&1
  return @{
    Ok = $LASTEXITCODE -eq 0
    Output = ($output -join " ")
  }
}

"START=$(Get-Date -Format o)" | Set-Content -LiteralPath $log -Encoding UTF8
Write-Log "BACKUP=$backupRegistry"

try {
  Stop-CodexRuntime
  Update-Registry
  Copy-Item -LiteralPath $suiteSource -Destination (Join-Path $scriptsDir "codex-status-suite.js") -Force
  Remove-Item -LiteralPath (Join-Path $scriptsDir "status-model-auto-switch.js") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $scriptsDir "codex-task-recovery.js") -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $launcher -WindowStyle Hidden

  $ready = $false
  $port = $null
  for ($attempt = 1; $attempt -le 60; $attempt += 1) {
    Start-Sleep -Seconds 2
    $port = Find-DebugPort
    if (-not $port) { continue }
    $result = Invoke-Probe $port
    if ($result.Ok) {
      $ready = $true
      Write-Log "READY_ATTEMPT=$attempt PORT=$port OUTPUT=$($result.Output)"
      break
    }
  }
  if (-not $ready) { throw "Merged suite did not become ready" }

  for ($check = 1; $check -le 10; $check += 1) {
    if ($check -gt 1) { Start-Sleep -Seconds 6 }
    $ok = $false
    for ($retry = 1; $retry -le 5; $retry += 1) {
      $result = Invoke-Probe $port
      if ($result.Ok) { $ok = $true; break }
      Start-Sleep -Seconds 2
    }
    Write-Log "CHECK=$check OK=$ok RETRY=$retry OUTPUT=$($result.Output)"
    if (-not $ok) { throw "Merged suite failed check $check" }
  }

  $current = Get-Content -LiteralPath $registry -Raw -Encoding UTF8 | ConvertFrom-Json
  $targetKeys = @($current.scripts.psobject.Properties.Name | Where-Object {
    $_ -match "status-model-auto-switch|codex-task-recovery|codex-status-suite"
  })
  if ($targetKeys.Count -ne 1 -or $targetKeys[0] -ne "user:codex-status-suite.js") {
    throw "Codex++ did not preserve the merged suite registry entry"
  }
  Write-Log "TARGET_KEYS=$($targetKeys -join ',')"
  Write-Log "RESULT=PASS"
  Write-Log "END=$(Get-Date -Format o)"
  exit 0
} catch {
  Write-Log "ERROR=$($_.Exception.Message)"
  Write-Log "RESULT=ROLLBACK"
  Restore-Backup
  exit 2
}
