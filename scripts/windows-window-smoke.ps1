param(
  [string]$Executable = "src-tauri/target/release/desktop-course-widget.exe",
  [string]$TauriConfig = "src-tauri/tauri.conf.json",
  [string]$FrontendDist = "dist"
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
$resolvedConfig = Resolve-Path $TauriConfig
$resolvedFrontendDist = Resolve-Path $FrontendDist

# Settings and presentation are configured as hidden startup windows. Tauri/WebView2
# is allowed to materialize their native HWNDs lazily, so a packaged startup smoke
# must not depend on those hidden handles appearing before the user opens them.
# Validate their packaged definitions and entry pages statically, then use the main
# window as the runtime proof that the release executable and WebView2 shell start.
$config = Get-Content $resolvedConfig -Raw | ConvertFrom-Json
$expectedWindows = @(
  [pscustomobject]@{ Label = "main"; Title = "课刻"; Url = "widget.html" },
  [pscustomobject]@{ Label = "settings"; Title = "课刻 · 课表与设置"; Url = "settings.html" },
  [pscustomobject]@{ Label = "presentation"; Title = "课刻 · 演示控制器"; Url = "presentation.html" }
)

foreach ($expected in $expectedWindows) {
  $configured = @($config.app.windows | Where-Object { $_.label -eq $expected.Label })
  if ($configured.Count -ne 1) {
    throw "Expected exactly one Tauri window with label '$($expected.Label)', found $($configured.Count)."
  }
  $window = $configured[0]
  if ($window.title -ne $expected.Title) {
    throw "Tauri window '$($expected.Label)' has unexpected title '$($window.title)'."
  }
  if ($window.url -ne $expected.Url) {
    throw "Tauri window '$($expected.Label)' has unexpected entry page '$($window.url)'."
  }
  $entryPage = Join-Path $resolvedFrontendDist $expected.Url
  if (-not (Test-Path $entryPage -PathType Leaf)) {
    throw "Packaged frontend entry page is missing for '$($expected.Label)': $entryPage"
  }
}

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
  $deadline = (Get-Date).AddSeconds(30)
  $observedTitles = @()
  $mainObservedAt = $null

  do {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) {
      throw "Release executable exited during startup smoke with code $($process.ExitCode)."
    }

    $observedTitles = [CourseWidgetWindowProbe]::TitlesForProcess([uint32]$process.Id)
    if ("课刻" -in $observedTitles) {
      if ($null -eq $mainObservedAt) {
        $mainObservedAt = Get-Date
      }
      # Keep the process alive for another second after the main HWND appears so the
      # smoke also catches immediate post-startup crashes.
      if (((Get-Date) - $mainObservedAt).TotalSeconds -ge 1.0) {
        Write-Host "Release startup smoke passed. Main window observed and process remained alive. Configured windows: $($expectedWindows.Label -join ', '). Observed HWND titles: $($observedTitles -join ', ')"
        return
      }
    }
  } while ((Get-Date) -lt $deadline)

  throw "Release startup smoke did not observe the main window '课刻'. Observed: $($observedTitles -join ', ')"
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
