param(
  [Parameter(Mandatory = $true)]
  [string]$Candidate
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$config = Get-Content -Raw -LiteralPath 'src-tauri/tauri.conf.json' | ConvertFrom-Json
$productName = [string]$config.productName
$bundleId = [string]$config.identifier
$expectedVersion = [string]$config.version
$publisher = [string]$config.bundle.publisher

$baseVersion = '0.5.0-beta.1'
$baseUrl = 'https://github.com/Tyr1onX/desktop-course-widget/releases/download/v0.5.0-beta.1/_0.5.0-beta.1_x64-setup.exe'
$baseSha256 = '8ac5d9e62bc492e0e80e3aad94c338c070b0cc349f0d11ec35c7f5a909980126'
$baseInstaller = Join-Path $env:RUNNER_TEMP 'course-widget-v0.5.0-beta.1.exe'
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

function Get-UninstallEntries {
  $roots = @(
    @{ Hive = 'HKCU'; Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' },
    @{ Hive = 'HKLM'; Path = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' },
    @{ Hive = 'HKLM32'; Path = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' }
  )
  $matches = foreach ($root in $roots) {
    Get-ItemProperty -Path $root.Path -ErrorAction SilentlyContinue |
      Where-Object {
        $_.DisplayName -eq $productName -and
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

function Get-Registration([string]$Version) {
  $entries = @(Get-UninstallEntries)
  if ($entries.Count -ne 1) {
    throw "Expected exactly one $productName uninstall registration, found $($entries.Count)."
  }
  $entry = $entries[0]
  if ($entry.Hive -ne 'HKCU') {
    throw "Expected current-user uninstall registration, found $($entry.Hive)."
  }
  if ($entry.DisplayVersion -ne $Version) {
    throw "Installed version is '$($entry.DisplayVersion)', expected '$Version'."
  }
  return $entry
}

function Get-InstalledPaths($Registration) {
  $installRoot = $Registration.InstallLocation
  if ([string]::IsNullOrWhiteSpace($installRoot)) {
    throw 'InstallLocation is missing from the uninstall registration.'
  }
  $mainBinary = $Registration.MainBinaryName
  if ([string]::IsNullOrWhiteSpace($mainBinary)) {
    $mainBinary = 'desktop-course-widget.exe'
  }
  $mainExe = Join-Path $installRoot $mainBinary
  $uninstaller = Join-Path $installRoot 'uninstall.exe'
  foreach ($path in @($mainExe, $uninstaller)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Installed file is missing: $path" }
  }
  [pscustomobject]@{ InstallRoot = $installRoot; MainExe = $mainExe; Uninstaller = $uninstaller }
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
    throw 'Public beta.1 did not create schedules/index.json after startup.'
  }
  $index = Get-Content -Raw -LiteralPath $indexPath | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace([string]$index.activeScheduleId)) {
    throw 'Public beta.1 catalog has no activeScheduleId.'
  }
  $activePath = Join-Path $dataRoot ("schedules\{0}.json" -f $index.activeScheduleId)
  if (-not (Test-Path -LiteralPath $activePath)) {
    throw "Public beta.1 active catalog schedule is missing: $activePath"
  }
  return $activePath
}

function Seed-Beta1UserData {
  $legacyPath = Join-Path $dataRoot 'schedule.json'
  $settingsPath = Join-Path $dataRoot 'settings.json'
  $activePath = Get-ActiveCatalogPath

  $markerCourse = [ordered]@{
    name = '发布升级回归课'
    teacher = 'Release QA'
    weekday = 2
    start = '08:10'
    end = '09:45'
    location = 'A-305'
    weeks = @(1, 3, 5, 7, 9)
    parity = 'all'
  }
  $legacy = [ordered]@{
    schemaVersion = 1
    semesterStart = '2026-08-24'
    semesterEnd = '2027-01-18'
    courses = @($markerCourse)
  }
  Write-Utf8Json $legacyPath $legacy

  # beta.1 already uses the catalog schema. Keep that real schema intact and only
  # replace the user-facing timetable fields so the upgrade starts from valid data.
  $catalog = Get-Content -Raw -LiteralPath $activePath | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace([string]$catalog.id) -or
      [string]::IsNullOrWhiteSpace([string]$catalog.name)) {
    throw 'Public beta.1 active catalog schedule is not a valid catalog document.'
  }
  $catalog.semesterStart = $legacy.semesterStart
  $catalog.semesterEnd = $legacy.semesterEnd
  $catalog.courses = @(
    [ordered]@{
      id = 'release-upgrade-course'
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
    throw 'Public beta.1 did not create settings.json after startup.'
  }
  $settings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
  if (@($settings.lessonTimes).Count -lt 2) {
    throw 'Public beta.1 settings do not contain at least two lesson times.'
  }
  $settings.onboardingCompleted = $true
  $settings.equalDuration = $true
  $settings.lessonTimes[0].start = '08:10'
  $settings.lessonTimes[0].end = '08:55'
  $settings.lessonTimes[1].start = '09:00'
  $settings.lessonTimes[1].end = '09:45'
  Write-Utf8Json $settingsPath $settings

  Write-Host "seeded valid beta.1 user data: legacy='$legacyPath' catalog='$activePath' settings='$settingsPath'"
}

function Assert-RetainedUserData {
  $legacyPath = Join-Path $dataRoot 'schedule.json'
  $activePath = Get-ActiveCatalogPath
  $settingsPath = Join-Path $dataRoot 'settings.json'

  foreach ($schedulePath in @($legacyPath, $activePath)) {
    if (-not (Test-Path -LiteralPath $schedulePath)) { throw "Retained timetable file is missing: $schedulePath" }
    $schedule = Get-Content -Raw -LiteralPath $schedulePath | ConvertFrom-Json
    $course = @($schedule.courses | Where-Object { $_.name -eq '发布升级回归课' }) | Select-Object -First 1
    if (-not $course) { throw "Upgrade did not preserve the timetable marker in $schedulePath." }
    $weeks = @($course.weeks | ForEach-Object { [int]$_ })
    if ([int]$course.weekday -ne 2 -or [string]$course.location -ne 'A-305' -or
        ($weeks -join ',') -ne '1,3,5,7,9') {
      throw "Retained timetable marker changed unexpectedly in $schedulePath."
    }
  }

  if (-not (Test-Path -LiteralPath $settingsPath)) { throw 'Upgrade removed settings.json.' }
  $settings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
  $lesson1 = @($settings.lessonTimes | Where-Object { $_.section -eq 1 }) | Select-Object -First 1
  $lesson2 = @($settings.lessonTimes | Where-Object { $_.section -eq 2 }) | Select-Object -First 1
  if (-not $settings.onboardingCompleted -or -not $settings.equalDuration -or
      $lesson1.start -ne '08:10' -or $lesson1.end -ne '08:55' -or
      $lesson2.start -ne '09:00' -or $lesson2.end -ne '09:45') {
    throw 'Upgrade did not preserve the lesson-time/settings marker.'
  }
  Write-Host "public upgrade data preserved: legacy='$legacyPath' catalog='$activePath' settings='$settingsPath'"
}

function Get-UninstallerWindow([int]$TimeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($window in $windows) {
      try {
        $name = [string]$window.Current.Name
        if ($name -match '课刻.*卸载|卸载.*课刻|uninstall.*课刻|课刻.*uninstall') { return $window }
      }
      catch {}
    }
    Start-Sleep -Milliseconds 250
  }
  throw 'Timed out waiting for the candidate uninstaller window.'
}

function Invoke-DeleteDataUninstall([string]$Uninstaller) {
  Start-Process -FilePath $Uninstaller | Out-Null
  $window = Get-UninstallerWindow
  $elements = $window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )

  $checkbox = $null
  foreach ($element in $elements) {
    try {
      if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::CheckBox -and
          [string]$element.Current.Name -match '应用数据|app data') {
        $checkbox = $element
        break
      }
    }
    catch {}
  }
  if (-not $checkbox) { throw 'Candidate uninstaller delete-app-data checkbox was not found.' }

  $toggleObject = $null
  if (-not $checkbox.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$toggleObject)) {
    throw 'Candidate uninstaller delete-app-data checkbox has no TogglePattern.'
  }
  $toggle = [System.Windows.Automation.TogglePattern]$toggleObject
  if ($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) { $toggle.Toggle() }
  Start-Sleep -Milliseconds 300

  $button = $null
  foreach ($element in $elements) {
    try {
      if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
          [string]$element.Current.Name -match '^卸载|Uninstall') {
        $button = $element
        break
      }
    }
    catch {}
  }
  if (-not $button) { throw 'Candidate uninstaller action button was not found.' }

  $invokeObject = $null
  if (-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokeObject)) {
    throw 'Candidate uninstaller action button has no InvokePattern.'
  }
  ([System.Windows.Automation.InvokePattern]$invokeObject).Invoke()
}

if (@(Get-UninstallEntries).Count -ne 0) {
  throw "$productName is already installed on the release-upgrade runner."
}

try {
  Write-Host "Downloading public release $baseVersion from $baseUrl"
  Invoke-WebRequest -Uri $baseUrl -OutFile $baseInstaller
  $downloadHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $baseInstaller).Hash.ToLowerInvariant()
  if ($downloadHash -ne $baseSha256) {
    throw "Public $baseVersion installer SHA-256 mismatch: $downloadHash != $baseSha256"
  }
  Write-Host "public release installer verified: version=$baseVersion sha256=$downloadHash"

  $baseProcess = Start-Process -FilePath $baseInstaller -ArgumentList '/S' -PassThru -Wait
  if ($baseProcess.ExitCode -ne 0) { throw "Public $baseVersion installer exited with $($baseProcess.ExitCode)." }
  $baseRegistration = Get-Registration $baseVersion
  $basePaths = Get-InstalledPaths $baseRegistration
  Probe-App $basePaths.MainExe "public $baseVersion"
  Seed-Beta1UserData

  $candidateProcess = Start-Process -FilePath $Candidate -ArgumentList '/S' -PassThru -Wait
  if ($candidateProcess.ExitCode -ne 0) { throw "Candidate installer exited with $($candidateProcess.ExitCode)." }
  $candidateRegistration = Get-Registration $expectedVersion
  $candidatePaths = Get-InstalledPaths $candidateRegistration
  if ($candidatePaths.InstallRoot -ne $basePaths.InstallRoot) {
    throw "Upgrade changed install root: '$($basePaths.InstallRoot)' -> '$($candidatePaths.InstallRoot)'."
  }
  Probe-App $candidatePaths.MainExe "candidate $expectedVersion"
  Assert-RetainedUserData

  Stop-App
  $defaultUninstall = Start-Process -FilePath $candidatePaths.Uninstaller -ArgumentList '/S' -PassThru -Wait
  if ($defaultUninstall.ExitCode -ne 0) { throw "Candidate silent uninstaller exited with $($defaultUninstall.ExitCode)." }
  Wait-Condition { @(Get-UninstallEntries).Count -eq 0 } 'Candidate uninstall registration was not removed.'
  if (-not (Test-Path -LiteralPath $dataRoot)) { throw 'Default uninstall unexpectedly deleted application data.' }
  Assert-RetainedUserData
  Write-Host 'candidate default uninstall preserved application data as required.'

  $reinstall = Start-Process -FilePath $Candidate -ArgumentList '/S' -PassThru -Wait
  if ($reinstall.ExitCode -ne 0) { throw "Candidate reinstall exited with $($reinstall.ExitCode)." }
  $reinstalledRegistration = Get-Registration $expectedVersion
  $reinstalledPaths = Get-InstalledPaths $reinstalledRegistration
  Stop-App
  Invoke-DeleteDataUninstall $reinstalledPaths.Uninstaller
  Wait-Condition { @(Get-UninstallEntries).Count -eq 0 } 'Interactive candidate uninstall registration was not removed.' 45
  Wait-Condition { -not (Test-Path -LiteralPath $dataRoot) } 'Delete-app-data option did not remove the application data directory.' 45
  Write-Host 'candidate uninstaller delete-app-data option removed application data as required.'

  Write-Host "public release upgrade smoke passed: $baseVersion -> $expectedVersion; timetable/settings preserved; default uninstall preserved data; delete-app-data removed data"
  if ($env:GITHUB_STEP_SUMMARY) {
    @(
      '### Public release upgrade smoke',
      '',
      "- upgrade: $baseVersion → $expectedVersion",
      '- public installer SHA-256: verified',
      '- legacy and active catalog timetable: preserved',
      '- lesson-time/settings marker: preserved',
      '- candidate startup: passed',
      '- candidate-own uninstaller: passed',
      '- default uninstall data policy: preserved',
      '- delete-app-data option: removed data'
    ) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
  }
}
finally {
  Stop-App
  $entries = @(Get-UninstallEntries)
  foreach ($entry in $entries) {
    try {
      $paths = Get-InstalledPaths $entry
      Start-Process -FilePath $paths.Uninstaller -ArgumentList '/S' -Wait -ErrorAction SilentlyContinue | Out-Null
    }
    catch {}
  }
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -match '课刻.*卸载|卸载.*课刻|uninstall.*课刻|课刻.*uninstall' } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  if ($testCreatedDataRoot -and (Test-Path -LiteralPath $dataRoot)) {
    Remove-Item -Recurse -Force -LiteralPath $dataRoot -ErrorAction SilentlyContinue
  }
  Remove-Item -Force -LiteralPath $baseInstaller -ErrorAction SilentlyContinue
}
