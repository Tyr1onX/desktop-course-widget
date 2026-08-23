param(
  [string]$Installer = ""
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$repoRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$productName = [string]$config.productName
$bundleId = [string]$config.identifier
$expectedVersion = [string]$config.version

if ([string]::IsNullOrWhiteSpace($Installer)) {
  $candidate = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'src-tauri/target/release/bundle/nsis') -Filter '*.exe' -File |
    Select-Object -First 1
  if (-not $candidate) { throw 'Windows NSIS installer was not produced.' }
  $Installer = $candidate.FullName
}
$installerPath = [IO.Path]::GetFullPath($Installer)
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
  throw "Installer does not exist: $installerPath"
}

$dataRoot = Join-Path $env:LOCALAPPDATA $bundleId
$sentinelPath = Join-Path $dataRoot 'installer-smoke-sentinel.txt'
$sentinelValue = [guid]::NewGuid().ToString()
$dataRootExistedBefore = Test-Path -LiteralPath $dataRoot
$installRoot = $null
$mainExe = $null
$uninstallerPath = $null

function Normalize-RegistryPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  return [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"'))
}

function Resolve-UninstallExecutable([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  $expanded = [Environment]::ExpandEnvironmentVariables($Value.Trim())
  if ($expanded.StartsWith('"')) {
    $match = [regex]::Match($expanded, '^"([^"]+)"')
    if ($match.Success) { return $match.Groups[1].Value }
  }
  return ($expanded -split '\s+', 2)[0]
}

function Get-CourseWidgetUninstallEntries {
  $roots = @(
    @{ Hive = 'HKCU'; Path = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall' },
    @{ Hive = 'HKLM'; Path = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' },
    @{ Hive = 'HKLM32'; Path = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' }
  )

  $matches = @()
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root.Path)) { continue }
    foreach ($key in Get-ChildItem -LiteralPath $root.Path -ErrorAction SilentlyContinue) {
      $item = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
      if ($item.DisplayName -ne $productName) { continue }
      if ($item.Publisher -and $item.Publisher -ne 'Tyr1onX') { continue }
      $matches += [pscustomobject]@{
        Hive = $root.Hive
        KeyPath = $key.PSPath
        DisplayName = [string]$item.DisplayName
        DisplayVersion = [string]$item.DisplayVersion
        InstallLocation = [string]$item.InstallLocation
        UninstallString = [string]$item.UninstallString
        MainBinaryName = [string]$item.MainBinaryName
      }
    }
  }
  return @($matches)
}

function Get-InstalledState {
  $entries = @(Get-CourseWidgetUninstallEntries)
  if ($entries.Count -ne 1) {
    throw "Expected exactly one uninstall registration for $productName, found $($entries.Count)."
  }
  $entry = $entries[0]
  if ($entry.Hive -ne 'HKCU') {
    throw "currentUser installer registered outside HKCU: $($entry.Hive)"
  }
  if ($entry.DisplayVersion -ne $expectedVersion) {
    throw "DisplayVersion is '$($entry.DisplayVersion)', expected '$expectedVersion'."
  }
  if ([string]::IsNullOrWhiteSpace($entry.UninstallString)) {
    throw 'UninstallString is missing.'
  }

  $root = Normalize-RegistryPath $entry.InstallLocation
  if ([string]::IsNullOrWhiteSpace($root)) {
    $uninstallExe = Resolve-UninstallExecutable $entry.UninstallString
    if (-not $uninstallExe) { throw 'Could not resolve install location or uninstaller.' }
    $root = Split-Path -Parent $uninstallExe
  }
  $root = [IO.Path]::GetFullPath($root)

  $systemRoots = @(
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:SystemRoot
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  foreach ($systemRoot in $systemRoots) {
    $fullSystemRoot = [IO.Path]::GetFullPath($systemRoot).TrimEnd('\') + '\'
    if (($root.TrimEnd('\') + '\').StartsWith($fullSystemRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "currentUser installer unexpectedly used a system-wide location: $root"
    }
  }

  $userRoots = @($env:LOCALAPPDATA, $env:APPDATA, $env:USERPROFILE) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') + '\' }
  $rootWithSlash = $root.TrimEnd('\') + '\'
  if (-not ($userRoots | Where-Object { $rootWithSlash.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) {
    throw "currentUser installer location is not under the runner user profile: $root"
  }

  $binaryName = if ($entry.MainBinaryName) { $entry.MainBinaryName } else { 'desktop-course-widget.exe' }
  $exe = Join-Path $root $binaryName
  $uninstallExe = Resolve-UninstallExecutable $entry.UninstallString

  if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Install directory is missing: $root" }
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Installed main executable is missing: $exe" }
  if (-not $uninstallExe -or -not (Test-Path -LiteralPath $uninstallExe -PathType Leaf)) {
    throw "Installed uninstaller is missing: $uninstallExe"
  }

  $uninstallers = @(Get-ChildItem -LiteralPath $root -Filter 'uninstall*.exe' -File -ErrorAction SilentlyContinue)
  if ($uninstallers.Count -ne 1) {
    throw "Expected exactly one uninstaller in $root, found $($uninstallers.Count)."
  }

  return [pscustomobject]@{
    Entry = $entry
    InstallRoot = $root
    MainExe = $exe
    Uninstaller = [IO.Path]::GetFullPath($uninstallExe)
  }
}

function Invoke-Installer {
  $process = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Installer exited with code $($process.ExitCode)."
  }
}

function Invoke-InstalledWindowSmoke([string]$Executable) {
  & (Join-Path $repoRoot 'scripts/windows-window-smoke.ps1') -Executable $Executable
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds = 20) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    if (& $Condition) { return $true }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Stop-SmokeProcesses {
  Get-Process -Name 'desktop-course-widget' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

try {
  if (@(Get-CourseWidgetUninstallEntries).Count -ne 0) {
    throw "Fresh-install smoke requires no pre-existing $productName uninstall registration."
  }

  Write-Host 'installer smoke: fresh install'
  Invoke-Installer
  $fresh = Get-InstalledState
  $installRoot = $fresh.InstallRoot
  $mainExe = $fresh.MainExe
  $uninstallerPath = $fresh.Uninstaller
  Invoke-InstalledWindowSmoke $mainExe

  New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
  Set-Content -LiteralPath $sentinelPath -Value $sentinelValue -NoNewline -Encoding utf8

  Write-Host 'installer smoke: same-version overwrite install'
  Invoke-Installer
  $overwrite = Get-InstalledState
  if (-not $overwrite.InstallRoot.Equals($installRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Overwrite install changed install directory: '$installRoot' -> '$($overwrite.InstallRoot)'"
  }
  if (-not $overwrite.Uninstaller.Equals($uninstallerPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Overwrite install changed uninstaller path: '$uninstallerPath' -> '$($overwrite.Uninstaller)'"
  }
  if (-not (Test-Path -LiteralPath $sentinelPath -PathType Leaf)) {
    throw 'Overwrite install removed the user-data sentinel.'
  }
  $sentinelAfterOverwrite = Get-Content -LiteralPath $sentinelPath -Raw
  if ($sentinelAfterOverwrite -ne $sentinelValue) {
    throw 'Overwrite install changed the user-data sentinel contents.'
  }
  Invoke-InstalledWindowSmoke $overwrite.MainExe

  Write-Host 'installer smoke: uninstall'
  Stop-SmokeProcesses
  $uninstallProcess = Start-Process -FilePath $overwrite.Uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($uninstallProcess.ExitCode -ne 0) {
    throw "Uninstaller exited with code $($uninstallProcess.ExitCode)."
  }

  $removed = Wait-Until {
    @(Get-CourseWidgetUninstallEntries).Count -eq 0 -and
    -not (Test-Path -LiteralPath $overwrite.MainExe -PathType Leaf) -and
    -not (Test-Path -LiteralPath $overwrite.Uninstaller -PathType Leaf)
  }
  if (-not $removed) {
    throw 'Uninstall did not remove the core executable, uninstaller, and uninstall registration within the timeout.'
  }

  if (-not (Test-Path -LiteralPath $sentinelPath -PathType Leaf)) {
    throw 'Silent uninstall removed user data, but the current default NSIS policy preserves it unless deletion is explicitly selected.'
  }
  $sentinelAfterUninstall = Get-Content -LiteralPath $sentinelPath -Raw
  if ($sentinelAfterUninstall -ne $sentinelValue) {
    throw 'Silent uninstall changed the preserved user-data sentinel contents.'
  }

  Write-Host "installer lifecycle smoke passed: install=$installRoot version=$expectedVersion"
  if ($env:GITHUB_STEP_SUMMARY) {
    @(
      '### Windows installer lifecycle smoke',
      '',
      '- Fresh current-user install: passed',
      '- Installed executable startup: passed',
      '- Same-version overwrite install: passed',
      '- User-data sentinel preserved across overwrite: passed',
      '- Silent uninstall: passed',
      '- Uninstall registry cleanup: passed',
      '- User-data sentinel preserved by existing silent-uninstall policy: passed'
    ) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
  }
}
finally {
  Stop-SmokeProcesses

  $entries = @(Get-CourseWidgetUninstallEntries)
  foreach ($entry in $entries) {
    $cleanupUninstaller = Resolve-UninstallExecutable $entry.UninstallString
    if ($cleanupUninstaller -and (Test-Path -LiteralPath $cleanupUninstaller -PathType Leaf)) {
      Start-Process -FilePath $cleanupUninstaller -ArgumentList '/S' -Wait -ErrorAction SilentlyContinue | Out-Null
    }
  }

  Remove-Item -LiteralPath $sentinelPath -Force -ErrorAction SilentlyContinue
  if (-not $dataRootExistedBefore) {
    Remove-Item -LiteralPath $dataRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  if ($installRoot -and (Test-Path -LiteralPath $installRoot)) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
