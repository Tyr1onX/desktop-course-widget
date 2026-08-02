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
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.UseShellExecute = $false
  foreach ($argument in $ArgumentList) {
    [void]$startInfo.ArgumentList.Add($argument)
  }
  $process = [Diagnostics.Process]::Start($startInfo)
  if (-not $process) {
    throw "Could not start command: $FilePath"
  }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "Command failed with exit code $($process.ExitCode)`: $FilePath $($ArgumentList -join ' ')"
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
$Icacls = Join-Path $env:SystemRoot 'System32/icacls.exe'
[string]$ResourceRoot = ''
$ResourceAclLocked = $false
$OriginalEnvironment = @{
  PATH = $env:PATH
  PYTHONHOME = $env:PYTHONHOME
  PYTHONPATH = $env:PYTHONPATH
  PYTHONNOUSERSITE = $env:PYTHONNOUSERSITE
  PYTHONDONTWRITEBYTECODE = $env:PYTHONDONTWRITEBYTECODE
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
  $ResourceRoot = $manifestFile.Directory.FullName
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

  $portablePython = Join-Path $ResourceRoot $manifest.pythonRelativePath
  $moduleRoot = Join-Path $ResourceRoot $manifest.moduleRootRelativePath
  $modelsRoot = Join-Path $ResourceRoot $manifest.modelCacheRelativePath
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

  # Match a normal installed application: bundled runtime and models are readable and executable,
  # but recognition must not rely on writing bytecode, logs, or refreshed model files beside them.
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  Invoke-Checked -FilePath $Icacls -ArgumentList @(
    $ResourceRoot,
    '/inheritance:r',
    '/grant:r',
    "*${currentSid}:(OI)(CI)RX",
    '/T',
    '/C'
  )
  $ResourceAclLocked = $true

  $pythonRoot = Split-Path -Parent $portablePython
  $env:PATH = $pythonRoot
  Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
  Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
  $env:PYTHONNOUSERSITE = '1'
  $env:PYTHONDONTWRITEBYTECODE = '1'
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

  # Restore inherited permissions before asking the generated uninstaller to remove the files.
  Invoke-Checked -FilePath $Icacls -ArgumentList @($ResourceRoot, '/inheritance:e', '/T', '/C')
  Invoke-Checked -FilePath $Icacls -ArgumentList @($ResourceRoot, '/reset', '/T', '/C')
  $ResourceAclLocked = $false

  $uninstaller = Get-ChildItem -LiteralPath $InstallRoot -Recurse -File |
    Where-Object { $_.Name -match '^(uninstall|unins.*)\.exe$' } |
    Select-Object -First 1
  if (-not $uninstaller) {
    throw "Installed application did not provide an uninstaller below $InstallRoot"
  }
  Invoke-Checked -FilePath $uninstaller.FullName -ArgumentList @('/S')

  $uninstallDeadline = [DateTime]::UtcNow.AddSeconds(30)
  while ((Test-Path -LiteralPath $portablePython -PathType Leaf) -and [DateTime]::UtcNow -lt $uninstallDeadline) {
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path -LiteralPath $portablePython -PathType Leaf) {
    throw "Uninstaller left the bundled OCR runtime behind: $portablePython"
  }
  if (Test-Path -LiteralPath $manifestFile.FullName -PathType Leaf) {
    throw "Uninstaller left the OCR component manifest behind: $($manifestFile.FullName)"
  }

  Write-Host "Installed OCR resource root: $ResourceRoot"
  Write-Host "Installed component version: $($manifest.componentVersion)"
  Write-Host "Installed component files: $($manifest.files.Count)"
  Write-Host "Offline OCR token count: $($report.tokenCount)"
  Write-Host 'Installed OCR resources remained usable with read/execute-only permissions.'
  Write-Host 'The generated uninstaller removed the bundled OCR runtime and manifest.'
} finally {
  if ($ResourceAclLocked -and $ResourceRoot -and (Test-Path -LiteralPath $ResourceRoot)) {
    & $Icacls $ResourceRoot '/inheritance:e' '/T' '/C' | Out-Null
    & $Icacls $ResourceRoot '/reset' '/T' '/C' | Out-Null
  }
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
