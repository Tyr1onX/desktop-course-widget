[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$WorkingRoot = (Join-Path $env:RUNNER_TEMP "course-widget-ocr-installer-$PID")
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList
  )
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($ArgumentList -join ' ')"
  }
}

function Get-DirectoryFingerprint {
  param([Parameter(Mandatory = $true)][string]$Root)
  return @(
    Get-ChildItem -LiteralPath $Root -Recurse -File |
      Sort-Object FullName |
      ForEach-Object {
        $relative = [IO.Path]::GetRelativePath($Root, $_.FullName).Replace('\', '/')
        "$relative|$($_.Length)|$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
      }
  )
}

if (-not $IsWindows) {
  throw 'The OCR-enabled installer smoke test requires Windows.'
}
$InstallerPath = [IO.Path]::GetFullPath($Installer)
if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
  throw "Installer not found: $InstallerPath"
}

$InstallRoot = Join-Path $WorkingRoot 'install'
$SmokeRoot = Join-Path $WorkingRoot 'smoke'
$OriginalEnvironment = @{
  PATH = $env:PATH
  PYTHONHOME = $env:PYTHONHOME
  PYTHONPATH = $env:PYTHONPATH
  PYTHONNOUSERSITE = $env:PYTHONNOUSERSITE
  PYTHONIOENCODING = $env:PYTHONIOENCODING
  HTTP_PROXY = $env:HTTP_PROXY
  HTTPS_PROXY = $env:HTTPS_PROXY
  ALL_PROXY = $env:ALL_PROXY
  NO_PROXY = $env:NO_PROXY
  PADDLE_OCR_BASE_DIR = $env:PADDLE_OCR_BASE_DIR
  PADDLE_PDX_CACHE_HOME = $env:PADDLE_PDX_CACHE_HOME
  PADDLE_PDX_MODEL_SOURCE = $env:PADDLE_PDX_MODEL_SOURCE
  PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = $env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK
}

try {
  Remove-Item -LiteralPath $WorkingRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $InstallRoot, $SmokeRoot | Out-Null

  # NSIS requires /D to be the final argument and does not accept quotes around its value.
  Invoke-Checked -FilePath $InstallerPath -ArgumentList @('/S', "/D=$InstallRoot")

  $manifestFile = Get-ChildItem -LiteralPath $InstallRoot -Recurse -File -Filter 'component.json' |
    Where-Object { $_.Directory.Name -eq 'ocr-component' } |
    Select-Object -First 1
  if (-not $manifestFile) {
    throw "Installed OCR component manifest was not found below $InstallRoot"
  }
  $resourceRoot = $manifestFile.Directory.FullName
  $manifest = Get-Content -LiteralPath $manifestFile.FullName -Raw | ConvertFrom-Json
  if ($manifest.available -ne $true) {
    throw 'Installed OCR component manifest is not available.'
  }
  if ($manifest.platform -ne 'windows-x86_64') {
    throw "Installed OCR component platform is invalid: $($manifest.platform)"
  }
  if ($manifest.files.Count -lt 100) {
    throw "Installed OCR component contains too few files: $($manifest.files.Count)"
  }

  $portablePython = Join-Path $resourceRoot $manifest.pythonRelativePath
  $moduleRoot = Join-Path $resourceRoot $manifest.moduleRootRelativePath
  $modelsRoot = Join-Path $resourceRoot $manifest.modelCacheRelativePath
  if (-not (Test-Path -LiteralPath $portablePython -PathType Leaf)) {
    throw "Installed portable Python is missing: $portablePython"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $moduleRoot 'experiments/screenshot_import') -PathType Container)) {
    throw "Installed screenshot import module is missing: $moduleRoot"
  }
  if (-not (Test-Path -LiteralPath $modelsRoot -PathType Container)) {
    throw "Installed OCR model cache is missing: $modelsRoot"
  }

  $before = Get-DirectoryFingerprint -Root $modelsRoot

  $pythonRoot = Split-Path -Parent $portablePython
  $env:PATH = $pythonRoot
  Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
  Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
  $env:PYTHONNOUSERSITE = '1'
  $env:PYTHONIOENCODING = 'utf-8'
  $env:HTTP_PROXY = 'http://127.0.0.1:9'
  $env:HTTPS_PROXY = 'http://127.0.0.1:9'
  $env:ALL_PROXY = 'http://127.0.0.1:9'
  $env:NO_PROXY = ''
  $env:PADDLE_OCR_BASE_DIR = Join-Path $modelsRoot 'paddleocr'
  $env:PADDLE_PDX_CACHE_HOME = Join-Path $modelsRoot 'paddlex'
  $env:PADDLE_PDX_MODEL_SOURCE = 'BOS'
  $env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = '1'

  $smokeScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/ocr-component-smoke.py'
  Invoke-Checked -FilePath $portablePython -ArgumentList @(
    '-I', $smokeScript,
    '--output', $SmokeRoot,
    '--inference'
  )

  $after = Get-DirectoryFingerprint -Root $modelsRoot
  if (Compare-Object -ReferenceObject $before -DifferenceObject $after) {
    throw 'Installed OCR model cache changed during the blocked-network smoke run.'
  }

  $report = Get-Content -LiteralPath (Join-Path $SmokeRoot 'portable-ocr-smoke.json') -Raw | ConvertFrom-Json
  if ($report.tokenCount -lt 4) {
    throw "Installed OCR runtime returned too few tokens: $($report.tokenCount)"
  }
  if (-not ([IO.Path]::GetFullPath($report.executable)).StartsWith([IO.Path]::GetFullPath($InstallRoot), [StringComparison]::OrdinalIgnoreCase)) {
    throw "Smoke test used a Python outside the installed application: $($report.executable)"
  }

  $uninstaller = Get-ChildItem -LiteralPath $InstallRoot -Recurse -File |
    Where-Object { $_.Name -match '^(uninstall|unins.*)\.exe$' } |
    Select-Object -First 1
  if ($uninstaller) {
    Invoke-Checked -FilePath $uninstaller.FullName -ArgumentList @('/S')
  }

  Write-Host "Installed OCR resource root: $resourceRoot"
  Write-Host "Installed component version: $($manifest.componentVersion)"
  Write-Host "Installed component files: $($manifest.files.Count)"
  Write-Host "Offline OCR token count: $($report.tokenCount)"
} finally {
  foreach ($name in $OriginalEnvironment.Keys) {
    $value = $OriginalEnvironment[$name]
    if ($null -eq $value) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item "Env:$name" $value
    }
  }
  Remove-Item -LiteralPath $WorkingRoot -Recurse -Force -ErrorAction SilentlyContinue
}
