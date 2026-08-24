param(
  [Parameter(Mandatory = $true)]
  [string]$Installer,
  [Parameter(Mandatory = $true)]
  [string]$OutputDir
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class InstallerReviewNative {
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

  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);

  [DllImport("user32.dll")]
  public static extern IntPtr GetDlgItem(IntPtr hDlg, int nIDDlgItem);

  [DllImport("user32.dll")]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@

$BM_CLICK = 0x00F5
$installerPath = [IO.Path]::GetFullPath($Installer)
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
  throw "Installer does not exist: $installerPath"
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
Get-ChildItem -LiteralPath $OutputDir -Filter '*.png' -File -ErrorAction SilentlyContinue |
  Remove-Item -Force

$productName = '课刻'
$installRoot = Join-Path $env:LOCALAPPDATA $productName
$uninstallerPath = Join-Path $installRoot 'uninstall.exe'
$reviewUninstaller = $null

function Wait-MainWindow([Diagnostics.Process]$Process, [int]$Seconds = 20) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    if ($Process.HasExited) {
      throw "Process $($Process.Id) exited before its main window appeared."
    }
    $Process.Refresh()
    if ($Process.MainWindowHandle -ne [IntPtr]::Zero) {
      return $Process.MainWindowHandle
    }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for process $($Process.Id) main window."
}

function Get-WindowText([IntPtr]$Handle) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
  if (-not $root) { return '' }
  $elements = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  $names = foreach ($element in $elements) {
    try {
      $name = [string]$element.Current.Name
      if (-not [string]::IsNullOrWhiteSpace($name)) { $name }
    }
    catch {}
  }
  return ($names -join "`n")
}

function Get-TopLevelWindowHandles {
  $handles = @{}
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($window in $windows) {
    try {
      $handle = [IntPtr][long]$window.Current.NativeWindowHandle
      if ($handle -ne [IntPtr]::Zero) {
        $handles[$handle.ToInt64()] = $true
      }
    }
    catch {}
  }
  return $handles
}

function Wait-NewUninstallerWindow([hashtable]$BaselineHandles, [datetime]$StartedAt, [int]$Seconds = 20) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $windows = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($window in $windows) {
      try {
        $handle = [IntPtr][long]$window.Current.NativeWindowHandle
        if ($handle -eq [IntPtr]::Zero -or $BaselineHandles.ContainsKey($handle.ToInt64())) { continue }
        if (-not [InstallerReviewNative]::IsWindowVisible($handle)) { continue }

        $title = [string]$window.Current.Name
        if ($title -notmatch [regex]::Escape($productName)) { continue }

        $rect = New-Object InstallerReviewNative+RECT
        if (-not [InstallerReviewNative]::GetWindowRect($handle, [ref]$rect)) { continue }
        $width = $rect.Right - $rect.Left
        $height = $rect.Bottom - $rect.Top
        if ($width -lt 300 -or $width -gt 900 -or $height -lt 200 -or $height -gt 700) { continue }

        $text = Get-WindowText $handle
        if ($text -notmatch '卸载|Uninstall') { continue }

        $processId = [int]$window.Current.ProcessId
        if ($processId -le 0) { continue }
        $process = Get-Process -Id $processId -ErrorAction Stop
        if ($process.StartTime -lt $StartedAt.AddSeconds(-1)) { continue }

        return [pscustomobject]@{
          Process = $process
          Handle = $handle
          Title = $title
          Text = $text
        }
      }
      catch {}
    }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for the candidate uninstaller window after NSIS process handoff."
}

function Wait-WindowText([Diagnostics.Process]$Process, [string]$Pattern, [int]$Seconds = 20) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $handle = Wait-MainWindow $Process 5
    $text = Get-WindowText $handle
    if ($text -match $Pattern) {
      return [pscustomobject]@{ Handle = $handle; Text = $text }
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for window text /$Pattern/. Last text:`n$text"
}

function Invoke-Next([Diagnostics.Process]$Process) {
  $handle = Wait-MainWindow $Process
  $button = [InstallerReviewNative]::GetDlgItem($handle, 1)
  if ($button -eq [IntPtr]::Zero) { throw 'NSIS Next/Finish button (control id 1) was not found.' }
  [void][InstallerReviewNative]::SendMessage($button, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
}

function Capture-Window([Diagnostics.Process]$Process, [string]$Name) {
  $handle = Wait-MainWindow $Process
  $rect = New-Object InstallerReviewNative+RECT
  if (-not [InstallerReviewNative]::GetWindowRect($handle, [ref]$rect)) {
    throw "GetWindowRect failed for $Name."
  }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 100 -or $height -lt 100) {
    throw "Unexpected window bounds for ${Name}: ${width}x${height}."
  }

  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $hdc = $graphics.GetHdc()
  try {
    if (-not [InstallerReviewNative]::PrintWindow($handle, $hdc, 0)) {
      throw "PrintWindow failed for $Name."
    }
  }
  finally {
    $graphics.ReleaseHdc($hdc)
    $graphics.Dispose()
  }

  $path = Join-Path $OutputDir "$Name.png"
  try {
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $bitmap.Dispose()
  }
  Write-Host "captured installer review page: $path (${width}x${height})"
}

function Stop-Interactive([Diagnostics.Process]$Process) {
  if (-not $Process -or $Process.HasExited) { return }
  [void]$Process.CloseMainWindow()
  if (-not $Process.WaitForExit(3000)) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-Silent([string]$Executable) {
  $process = Start-Process -FilePath $Executable -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Silent process failed: $Executable exit=$($process.ExitCode)"
  }
}

function Remove-InstalledCandidate {
  if (Test-Path -LiteralPath $uninstallerPath -PathType Leaf) {
    Invoke-Silent $uninstallerPath
    Start-Sleep -Milliseconds 500
  }
}

try {
  Remove-InstalledCandidate

  # 1. Fresh Welcome page.
  $welcome = Start-Process -FilePath $installerPath -PassThru
  [void](Wait-WindowText $welcome '欢迎|Welcome' 20)
  Start-Sleep -Milliseconds 500
  Capture-Window $welcome '01-welcome'
  Stop-Interactive $welcome

  # Prepare the candidate's own installed uninstaller and reinstall/maintenance page.
  Invoke-Silent $installerPath
  if (-not (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
    throw "Candidate uninstaller was not created: $uninstallerPath"
  }

  # 2. Existing-version / install-method page from this exact candidate.
  $maintenance = Start-Process -FilePath $installerPath -PassThru
  [void](Wait-WindowText $maintenance '欢迎|Welcome' 20)
  Invoke-Next $maintenance
  [void](Wait-WindowText $maintenance '已安装|重新安装|卸载|already installed|reinstall' 20)
  Start-Sleep -Milliseconds 500
  Capture-Window $maintenance '02-existing-install'
  Stop-Interactive $maintenance

  # 3. The newly installed candidate's own uninstaller page. NSIS may hand the UI off
  # to a temporary process, so identify the new top-level uninstall window instead of
  # assuming the bootstrap uninstall.exe process keeps the window.
  $baselineWindows = Get-TopLevelWindowHandles
  $uninstallerStartedAt = Get-Date
  $uninstallerBootstrap = Start-Process -FilePath $uninstallerPath -PassThru
  $uninstallerWindow = Wait-NewUninstallerWindow $baselineWindows $uninstallerStartedAt 20
  $reviewUninstaller = $uninstallerWindow.Process
  Write-Host "candidate uninstaller window: bootstrapPid=$($uninstallerBootstrap.Id) uiPid=$($reviewUninstaller.Id) title='$($uninstallerWindow.Title)'"
  Start-Sleep -Milliseconds 500
  Capture-Window $reviewUninstaller '03-uninstall'
  Stop-Interactive $reviewUninstaller
  $reviewUninstaller = $null

  # Return to a fresh state, then walk the normal interactive flow to the real Finish page.
  Remove-InstalledCandidate
  $finish = Start-Process -FilePath $installerPath -PassThru
  [void](Wait-WindowText $finish '欢迎|Welcome' 20)

  $deadline = (Get-Date).AddSeconds(120)
  $finishReached = $false
  while ((Get-Date) -lt $deadline) {
    $handle = Wait-MainWindow $finish 10
    $text = Get-WindowText $handle
    if ($text -match '完成|Finish') {
      $finishReached = $true
      break
    }
    Invoke-Next $finish
    Start-Sleep -Milliseconds 800
  }
  if (-not $finishReached) {
    throw "Timed out reaching the Finish page. Last text:`n$text"
  }
  Start-Sleep -Milliseconds 700
  Capture-Window $finish '04-finish'
  Stop-Interactive $finish

  $screenshots = @(Get-ChildItem -LiteralPath $OutputDir -Filter '*.png' -File | Sort-Object Name)
  if ($screenshots.Count -ne 4) {
    throw "Expected four installer review screenshots, found $($screenshots.Count)."
  }
  Write-Host "installer review capture passed: $($screenshots.Name -join ', ')"
}
finally {
  Stop-Interactive $reviewUninstaller
  foreach ($name in @('课刻', 'desktop-course-widget')) {
    Get-Process -Name $name -ErrorAction SilentlyContinue |
      Stop-Process -Force -ErrorAction SilentlyContinue
  }
  try { Remove-InstalledCandidate } catch { Write-Warning $_ }
  if (Test-Path -LiteralPath $installRoot) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
