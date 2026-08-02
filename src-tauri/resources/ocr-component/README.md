# OCR component build input

The committed `component.json` intentionally marks the component unavailable. Release packaging replaces this directory **in the build workspace only** with a pinned, hash-verified Windows OCR runtime before `tauri build`. Generated Python, PaddleOCR, native libraries, and model files are never committed to Git.

The generated component must follow these rules:

- target `windows-x86_64`;
- use only safe relative paths;
- include the Python executable in `files`;
- record the exact byte size and lowercase SHA-256 of every immutable file;
- place the importable `experiments/screenshot_import` package below `moduleRootRelativePath`;
- include the prewarmed model tree below `modelCacheRelativePath`;
- run successfully when the installed component tree is read/execute-only;
- avoid any dependency on `PATH`, a system Python installation, user site packages, or a network connection.

A normal OCR-enabled release verifies and uses the bundled component in place, so first use does not create a second full copy in app-local storage. The versioned app-local component directory exists only for repair or migration scenarios. Repair copies only manifest-listed files through a staging directory, verifies the result, and then atomically enables it.

A release build must replace the unavailable placeholder. Otherwise screenshot import remains explicitly disabled rather than silently falling back to the host system.
