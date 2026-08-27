from pathlib import Path
import re


def replace_function(path, start_name, next_name, replacement):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    pattern = rf'function {re.escape(start_name)} \{{.*?(?=function {re.escape(next_name)} \{{)'
    updated, count = re.subn(pattern, lambda _: replacement.rstrip() + '\n\n', text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{path}: expected one {start_name} block, found {count}')
    p.write_text(updated, encoding='utf-8')


replace_function(
    'scripts/windows-release-upgrade-smoke.ps1',
    'Seed-Beta1UserData',
    'Assert-RetainedUserData',
    r'''function Seed-Beta1UserData {
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
}'''
)

replace_function(
    'scripts/windows-legacy-dual-install-smoke.ps1',
    'Seed-SharedUserData',
    'Assert-SharedUserData',
    r'''function Seed-SharedUserData {
  $legacyPath = Join-Path $dataRoot 'schedule.json'
  $settingsPath = Join-Path $dataRoot 'settings.json'
  $indexPath = Join-Path $dataRoot 'schedules\index.json'
  $activePath = if (Test-Path -LiteralPath $indexPath) { Get-ActiveCatalogPath } else { $null }

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

  if ($activePath) {
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
  }
  else {
    Write-Host "public $legacyVersion uses pre-catalog legacy schedule storage; public $currentVersion startup must migrate schedule.json into the shared catalog"
  }

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

  $catalogLabel = if ($activePath) { $activePath } else { '<pre-catalog baseline>' }
  Write-Host "seeded shared user data under identifier '$bundleId': legacy='$legacyPath' catalog='$catalogLabel' settings='$settingsPath'"
}'''
)

p = Path('scripts/beta5-regressions.test.mjs')
text = p.read_text(encoding='utf-8')
anchor = "  assert.match(upgradeSmoke, /ExpectedVersion/)\n"
addition = anchor + "  assert.match(upgradeSmoke, /pre-catalog legacy schedule storage/)\n"
if text.count(anchor) != 1:
    raise SystemExit('beta5 regression upgrade anchor not unique')
text = text.replace(anchor, addition, 1)
anchor2 = "  assert.match(dualInstallSmoke, /shared AppData\\/timetable\\/settings preserved/)\n"
addition2 = anchor2 + "  assert.match(dualInstallSmoke, /pre-catalog legacy schedule storage/)\n"
if text.count(anchor2) != 1:
    raise SystemExit('beta5 regression dual anchor not unique')
text = text.replace(anchor2, addition2, 1)
p.write_text(text, encoding='utf-8')
