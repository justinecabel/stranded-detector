$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $projectRoot 'data'
$stdoutLog = Join-Path $dataDirectory 'dev-server.log'
$stderrLog = Join-Path $dataDirectory 'dev-server-error.log'
$nodeCommand = Get-Command node -ErrorAction Stop

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

$serverProcess = Start-Process `
  -FilePath $nodeCommand.Source `
  -ArgumentList '--watch', 'src/server.js' `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Write-Output "Hidden development server started (PID $($serverProcess.Id))."
Write-Output "Logs: $stdoutLog"
