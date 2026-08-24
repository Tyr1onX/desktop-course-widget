param(
  [string]$Executable = "src-tauri/target/release/desktop-course-widget.exe"
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class CourseWidgetWindowProbe
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    public static string[] TitlesForProcess(uint processId)
    {
        var titles = new List<string>();
        EnumWindows((hWnd, lParam) =>
        {
            uint ownerProcessId;
            GetWindowThreadProcessId(hWnd, out ownerProcessId);
            if (ownerProcessId != processId)
            {
                return true;
            }

            var length = GetWindowTextLength(hWnd);
            if (length <= 0)
            {
                return true;
            }

            var text = new StringBuilder(length + 1);
            GetWindowText(hWnd, text, text.Capacity);
            titles.Add(text.ToString());
            return true;
        }, IntPtr.Zero);
        return titles.ToArray();
    }
}
"@

$resolvedExecutable = Resolve-Path $Executable
$testRoot = Join-Path $env:RUNNER_TEMP "course-widget-window-smoke"
Remove-Item $testRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $testRoot | Out-Null

$previousAppData = $env:APPDATA
$previousLocalAppData = $env:LOCALAPPDATA
$env:APPDATA = Join-Path $testRoot "Roaming"
$env:LOCALAPPDATA = Join-Path $testRoot "Local"
New-Item -ItemType Directory -Path $env:APPDATA, $env:LOCALAPPDATA | Out-Null

$process = $null
try {
  $process = Start-Process -FilePath $resolvedExecutable -PassThru
  $expectedTitles = @(
    "课刻",
    "课刻 · 课表与设置",
    "课刻 · 演示控制器"
  )
  $deadline = (Get-Date).AddSeconds(30)
  $observedTitles = @()

  do {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) {
      throw "Release executable exited during startup smoke with code $($process.ExitCode)."
    }

    $observedTitles = [CourseWidgetWindowProbe]::TitlesForProcess([uint32]$process.Id)
    $missing = @($expectedTitles | Where-Object { $_ -notin $observedTitles })
    if ($missing.Count -eq 0) {
      Write-Host "Release startup smoke passed. Created windows: $($observedTitles -join ', ')"
      return
    }
  } while ((Get-Date) -lt $deadline)

  throw "Release startup smoke did not observe all configured windows. Missing: $($missing -join ', '). Observed: $($observedTitles -join ', ')"
}
finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
  }
  $env:APPDATA = $previousAppData
  $env:LOCALAPPDATA = $previousLocalAppData
  Remove-Item $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
