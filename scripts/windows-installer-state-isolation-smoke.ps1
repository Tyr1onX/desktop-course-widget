param(
  [Parameter(Mandatory = $true)]
  [string]$Installer,
  [string]$WorkingRoot = (Join-Path $env:RUNNER_TEMP "course-widget-installer-state-isolation-$PID")
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$repoRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri/tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$productName = [string]$config.productName
$bundleId = [string]$config.identifier
$publisher = [string]$config.bundle.publisher
$expectedVersion = [string]$config.version
$installerPath = [IO.Path]::GetFullPath($Installer)
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
  throw "Installer does not exist: $installerPath"
}

$manufacturerKey = "HKCU:\Software\$publisher\$productName"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$productName"
$canonicalRoot = Join-Path $env:LOCALAPPDATA $productName
$canonicalExe = Join-Path $canonicalRoot 'desktop-course-widget.exe'
$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('Desktop')
$startShortcut = Join-Path $programs "$productName.lnk"
$desktopShortcut = Join-Path $desktop "$productName.lnk"
$dataRoot = Join-Path $env:LOCALAPPDATA $bundleId
$dataRootExistedBefore = Test-Path -LiteralPath $dataRoot
$sentinelPath = Join-Path $dataRoot "installer-state-isolation-$PID.txt"
$sentinelValue = [guid]::NewGuid().ToString()
$root = [IO.Path]::GetFullPath($WorkingRoot)
$isolatedRoot = Join-Path $root '.marketing-install'
$pollutedRoot = Join-Path $root 'historical\.marketing-install'

function Normalize-RegistryPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  return [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"'))
}

function Get-ShortcutTarget([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
  $shell = New-Object -ComObject WScript.Shell
  return [string]$shell.CreateShortcut($Path).TargetPath
}

function New-TestShortcut([string]$Path, [string]$Target) {
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $Target
  $shortcut.WorkingDirectory = Split-Path -Parent $Target
  $shortcut.Save()
}

function Assert-NoProductionIdentity([string]$Phase) {
  if (Test-Path -LiteralPath $manufacturerKey) {
    throw "$Phase polluted manufacturer installer state: $manufacturerKey"
  }
  if (Test-Path -LiteralPath $uninstallKey) {
    throw "$Phase polluted uninstall registration: $uninstallKey"
  }
  foreach ($shortcut in @($startShortcut, $desktopShortcut)) {
    if (Test-Path -LiteralPath $shortcut -PathType Leaf) {
      throw "$Phase created production shortcut: $shortcut"
    }
  }
}

function Invoke-Installer([string[]]$Arguments) {
  $process = Start-Process -FilePath $installerPath -ArgumentList $Arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Installer exited with code $($process.ExitCode): $($Arguments -join ' ')"
  }
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds = 15) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    if (& $Condition) { return $true }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  return $false
}

$preexisting = @(
  (Test-Path -LiteralPath $manufacturerKey),
  (Test-Path -LiteralPath $uninstallKey),
  (Test-Path -LiteralPath $startShortcut -PathType Leaf),
  (Test-Path -LiteralPath $desktopShortcut -PathType Leaf),
  (Test-Path -LiteralPath $canonicalRoot -PathType Container)
) | Where-Object { $_ }
if ($preexisting.Count -ne 0) {
  throw 'Installer-state isolation smoke requires a clean runner and refuses to modify an existing production installation.'
}

Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $isolatedRoot | Out-Null
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
Set-Content -LiteralPath $sentinelPath -Value $sentinelValue -NoNewline -Encoding utf8

try {
  Write-Host 'installer identity smoke: isolated mode without /D must fail closed'
  $missingRootProcess = Start-Process -FilePath $installerPath -ArgumentList @('/S', '/ISOLATED') -Wait -PassThru
  if ($missingRootProcess.ExitCode -ne 87) {
    throw "Isolated install without /D exited with $($missingRootProcess.ExitCode), expected 87."
  }
  Assert-NoProductionIdentity 'rejected isolated install'

  Write-Host "installer identity smoke: isolated dev/marketing install -> $isolatedRoot"
  Invoke-Installer @('/S', '/ISOLATED', "/D=$isolatedRoot")

  $isolatedApps = @(
    Get-ChildItem -LiteralPath $isolatedRoot -Filter '*.exe' -File -ErrorAction Stop |
      Where-Object { $_.Name -notmatch '(?i)^(uninstall|unins)' }
  )
  if ($isolatedApps.Count -ne 1) {
    throw "Isolated install expected one top-level application executable, found $($isolatedApps.Count)."
  }
  if (Test-Path -LiteralPath (Join-Path $isolatedRoot 'uninstall.exe') -PathType Leaf) {
    throw 'Isolated install created a production-identity uninstaller.'
  }
  Assert-NoProductionIdentity 'isolated install'
  if ((Get-Content -LiteralPath $sentinelPath -Raw) -ne $sentinelValue) {
    throw 'Isolated install changed shared AppData.'
  }

  Remove-Item -LiteralPath $isolatedRoot -Recurse -Force

  Write-Host 'installer identity smoke: simulate historical coherent .marketing-install pollution'
  New-Item -ItemType Directory -Force -Path $pollutedRoot | Out-Null
  $pollutedExe = Join-Path $pollutedRoot 'desktop-course-widget.exe'
  $pollutedUninstaller = Join-Path $pollutedRoot 'uninstall.exe'
  Set-Content -LiteralPath $pollutedExe -Value 'historical dev binary sentinel' -NoNewline -Encoding ascii
  Set-Content -LiteralPath $pollutedUninstaller -Value 'historical dev uninstaller sentinel' -NoNewline -Encoding ascii

  New-Item -Path $manufacturerKey -Force | Out-Null
  Set-Item -LiteralPath $manufacturerKey -Value $pollutedRoot
  New-Item -Path $uninstallKey -Force | Out-Null
  Set-Item -LiteralPath $uninstallKey -Value $productName
  New-ItemProperty -LiteralPath $uninstallKey -Name 'DisplayName' -Value $productName -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $uninstallKey -Name 'DisplayVersion' -Value $expectedVersion -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $uninstallKey -Name 'Publisher' -Value $publisher -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $uninstallKey -Name 'InstallLocation' -Value ('"' + $pollutedRoot + '"') -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $uninstallKey -Name 'UninstallString' -Value ('"' + $pollutedUninstaller + '"') -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $uninstallKey -Name 'MainBinaryName' -Value 'desktop-course-widget.exe' -PropertyType String -Force | Out-Null
  New-TestShortcut -Path $startShortcut -Target $pollutedExe
  New-TestShortcut -Path $desktopShortcut -Target $pollutedExe

  Write-Host 'installer identity smoke: normal production install must reject stale dev root and converge to canonical root'
  Invoke-Installer @('/S')

  if (-not (Test-Path -LiteralPath $canonicalExe -PathType Leaf)) {
    throw "Production install did not create canonical executable: $canonicalExe"
  }
  $savedRoot = Normalize-RegistryPath ([string](Get-Item -LiteralPath $manufacturerKey).GetValue(''))
  if (-not $savedRoot.Equals([IO.Path]::GetFullPath($canonicalRoot), [StringComparison]::OrdinalIgnoreCase)) {
    throw "Manufacturer installer state did not converge to canonical root: '$savedRoot'"
  }

  $registration = Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction Stop
  $registeredRoot = Normalize-RegistryPath ([string]$registration.InstallLocation)
  if (-not $registeredRoot.Equals([IO.Path]::GetFullPath($canonicalRoot), [StringComparison]::OrdinalIgnoreCase)) {
    throw "Uninstall registration kept stale dev root: '$registeredRoot'"
  }
  if ([string]$registration.DisplayVersion -ne $expectedVersion) {
    throw "Production DisplayVersion is '$($registration.DisplayVersion)', expected '$expectedVersion'."
  }

  foreach ($shortcut in @($startShortcut, $desktopShortcut)) {
    $target = Get-ShortcutTarget $shortcut
    if ([string]::IsNullOrWhiteSpace($target)) {
      throw "Production shortcut target could not be resolved: $shortcut"
    }
    if (-not ([IO.Path]::GetFullPath($target)).Equals([IO.Path]::GetFullPath($canonicalExe), [StringComparison]::OrdinalIgnoreCase)) {
      throw "Production shortcut still targets stale dev binary: $shortcut -> $target"
    }
  }

  $startAppsReady = Wait-Until {
    @(Get-StartApps -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $productName }).Count -gt 0
  }
  if (-not $startAppsReady) {
    throw "Get-StartApps did not discover '$productName' after canonical production install."
  }

  if ((Get-Content -LiteralPath $sentinelPath -Raw) -ne $sentinelValue) {
    throw 'Production recovery install changed shared AppData.'
  }
  if (-not (Test-Path -LiteralPath $pollutedExe -PathType Leaf)) {
    throw 'Production recovery recursively deleted the historical dev root instead of only retiring its identity.'
  }

  Write-Host "installer state isolation smoke passed: isolated root left no identity; stale .marketing-install recovered to $canonicalRoot; AppData preserved"
  if ($env:GITHUB_STEP_SUMMARY) {
    @(
      '### Windows installer state isolation smoke',
      '',
      '- `/ISOLATED /D=...`: no production registry, uninstall entry, uninstaller, or shortcuts',
      '- coherent historical `.marketing-install` pollution: rejected on next normal install',
      "- production root converged to $canonicalRoot",
      '- Start Menu / Desktop shortcuts retargeted to the canonical executable',
      '- `Get-StartApps` discovers the production app',
      '- shared AppData sentinel preserved'
    ) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
  }
}
finally {
  Get-Process -Name 'desktop-course-widget' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

  if (Test-Path -LiteralPath $uninstallKey) {
    $registration = Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction SilentlyContinue
    $uninstallExe = if ($registration) { Normalize-RegistryPath ([string]$registration.UninstallString) } else { '' }
    if ($uninstallExe -and (Test-Path -LiteralPath $uninstallExe -PathType Leaf) -and
        ([IO.Path]::GetFullPath($uninstallExe)).StartsWith([IO.Path]::GetFullPath($canonicalRoot), [StringComparison]::OrdinalIgnoreCase)) {
      Start-Process -FilePath $uninstallExe -ArgumentList '/S' -Wait -ErrorAction SilentlyContinue | Out-Null
    }
  }

  Remove-Item -LiteralPath $manufacturerKey -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $startShortcut -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $desktopShortcut -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $canonicalRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $sentinelPath -Force -ErrorAction SilentlyContinue
  if (-not $dataRootExistedBefore) {
    Remove-Item -LiteralPath $dataRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
