# Local screenshot OCR deployment decision

Status: the Python + PaddleOCR installer approach in draft PR #88 failed real-user Windows validation and must not be merged.

Observed local failures after CI success:

- the screenshot picker remained interactable while recognition was busy;
- the installed OCR runtime still failed on a real Windows machine (`OCR-6A71717E-10A10-0`);
- repeated fixes increased installer complexity and size without producing a dependable user experience.

Decision:

- stop shipping portable Python, PaddlePaddle, PaddleOCR, the persistent Python worker, or their model/cache bootstrap in the normal installer;
- keep the stable main branch free of those resources;
- evaluate a Rust-native OCR engine with small PP-OCR mobile models as an isolated spike;
- require the spike to run from the normal NSIS application, use no external Python process, stay fully offline, and finish the known real timetable in under 30 seconds before any UI integration;
- discard the spike if those gates are not met.

Windows platform APIs were not selected as the default replacement because the legacy `Windows.Media.Ocr` desktop API requires MSIX package identity, while the newer Windows AI text recognizer is limited to supported NPU devices and may need model provisioning. Those constraints do not match the current NSIS installer and broad Windows hardware target.
