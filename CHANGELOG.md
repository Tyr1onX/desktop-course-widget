# Changelog

## Unreleased

## v0.5.0-beta.5 - 2026-08-27

- Unified the About surface on the 课刻 brand and read the real application version from the Tauri runtime instead of showing a hard-coded old version.
- Hardened the Windows NSIS migration from the historical “桌面课表” identity: migration now requires matching product name, publisher, install root, and uninstall command before any legacy installation is touched.
- Fixed distinct legacy-root retirement by staging the validated old uninstaller in a safe temporary directory, waiting for the real NSIS uninstall with `_?=`, and verifying the old executable is gone without recursively deleting shared application data.
- Consolidated the empty-week hint styling and tightened packaged OCR verification so release checks resolve resources from the same root used by the application runtime.
- Revalidated the exact PR #108 head through Validate, the complete Windows Release workflow, public v0.3.0 direct migration, current 课刻 plus historical-residue migration, and a real public v0.3.0 + public beta.4 dual-install migration.

### Known limitations

- Screenshot recognition remains a Beta feature and unfamiliar timetable layouts may still require manual correction.
- The Windows installer is not commercially code-signed yet, so Windows may show an unknown-publisher or SmartScreen warning.

## v0.5.0-beta.4 - 2026-08-26

- Reused OCR course-card seed analysis after ownership filtering, avoiding a duplicated expensive parser pass without changing OCR heuristics or output rules; the synthetic Debug benchmark improved from 63.238s/iter to 39.235s/iter (about 38% lower time, 1.61× faster).
- Updated the vulnerable transitive npm dependencies `postcss` from 8.5.22 to 8.5.26 and `nanoid` from 3.3.16 to 3.3.18; `npm audit` is clean and high/critical findings now block Windows release builds.
- Kept `ocr-rs` 2.4.0 while building MNN from source on Windows MSVC so the native OCR path follows the same CRT mode as Rust, removing the previously reproducible `LNK4098` / `LIBCMT` conflict.
- Reduced redundant cold Rust compilation in the Windows release workflow while preserving linked Rust tests, release OCR compile/check, real MNN inference, NSIS packaging, install/upgrade/uninstall smoke tests, packaged OCR verification, release executable smoke, clean-tree, and artifact gates.
- Revalidated the complete Windows release lifecycle, including fresh and overwrite installs, public beta.1 upgrades, local data preservation, default uninstall data retention, explicit delete-data uninstall, bundled OCR resources, and packaged executable startup.

### Known limitations

- Screenshot recognition remains a Beta feature and unfamiliar timetable layouts may still require manual correction.
- Some optional location fields may remain empty even when the core course arrangement is recovered correctly.
- Use a complete, clear PNG/JPG timetable screenshot containing weekday headers, section markers, and all course cards.
- The Windows installer is not commercially code-signed yet, so Windows may show an unknown-publisher or SmartScreen warning.

## v0.5.0-beta.3 - 2026-08-25

- Improved screenshot import for traditional grid timetables, including weekday headers, lesson sections, week ranges, odd/even weeks, non-contiguous weeks, multiple courses in one grid area, and split-row information.
- Kept screenshot imports review-first so recognized courses can be checked and corrected before applying, while ordinary non-timetable images continue to be rejected safely.
- Refined the main timetable hierarchy and visual details, clarified the import flow, and added teaching-week and date-range context to the desktop widget.
- Unified the Windows installer and uninstaller on the official 课刻 icon, a blank minimal sidebar, and the native NSIS header.
- Made successful installs enter the real Finish page automatically, and verified overwrite upgrades, local timetable/settings preservation, and the newly installed version’s own uninstaller.

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
