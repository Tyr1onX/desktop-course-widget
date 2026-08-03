param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$WorkingRoot = (Join-Path $env:RUNNER_TEMP "课刻-OCR-应用级-$PID")
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = ''
  )
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.UseShellExecute = $false
  if ($WorkingDirectory) { $startInfo.WorkingDirectory = $WorkingDirectory }
  foreach ($argument in $ArgumentList) { [void]$startInfo.ArgumentList.Add($argument) }
  $process = [Diagnostics.Process]::Start($startInfo)
  if (-not $process) { throw "Could not start $FilePath" }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "$FilePath exited with code $($process.ExitCode)"
  }
}

function Get-RegisteredInstallRoot {
  $uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($root in $uninstallRoots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($entry in Get-ChildItem $root -ErrorAction SilentlyContinue) {
      $item = Get-ItemProperty $entry.PSPath -ErrorAction SilentlyContinue
      if ($item.DisplayName -ne '课刻') { continue }
      if ($item.InstallLocation -and (Test-Path -LiteralPath $item.InstallLocation)) {
        return [IO.Path]::GetFullPath([string]$item.InstallLocation)
      }
      if ($item.UninstallString) {
        $match = [regex]::Match([string]$item.UninstallString, '^"?([^" ]+uninstall\.exe)"?', 'IgnoreCase')
        if ($match.Success) {
          $candidate = Split-Path -Parent $match.Groups[1].Value
          if (Test-Path -LiteralPath $candidate) { return [IO.Path]::GetFullPath($candidate) }
        }
      }
    }
  }
  return $null
}

function Wait-ForRegisteredInstallRoot {
  $deadline = [DateTime]::UtcNow.AddMinutes(3)
  while ([DateTime]::UtcNow -lt $deadline) {
    $root = Get-RegisteredInstallRoot
    if ($root) { return $root }
    Start-Sleep -Milliseconds 500
  }
  throw 'Installed application did not register an install root.'
}

function Wait-ForInstalledComponent {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$ManifestPath
  )
  $deadline = [DateTime]::UtcNow.AddMinutes(3)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) {
      try {
        $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
        $python = Join-Path $Root $manifest.pythonRelativePath
        $models = Join-Path $Root $manifest.modelCacheRelativePath
        if ((Test-Path -LiteralPath $python -PathType Leaf) -and (Test-Path -LiteralPath $models -PathType Container)) {
          return $manifest
        }
      } catch {
        # NSIS may still be copying the large component.
      }
    }
    Start-Sleep -Milliseconds 500
  }
  throw 'Installed OCR component did not become complete before the timeout.'
}

function Get-AppExecutable {
  param([Parameter(Mandatory = $true)][string]$InstallRoot)
  $candidate = Join-Path $InstallRoot '课刻.exe'
  if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  $fallback = Get-ChildItem -LiteralPath $InstallRoot -Filter '*.exe' -File |
    Where-Object { $_.Name -notmatch '^(uninstall|unins)' } |
    Select-Object -First 1
  if (-not $fallback) { throw 'Installed application executable was not found.' }
  return $fallback.FullName
}

function Get-DirectoryFingerprint {
  param([Parameter(Mandatory = $true)][string]$Root)
  return @(
    Get-ChildItem -LiteralPath $Root -Recurse -File | ForEach-Object {
      $relative = [IO.Path]::GetRelativePath($Root, $_.FullName).Replace('\', '/')
      "$relative|$($_.Length)|$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
    } | Sort-Object
  )
}

function Set-ResourceFilesReadOnly {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][bool]$ReadOnly
  )
  Get-ChildItem -LiteralPath $Root -Recurse -File | ForEach-Object { $_.IsReadOnly = $ReadOnly }
}

function Add-IsolatedPythonEnvironment {
  param(
    [Parameter(Mandatory = $true)][Diagnostics.ProcessStartInfo]$StartInfo,
    [Parameter(Mandatory = $true)][string]$PythonRoot,
    [Parameter(Mandatory = $true)][string]$ModelsRoot
  )
  $StartInfo.Environment.Clear()
  $systemRoot = [Environment]::GetEnvironmentVariable('SystemRoot')
  $temp = [Environment]::GetEnvironmentVariable('TEMP')
  $tmp = [Environment]::GetEnvironmentVariable('TMP')
  $profile = [Environment]::GetEnvironmentVariable('USERPROFILE')
  $local = [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
  $StartInfo.Environment['SystemRoot'] = $systemRoot
  $StartInfo.Environment['WINDIR'] = $systemRoot
  $StartInfo.Environment['TEMP'] = $temp
  $StartInfo.Environment['TMP'] = $tmp
  $StartInfo.Environment['USERPROFILE'] = $profile
  $StartInfo.Environment['LOCALAPPDATA'] = $local
  $StartInfo.Environment['PATH'] = "$PythonRoot;$systemRoot\System32"
  $StartInfo.Environment['PYTHONNOUSERSITE'] = '1'
  $StartInfo.Environment['PYTHONDONTWRITEBYTECODE'] = '1'
  $StartInfo.Environment['PYTHONUTF8'] = '1'
  $StartInfo.Environment['PYTHONIOENCODING'] = 'utf-8'
  $StartInfo.Environment['PADDLE_OCR_BASE_DIR'] = Join-Path $ModelsRoot 'paddleocr'
  $StartInfo.Environment['PADDLE_PDX_CACHE_HOME'] = Join-Path $ModelsRoot 'paddlex'
  $StartInfo.Environment['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
  $StartInfo.Environment['PADDLE_PDX_DISABLE_AUTO_LOAD_DEFAULT_MODEL'] = 'True'
  $StartInfo.Environment['PADDLE_PDX_DISABLE_TELEMETRY'] = 'True'
  $StartInfo.Environment['FLAGS_enable_pir_api'] = '0'
  $StartInfo.Environment['FLAGS_use_mkldnn'] = '0'
  $StartInfo.Environment['OMP_NUM_THREADS'] = '2'
  $StartInfo.Environment['OPENBLAS_NUM_THREADS'] = '2'
  $StartInfo.Environment['MKL_NUM_THREADS'] = '2'
  $StartInfo.Environment['NUMEXPR_NUM_THREADS'] = '2'
  $StartInfo.Environment['COURSE_WIDGET_OCR_CPU_THREADS'] = '2'
}

function Invoke-IsolatedPortableSmoke {
  param(
    [Parameter(Mandatory = $true)][string]$Python,
    [Parameter(Mandatory = $true)][string]$ModelsRoot,
    [Parameter(Mandatory = $true)][string]$SmokeScript,
    [Parameter(Mandatory = $true)][string]$Output,
    [switch]$GenerateSampleOnly
  )
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Python
  $startInfo.UseShellExecute = $false
  $startInfo.WorkingDirectory = Split-Path -Parent $SmokeScript
  Add-IsolatedPythonEnvironment -StartInfo $startInfo -PythonRoot (Split-Path -Parent $Python) -ModelsRoot $ModelsRoot
  $arguments = @('-I', '-B', $SmokeScript, '--output', $Output)
  if ($GenerateSampleOnly) {
    $arguments += '--generate-sample'
  } else {
    $arguments += '--inference'
  }
  foreach ($argument in $arguments) {
    [void]$startInfo.ArgumentList.Add($argument)
  }
  $process = [Diagnostics.Process]::Start($startInfo)
  if (-not $process) { throw 'Could not start isolated portable Python smoke.' }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "Isolated portable Python smoke failed with exit code $($process.ExitCode)."
  }
}

function Get-DirectPythonChildren {
  param([Parameter(Mandatory = $true)][int]$ParentProcessId)
  try {
    return @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentProcessId" |
      Where-Object { $_.Name -match '^python(w)?\.exe$' })
  } catch {
    return @()
  }
}

function Invoke-AppOcrSmoke {
  param(
    [Parameter(Mandatory = $true)][string]$Application,
    [Parameter(Mandatory = $true)][string]$Image,
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [Parameter(Mandatory = $true)][int]$Runs,
    [bool]$Initialize = $false,
    [bool]$ExpectSuccess = $true,
    [int]$TimeoutSeconds = 420
  )
  $fakeRoot = Join-Path (Split-Path -Parent $ResultPath) '污染 环境'
  New-Item -ItemType Directory -Force -Path $fakeRoot | Out-Null
  Set-Content -LiteralPath (Join-Path $fakeRoot 'python.exe') -Value 'not a real python executable' -Encoding ascii

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Application
  $startInfo.WorkingDirectory = Split-Path -Parent $Application
  $startInfo.UseShellExecute = $false
  $systemRoot = [Environment]::GetEnvironmentVariable('SystemRoot')
  $startInfo.Environment['PATH'] = "$fakeRoot;$systemRoot\System32"
  $startInfo.Environment['PYTHONHOME'] = Join-Path $fakeRoot 'python-home'
  $startInfo.Environment['PYTHONPATH'] = Join-Path $fakeRoot 'site-packages'
  $startInfo.Environment['VIRTUAL_ENV'] = Join-Path $fakeRoot 'venv'
  $startInfo.Environment['CONDA_PREFIX'] = Join-Path $fakeRoot 'conda'
  $startInfo.Environment['CONDA_DEFAULT_ENV'] = 'polluted'
  $startInfo.Environment['CUDA_PATH'] = Join-Path $fakeRoot 'cuda'
  $startInfo.Environment['CUDA_HOME'] = Join-Path $fakeRoot 'cuda-home'
  $startInfo.Environment['PADDLE_HOME'] = Join-Path $fakeRoot 'paddle'
  $startInfo.Environment['LD_LIBRARY_PATH'] = Join-Path $fakeRoot 'linux-dlls'
  $startInfo.Environment['PADDLE_OCR_BASE_DIR'] = Join-Path $fakeRoot 'wrong-models'
  $startInfo.Environment['PADDLE_PDX_CACHE_HOME'] = Join-Path $fakeRoot 'wrong-cache'
  $startInfo.Environment['OMP_NUM_THREADS'] = '99'
  $startInfo.Environment['COURSE_WIDGET_OCR_APP_SMOKE_IMAGE'] = $Image
  $startInfo.Environment['COURSE_WIDGET_OCR_APP_SMOKE_RESULT'] = $ResultPath
  $startInfo.Environment['COURSE_WIDGET_OCR_APP_SMOKE_RUNS'] = [string]$Runs
  if ($Initialize) {
    $startInfo.Environment['COURSE_WIDGET_OCR_APP_SMOKE_INITIALIZE'] = '1'
  } else {
    [void]$startInfo.Environment.Remove('COURSE_WIDGET_OCR_APP_SMOKE_INITIALIZE')
  }

  $process = [Diagnostics.Process]::Start($startInfo)
  if (-not $process) { throw 'Could not start installed application OCR smoke.' }
  $visibleConsole = $false
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
    foreach ($child in Get-DirectPythonChildren -ParentProcessId $process.Id) {
      try {
        $pythonProcess = Get-Process -Id $child.ProcessId -ErrorAction Stop
        $pythonProcess.Refresh()
        if ($pythonProcess.MainWindowHandle -ne 0) { $visibleConsole = $true }
      } catch {
        # The child can exit between WMI enumeration and Get-Process.
      }
    }
    if (Test-Path -LiteralPath $ResultPath -PathType Leaf) {
      $process.WaitForExit(30000) | Out-Null
      break
    }
    Start-Sleep -Milliseconds 200
  }
  if (-not $process.HasExited) {
    $process.Kill($true)
    throw "Installed application OCR smoke timed out after $TimeoutSeconds seconds."
  }
  if ($visibleConsole) {
    throw 'The installed application created a visible Python/CMD console window.'
  }
  if (-not (Test-Path -LiteralPath $ResultPath -PathType Leaf)) {
    throw "Installed application exited without writing the smoke result: $ResultPath"
  }
  $result = Get-Content -LiteralPath $ResultPath -Raw | ConvertFrom-Json
  if ($ExpectSuccess) {
    if ($result.ok -ne $true) {
      Write-Host 'Application OCR smoke result:'
      Write-Host ($result | ConvertTo-Json -Depth 20)
      throw "Application OCR smoke failed: $($result.error)"
    }
    if ([int]$result.runCount -ne $Runs) {
      throw "Expected $Runs application OCR runs, got $($result.runCount)"
    }
    if ([int]$result.courseCount -lt 1) { throw 'Application OCR smoke returned no courses.' }
    if ($result.componentStatus.state -ne 'ready') {
      throw "Application component status was not ready: $($result.componentStatus.state)"
    }
    if ($Initialize -and $result.probe.ok -ne $true) {
      throw 'Application initialization probe did not succeed.'
    }
  } else {
    if ($result.ok -eq $true) { throw 'Expected the application OCR smoke to fail.' }
    if (-not $result.diagnosticId) { throw 'Failed application OCR smoke did not retain a diagnostic ID.' }
    if (-not $result.diagnosticSummary) { throw 'Failed application OCR smoke did not retain a diagnostic summary.' }
  }
  return $result
}

if (-not $IsWindows) { throw 'The application-level OCR smoke requires Windows.' }
$installerPath = [IO.Path]::GetFullPath($Installer)
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
  throw "Installer not found: $installerPath"
}

$requestedInstallRoot = Join-Path $WorkingRoot '中文 安装目录'
$smokeRoot = Join-Path $WorkingRoot '应用级 smoke'
[string]$installRoot = ''
[string]$resourceRoot = ''
$resourcesReadOnly = $false
$uninstallCompleted = $false

try {
  $existing = Get-RegisteredInstallRoot
  if ($existing) {
    throw "Application-level OCR smoke requires a clean runner; found $existing"
  }
  Remove-Item -LiteralPath $WorkingRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $requestedInstallRoot, $smokeRoot | Out-Null

  Invoke-Checked -FilePath $installerPath -ArgumentList @('/S', "/D=$requestedInstallRoot")
  $installRoot = Wait-ForRegisteredInstallRoot
  $resourceRoot = Join-Path $installRoot 'ocr-component'
  $manifestPath = Join-Path $resourceRoot 'component.json'
  $manifest = Wait-ForInstalledComponent -Root $resourceRoot -ManifestPath $manifestPath

  $portablePython = Join-Path $resourceRoot $manifest.pythonRelativePath
  $modelsRoot = Join-Path $resourceRoot $manifest.modelCacheRelativePath
  $appExecutable = Get-AppExecutable -InstallRoot $installRoot
  $smokeScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/ocr-component-smoke.py'
  $directSmokeRoot = Join-Path $smokeRoot '直接隔离运行'
  Invoke-IsolatedPortableSmoke -Python $portablePython -ModelsRoot $modelsRoot -SmokeScript $smokeScript -Output $directSmokeRoot -GenerateSampleOnly
  $directReport = Get-Content -LiteralPath (Join-Path $directSmokeRoot 'portable-ocr-smoke.json') -Raw | ConvertFrom-Json
  $sampleImage = [IO.Path]::GetFullPath([string]$directReport.sampleImage)
  if (-not (Test-Path -LiteralPath $sampleImage -PathType Leaf)) {
    throw 'Installed portable Python did not generate the Unicode-path OCR fixture.'
  }

  $before = Get-DirectoryFingerprint -Root $resourceRoot
  Set-ResourceFilesReadOnly -Root $resourceRoot -ReadOnly $true
  $resourcesReadOnly = $true

  $first = Invoke-AppOcrSmoke `
    -Application $appExecutable `
    -Image $sampleImage `
    -ResultPath (Join-Path $smokeRoot '应用-连续两次.json') `
    -Runs 2 `
    -Initialize $true
  $second = Invoke-AppOcrSmoke `
    -Application $appExecutable `
    -Image $sampleImage `
    -ResultPath (Join-Path $smokeRoot '应用-重启后.json') `
    -Runs 1 `
    -Initialize $false

  # Force a fast component-verification failure, then restore the exact file. This validates
  # persistent, copyable and redacted diagnostics without recording any timetable image content.
  $pythonItem = Get-Item -LiteralPath $portablePython
  $pythonItem.IsReadOnly = $false
  $disabledPython = "$portablePython.disabled"
  Move-Item -LiteralPath $portablePython -Destination $disabledPython
  try {
    $failureResult = Invoke-AppOcrSmoke `
      -Application $appExecutable `
      -Image $sampleImage `
      -ResultPath (Join-Path $smokeRoot '应用-诊断失败.json') `
      -Runs 1 `
      -Initialize $false `
      -ExpectSuccess $false
  } finally {
    Move-Item -LiteralPath $disabledPython -Destination $portablePython
    (Get-Item -LiteralPath $portablePython).IsReadOnly = $true
  }

  $diagnosticText = [string]$failureResult.diagnosticSummary
  foreach ($secret in @($env:USERNAME, $env:USERPROFILE, $env:LOCALAPPDATA, $installRoot, $WorkingRoot)) {
    if ($secret -and $diagnosticText.Contains([string]$secret, [StringComparison]::OrdinalIgnoreCase)) {
      throw "OCR diagnostic leaked a private path or username: $secret"
    }
  }
  if (-not $diagnosticText.Contains('诊断编号')) {
    throw 'OCR diagnostic summary is not copyable or structured.'
  }

  $after = Get-DirectoryFingerprint -Root $resourceRoot
  if (Compare-Object -ReferenceObject $before -DifferenceObject $after) {
    throw 'Installed OCR resource tree changed during application-level offline recognition.'
  }

  Set-ResourceFilesReadOnly -Root $resourceRoot -ReadOnly $false
  $resourcesReadOnly = $false
  $uninstaller = Get-ChildItem -LiteralPath $installRoot -Recurse -File |
    Where-Object { $_.Name -match '^(uninstall|unins.*)\.exe$' } |
    Select-Object -First 1
  if (-not $uninstaller) { throw 'Installed application did not provide an uninstaller.' }
  Invoke-Checked -FilePath $uninstaller.FullName -ArgumentList @('/S')
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while ((Test-Path -LiteralPath $portablePython) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path -LiteralPath $portablePython) {
    throw 'Uninstaller left the bundled OCR runtime behind.'
  }
  $uninstallCompleted = $true

  Write-Host "Application executable: $appExecutable"
  Write-Host "Application consecutive OCR runs: $($first.runCount)"
  Write-Host "Application restart OCR runs: $($second.runCount)"
  Write-Host "Diagnostic ID: $($failureResult.diagnosticId)"
  Write-Host 'Polluted Python/Conda/CUDA variables did not alter the bundled runtime.'
  Write-Host 'No visible Python/CMD console was observed.'
  Write-Host 'The application used the same backend path as the real Tauri screenshot command.'
  Write-Host 'Installed resources remained byte-for-byte unchanged while offline and read-only.'
} finally {
  if ($resourcesReadOnly -and $resourceRoot -and (Test-Path -LiteralPath $resourceRoot)) {
    Set-ResourceFilesReadOnly -Root $resourceRoot -ReadOnly $false
  }
  if (-not $uninstallCompleted -and $installRoot -and (Test-Path -LiteralPath $installRoot)) {
    $fallback = Get-ChildItem -LiteralPath $installRoot -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^(uninstall|unins.*)\.exe$' } |
      Select-Object -First 1
    if ($fallback) {
      try { Invoke-Checked -FilePath $fallback.FullName -ArgumentList @('/S') }
      catch { Write-Warning "Fallback uninstall failed: $($_.Exception.Message)" }
    }
  }
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (-not (Test-Path -LiteralPath $WorkingRoot)) { break }
    try {
      Remove-Item -LiteralPath $WorkingRoot -Recurse -Force -ErrorAction Stop
      break
    } catch {
      if ($attempt -eq 59) { throw }
      Start-Sleep -Milliseconds 500
    }
  }
}
