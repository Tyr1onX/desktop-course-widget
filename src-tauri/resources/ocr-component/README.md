# OCR component build input

The committed `component.json` intentionally marks the component unavailable. Release packaging replaces this directory **in the build workspace only** with a pinned, hash-verified Windows OCR runtime before `tauri build`. Generated Python, PaddleOCR, native libraries, and model files are never committed to Git.

The generated component must follow these rules:

- target `windows-x86_64`;
- use only safe relative paths;
- include the Python executable in `files`;
- record the exact byte size and lowercase SHA-256 of every immutable file;
- place the importable `experiments/screenshot_import` package below `moduleRootRelativePath`;
- reserve `modelCacheRelativePath` for app-local writable model state;
- avoid any dependency on `PATH`, a system Python installation, or user site packages.

The application copies only manifest-listed files into its versioned app-local component directory, verifies the copy, and exposes missing/corrupt states to the import UI. A release build must replace the unavailable placeholder; otherwise screenshot import remains explicitly disabled rather than silently falling back to the host system.
