param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$WorkingRoot = (Join-Path $env:RUNNER_TEMP "course-widget-native-ocr-package-$PID")
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$expected = [ordered]@{
  'PP-OCRv5_mobile_det_fp16.mnn' = '617b5228b101275594f96ebb6ae7662fd1618bcf8e84b0ffde1cf3b48e754951'
  'PP-OCRv5_mobile_rec_fp16.mnn' = 'ff03e4204260325eabe9f4eae0ec8cc6b79b8a97a8e38a5292ba69cf02a689fc'
  'ppocr_keys_v5.txt' = 'f2ed6bb20a850ce4767fa9b4622d9b282985ab7f0ea8f8c11abd790ca6d2ff94'
}

$root = [IO.Path]::GetFullPath($WorkingRoot)
$installRoot = Join-Path $root '中文安装目录\课刻'
Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

try {
  $installerPath = [IO.Path]::GetFullPath($Installer)
  $process = Start-Process -FilePath $installerPath -ArgumentList @('/S', '/ISOLATED', "/D=$installRoot") -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Installer exited with code $($process.ExitCode)."
  }

  $mainCandidates = @(
    Get-ChildItem -LiteralPath $installRoot -Filter '*.exe' -File -ErrorAction Stop |
      Where-Object { $_.Name -notmatch '(?i)^(uninstall|unins)' }
  )
  if ($mainCandidates.Count -ne 1) {
    throw "Isolated package probe expected exactly one top-level application executable, found $($mainCandidates.Count)."
  }
  $mainExe = $mainCandidates[0].FullName
  if (Test-Path -LiteralPath (Join-Path $installRoot 'uninstall.exe') -PathType Leaf) {
    throw 'Isolated package probe unexpectedly created a production-identity uninstaller.'
  }

  $exeDir = Split-Path -Parent $mainExe
  $runtimeRoots = @(
    (Join-Path $exeDir 'ocr-native'),
    (Join-Path $exeDir 'resources\ocr-native'),
    (Join-Path $exeDir '_up_\resources\ocr-native')
  )
  $modelRoot = $null
  foreach ($candidateRoot in $runtimeRoots) {
    $complete = $true
    foreach ($name in $expected.Keys) {
      if (-not (Test-Path -LiteralPath (Join-Path $candidateRoot $name) -PathType Leaf)) {
        $complete = $false
        break
      }
    }
    if ($complete) {
      $modelRoot = $candidateRoot
      break
    }
  }
  if (-not $modelRoot) {
    throw "Installed OCR resources are not visible from any packaged runtime resolver root: $($runtimeRoots -join '; ')"
  }

  foreach ($entry in $expected.GetEnumerator()) {
    $path = Join-Path $modelRoot $entry.Key
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $entry.Value) {
      throw "Installed native OCR resource hash mismatch for $($entry.Key): $actual"
    }
  }

  $manifestPath = Join-Path $modelRoot 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'Installed native OCR manifest.json is missing.'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if (@($manifest.files).Count -ne $expected.Count) {
    throw "Native OCR manifest lists $(@($manifest.files).Count) files instead of $($expected.Count)."
  }

  $forbidden = @(
    Get-ChildItem -LiteralPath $installRoot -Recurse -File |
      Where-Object {
        $_.Name -match '(?i)^python(w)?\.exe$' -or
        $_.FullName -match '(?i)[\\/](site-packages|conda|paddle)([\\/]|$)'
      }
  )
  if ($forbidden.Count -gt 0) {
    throw "Installer contains a forbidden Python/Paddle runtime path: $($forbidden[0].FullName)"
  }

  Write-Host "packaged runtime OCR resolver root verified: $modelRoot"
  "runtime_resolver_model_root=$modelRoot" >> $env:GITHUB_STEP_SUMMARY
  "installed_model_count=$($expected.Count)" >> $env:GITHUB_STEP_SUMMARY
  "python_runtime_files=0" >> $env:GITHUB_STEP_SUMMARY
}
finally {
  # /ISOLATED deliberately creates no uninstaller or persistent product identity.
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
