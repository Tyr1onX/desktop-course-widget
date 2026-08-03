[CmdletBinding()]
param(
  [string]$Python = 'python',
  [string]$WorkingRoot = (Join-Path $env:RUNNER_TEMP "course-widget-ocr-bootstrap-$PID")
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IsWindows) { throw 'The OCR development bootstrap regression test requires Windows.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$venvRoot = Join-Path $WorkingRoot '普通 venv'
$unrelatedRoot = Join-Path $WorkingRoot '无关当前目录'
$venvPython = Join-Path $venvRoot 'Scripts/python.exe'
$bootstrap = "import runpy,sys;root=sys.argv.pop(1);module=sys.argv.pop(1);sys.path.insert(0,root);runpy.run_module(module,run_name='__main__')"

try {
  Remove-Item -LiteralPath $WorkingRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $WorkingRoot, $unrelatedRoot | Out-Null
  & $Python -m venv $venvRoot
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    throw 'Could not create a normal Windows development venv.'
  }

  Push-Location $unrelatedRoot
  try {
    & $venvPython -I -B -m experiments.screenshot_import.bootstrap_probe 2>$null
    if ($LASTEXITCODE -eq 0) {
      throw 'The regression precondition is invalid: plain -I -m unexpectedly found the repository package.'
    }

    $output = & $venvPython -I -B -c $bootstrap $repoRoot experiments.screenshot_import.bootstrap_probe
    if ($LASTEXITCODE -ne 0) {
      throw 'The explicit isolated bootstrap could not load the repository module.'
    }
  } finally {
    Pop-Location
  }

  $report = ($output | Select-Object -Last 1) | ConvertFrom-Json
  if ($report.ok -ne $true) { throw 'Development bootstrap probe did not report success.' }
  if ($report.isolated -ne $true) { throw 'Development bootstrap did not preserve Python isolated mode.' }
  if ($report.module -ne '__main__') { throw "Unexpected bootstrap module name: $($report.module)" }
  Write-Host 'Normal venv + python -I -B works through the explicit absolute-path bootstrap.'
} finally {
  Remove-Item -LiteralPath $WorkingRoot -Recurse -Force -ErrorAction SilentlyContinue
}
