from __future__ import annotations

from experiments.screenshot_import import cli


class ConfigurableStream:
    def __init__(self) -> None:
        self.calls = []

    def reconfigure(self, **kwargs) -> None:
        self.calls.append(kwargs)


def test_cli_configures_windows_console_streams_as_utf8(monkeypatch):
    stdout = ConfigurableStream()
    stderr = ConfigurableStream()
    monkeypatch.setattr(cli.sys, "stdout", stdout)
    monkeypatch.setattr(cli.sys, "stderr", stderr)

    cli._configure_console_encoding()

    assert stdout.calls == [{"encoding": "utf-8", "errors": "replace"}]
    assert stderr.calls == [{"encoding": "utf-8", "errors": "replace"}]
