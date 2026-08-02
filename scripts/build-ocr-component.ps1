[CmdletBinding()]
param(
  [string]$Output = 'src-tauri/resources/ocr-component',
  [string]$BuildPython = 'python',
  [string]$ComponentVersion = 'windows-py31314-paddle331-ocr370-v1',
  [switch]$WarmModels
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PythonVersion = '3.13.14'
$PythonArchiveUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$PythonArchiveSha256 = '90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907'
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$OutputRoot = if ([IO.Path]::IsPathRooted($Output)) {
  [IO.Path]::GetFullPath($Output)
} else {
  [IO.Path]::GetFullPath((Join-Path $RepoRoot $Output))
}
$Requirements = Join-Path $RepoRoot 'experiments/screenshot_import/requirements-ocr-component.txt'
$LockVerifier = Join-Path $RepoRoot 'scripts/verify-ocr-component-lock.py'
$NoticeWriter = Join-Path $RepoRoot 'scripts/write-ocr-third-party-notices.py'
$SmokeScript = Join-Path $RepoRoot 'scripts/ocr-component-smoke.py'
$BuildTemp = Join-Path ([IO.Path]::GetTempPath()) "course-widget-ocr-component-$PID-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$PythonRoot = Join-Path $OutputRoot 'python'
$SitePackages = Join-Path $PythonRoot 'Lib/site-packages'
$AppRoot = Join-Path $OutputRoot 'app'
$ModelsRoot = Join-Path $OutputRoot 'models'
$SmokeRoot = Join-Path $BuildTemp 'smoke'

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

function Get-RelativeUnixPath {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Path
  )
  return [IO.Path]::GetRelativePath($Root, $Path).Replace('\', '/')
}

function Get-DirectoryFingerprint {
  param([Parameter(Mandatory = $true)][string]$Root)
  if (-not (Test-Path -LiteralPath $Root)) {
    return @()
  }
  return @(
    Get-ChildItem -LiteralPath $Root -Recurse -File |
      Sort-Object FullName |
      ForEach-Object {
        [ordered]@{
          path = Get-RelativeUnixPath -Root $Root -Path $_.FullName
          size = [int64]$_.Length
          sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
      }
  )
}

if (-not $IsWindows) {
  throw 'The OCR component can only be built on Windows.'
}
foreach ($requiredFile in @($Requirements, $LockVerifier, $NoticeWriter, $SmokeScript)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    throw "Missing OCR component build input: $requiredFile"
  }
}
if ($OutputRoot -eq $RepoRoot) {
  throw 'Refusing to replace the repository root.'
}

try {
  New-Item -ItemType Directory -Force -Path $BuildTemp | Out-Null
  if (Test-Path -LiteralPath $OutputRoot) {
    Remove-Item -LiteralPath $OutputRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $PythonRoot, $SitePackages, $AppRoot, $ModelsRoot, $SmokeRoot | Out-Null

  $hostVersion = & $BuildPython -c "import platform,sys; print(f'{sys.version_info.major}.{sys.version_info.minor}|{platform.machine()}|{sys.executable}')"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to query build Python: $BuildPython"
  }
  $hostParts = $hostVersion.Trim().Split('|')
  if ($hostParts.Count -ne 3 -or $hostParts[0] -ne '3.13' -or $hostParts[1] -notmatch '^(AMD64|x86_64)$') {
    throw "OCR component build requires Windows x64 Python 3.13, got: $hostVersion"
  }

  $archive = Join-Path $BuildTemp 'python-embed-amd64.zip'
  Invoke-WebRequest -Uri $PythonArchiveUrl -OutFile $archive -MaximumRetryCount 3 -RetryIntervalSec 5
  $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($archiveHash -ne $PythonArchiveSha256) {
    throw "Python embeddable archive hash mismatch: expected $PythonArchiveSha256, got $archiveHash"
  }
  Expand-Archive -LiteralPath $archive -DestinationPath $PythonRoot -Force

  $pthPath = Join-Path $PythonRoot 'python313._pth'
  if (-not (Test-Path -LiteralPath $pthPath -PathType Leaf)) {
    throw "Python embeddable path file was not found: $pthPath"
  }
  @(
    'python313.zip'
    '.'
    'Lib/site-packages'
    '../app'
    'import site'
  ) | Set-Content -LiteralPath $pthPath -Encoding utf8NoBOM

  $pipReport = Join-Path $BuildTemp 'pip-install-report.json'
  Invoke-Checked -FilePath $BuildPython -ArgumentList @(
    '-m', 'pip', 'install',
    '--disable-pip-version-check',
    '--no-compile',
    '--no-deps',
    '--only-binary=:all:',
    '--target', $SitePackages,
    '--report', $pipReport,
    '-r', $Requirements
  )
  Invoke-Checked -FilePath $BuildPython -ArgumentList @(
    $LockVerifier,
    '--lock', $Requirements,
    '--report', $pipReport,
    '--site-packages', $SitePackages
  )

  $experimentsTarget = Join-Path $AppRoot 'experiments'
  New-Item -ItemType Directory -Force -Path $experimentsTarget | Out-Null
  Copy-Item -LiteralPath (Join-Path $RepoRoot 'experiments/__init__.py') -Destination $experimentsTarget
  Copy-Item -LiteralPath (Join-Path $RepoRoot 'experiments/screenshot_import') -Destination $experimentsTarget -Recurse
  Remove-Item -LiteralPath (Join-Path $experimentsTarget 'screenshot_import/tests') -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -LiteralPath $AppRoot -Recurse -Directory -Filter '__pycache__' |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -LiteralPath $AppRoot -Recurse -File -Include '*.pyc', '*.pyo' |
    Remove-Item -Force -ErrorAction SilentlyContinue

  Invoke-Checked -FilePath $BuildPython -ArgumentList @(
    $NoticeWriter,
    '--component-root', $OutputRoot,
    '--site-packages', $SitePackages,
    '--python-root', $PythonRoot
  )

  $portablePython = Join-Path $PythonRoot 'python.exe'
  if (-not (Test-Path -LiteralPath $portablePython -PathType Leaf)) {
    throw 'Portable Python executable was not produced.'
  }

  $savedEnvironment = @{
    PATH = $env:PATH
    PYTHONHOME = $env:PYTHONHOME
    PYTHONPATH = $env:PYTHONPATH
    PYTHONNOUSERSITE = $env:PYTHONNOUSERSITE
    PADDLE_OCR_BASE_DIR = $env:PADDLE_OCR_BASE_DIR
    PADDLE_PDX_CACHE_HOME = $env:PADDLE_PDX_CACHE_HOME
    PADDLE_PDX_MODEL_SOURCE = $env:PADDLE_PDX_MODEL_SOURCE
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = $env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK
  }
  try {
    $env:PATH = $PythonRoot
    Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
    Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    $env:PYTHONNOUSERSITE = '1'
    $env:PADDLE_OCR_BASE_DIR = Join-Path $ModelsRoot 'paddleocr'
    $env:PADDLE_PDX_CACHE_HOME = Join-Path $ModelsRoot 'paddlex'
    $env:PADDLE_PDX_MODEL_SOURCE = 'BOS'

    Invoke-Checked -FilePath $portablePython -ArgumentList @(
      '-I', $SmokeScript,
      '--output', (Join-Path $SmokeRoot 'imports')
    )

    if ($WarmModels) {
      Remove-Item Env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK -ErrorAction SilentlyContinue
      Invoke-Checked -FilePath $portablePython -ArgumentList @(
        '-I', $SmokeScript,
        '--output', (Join-Path $SmokeRoot 'online'),
        '--inference'
      )
      $beforeOffline = Get-DirectoryFingerprint -Root $ModelsRoot | ConvertTo-Json -Depth 5 -Compress
      if ($beforeOffline -eq '[]') {
        throw 'PaddleOCR inference completed without producing a local model cache.'
      }

      $env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = '1'
      Invoke-Checked -FilePath $portablePython -ArgumentList @(
        '-I', $SmokeScript,
        '--output', (Join-Path $SmokeRoot 'offline'),
        '--inference'
      )
      $afterOffline = Get-DirectoryFingerprint -Root $ModelsRoot | ConvertTo-Json -Depth 5 -Compress
      if ($afterOffline -ne $beforeOffline) {
        throw 'The bundled model cache changed during the offline repeat run.'
      }
    }
  } finally {
    foreach ($name in $savedEnvironment.Keys) {
      $value = $savedEnvironment[$name]
      if ($null -eq $value) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
      } else {
        Set-Item "Env:$name" $value
      }
    }
  }

  $files = @(
    Get-ChildItem -LiteralPath $OutputRoot -Recurse -File |
      Where-Object { $_.Name -ne 'component.json' } |
      Sort-Object FullName |
      ForEach-Object {
        [ordered]@{
          path = Get-RelativeUnixPath -Root $OutputRoot -Path $_.FullName
          size = [int64]$_.Length
          sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
      }
  )
  if ($files.Count -eq 0) {
    throw 'OCR component contains no files.'
  }

  $manifest = [ordered]@{
    schemaVersion = 1
    available = $true
    componentVersion = $ComponentVersion
    platform = 'windows-x86_64'
    pythonRelativePath = 'python/python.exe'
    moduleRootRelativePath = 'app'
    modelCacheRelativePath = 'models'
    files = $files
  }
  $manifestPath = Join-Path $OutputRoot 'component.json'
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM

  [int64]$totalBytes = 0
  foreach ($file in $files) {
    $totalBytes += [int64]$file['size']
  }
  Write-Host "OCR component built at $OutputRoot"
  Write-Host "Component version: $ComponentVersion"
  Write-Host "Manifest files: $($files.Count)"
  Write-Host "Component bytes: $totalBytes"
  Write-Host "Models warmed: $([bool]$WarmModels)"
} finally {
  Remove-Item -LiteralPath $BuildTemp -Recurse -Force -ErrorAction SilentlyContinue
}
