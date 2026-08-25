param(
  [Parameter(Mandatory = $true)]
  [string]$Candidate
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ReleaseUpgradeNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@

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

function Get-TopLevelWindowHandles {
  $handles = @{}
  try {
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($window in $windows) {
      try {
        $handle = [long]$window.Current.NativeWindowHandle
        if ($handle -gt 0) { $handles[$handle] = $true }
      }
      catch {}
    }
  }
  catch {}
  return $handles
}

function Get-WindowElement([long]$Handle) {
  if ($Handle -le 0) { return $null }
  try {
    return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Handle)
  }
  catch {
    return $null
  }
}

function Get-WindowText([long]$Handle) {
  $window = Get-WindowElement $Handle
  if (-not $window) { return '' }
  try {
    $elements = $window.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )
  }
  catch {
    return ''
  }
  $names = foreach ($element in $elements) {
    try {
      $name = [string]$element.Current.Name
      if (-not [string]::IsNullOrWhiteSpace($name)) { $name }
    }
    catch {}
  }
  return ($names -join "`n")
}

function Get-WindowObservation([long]$Handle) {
  $observation = [ordered]@{
    Handle = $Handle
    Title = ''
    ProcessId = 0
    Width = 0
    Height = 0
    Left = 0
    Top = 0
    Visible = $false
    IsOffscreen = $true
    Text = ''
  }
  if ($Handle -le 0) { return [pscustomobject]$observation }

  $nativeHandle = [IntPtr]$Handle
  try { $observation.Visible = [ReleaseUpgradeNative]::IsWindowVisible($nativeHandle) } catch {}
  try {
    $rect = New-Object ReleaseUpgradeNative+RECT
    if ([ReleaseUpgradeNative]::GetWindowRect($nativeHandle, [ref]$rect)) {
      $observation.Width = $rect.Right - $rect.Left
      $observation.Height = $rect.Bottom - $rect.Top
      $observation.Left = $rect.Left
      $observation.Top = $rect.Top
    }
  }
  catch {}

  $window = Get-WindowElement $Handle
  if ($window) {
    try { $observation.Title = [string]$window.Current.Name } catch {}
    try { $observation.ProcessId = [int]$window.Current.ProcessId } catch {}
    try { $observation.IsOffscreen = [bool]$window.Current.IsOffscreen } catch {}
    try { $observation.Text = Get-WindowText $Handle } catch {}
  }
  return [pscustomobject]$observation
}

function Test-UninstallerWindowObservation($Observation, [datetime]$StartedAt) {
  if (-not $Observation -or [long]$Observation.Handle -le 0) { return $false }
  if (-not $Observation.Visible -or $Observation.IsOffscreen) { return $false }
  if ($Observation.Width -lt 300 -or $Observation.Width -gt 900 -or
      $Observation.Height -lt 200 -or $Observation.Height -gt 700) { return $false }
  if ([int]$Observation.ProcessId -le 0) { return $false }

  try {
    $process = Get-Process -Id ([int]$Observation.ProcessId) -ErrorAction Stop
    $process.Refresh()
    if ($process.HasExited -or $process.StartTime -lt $StartedAt.AddSeconds(-1)) { return $false }
  }
  catch {
    return $false
  }

  $identityText = "$($Observation.Title)`n$($Observation.Text)"
  if ($identityText -notmatch [regex]::Escape($productName)) { return $false }
  if ($identityText -notmatch '卸载|Uninstall') { return $false }
  return $true
}

function Format-WindowObservation($Observation) {
  if (-not $Observation) { return '<null>' }
  $text = ([string]$Observation.Text -replace '\s+', ' ').Trim()
  if ($text.Length -gt 220) { $text = $text.Substring(0, 220) + '...' }
  return "handle=$($Observation.Handle) title='$($Observation.Title)' pid=$($Observation.ProcessId) bounds=$($Observation.Width)x$($Observation.Height)@$($Observation.Left),$($Observation.Top) visible=$($Observation.Visible) offscreen=$($Observation.IsOffscreen) text='$text'"
}

function Wait-NewUninstallerWindow(
  [hashtable]$BaselineHandles,
  [datetime]$StartedAt,
  [Diagnostics.Process]$Bootstrap,
  [int]$TimeoutSeconds = 30
) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $observed = [ordered]@{}

  while ((Get-Date) -lt $deadline) {
    try {
      $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition
      )
    }
    catch {
      Start-Sleep -Milliseconds 200
      continue
    }

    foreach ($window in $windows) {
      $handle = 0L
      try { $handle = [long]$window.Current.NativeWindowHandle } catch { continue }
      if ($handle -le 0 -or $BaselineHandles.ContainsKey($handle)) { continue }

      $observation = Get-WindowObservation $handle
      $looksRelevant = $observation.Visible -and (
        ($observation.Width -ge 300 -and $observation.Width -le 900 -and
         $observation.Height -ge 200 -and $observation.Height -le 700) -or
        $observation.Title -match [regex]::Escape($productName) -or
        $observation.Text -match '卸载|Uninstall'
      )
      if ($looksRelevant -and ($observed.Contains($handle) -or $observed.Count -lt 12)) {
        $observed[$handle] = $observation
      }

      if (-not (Test-UninstallerWindowObservation $observation $StartedAt)) { continue }

      # NSIS can create the UIA element before the final UI process/window settles.
      # Reacquire from HWND after a short stabilization interval and require the same
      # process/identity again before handing anything to the caller.
      Start-Sleep -Milliseconds 150
      $stable = Get-WindowObservation $handle
      if (-not (Test-UninstallerWindowObservation $stable $StartedAt)) { continue }
      if ([int]$stable.ProcessId -ne [int]$observation.ProcessId) { continue }

      return $stable
    }
    Start-Sleep -Milliseconds 200
  }

  $bootstrapState = 'unknown'
  $bootstrapPid = 0
  if ($Bootstrap) {
    $bootstrapPid = $Bootstrap.Id
    try {
      $Bootstrap.Refresh()
      if ($Bootstrap.HasExited) {
        $bootstrapState = "exited code=$($Bootstrap.ExitCode)"
      }
      else {
        $bootstrapState = 'running'
      }
    }
    catch {
      $bootstrapState = "unreadable: $($_.Exception.Message)"
    }
  }

  $diagnostics = @($observed.Values | ForEach-Object { Format-WindowObservation $_ })
  if ($diagnostics.Count -eq 0) { $diagnostics = @('<none>') }
  throw "Timed out waiting for the candidate uninstaller window after NSIS process handoff. bootstrapPid=$bootstrapPid bootstrapState=$bootstrapState Observed new candidate windows:`n$($diagnostics -join "`n")"
}

function Enable-DeleteDataOption([long]$Handle, [int]$TimeoutSeconds = 12) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $window = Get-WindowElement $Handle
    if (-not $window) {
      Start-Sleep -Milliseconds 200
      continue
    }

    try {
      $elements = $window.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
      )
    }
    catch {
      Start-Sleep -Milliseconds 200
      continue
    }

    foreach ($element in $elements) {
      try {
        if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::CheckBox -or
            [string]$element.Current.Name -notmatch '应用数据|app data') { continue }

        $toggleObject = $null
        if (-not $element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$toggleObject)) {
          continue
        }
        $toggle = [System.Windows.Automation.TogglePattern]$toggleObject
        if ($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) {
          $toggle.Toggle()
          Start-Sleep -Milliseconds 150
        }
        if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) {
          Write-Host 'candidate uninstaller delete-app-data option enabled.'
          return
        }
      }
      catch {
        # Treat UIA failures as transient. The next poll reacquires the window from HWND.
      }
    }
    Start-Sleep -Milliseconds 200
  }

  $text = Get-WindowText $Handle
  throw "Candidate uninstaller delete-app-data checkbox could not be enabled. Window text:`n$text"
}

function Invoke-UninstallerAction([long]$Handle, [int]$TimeoutSeconds = 10) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $window = Get-WindowElement $Handle
    if (-not $window) {
      Start-Sleep -Milliseconds 200
      continue
    }

    try {
      $elements = $window.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
      )
    }
    catch {
      Start-Sleep -Milliseconds 200
      continue
    }

    foreach ($element in $elements) {
      try {
        if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button -or
            [string]$element.Current.Name -notmatch '^(卸载|Uninstall)') { continue }

        $invokeObject = $null
        if (-not $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokeObject)) {
          continue
        }
        ([System.Windows.Automation.InvokePattern]$invokeObject).Invoke()
        Write-Host 'candidate uninstaller action invoked.'
        return
      }
      catch {
        # Treat UIA failures as transient. The next poll reacquires the window from HWND.
      }
    }
    Start-Sleep -Milliseconds 200
  }

  $text = Get-WindowText $Handle
  throw "Candidate uninstaller action button could not be invoked. Window text:`n$text"
}

function Invoke-DeleteDataUninstall([string]$Uninstaller) {
  $baselineWindows = Get-TopLevelWindowHandles
  $startedAt = Get-Date
  $bootstrap = Start-Process -FilePath $Uninstaller -PassThru
  $uninstaller = Wait-NewUninstallerWindow $baselineWindows $startedAt $bootstrap 30

  if (-not $uninstaller -or
      -not $uninstaller.PSObject.Properties['Handle'] -or
      -not $uninstaller.PSObject.Properties['ProcessId']) {
    throw 'Candidate uninstaller handoff returned an incomplete result.'
  }
  $uiHandle = [long]$uninstaller.Handle
  $uiProcessId = [int]$uninstaller.ProcessId
  if ($uiHandle -le 0 -or $uiProcessId -le 0) {
    throw "Candidate uninstaller handoff returned invalid handle/pid: handle=$uiHandle pid=$uiProcessId."
  }

  try {
    $uiProcess = Get-Process -Id $uiProcessId -ErrorAction Stop
    $uiProcess.Refresh()
    if ($uiProcess.HasExited) { throw 'UI process already exited.' }
  }
  catch {
    throw "Candidate uninstaller UI process was not stable after handoff: pid=$uiProcessId $($_.Exception.Message)"
  }

  $confirmed = Get-WindowObservation $uiHandle
  if (-not (Test-UninstallerWindowObservation $confirmed $startedAt) -or
      [int]$confirmed.ProcessId -ne $uiProcessId) {
    throw "Candidate uninstaller UI became invalid immediately after handoff: $(Format-WindowObservation $confirmed)"
  }

  Write-Host "candidate interactive uninstaller UI recognized: bootstrapPid=$($bootstrap.Id) uiPid=$uiProcessId handle=$uiHandle title='$($confirmed.Title)'"
  Enable-DeleteDataOption $uiHandle 12
  Start-Sleep -Milliseconds 300
  Invoke-UninstallerAction $uiHandle 10
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
