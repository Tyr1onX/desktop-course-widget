from __future__ import annotations

from types import SimpleNamespace

from experiments.screenshot_import import rust_validate


def test_rust_validator_decodes_subprocess_output_as_utf8(tmp_path, monkeypatch):
    manifest = tmp_path / "src-tauri" / "Cargo.toml"
    manifest.parent.mkdir(parents=True)
    manifest.write_text("[package]\nname = 'fixture'\nversion = '0.0.0'\n", encoding="utf-8")
    draft = tmp_path / "draft.json"
    draft.write_text("{}", encoding="utf-8")
    observed = {}

    def fake_run(command, **kwargs):
        observed["command"] = command
        observed.update(kwargs)
        return SimpleNamespace(
            stdout='{"strictValid":false,"structuralValid":true,"reviewOnly":true}',
            stderr="",
            returncode=0,
        )

    monkeypatch.setattr(rust_validate.subprocess, "run", fake_run)
    result = rust_validate.validate_with_rust(draft, tmp_path)

    assert observed["encoding"] == "utf-8"
    assert observed["errors"] == "replace"
    assert observed["text"] is True
    assert result["structuralValid"] is True
