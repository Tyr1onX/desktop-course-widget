# OCR component build input

The committed manifest intentionally marks the component unavailable. Release packaging replaces this directory in the build workspace with a pinned, hash-verified Windows OCR runtime before `tauri build`. No generated runtime binaries or model files are committed to Git.
