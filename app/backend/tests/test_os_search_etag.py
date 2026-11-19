from services.os_search_service import build_os_search_etag


def test_os_search_etag_stable_for_same_rows():
    result = {
        "data": [
            {
                "nr_os": 1,
                "ano": 2026,
                "last_update": "2026-01-01",
                "situacao": "A",
                "setor": "SEFOC",
            }
        ]
    }
    assert build_os_search_etag(result) == build_os_search_etag(result)


def test_os_search_etag_changes_when_andamento_changes():
    base = {
        "data": [
            {
                "nr_os": 1,
                "ano": 2026,
                "last_update": "2026-01-01",
                "situacao": "A",
                "setor": "SEFOC",
            }
        ]
    }
    changed = {
        "data": [
            {
                **base["data"][0],
                "situacao": "B",
            }
        ]
    }
    assert build_os_search_etag(base) != build_os_search_etag(changed)


def test_os_search_etag_changes_when_only_titulo_changes():
    base = {
        "data": [
            {
                "nr_os": 1,
                "ano": 2026,
                "last_update": "2026-01-01",
                "situacao": "A",
                "setor": "SEFOC",
                "titulo": "Antes",
            }
        ]
    }
    changed = {"data": [{**base["data"][0], "titulo": "Depois"}]}
    assert build_os_search_etag(base) != build_os_search_etag(changed)


def test_os_search_etag_uses_rendered_json_bytes():
    same = b'{"data":[{"titulo":"A"}]}'
    assert build_os_search_etag({"json": same}) == build_os_search_etag({"json": same})
    assert build_os_search_etag({"json": same}) != build_os_search_etag(
        {"json": b'{"data":[{"titulo":"B"}]}'}
    )
