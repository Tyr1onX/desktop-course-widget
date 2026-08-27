param(
  [Parameter(Mandatory = $true)]
  [string]$Candidate,
  [string]$BaseVersion = '0.5.0-beta.1',
  [string]$BaseUrl = 'https://github.com/Tyr1onX/desktop-course-widget/releases/download/v0.5.0-beta.1/_0.5.0-beta.1_x64-setup.exe',
  [string]$BaseSha256 = '8ac5d9e62bc492e0e80e3aad94c338c070b0cc349f0d11ec35c7f5a909980126',
  [string]$LegacyProductName = '',
  [string]$ExpectedVersion = ''
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

. (Join-Path $PSScriptRoot 'windows-installer-ui.ps1')

$config = Get-Content -Raw -LiteralPath 'src-tauri/tauri.conf.json' | ConvertFrom-Json
$productName = [string]$config.productName
$bundleId = [string]$config.identifier
$expectedVersion = if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) { [string]$config.version } else { $ExpectedVersion }
$publisher = [string]$config.bundle.publisher

$baseVersion = $BaseVersion
$baseUrl = $BaseUrl
$baseSha256 = $BaseSha256.ToLowerInvariant()
$baseInstaller = Join-Path $env:RUNNER_TEMP ("course-widget-{0}.exe" -f $baseVersion)
$baseProductName = if ([string]::IsNullOrWhiteSpace($LegacyProductName)) { $productName } else { $LegacyProductName }
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

function Get-UninstallEntries([string]$Name = $productName) {
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

function Get-Registration([string]$Version, [string]$Name = $productName) {
  $entries = @(Get-UninstallEntries -Name $Name)
  if ($entries.Count -ne 1) {
    throw "Expected exactly one $Name uninstall registration, found $($entries.Count)."
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
  $indexPath = Join-Path $dataRoot 'schedules\index.json'
  $activePath = if (Test-Path -LiteralPath $indexPath) { Get-ActiveCatalogPath } else { $null }

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

  if ($activePath) {
    # beta.1 already uses the catalog schema. Keep that real schema intact and only
    # replace the user-facing timetable fields so the upgrade starts from valid data.
    $catalog = Get-Content -Raw -LiteralPath $activePath | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$catalog.id) -or
        [string]::IsNullOrWhiteSpace([string]$catalog.name)) {
      throw "Public $baseVersion active catalog schedule is not a valid catalog document."
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
  }
  else {
    Write-Host "public $baseVersion uses pre-catalog legacy schedule storage; candidate startup must migrate schedule.json into the active catalog"
  }

  if (-not (Test-Path -LiteralPath $settingsPath)) {
    throw "Public $baseVersion did not create settings.json after startup."
  }
  $settings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
  if (@($settings.lessonTimes).Count -lt 2) {
    throw "Public $baseVersion settings do not contain at least two lesson times."
  }
  $settings.onboardingCompleted = $true
  $settings.equalDuration = $true
  $settings.lessonTimes[0].start = '08:10'
  $settings.lessonTimes[0].end = '08:55'
  $settings.lessonTimes[1].start = '09:00'
  $settings.lessonTimes[1].end = '09:45'
  Write-Utf8Json $settingsPath $settings

  $catalogLabel = if ($activePath) { $activePath } else { '<pre-catalog baseline>' }
  Write-Host "seeded valid public $baseVersion user data: legacy='$legacyPath' catalog='$catalogLabel' settings='$settingsPath'"
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

function Seed-LegacyIdentityResidue([string]$Name, [string]$InstallRoot, [string]$MainExe, [string]$Uninstaller) {
  $uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Name"
  New-Item -Path $uninstallKey -Force | Out-Null
  New-ItemProperty -LiteralPath $uninstallKey -Name DisplayName -Value $Name -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion -Value $baseVersion -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $uninstallKey -Name Publisher -Value $publisher -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $uninstallKey -Name InstallLocation -Value $InstallRoot -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $uninstallKey -Name UninstallString -Value ('"{0}"' -f $Uninstaller) -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $uninstallKey -Name MainBinaryName -Value ([IO.Path]::GetFileName($MainExe)) -PropertyType String -Force | Out-Null
  $legacyProductKey = "HKCU:\Software\$publisher\$Name"
  New-Item -Path $legacyProductKey -Force | Out-Null
  Set-Item -LiteralPath $legacyProductKey -Value $InstallRoot
  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcutPath in @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) "$Name.lnk"),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "$Name.lnk")
  )) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $MainExe
    $shortcut.WorkingDirectory = $InstallRoot
    $shortcut.Save()
  }
  Write-Host "seeded exact legacy identity residue while current '$productName' remains installed: '$Name'"
}

function Enable-DeleteDataOption([IntPtr]$Handle, [int]$TimeoutSeconds = 12) {
  $BM_GETCHECK = 0x00F0
  $BM_CLICK = 0x00F5
  $BST_CHECKED = 1
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastCandidates = [System.Collections.Generic.List[string]]::new()

  while ((Get-Date) -lt $deadline) {
    $window = Get-InstallerWindowElement $Handle
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

    $lastCandidates.Clear()
    foreach ($element in $elements) {
      try {
        $name = [string]$element.Current.Name
        if ($name -notmatch '应用(?:程序)?数据|app data') { continue }

        $nativeHandle = [IntPtr][long]$element.Current.NativeWindowHandle
        $controlType = [string]$element.Current.ControlType.ProgrammaticName
        $toggleObject = $null
        $hasToggle = $element.TryGetCurrentPattern(
          [System.Windows.Automation.TogglePattern]::Pattern,
          [ref]$toggleObject
        )
        [void]$lastCandidates.Add("name='$name' type='$controlType' hwnd=$($nativeHandle.ToInt64()) toggle=$hasToggle")

        if ($hasToggle) {
          $toggle = [System.Windows.Automation.TogglePattern]$toggleObject
          if ($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) {
            $toggle.Toggle()
            Start-Sleep -Milliseconds 150
          }
          if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) {
            Write-Host "candidate uninstaller delete-app-data option enabled via UIA: type='$controlType' hwnd=$($nativeHandle.ToInt64())."
            return
          }
        }

        # Tauri's pinned NSIS template creates this option with CreateWindowEx as a
        # native checkbox HWND and later reads it with BM_GETCHECK. Some Windows CI
        # UIA providers expose its label but not TogglePattern, so use that same HWND
        # and native checkbox protocol rather than inventing another window finder.
        if ($nativeHandle -ne [IntPtr]::Zero) {
          $state = [InstallerUiHandoffNative]::SendMessage(
            $nativeHandle,
            $BM_GETCHECK,
            [IntPtr]::Zero,
            [IntPtr]::Zero
          ).ToInt64()
          if ($state -ne $BST_CHECKED) {
            [void][InstallerUiHandoffNative]::SendMessage(
              $nativeHandle,
              $BM_CLICK,
              [IntPtr]::Zero,
              [IntPtr]::Zero
            )
            Start-Sleep -Milliseconds 150
            $state = [InstallerUiHandoffNative]::SendMessage(
              $nativeHandle,
              $BM_GETCHECK,
              [IntPtr]::Zero,
              [IntPtr]::Zero
            ).ToInt64()
          }
          if ($state -eq $BST_CHECKED) {
            Write-Host "candidate uninstaller delete-app-data option enabled via native checkbox HWND=$($nativeHandle.ToInt64())."
            return
          }
        }
      }
      catch {
        # Treat UIA/native-control failures as transient. The next poll reacquires
        # the already recognized uninstaller window from its HWND.
      }
    }
    Start-Sleep -Milliseconds 200
  }

  $text = Get-InstallerWindowText $Handle
  $candidates = if ($lastCandidates.Count -gt 0) { $lastCandidates -join '; ' } else { '<none>' }
  throw "Candidate uninstaller delete-app-data checkbox could not be enabled. Candidates: $candidates Window text:`n$text"
}

function Invoke-UninstallerAction([IntPtr]$Handle, [int]$TimeoutSeconds = 10) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $window = Get-InstallerWindowElement $Handle
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

  $text = Get-InstallerWindowText $Handle
  throw "Candidate uninstaller action button could not be invoked. Window text:`n$text"
}

function Invoke-DeleteDataUninstall([string]$Uninstaller) {
  $baselineWindows = Get-InstallerTopLevelWindowHandles
  $startedAt = Get-Date
  $bootstrap = Start-Process -FilePath $Uninstaller -PassThru
  $uninstallerWindow = Wait-NewUninstallerWindow `
    -BaselineHandles $baselineWindows `
    -StartedAt $startedAt `
    -ProductName $productName `
    -Bootstrap $bootstrap `
    -Seconds 30

  if (-not $uninstallerWindow -or
      -not $uninstallerWindow.PSObject.Properties['Process'] -or
      -not $uninstallerWindow.PSObject.Properties['Handle'] -or
      -not $uninstallerWindow.PSObject.Properties['Title']) {
    throw 'Candidate uninstaller handoff returned an incomplete result.'
  }

  $uiProcess = $uninstallerWindow.Process
  $uiHandle = [IntPtr]$uninstallerWindow.Handle
  if (-not $uiProcess -or $uiHandle -eq [IntPtr]::Zero) {
    throw "Candidate uninstaller handoff returned invalid process/handle: handle=$($uiHandle.ToInt64())."
  }

  try {
    $uiProcess.Refresh()
    if ($uiProcess.HasExited) { throw 'UI process already exited.' }
  }
  catch {
    throw "Candidate uninstaller UI process was not stable after handoff: pid=$($uiProcess.Id) $($_.Exception.Message)"
  }

  Write-Host "candidate interactive uninstaller UI recognized: bootstrapPid=$($bootstrap.Id) uiPid=$($uiProcess.Id) handle=$($uiHandle.ToInt64()) title='$($uninstallerWindow.Title)'"
  Enable-DeleteDataOption $uiHandle 12
  Start-Sleep -Milliseconds 300
  Invoke-UninstallerAction $uiHandle 10
}

if (@(Get-UninstallEntries -Name $productName).Count -ne 0) {
  throw "$productName is already installed on the release-upgrade runner."
}
if ($baseProductName -ne $productName -and @(Get-UninstallEntries -Name $baseProductName).Count -ne 0) {
  throw "$baseProductName is already installed on the release-upgrade runner."
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
  $baseRegistration = Get-Registration $baseVersion $baseProductName
  $basePaths = Get-InstalledPaths $baseRegistration
  Probe-App $basePaths.MainExe "public $baseVersion"
  Seed-Beta1UserData

  $legacyStartShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$baseProductName.lnk"
  $legacyDesktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$baseProductName.lnk"
  if ($baseProductName -ne $productName) {
    if (-not (Test-Path -LiteralPath $legacyStartShortcut)) {
      throw "Public $baseVersion did not create the expected legacy Start Menu shortcut: $legacyStartShortcut"
    }
    if (-not (Test-Path -LiteralPath $legacyDesktopShortcut)) {
      throw "Public $baseVersion did not create the expected legacy desktop shortcut: $legacyDesktopShortcut"
    }
    Write-Host "legacy Windows identity verified before upgrade: DisplayName='$baseProductName' installRoot='$($basePaths.InstallRoot)'"
  }

  $candidateProcess = Start-Process -FilePath $Candidate -ArgumentList '/S' -PassThru -Wait
  if ($candidateProcess.ExitCode -ne 0) { throw "Candidate installer exited with $($candidateProcess.ExitCode)." }
  $candidateRegistration = Get-Registration $expectedVersion
  $candidatePaths = Get-InstalledPaths $candidateRegistration
  if ($candidatePaths.InstallRoot -ne $basePaths.InstallRoot) {
    throw "Upgrade changed install root: '$($basePaths.InstallRoot)' -> '$($candidatePaths.InstallRoot)'."
  }
  if ($baseProductName -ne $productName) {
    if (@(Get-UninstallEntries -Name $baseProductName).Count -ne 0) {
      throw "Legacy uninstall registration '$baseProductName' remained after candidate upgrade."
    }
    if (Test-Path -LiteralPath $legacyStartShortcut) {
      throw "Legacy Start Menu shortcut remained after migration: $legacyStartShortcut"
    }
    if (Test-Path -LiteralPath $legacyDesktopShortcut) {
      throw "Legacy desktop shortcut remained after migration: $legacyDesktopShortcut"
    }
    $newStartShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$productName.lnk"
    $newDesktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$productName.lnk"
    foreach ($shortcut in @($newStartShortcut, $newDesktopShortcut)) {
      if (-not (Test-Path -LiteralPath $shortcut)) {
        throw "Migrated $productName shortcut is missing: $shortcut"
      }
    }
    $shell = New-Object -ComObject WScript.Shell
    $startTarget = [IO.Path]::GetFullPath($shell.CreateShortcut($newStartShortcut).TargetPath)
    $expectedTarget = [IO.Path]::GetFullPath($candidatePaths.MainExe)
    if ($startTarget -ne $expectedTarget) {
      throw "Migrated Start Menu shortcut targets '$startTarget', expected '$expectedTarget'."
    }
    Write-Host "legacy brand migration verified: old registration/shortcuts removed; new identity='$productName'; installRoot preserved"
  }
  Probe-App $candidatePaths.MainExe "candidate $expectedVersion"
  Assert-RetainedUserData

  if ($baseProductName -ne $productName) {
    Seed-LegacyIdentityResidue $baseProductName $candidatePaths.InstallRoot $candidatePaths.MainExe $candidatePaths.Uninstaller
    if (@(Get-UninstallEntries -Name $productName).Count -ne 1 -or @(Get-UninstallEntries -Name $baseProductName).Count -ne 1) {
      throw 'Failed to establish current-product + legacy-residue migration precondition.'
    }
    $residualUpgrade = Start-Process -FilePath $Candidate -ArgumentList '/S' -PassThru -Wait
    if ($residualUpgrade.ExitCode -ne 0) { throw "Candidate residual-identity reinstall exited with $($residualUpgrade.ExitCode)." }
    if (@(Get-UninstallEntries -Name $baseProductName).Count -ne 0) {
      throw "Legacy uninstall registration '$baseProductName' remained when $productName was already installed."
    }
    if (@(Get-UninstallEntries -Name $productName).Count -ne 1) {
      throw "Expected exactly one current '$productName' uninstall identity after residual cleanup."
    }
    foreach ($shortcut in @($legacyStartShortcut, $legacyDesktopShortcut)) {
      if (Test-Path -LiteralPath $shortcut) {
        throw "Legacy shortcut remained when $productName was already installed: $shortcut"
      }
    }
    $candidateRegistration = Get-Registration $expectedVersion
    $candidatePaths = Get-InstalledPaths $candidateRegistration
    Assert-RetainedUserData
    Write-Host "current product + legacy residue migration passed: only one '$productName' identity remains; user data preserved"
  }

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

  Write-Host "public release upgrade smoke passed: $baseVersion -> $expectedVersion; baselineBrand=$baseProductName; timetable/settings preserved; default uninstall preserved data; delete-app-data removed data"
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
  $entries = @(Get-UninstallEntries -Name $productName)
  if ($baseProductName -ne $productName) { $entries += @(Get-UninstallEntries -Name $baseProductName) }
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
