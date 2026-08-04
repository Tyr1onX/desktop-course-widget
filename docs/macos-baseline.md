# macOS stable baseline

This branch brings the existing stable timetable application to macOS without the unfinished screenshot OCR runtime.

## Included

- the desktop course widget and time-flow rendering;
- Excel `.xlsx` import and review;
- course editing, lesson times and multiple schedules;
- local-only schedule and settings storage;
- menu bar tray actions, close-to-tray behavior and autostart;
- an unsigned Universal DMG containing both Apple Silicon and Intel code.

## Deliberately excluded

- screenshot timetable recognition;
- Python, PaddleOCR, MNN or OCR model resources;
- App Store packaging;
- Apple Developer ID signing and notarization.

The settings page loads a platform bootstrap. Windows and browser development keep the existing screenshot import controller. A real macOS Tauri runtime loads the Excel-only controller instead, so users do not see an entry that cannot work in this baseline.

## Build

A Mac with Xcode command-line tools, Node.js and Rust can run:

```bash
npm ci
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run check:macos-baseline
npm run tauri:build:macos
```

The DMG is written under:

```text
src-tauri/target/universal-apple-darwin/release/bundle/dmg/
```

## Required real-device checks

Do not merge this baseline solely because CI produced a DMG. On a real Mac, verify:

1. the DMG opens and the application can be copied to Applications;
2. the app launches through macOS Gatekeeper's unsigned-app flow;
3. first launch opens settings and Excel import creates a schedule;
4. the desktop widget appears, remains transparent and can be hidden or shown from the menu bar icon;
5. closing the widget and settings windows does not quit the process;
6. course edits, schedule switching and lesson-time changes survive restart;
7. autostart can be enabled and disabled in a release build;
8. Retina rendering, multiple displays and Spaces do not strand the widget off-screen;
9. the import surface contains only the Excel option and no screenshot recognition entry;
10. no OCR runtime or model files exist inside the application bundle.

Signing and notarization should be added only after these checks pass. They are not required to prove that the application itself runs on macOS.
