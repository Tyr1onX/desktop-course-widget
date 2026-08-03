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

function Set-ResourceFilesReadOnly {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][bool]$ReadOnly
  )
  Get-ChildItem -LiteralPath $Root -Recurse -File | ForEach-Object {
    $_.IsReadOnly = $ReadOnly
  }
}

function Get-RegisteredInstallRoot {
  $subKeyPath = 'Software\Tyr1onX\课刻'
  foreach ($hive in @(
    [Microsoft.Win32.RegistryHive]::CurrentUser,
    [Microsoft.Win32.RegistryHive]::LocalMachine
  )) {
    foreach ($view in @(
      [Microsoft.Win32.RegistryView]::Registry64,
      [Microsoft.Win32.RegistryView]::Registry32
    )) {
      $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      try {
        $productKey = $baseKey.OpenSubKey($subKeyPath)
        if ($productKey) {
          try {
            $value = $productKey.GetValue('')
            if ($value) {
              return [string]$value
            }
          } finally {
            $productKey.Dispose()
          }
        }
      } finally {
        $baseKey.Dispose()
      }
    }
  }
  return $null
}

function Wait-ForRegisteredInstallRoot {
  param([int]$TimeoutSeconds = 120)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $registeredRoot = Get-RegisteredInstallRoot
    if ($registeredRoot -and (Test-Path -LiteralPath $registeredRoot -PathType Container)) {
      return [IO.Path]::GetFullPath($registeredRoot)
    }
    Start-Sleep -Seconds 1
  }
  throw 'The NSIS installer exited without registering a usable installation directory.'
}

function Wait-ForInstalledComponent {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [int]$TimeoutSeconds = 180
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $nextProgressAt = [DateTime]::UtcNow
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) {
      try {
        $candidate = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
        $files = @($candidate.files)
        if ($candidate.available -eq $true -and $files.Count -ge 100) {
          $complete = $true
          foreach ($file in $files) {
            $relativePath = ([string]$file.path).Replace('/', '\')
            $installedPath = Join-Path $Root $relativePath
            if (-not (Test-Path -LiteralPath $installedPath -PathType Leaf)) {
              $complete = $false
              break
            }
            if ((Get-Item -LiteralPath $installedPath).Length -ne [int64]$file.size) {
              $complete = $false
              break
            }
          }
          if ($complete) {
            Write-Host "Installed OCR component is complete: $($files.Count) manifest files"
            return $candidate
          }
        }
      } catch {
        # The manifest itself can become visible before the installer has finished flushing it.
      }
    }

    if ([DateTime]::UtcNow -ge $nextProgressAt) {
      $observedCount = @(Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue).Count
      Write-Host "Waiting for installed OCR resources: $observedCount files currently visible"
      $nextProgressAt = [DateTime]::UtcNow.AddSeconds(30)
    }
    Start-Sleep -Seconds 1
  }

  $finalObservedCount = @(Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue).Count
  throw "Installed OCR component did not finish materializing before timeout: $ManifestPath (observed files: $finalObservedCount)"
}

if (-not $IsWindows) {
  throw 'The OCR-enabled installer smoke test requires Windows.'
}
$InstallerPath = [IO.Path]::GetFullPath($Installer)
if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
  throw "Installer not found: $InstallerPath"
}

$RequestedInstallRoot = Join-Path $WorkingRoot 'install'
$SmokeRoot = Join-Path $WorkingRoot 'smoke'
[string]$InstallRoot = ''
[string]$ResourceRoot = ''
$ResourcesReadOnly = $false
$UninstallCompleted = $false
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
  $existingInstallRoot = Get-RegisteredInstallRoot
  if ($existingInstallRoot) {
    throw "The installer smoke test requires a clean machine, but an existing 课刻 installation is registered at $existingInstallRoot"
  }

  Remove-Item -LiteralPath $WorkingRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $RequestedInstallRoot, $SmokeRoot | Out-Null

  # NSIS accepts /D only as the final argument. Tauri records the authoritative $INSTDIR in its
  # publisher/product registry key, so read that value after installation instead of assuming the
  # requested directory was honored by every NSIS execution path.
  Invoke-Checked -FilePath $InstallerPath -ArgumentList @('/S', "/D=$RequestedInstallRoot")
  $InstallRoot = Wait-ForRegisteredInstallRoot
  Write-Host "NSIS registered install root: $InstallRoot"

  # tauri.conf.json maps resources/ocr-component directly to the install-root/ocr-component
  # destination. Keep this smoke test aligned with the same primary layout the application resolves.
  $ResourceRoot = Join-Path $InstallRoot 'ocr-component'
  $manifestPath = Join-Path $ResourceRoot 'component.json'
  # Treat installation as complete only after every manifest-listed file exists at its declared
  # size. This protects the smoke test from both asynchronous extraction and partial installations.
  $manifest = Wait-ForInstalledComponent -Root $ResourceRoot -ManifestPath $manifestPath
  $manifestFile = Get-Item -LiteralPath $manifestPath
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
  $noticeFile = Join-Path $ResourceRoot 'THIRD_PARTY_NOTICES.txt'
  $inventoryFile = Join-Path $ResourceRoot 'third-party-packages.json'
  if (-not (Test-Path -LiteralPath $portablePython -PathType Leaf)) {
    throw "Installed portable Python is missing: $portablePython"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $moduleRoot 'experiments/screenshot_import') -PathType Container)) {
    throw "Installed screenshot import module is missing: $moduleRoot"
  }
  if (-not (Test-Path -LiteralPath $modelsRoot -PathType Container)) {
    throw "Installed OCR model cache is missing: $modelsRoot"
  }
  if (-not (Test-Path -LiteralPath $noticeFile -PathType Leaf)) {
    throw "Installed third-party notices are missing: $noticeFile"
  }
  if (-not (Test-Path -LiteralPath $inventoryFile -PathType Leaf)) {
    throw "Installed third-party package inventory is missing: $inventoryFile"
  }

  $inventory = Get-Content -LiteralPath $inventoryFile -Raw | ConvertFrom-Json
  if ($inventory.packageCount -lt 60) {
    throw "Installed OCR package inventory is unexpectedly small: $($inventory.packageCount)"
  }

  # File attributes are portable across current-user and Program Files-style installs. Combined with
  # PYTHONDONTWRITEBYTECODE and a full tree fingerprint, this catches any attempt to mutate or add
  # runtime/model files without relying on runner-specific ACL privileges.
  $before = Get-DirectoryFingerprint -Root $ResourceRoot
  Set-ResourceFilesReadOnly -Root $ResourceRoot -ReadOnly $true
  $ResourcesReadOnly = $true

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

  $after = Get-DirectoryFingerprint -Root $ResourceRoot
  if (Compare-Object -ReferenceObject $before -DifferenceObject $after) {
    throw 'Installed OCR resource tree changed during the blocked-network, read-only smoke run.'
  }

  $report = Get-Content -LiteralPath (Join-Path $SmokeRoot 'portable-ocr-smoke.json') -Raw | ConvertFrom-Json
  if ($report.tokenCount -lt 4) {
    throw "Installed OCR runtime returned too few tokens: $($report.tokenCount)"
  }
  if (-not ([IO.Path]::GetFullPath($report.executable)).StartsWith([IO.Path]::GetFullPath($InstallRoot), [StringComparison]::OrdinalIgnoreCase)) {
    throw "Smoke test used a Python outside the installed application: $($report.executable)"
  }

  Set-ResourceFilesReadOnly -Root $ResourceRoot -ReadOnly $false
  $ResourcesReadOnly = $false

  $uninstaller = Get-ChildItem -LiteralPath $InstallRoot -Recurse -File |
    Where-Object { $_.Name -match '^(uninstall|unins.*)\.exe$' } |
    Select-Object -First 1
  if (-not $uninstaller) {
    throw "Installed application did not provide an uninstaller below $InstallRoot"
  }
  Invoke-Checked -FilePath $uninstaller.FullName -ArgumentList @('/S')

  $uninstallDeadline = [DateTime]::UtcNow.AddSeconds(60)
  while ((Test-Path -LiteralPath $portablePython -PathType Leaf) -and [DateTime]::UtcNow -lt $uninstallDeadline) {
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path -LiteralPath $portablePython -PathType Leaf) {
    throw "Uninstaller left the bundled OCR runtime behind: $portablePython"
  }
  if (Test-Path -LiteralPath $manifestFile.FullName -PathType Leaf) {
    throw "Uninstaller left the OCR component manifest behind: $($manifestFile.FullName)"
  }
  $UninstallCompleted = $true

  Write-Host "Installed OCR resource root: $ResourceRoot"
  Write-Host "Installed component version: $($manifest.componentVersion)"
  Write-Host "Installed component files: $($manifest.files.Count)"
  Write-Host "Installed third-party packages: $($inventory.packageCount)"
  Write-Host "Offline OCR token count: $($report.tokenCount)"
  Write-Host 'Installed OCR resources remained byte-for-byte unchanged while every resource file was read-only.'
  Write-Host 'The generated uninstaller removed the bundled OCR runtime and manifest.'
} finally {
  if ($ResourcesReadOnly -and $ResourceRoot -and (Test-Path -LiteralPath $ResourceRoot)) {
    Set-ResourceFilesReadOnly -Root $ResourceRoot -ReadOnly $false
  }

  if (-not $UninstallCompleted -and $InstallRoot -and (Test-Path -LiteralPath $InstallRoot)) {
    $fallbackUninstaller = Get-ChildItem -LiteralPath $InstallRoot -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^(uninstall|unins.*)\.exe$' } |
      Select-Object -First 1
    if ($fallbackUninstaller) {
      try {
        Invoke-Checked -FilePath $fallbackUninstaller.FullName -ArgumentList @('/S')
      } catch {
        Write-Warning "Fallback uninstall failed: $($_.Exception.Message)"
      }
    }
  }

  foreach ($name in $OriginalEnvironment.Keys) {
    $value = $OriginalEnvironment[$name]
    if ($null -eq $value) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item "Env:$name" $value
    }
  }

  # NSIS may finish deleting its temporary install tree after uninstall.exe exits. Retry only while
  # the working root still exists so a disappearing child is not reported as a failed smoke test.
  for ($cleanupAttempt = 0; $cleanupAttempt -lt 60; $cleanupAttempt++) {
    if (-not (Test-Path -LiteralPath $WorkingRoot)) {
      break
    }
    try {
      Remove-Item -LiteralPath $WorkingRoot -Recurse -Force -ErrorAction Stop
      break
    } catch {
      if (-not (Test-Path -LiteralPath $WorkingRoot)) {
        break
      }
      if ($cleanupAttempt -eq 59) {
        throw
      }
      Start-Sleep -Milliseconds 500
    }
  }
}
