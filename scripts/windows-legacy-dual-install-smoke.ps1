param(
  [Parameter(Mandatory = $true)]
  [string]$Candidate,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$config = Get-Content -Raw -LiteralPath 'src-tauri/tauri.conf.json' | ConvertFrom-Json
$productName = [string]$config.productName
$bundleId = [string]$config.identifier
$publisher = [string]$config.bundle.publisher
$legacyProductName = '桌面课表'
$legacyVersion = '0.3.0'
$legacyUrl = 'https://github.com/Tyr1onX/desktop-course-widget/releases/download/v0.3.0/_0.3.0_x64-setup.exe'
$legacySha256 = '4a54a97c9dc0799098d123ffa0ba5ae253fe6557e1e8067968706a62404b99b6'
$currentVersion = '0.5.0-beta.4'
$currentUrl = 'https://github.com/Tyr1onX/desktop-course-widget/releases/download/v0.5.0-beta.4/_0.5.0-beta.4_x64-setup.exe'
$currentSha256 = 'f1a63b08482d3b04c6e857a9191ede0184b19e0f42768121300c047957ebec25'
$legacyInstaller = Join-Path $env:RUNNER_TEMP 'course-widget-v0.3.0.exe'
$currentInstaller = Join-Path $env:RUNNER_TEMP 'course-widget-v0.5.0-beta.4.exe'
$dataRoot = Join-Path $env:LOCALAPPDATA $bundleId
$testCreatedDataRoot = -not (Test-Path -LiteralPath $dataRoot)

function Wait-Condition([scriptblock]$Condition, [string]$Message, [int]$TimeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 300
  }
  throw $Message
}

function Get-UninstallEntries([string]$Name) {
  $roots = @(
    @{ Hive = 'HKCU'; Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' },
    @{ Hive = 'HKLM'; Path = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' },
    @{ Hive = 'HKLM32'; Path = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' }
  )
  $matches = foreach ($root in $roots) {
    Get-ItemProperty -Path $root.Path -ErrorAction SilentlyContinue |
      Where-Object {
        $_.DisplayName -eq $Name -and
        ([string]::IsNullOrWhiteSpace($publisher) -or $_.Publisher -eq $publisher)
      } |
      ForEach-Object {
        [pscustomobject]@{
          Hive = $root.Hive
          DisplayVersion = [string]$_.DisplayVersion
          InstallLocation = ([string]$_.InstallLocation).Trim('"')
          MainBinaryName = [string]$_.MainBinaryName
        }
      }
  }
  return @($matches)
}

function Get-Registration([string]$Name, [string]$Version) {
  $entries = @(Get-UninstallEntries $Name)
  if ($entries.Count -ne 1) {
    throw "Expected exactly one '$Name' uninstall registration, found $($entries.Count)."
  }
  $entry = $entries[0]
  if ($entry.Hive -ne 'HKCU') {
    throw "Expected current-user uninstall registration for '$Name', found $($entry.Hive)."
  }
  if ($entry.DisplayVersion -ne $Version) {
    throw "Installed '$Name' version is '$($entry.DisplayVersion)', expected '$Version'."
  }
  return $entry
}

function Get-InstalledPaths($Registration) {
  $installRoot = [string]$Registration.InstallLocation
  if ([string]::IsNullOrWhiteSpace($installRoot)) {
    throw 'InstallLocation is missing from the uninstall registration.'
  }
  $mainBinary = [string]$Registration.MainBinaryName
  if ([string]::IsNullOrWhiteSpace($mainBinary)) {
    $mainBinary = 'desktop-course-widget.exe'
  }
  $mainExe = Join-Path $installRoot $mainBinary
  $uninstaller = Join-Path $installRoot 'uninstall.exe'
  foreach ($path in @($mainExe, $uninstaller)) {
    if (-not (Test-Path -LiteralPath $path)) {
      throw "Installed file is missing: $path"
    }
  }
  return [pscustomobject]@{
    InstallRoot = $installRoot
    MainExe = $mainExe
    Uninstaller = $uninstaller
  }
}

function Stop-App {
  Get-Process -Name 'desktop-course-widget' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400
}

function Probe-App([string]$Executable, [string]$Label) {
  Stop-App
  $process = Start-Process -FilePath $Executable -PassThru
  Start-Sleep -Seconds 4
  if ($process.HasExited) {
    throw "$Label exited during startup probe with code $($process.ExitCode)."
  }
  Stop-App
  Write-Host "$Label startup probe passed."
}

function Write-Utf8Json([string]$Path, $Value) {
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $json = $Value | ConvertTo-Json -Depth 30
  [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function Get-ActiveCatalogPath {
  $indexPath = Join-Path $dataRoot 'schedules\index.json'
  if (-not (Test-Path -LiteralPath $indexPath)) {
    throw "Legacy startup did not create schedules/index.json: $indexPath"
  }
  $index = Get-Content -Raw -LiteralPath $indexPath | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace([string]$index.activeScheduleId)) {
    throw 'Legacy/current shared catalog has no activeScheduleId.'
  }
  $activePath = Join-Path $dataRoot ("schedules\{0}.json" -f $index.activeScheduleId)
  if (-not (Test-Path -LiteralPath $activePath)) {
    throw "Active catalog schedule is missing: $activePath"
  }
  return $activePath
}

function Seed-SharedUserData {
  $legacyPath = Join-Path $dataRoot 'schedule.json'
  $settingsPath = Join-Path $dataRoot 'settings.json'
  $activePath = Get-ActiveCatalogPath

  $markerCourse = [ordered]@{
    name = '双目录迁移回归课'
    teacher = 'Dual Root QA'
    weekday = 4
    start = '10:10'
    end = '11:45'
    location = 'B-407'
    weeks = @(2, 4, 6, 8, 10)
    parity = 'all'
  }
  $legacy = [ordered]@{
    schemaVersion = 1
    semesterStart = '2026-08-24'
    semesterEnd = '2027-01-18'
    courses = @($markerCourse)
  }
  Write-Utf8Json $legacyPath $legacy

  $catalog = Get-Content -Raw -LiteralPath $activePath | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace([string]$catalog.id) -or
      [string]::IsNullOrWhiteSpace([string]$catalog.name)) {
    throw 'Active catalog schedule is not a valid catalog document.'
  }
  $catalog.semesterStart = $legacy.semesterStart
  $catalog.semesterEnd = $legacy.semesterEnd
  $catalog.courses = @(
    [ordered]@{
      id = 'dual-root-upgrade-course'
      name = $markerCourse.name
      color = '#CFE1FF'
      teacher = $markerCourse.teacher
      weekday = $markerCourse.weekday
      start = $markerCourse.start
      end = $markerCourse.end
      location = $markerCourse.location
      weeks = $markerCourse.weeks
      parity = $markerCourse.parity
    }
  )
  if ($catalog.PSObject.Properties.Name -contains 'updatedAt') {
    $catalog.updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
  Write-Utf8Json $activePath $catalog

  if (-not (Test-Path -LiteralPath $settingsPath)) {
    throw 'Legacy startup did not create settings.json.'
  }
  $settings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
  if (@($settings.lessonTimes).Count -lt 2) {
    throw 'Settings do not contain at least two lesson times.'
  }
  $settings.onboardingCompleted = $true
  $settings.equalDuration = $true
  $settings.lessonTimes[0].start = '10:10'
  $settings.lessonTimes[0].end = '10:55'
  $settings.lessonTimes[1].start = '11:00'
  $settings.lessonTimes[1].end = '11:45'
  Write-Utf8Json $settingsPath $settings

  Write-Host "seeded shared user data under identifier '$bundleId': legacy='$legacyPath' catalog='$activePath' settings='$settingsPath'"
}

function Assert-SharedUserData {
  if (-not (Test-Path -LiteralPath $dataRoot)) {
    throw "Shared AppData root was removed: $dataRoot"
  }
  $legacyPath = Join-Path $dataRoot 'schedule.json'
  $activePath = Get-ActiveCatalogPath
  $settingsPath = Join-Path $dataRoot 'settings.json'

  foreach ($schedulePath in @($legacyPath, $activePath)) {
    if (-not (Test-Path -LiteralPath $schedulePath)) {
      throw "Retained timetable file is missing: $schedulePath"
    }
    $schedule = Get-Content -Raw -LiteralPath $schedulePath | ConvertFrom-Json
    $course = @($schedule.courses | Where-Object { $_.name -eq '双目录迁移回归课' }) | Select-Object -First 1
    if (-not $course) {
      throw "Dual-root upgrade did not preserve the timetable marker in $schedulePath."
    }
    $weeks = @($course.weeks | ForEach-Object { [int]$_ })
    if ([int]$course.weekday -ne 4 -or [string]$course.location -ne 'B-407' -or
        ($weeks -join ',') -ne '2,4,6,8,10') {
      throw "Dual-root timetable marker changed unexpectedly in $schedulePath."
    }
  }

  if (-not (Test-Path -LiteralPath $settingsPath)) {
    throw 'Dual-root upgrade removed settings.json.'
  }
  $settings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
  $lesson1 = @($settings.lessonTimes | Where-Object { $_.section -eq 1 }) | Select-Object -First 1
  $lesson2 = @($settings.lessonTimes | Where-Object { $_.section -eq 2 }) | Select-Object -First 1
  if (-not $settings.onboardingCompleted -or -not $settings.equalDuration -or
      $lesson1.start -ne '10:10' -or $lesson1.end -ne '10:55' -or
      $lesson2.start -ne '11:00' -or $lesson2.end -ne '11:45') {
    throw 'Dual-root upgrade did not preserve the lesson-time/settings marker.'
  }
  Write-Host "shared AppData/timetable/settings preserved: $dataRoot"
}

function Download-VerifiedInstaller([string]$Version, [string]$Url, [string]$Sha256, [string]$OutFile) {
  Write-Host "Downloading public release $Version from $Url"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $OutFile).Hash.ToLowerInvariant()
  if ($actual -ne $Sha256.ToLowerInvariant()) {
    throw "Public $Version installer SHA-256 mismatch: $actual != $($Sha256.ToLowerInvariant())"
  }
  Write-Host "public release installer verified: version=$Version sha256=$actual"
}

if (@(Get-UninstallEntries $legacyProductName).Count -ne 0 -or
    @(Get-UninstallEntries $productName).Count -ne 0) {
  throw 'Dual-install runner already contains a legacy or current course-widget installation.'
}

try {
  Download-VerifiedInstaller $legacyVersion $legacyUrl $legacySha256 $legacyInstaller
  Download-VerifiedInstaller $currentVersion $currentUrl $currentSha256 $currentInstaller

  $legacyInstall = Start-Process -FilePath $legacyInstaller -ArgumentList '/S' -PassThru -Wait
  if ($legacyInstall.ExitCode -ne 0) {
    throw "Public $legacyVersion installer exited with $($legacyInstall.ExitCode)."
  }
  $legacyRegistration = Get-Registration $legacyProductName $legacyVersion
  $legacyPaths = Get-InstalledPaths $legacyRegistration
  Probe-App $legacyPaths.MainExe "public $legacyVersion '$legacyProductName'"
  Seed-SharedUserData

  $legacyStartShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$legacyProductName.lnk"
  $legacyDesktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$legacyProductName.lnk"
  foreach ($shortcut in @($legacyStartShortcut, $legacyDesktopShortcut)) {
    if (-not (Test-Path -LiteralPath $shortcut)) {
      throw "Public $legacyVersion did not create expected legacy shortcut: $shortcut"
    }
  }

  $currentInstall = Start-Process -FilePath $currentInstaller -ArgumentList '/S' -PassThru -Wait
  if ($currentInstall.ExitCode -ne 0) {
    throw "Public $currentVersion installer exited with $($currentInstall.ExitCode)."
  }
  $currentRegistration = Get-Registration $productName $currentVersion
  $currentPaths = Get-InstalledPaths $currentRegistration

  $legacyRoot = [IO.Path]::GetFullPath($legacyPaths.InstallRoot)
  $currentRoot = [IO.Path]::GetFullPath($currentPaths.InstallRoot)
  $expectedLegacyRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA $legacyProductName))
  $expectedCurrentRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA $productName))
  if ($legacyRoot -ne $expectedLegacyRoot) {
    throw "Legacy install root is '$legacyRoot', expected '$expectedLegacyRoot'."
  }
  if ($currentRoot -ne $expectedCurrentRoot) {
    throw "Current install root is '$currentRoot', expected '$expectedCurrentRoot'."
  }
  if ($legacyRoot -eq $currentRoot) {
    throw "Real dual-install precondition failed: roots are identical ('$legacyRoot')."
  }
  if (@(Get-UninstallEntries $legacyProductName).Count -ne 1 -or
      @(Get-UninstallEntries $productName).Count -ne 1) {
    throw 'Real dual-install precondition failed: expected one legacy and one current registration.'
  }

  $currentStartShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$productName.lnk"
  $currentDesktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$productName.lnk"
  foreach ($shortcut in @($currentStartShortcut, $currentDesktopShortcut)) {
    if (-not (Test-Path -LiteralPath $shortcut)) {
      throw "Public $currentVersion did not create expected current shortcut: $shortcut"
    }
  }

  Probe-App $legacyPaths.MainExe "legacy copy in distinct root"
  Probe-App $currentPaths.MainExe "current copy in distinct root"
  Assert-SharedUserData
  Write-Host "real dual-install precondition verified: legacyRoot='$legacyRoot' currentRoot='$currentRoot'; both copies independently runnable"

  $candidateInstall = Start-Process -FilePath $Candidate -ArgumentList '/S' -PassThru -Wait
  if ($candidateInstall.ExitCode -ne 0) {
    throw "Candidate installer exited with $($candidateInstall.ExitCode)."
  }

  $candidateRegistration = Get-Registration $productName $ExpectedVersion
  $candidatePaths = Get-InstalledPaths $candidateRegistration
  if ([IO.Path]::GetFullPath($candidatePaths.InstallRoot) -ne $currentRoot) {
    throw "Candidate selected wrong root: '$($candidatePaths.InstallRoot)' instead of current '$currentRoot'."
  }
  if (@(Get-UninstallEntries $legacyProductName).Count -ne 0) {
    throw "Legacy '$legacyProductName' registration remained after candidate migration."
  }
  if (@(Get-UninstallEntries $productName).Count -ne 1) {
    throw "Expected exactly one '$productName' registration after candidate migration."
  }

  foreach ($shortcut in @($legacyStartShortcut, $legacyDesktopShortcut)) {
    if (Test-Path -LiteralPath $shortcut) {
      throw "Legacy shortcut remained after candidate migration: $shortcut"
    }
  }
  foreach ($shortcut in @($currentStartShortcut, $currentDesktopShortcut)) {
    if (-not (Test-Path -LiteralPath $shortcut)) {
      throw "Current shortcut is missing after candidate migration: $shortcut"
    }
  }

  $shell = New-Object -ComObject WScript.Shell
  $startTarget = [IO.Path]::GetFullPath($shell.CreateShortcut($currentStartShortcut).TargetPath)
  $expectedTarget = [IO.Path]::GetFullPath($candidatePaths.MainExe)
  if ($startTarget -ne $expectedTarget) {
    throw "Current Start Menu shortcut targets '$startTarget', expected '$expectedTarget'."
  }

  Wait-Condition { -not (Test-Path -LiteralPath $legacyPaths.MainExe) } 'Legacy main executable remained in the old program root.' 45
  Wait-Condition { -not (Test-Path -LiteralPath $legacyPaths.Uninstaller) } 'Legacy uninstaller remained in the old program root.' 45
  if (Test-Path -LiteralPath $currentPaths.MainExe) {
    $currentAfter = [IO.Path]::GetFullPath($currentPaths.MainExe)
    if ($currentAfter -ne $expectedTarget) {
      throw "Unexpected current executable path after candidate migration: $currentAfter"
    }
  }

  Assert-SharedUserData
  Probe-App $candidatePaths.MainExe "candidate $ExpectedVersion after dual-root migration"
  Assert-SharedUserData

  Write-Host "real v0.3.0 dual-root migration passed: old program copy removed by its default-data-preserving uninstaller; only one '$productName' identity remains; new shortcuts valid; shared AppData/timetable/settings preserved"
  if ($env:GITHUB_STEP_SUMMARY) {
    @(
      '### Public v0.3.0 real dual-install migration',
      '',
      "- legacy root: $legacyRoot",
      "- current root: $currentRoot",
      '- precondition: both real public installations existed and were independently runnable',
      '- legacy registration: removed',
      '- legacy shortcuts: removed',
      '- legacy executable/uninstaller: removed by legacy silent uninstaller',
      '- current registration: exactly one',
      '- current shortcuts: valid',
      '- shared AppData/timetable/settings: preserved'
    ) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
  }
}
finally {
  Stop-App
  foreach ($name in @($productName, $legacyProductName)) {
    foreach ($entry in @(Get-UninstallEntries $name)) {
      try {
        $paths = Get-InstalledPaths $entry
        Start-Process -FilePath $paths.Uninstaller -ArgumentList '/S' -Wait -ErrorAction SilentlyContinue | Out-Null
      }
      catch {}
    }
  }
  if ($testCreatedDataRoot -and (Test-Path -LiteralPath $dataRoot)) {
    Remove-Item -Recurse -Force -LiteralPath $dataRoot -ErrorAction SilentlyContinue
  }
  Remove-Item -Force -LiteralPath $legacyInstaller -ErrorAction SilentlyContinue
  Remove-Item -Force -LiteralPath $currentInstaller -ErrorAction SilentlyContinue
}
