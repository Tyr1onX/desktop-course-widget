function Write-MigrationUtf8Json([string]$Path, $Value) {
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $json = $Value | ConvertTo-Json -Depth 30
  [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function New-V03CompatibleSettingsMarker(
  [string]$FirstStart,
  [string]$FirstEnd,
  [string]$SecondStart,
  [string]$SecondEnd
) {
  return [ordered]@{
    schemaVersion = 1
    onboardingCompleted = $true
    lessonTimes = @(
      [ordered]@{ section = 1; start = $FirstStart; end = $FirstEnd },
      [ordered]@{ section = 2; start = $SecondStart; end = $SecondEnd },
      [ordered]@{ section = 3; start = '10:00'; end = '10:45' },
      [ordered]@{ section = 4; start = '10:55'; end = '11:40' },
      [ordered]@{ section = 5; start = '13:30'; end = '14:15' },
      [ordered]@{ section = 6; start = '14:25'; end = '15:10' },
      [ordered]@{ section = 7; start = '15:30'; end = '16:15' },
      [ordered]@{ section = 8; start = '16:25'; end = '17:10' },
      [ordered]@{ section = 9; start = '18:00'; end = '18:45' },
      [ordered]@{ section = 10; start = '18:55'; end = '19:40' }
    )
    equalDuration = $true
  }
}

function Set-V03MigrationSettingsMarker {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SettingsPath,
    [Parameter(Mandatory = $true)]
    [bool]$PreCatalogBaseline,
    [Parameter(Mandatory = $true)]
    [string]$BaselineLabel,
    [Parameter(Mandatory = $true)]
    [string]$FirstStart,
    [Parameter(Mandatory = $true)]
    [string]$FirstEnd,
    [Parameter(Mandatory = $true)]
    [string]$SecondStart,
    [Parameter(Mandatory = $true)]
    [string]$SecondEnd
  )

  if (Test-Path -LiteralPath $SettingsPath) {
    $settings = Get-Content -Raw -LiteralPath $SettingsPath | ConvertFrom-Json
    if (@($settings.lessonTimes).Count -lt 2) {
      throw "$BaselineLabel settings do not contain at least two lesson times."
    }
    $settings.onboardingCompleted = $true
    $settings.equalDuration = $true
    $settings.lessonTimes[0].start = $FirstStart
    $settings.lessonTimes[0].end = $FirstEnd
    $settings.lessonTimes[1].start = $SecondStart
    $settings.lessonTimes[1].end = $SecondEnd
  }
  elseif (-not $PreCatalogBaseline) {
    throw "$BaselineLabel did not create settings.json after startup."
  }
  else {
    # Public v0.3.0 uses the legacy schedule schema and creates settings lazily.
    # Seed only the real v0.3-compatible settings schema; never synthesize catalog state.
    $settings = New-V03CompatibleSettingsMarker `
      -FirstStart $FirstStart `
      -FirstEnd $FirstEnd `
      -SecondStart $SecondStart `
      -SecondEnd $SecondEnd
    Write-Host "$BaselineLabel pre-catalog baseline did not eagerly create settings.json; seeding v0.3-compatible settings"
  }

  Write-MigrationUtf8Json $SettingsPath $settings
}

function Get-MigrationShortcutDiagnostic([string]$ShortcutPath) {
  $exists = Test-Path -LiteralPath $ShortcutPath
  $length = if ($exists) { [int64](Get-Item -LiteralPath $ShortcutPath).Length } else { [int64]0 }
  $targetPath = ''
  $workingDirectory = ''
  $arguments = ''
  $shellTarget = ''
  $resolvedTarget = ''
  $wscriptError = ''
  $shellError = ''

  if ($exists) {
    try {
      $wscript = New-Object -ComObject WScript.Shell
      $shortcut = $wscript.CreateShortcut($ShortcutPath)
      $targetPath = [string]$shortcut.TargetPath
      $workingDirectory = [string]$shortcut.WorkingDirectory
      $arguments = [string]$shortcut.Arguments
    }
    catch {
      $wscriptError = $_.Exception.Message
    }

    try {
      $shell = New-Object -ComObject Shell.Application
      $folderPath = Split-Path -Parent $ShortcutPath
      $leafName = Split-Path -Leaf $ShortcutPath
      $folder = $shell.NameSpace($folderPath)
      if (-not $folder) {
        throw "Shell.Application could not open shortcut directory '$folderPath'."
      }
      $item = $folder.ParseName($leafName)
      if (-not $item) {
        throw "Shell.Application could not parse shortcut '$leafName'."
      }
      try {
        $link = $item.GetLink
        if ($link) {
          $shellTarget = [string]$link.Path
          if ([string]::IsNullOrWhiteSpace($workingDirectory)) {
            $workingDirectory = [string]$link.WorkingDirectory
          }
          if ([string]::IsNullOrWhiteSpace($arguments)) {
            $arguments = [string]$link.Arguments
          }
        }
      }
      catch {}
      try {
        $resolvedTarget = [string]$item.ExtendedProperty('System.Link.TargetParsingPath')
      }
      catch {}
    }
    catch {
      $shellError = $_.Exception.Message
    }
  }

  return [pscustomobject]@{
    Path = $ShortcutPath
    Exists = $exists
    Length = $length
    TargetPath = $targetPath
    WorkingDirectory = $workingDirectory
    Arguments = $arguments
    ShellTarget = $shellTarget
    ResolvedTarget = $resolvedTarget
    WScriptError = $wscriptError
    ShellError = $shellError
  }
}

function Assert-MigrationShortcutTarget {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ShortcutPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedTarget,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $diagnostic = Get-MigrationShortcutDiagnostic $ShortcutPath
  Write-Host ("shortcut diagnostic: label='{0}' path='{1}' exists={2} length={3} TargetPath='{4}' WorkingDirectory='{5}' Arguments='{6}' shellTarget='{7}' resolvedTarget='{8}' wscriptError='{9}' shellError='{10}'" -f `
    $Label,
    $diagnostic.Path,
    $diagnostic.Exists,
    $diagnostic.Length,
    $diagnostic.TargetPath,
    $diagnostic.WorkingDirectory,
    $diagnostic.Arguments,
    $diagnostic.ShellTarget,
    $diagnostic.ResolvedTarget,
    $diagnostic.WScriptError,
    $diagnostic.ShellError)

  if (-not $diagnostic.Exists) {
    throw "$Label shortcut is missing: $ShortcutPath"
  }
  if ($diagnostic.Length -le 0) {
    throw "$Label shortcut file is empty: $ShortcutPath"
  }

  $target = @(
    $diagnostic.ShellTarget,
    $diagnostic.ResolvedTarget,
    $diagnostic.TargetPath
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -First 1

  if ([string]::IsNullOrWhiteSpace([string]$target)) {
    throw "$Label shortcut target could not be resolved. See shortcut diagnostic above."
  }

  # Guard GetFullPath explicitly: never turn an empty shortcut reader result into a context-free exception.
  $actualTarget = [IO.Path]::GetFullPath([string]$target)
  $expectedFull = [IO.Path]::GetFullPath($ExpectedTarget)
  if ($actualTarget -ne $expectedFull) {
    throw "$Label shortcut targets '$actualTarget', expected '$expectedFull'."
  }
  if (-not (Test-Path -LiteralPath $actualTarget)) {
    throw "$Label shortcut target does not exist: $actualTarget"
  }

  Write-Host "$Label shortcut target verified: '$actualTarget'"
  return $actualTarget
}
