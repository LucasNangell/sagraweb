from unittest.mock import patch

from services.email_presets import CONFIGURABLE_TEMPLATE_IDS


def test_os_arquivos_link_is_configurable():
    assert "os_arquivos_link" in CONFIGURABLE_TEMPLATE_IDS


@patch("services.email_template_store.load_persisted", return_value={})
def test_list_templates_public_includes_os_arquivos_link(_load):
    from services.email_template_service import list_templates_public

    templates = list_templates_public()
    match = next((t for t in templates if t["id"] == "os_arquivos_link"), None)
    assert match is not None
    assert match["label"] == "Envio de arquivos — nova OS (< 5000)"
