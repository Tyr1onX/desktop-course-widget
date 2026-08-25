Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if (-not ('InstallerUiHandoffNative' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class InstallerUiHandoffNative {
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
  public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@
}

function Get-InstallerTopLevelWindowHandles {
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

function Get-InstallerWindowElement([IntPtr]$Handle) {
  if ($Handle -eq [IntPtr]::Zero) { return $null }
  try {
    return [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
  }
  catch {
    return $null
  }
}

function Get-InstallerWindowText([IntPtr]$Handle) {
  $root = Get-InstallerWindowElement $Handle
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

function Wait-NewUninstallerWindow(
  [hashtable]$BaselineHandles,
  [datetime]$StartedAt,
  [string]$ProductName,
  [Diagnostics.Process]$Bootstrap = $null,
  [int]$Seconds = 20
) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $observed = [System.Collections.Generic.List[string]]::new()

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

        $title = [string]$window.Current.Name
        $processId = [int]$window.Current.ProcessId
        $visible = [InstallerUiHandoffNative]::IsWindowVisible($handle)
        $rect = New-Object InstallerUiHandoffNative+RECT
        $hasRect = [InstallerUiHandoffNative]::GetWindowRect($handle, [ref]$rect)
        $width = if ($hasRect) { $rect.Right - $rect.Left } else { 0 }
        $height = if ($hasRect) { $rect.Bottom - $rect.Top } else { 0 }
        $text = Get-InstallerWindowText $handle

        if ($observed.Count -lt 12 -and ($visible -or $title -match [regex]::Escape($ProductName) -or $text -match '卸载|Uninstall')) {
          $diagnosticText = ($text -replace '\s+', ' ').Trim()
          if ($diagnosticText.Length -gt 220) { $diagnosticText = $diagnosticText.Substring(0, 220) + '...' }
          [void]$observed.Add("handle=$($handle.ToInt64()) title='$title' pid=$processId bounds=${width}x${height} visible=$visible text='$diagnosticText'")
        }

        if (-not $visible) { continue }
        if ($title -notmatch [regex]::Escape($ProductName)) { continue }
        if (-not $hasRect) { continue }
        if ($width -lt 300 -or $width -gt 900 -or $height -lt 200 -or $height -gt 700) { continue }
        if ($text -notmatch '卸载|Uninstall') { continue }
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

  $bootstrapPid = 0
  $bootstrapState = 'not supplied'
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

  $diagnostics = if ($observed.Count -gt 0) { $observed -join "`n" } else { '<none>' }
  throw "Timed out waiting for the candidate uninstaller window after NSIS process handoff. bootstrapPid=$bootstrapPid bootstrapState=$bootstrapState Observed new windows:`n$diagnostics"
}
