# OCR component build input

The committed `component.json` intentionally marks the component unavailable. Release packaging replaces this directory **in the build workspace only** with a pinned, hash-verified Windows OCR runtime before `tauri build`. Generated Python, PaddleOCR, native libraries, and model files are never committed to Git.

The generated component must follow these rules:

- target `windows-x86_64`;
- use the SHA-256-pinned CPython embeddable archive and the complete exact package set in `requirements-ocr-component.txt`;
- verify the pip install report, installed distribution metadata, and dependency constraints before packaging;
- use only safe relative paths;
- include the Python executable in `files`;
- record the exact byte size and lowercase SHA-256 of every immutable file;
- place the importable `experiments/screenshot_import` package below `moduleRootRelativePath`;
- keep the prewarmed model tree below `modelCacheRelativePath`;
- include deterministic `THIRD_PARTY_NOTICES.txt` and `third-party-packages.json` files generated from the bundled wheels and CPython license;
- avoid any dependency on `PATH`, a system Python installation, user site packages, or network access during recognition.

A normal release verifies and uses the bundled component in place, so first use does not copy the complete runtime into app-local storage. The application retains a versioned app-local installation path for repair or migration scenarios, copies only manifest-listed files through a staging directory, and verifies the result before use.

Release smoke tests install the NSIS candidate into an empty directory, block network access, disable Python bytecode writes, mark every OCR resource file read-only, run real Chinese OCR, and require the complete resource-tree fingerprint to remain unchanged. The generated uninstaller must then remove the bundled Python runtime and component manifest.

A release build must replace the unavailable placeholder; otherwise screenshot import remains explicitly disabled rather than silently falling back to the host system.
