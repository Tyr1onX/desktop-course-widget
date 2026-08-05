# Changelog

## Unreleased

## v0.5.0-beta.1 - 2026-08-05

- Added fully local timetable screenshot recognition using in-process Rust OCR with bundled, hash-pinned models and no Python runtime.
- Added a course-by-course review and correction screen before importing screenshot or Excel results.
- Preserved existing timetables and settings during the tested upgrade from v0.4.0.
- Added clear failures for non-timetable images and kept recognition controls locked only while processing.
- Added a hidden time replay and presentation mode with a separate controller window and animated course handoffs.
- Tightened Tauri window capabilities with dedicated source-bound commands and no generic WebView window permissions.
- Removed the obsolete in-app updater UI and its unused process/updater dependencies.
- Reduced the production frontend build and removed unused website/demo configuration.

### Known limitations

- Screenshot recognition is a Beta feature and may require manual correction for unfamiliar timetable layouts.
- Some optional location fields may remain empty even when the core course arrangement is recovered correctly.
- Use a complete PNG/JPG screenshot containing weekday headers, section markers, and all course cards.
## v0.4.0

- Renamed the application to 课刻 and introduced the new application icon.
- Added complete local backup export and restore with validation, content preview, safety snapshots, and rollback protection.
- Added the shared time-flow model used by the desktop widget and website presentation.
- Improved packaged startup stability, window recovery, DPI handling, and multi-display behavior.
- Added Windows release-build and website validation workflows.
- Improved Excel import and local timetable handling.

## v0.3.0

- Added multi-timetable management.
- Added timetable editing, activation, and deletion.
- Added semester information editing.
- Added updated application icons.
- Improved settings workflow and local timetable management.

## v0.2.0

- Expanded the public Windows MVP with a seven-day timetable.
- Added course creation and editing, multiple time segments, custom teaching weeks, and dynamic lesson times from 1 to 24.
- Added multi-timetable management and upgrade guidance for retaining local application data.

## v0.1.0

- Published the first public Windows Beta / MVP.
- Added local Excel timetable import with a review step before applying changes.
- Added the desktop course widget, configurable lesson times, first-run guidance, and system tray controls.
- Kept timetable data on the local device without requiring an account.
