"""Testes unitários Timbrado A4 Digital (sem COM)."""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from timbrado_a4_digital_generator import (  # noqa: E402
    resolve_timbrado_a4_digital_templates_dir,
)


def test_resolve_templates_dir_default_sibling():
    models = r"\\server\share\Papelaria\CSP\WEB"
    got = resolve_timbrado_a4_digital_templates_dir(models)
    assert got.replace("/", "\\").endswith(r"Papelaria\Timbrado A4 Digital")


def test_resolve_templates_dir_configured_override(tmp_path):
    custom = tmp_path / "custom_templates"
    custom.mkdir()
    got = resolve_timbrado_a4_digital_templates_dir(
        r"C:\models",
        str(custom),
    )
    assert Path(got) == custom.resolve()
