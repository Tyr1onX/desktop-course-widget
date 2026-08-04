param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Image,
  [string]$WorkingRoot = (Join-Path $env:RUNNER_TEMP "课刻-原生OCR-$PID")
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @()
  )
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$FilePath exited with code $($process.ExitCode)"
  }
}

function Get-TreeFingerprint {
  param([Parameter(Mandatory = $true)][string]$Root)
  return @(
    Get-ChildItem -LiteralPath $Root -Recurse -File | ForEach-Object {
      $relative = [IO.Path]::GetRelativePath($Root, $_.FullName).Replace('\', '/')
      "$relative|$($_.Length)|$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
    } | Sort-Object
  )
}

$root = [IO.Path]::GetFullPath($WorkingRoot)
$installRoot = Join-Path $root '中文 安装目录\课刻'
$resultPath = Join-Path $root '原生识别结果.json'
$firewallRule = "course-widget-native-ocr-$PID"
Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

try {
  Invoke-Checked -FilePath ([IO.Path]::GetFullPath($Installer)) -ArgumentList @('/S', "/D=$installRoot")
  $application = Get-ChildItem -LiteralPath $installRoot -Recurse -Filter '*.exe' -File |
    Where-Object { $_.Name -notmatch '^(uninstall|unins)' } |
    Sort-Object @{ Expression = { if ($_.Name -eq '课刻.exe') { 0 } else { 1 } } }, FullName |
    Select-Object -First 1
  if (-not $application) { throw 'Installed application executable was not found.' }

  $forbidden = @(
    Get-ChildItem -LiteralPath $installRoot -Recurse -File |
      Where-Object { $_.Name -match '^python(w)?\.exe$' -or $_.FullName -match '(?i)paddle|site-packages' }
  )
  if ($forbidden.Count -gt 0) {
    throw "Installed native OCR package contains a forbidden Python/Paddle runtime: $($forbidden[0].FullName)"
  }

  $models = @(
    Get-ChildItem -LiteralPath $installRoot -Recurse -File |
      Where-Object { $_.Name -in @('PP-OCRv5_mobile_det_fp16.mnn', 'PP-OCRv5_mobile_rec_fp16.mnn', 'ppocr_keys_v5.txt') }
  )
  if ($models.Count -ne 3) { throw "Expected three installed native OCR model files, got $($models.Count)." }
  $modelRoot = $models[0].Directory.FullName
  if (@($models | Where-Object { $_.Directory.FullName -ne $modelRoot }).Count -gt 0) {
    throw 'Installed native OCR model files are split across multiple resource directories.'
  }
  $before = Get-TreeFingerprint -Root $modelRoot
  $models | ForEach-Object { $_.IsReadOnly = $true }

  New-NetFirewallRule -DisplayName $firewallRule -Direction Outbound -Program $application.FullName -Action Block | Out-Null

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $application.FullName
  $startInfo.WorkingDirectory = $application.Directory.FullName
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.Environment['COURSE_WIDGET_NATIVE_OCR_SMOKE_IMAGE'] = [IO.Path]::GetFullPath($Image)
  $startInfo.Environment['COURSE_WIDGET_NATIVE_OCR_SMOKE_RESULT'] = $resultPath
  $startInfo.Environment['COURSE_WIDGET_NATIVE_OCR_SMOKE_RUNS'] = '2'
  $process = [Diagnostics.Process]::Start($startInfo)
  if (-not $process) { throw 'Could not start installed application native OCR smoke.' }

  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while (-not (Test-Path -LiteralPath $resultPath -PathType Leaf) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 200
  }
  if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
    if (-not $process.HasExited) { $process.Kill($true) }
    throw 'Installed application did not produce the native OCR smoke result within 90 seconds.'
  }
  $process.WaitForExit(15000) | Out-Null
  if (-not $process.HasExited) {
    $process.Kill($true)
    throw 'Installed application did not exit after writing the native OCR result.'
  }

  $report = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  if (-not $report.ok) { throw "Installed native OCR failed: $($report.error)" }
  if ($report.runs.Count -ne 2) { throw "Expected two installed application OCR runs, got $($report.runs.Count)." }
  foreach ($run in $report.runs) {
    if ($run.courseCount -lt 1) { throw 'Installed application returned an empty ImportDraft.' }
    if ($run.elapsedMs -gt 30000) { throw "Installed native OCR exceeded 30 seconds: $($run.elapsedMs) ms." }
  }
  $allNames = @($report.runs[0].names)
  $matched = @(
    @('通信原理', '数字信号处理', '单片机原理', '通信与网络') |
      Where-Object { $allNames -contains $_ }
  )
  if ($matched.Count -lt 2) {
    throw "Installed application draft matched too few expected course names: $($allNames -join ', ')"
  }

  $after = Get-TreeFingerprint -Root $modelRoot
  if (Compare-Object $before $after) { throw 'Installed native OCR modified its model resources.' }

  "installed_application=$($application.FullName)" >> $env:GITHUB_STEP_SUMMARY
  "installed_run_1_ms=$($report.runs[0].elapsedMs)" >> $env:GITHUB_STEP_SUMMARY
  "installed_run_2_ms=$($report.runs[1].elapsedMs)" >> $env:GITHUB_STEP_SUMMARY
  "installed_course_count=$($report.runs[0].courseCount)" >> $env:GITHUB_STEP_SUMMARY
  "installed_matched_names=$($matched -join ', ')" >> $env:GITHUB_STEP_SUMMARY
}
finally {
  Remove-NetFirewallRule -DisplayName $firewallRule -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $installRoot) {
    Get-ChildItem -LiteralPath $installRoot -Recurse -File -ErrorAction SilentlyContinue |
      ForEach-Object { $_.IsReadOnly = $false }
  }
  $uninstaller = Get-ChildItem -LiteralPath $installRoot -Recurse -Filter '*uninstall*.exe' -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($uninstaller) {
    Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -ErrorAction SilentlyContinue
  }
}
