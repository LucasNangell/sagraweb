"""Testes Credenciais DEPOL — validação e helpers isolados."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from routers import credenciais_depol_routes as routes
from services import credenciais_depol_service as svc


def test_require_access_denied():
    request = MagicMock()
    request.state.sagra_permissions = {}
    with pytest.raises(HTTPException) as exc:
        routes._require_access(request)
    assert exc.value.status_code == 403


def test_require_access_ok():
    request = MagicMock()
    request.state.sagra_permissions = {"sb_credenciais_depol": True}
    routes._require_access(request)


def test_normalize_linhas_requires_linha1():
    with pytest.raises(ValueError, match="Linha 1"):
        svc._normalize_linhas("", None, None)


def test_normalize_linhas_requires_linha2_before_3():
    with pytest.raises(ValueError, match="Linha 2"):
        svc._normalize_linhas("A", None, "C")


def test_normalize_linhas_ok():
    assert svc._normalize_linhas("A", "B", None) == ["A", "B"]
    assert svc._normalize_linhas("A", "B", "C") == ["A", "B", "C"]


def test_svg_filename_for_linhas():
    assert svc.svg_filename_for_linhas(1) == "TXT01.svg"
    assert svc.svg_filename_for_linhas(2) == "TXT02.svg"
    assert svc.svg_filename_for_linhas(3) == "TXT03.svg"
    with pytest.raises(ValueError):
        svc.svg_filename_for_linhas(0)


def test_safe_basename_rejects_path():
    with pytest.raises(ValueError):
        svc._safe_basename(r"..\evil.jpg")
    with pytest.raises(ValueError):
        svc._safe_basename("a/b.jpg")
    with pytest.raises(ValueError):
        svc._safe_basename(r"C:\temp\x.jpg")
    assert svc._safe_basename("modelo01.jpg") == "modelo01.jpg"


def test_create_pedido_rejects_empty(monkeypatch):
    monkeypatch.setattr(svc, "ensure_credenciais_depol_schema", lambda: None)
    with pytest.raises(ValueError, match="ao menos uma"):
        svc.create_pedido(criado_por="1", itens=[])


def test_executar_sem_vinculo(monkeypatch):
    monkeypatch.setattr(svc, "ensure_credenciais_depol_schema", lambda: None)
    monkeypatch.setattr(
        svc,
        "get_pedido",
        lambda _id: {
            "id": 1,
            "status": svc.STATUS_ABERTO,
            "ano_protocolo": None,
            "nro_protocolo": None,
            "itens": [{"modelo_arquivo": "a.jpg", "linha1": "x"}],
        },
    )
    with pytest.raises(ValueError, match="vinculado"):
        svc.executar_pedido(1, "10")


def test_build_job_dados(monkeypatch):
    monkeypatch.setattr(
        svc,
        "_paths_config",
        lambda: {"jpg_dir": r"J:\jpg", "svg_dir": r"J:\svg"},
    )
    monkeypatch.setattr(
        svc,
        "get_modelo_by_arquivo",
        lambda _a: {
            "layout": {
                "page_w_mm": 85,
                "page_h_mm": 120,
                "svgs": {
                    "1": {"x_mm": 1, "y_mm": 2, "w_mm": 3, "h_mm": 4},
                    "2": {"x_mm": 10, "y_mm": 20, "w_mm": 70, "h_mm": 25},
                    "3": {"x_mm": 5, "y_mm": 6, "w_mm": 7, "h_mm": 8},
                },
            }
        },
    )
    pedido = {
        "id": 9,
        "itens": [
            {
                "ordem": 1,
                "modelo_arquivo": "m.jpg",
                "linha1": "Nome",
                "linha2": "Cargo",
                "linha3": None,
            }
        ],
    }
    dados = svc.build_job_dados(pedido)
    assert dados["pedido_id"] == 9
    assert dados["pedido_ids"] == [9]
    assert dados["page_w_mm"] == 85
    assert dados["itens"][0]["svg_arquivo"] == "TXT02.svg"
    assert dados["itens"][0]["num_linhas"] == 2
    assert dados["itens"][0]["pedido_id"] == 9
    assert dados["itens"][0]["svg_layout"] == {
        "x_mm": 1.0,
        "y_mm": 2.0,
    }


def test_build_job_dados_from_multiple_pedidos(monkeypatch):
    monkeypatch.setattr(
        svc,
        "_paths_config",
        lambda: {"jpg_dir": r"J:\jpg", "svg_dir": r"J:\svg"},
    )
    monkeypatch.setattr(
        svc,
        "get_modelo_by_arquivo",
        lambda _a: {"layout": svc.DEFAULT_LAYOUT},
    )
    p2 = {
        "id": 20,
        "itens": [
            {
                "ordem": 1,
                "modelo_arquivo": "b.jpg",
                "linha1": "B",
                "linha2": None,
                "linha3": None,
            }
        ],
    }
    p1 = {
        "id": 10,
        "itens": [
            {
                "ordem": 2,
                "modelo_arquivo": "a.jpg",
                "linha1": "A2",
                "linha2": "x",
                "linha3": None,
            },
            {
                "ordem": 1,
                "modelo_arquivo": "a.jpg",
                "linha1": "A1",
                "linha2": None,
                "linha3": None,
            },
        ],
    }
    dados = svc.build_job_dados_from_pedidos([p2, p1])
    assert dados["pedido_ids"] == [10, 20]
    assert dados["pedido_id"] == 10
    assert [it["linha1"] for it in dados["itens"]] == ["A1", "A2", "B"]
    assert [it["pedido_id"] for it in dados["itens"]] == [10, 10, 20]


def test_on_job_completed_updates_all_by_job_id(monkeypatch):
    monkeypatch.setattr(svc, "ensure_credenciais_depol_schema", lambda: None)
    calls = []

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        return []

    monkeypatch.setattr(svc.db, "execute_query", fake_exec)
    svc.on_job_completed(
        {
            "id": 55,
            "tipo_job": svc.TIPO_JOB_CREDENCIAIS_DEPOL,
            "dados": {"pedido_ids": [3, 4], "pedido_id": 3},
        }
    )
    assert calls
    assert calls[0][1]["st"] == svc.STATUS_CONCLUIDO
    assert calls[0][1]["jid"] == 55
    assert "id" not in calls[0][1]
    assert "JobID" in calls[0][0] or "jobid" in calls[0][0].lower()


def test_on_job_completed_ignores_papelaria():
    # Não deve lançar nem acessar DB
    svc.on_job_completed({"id": 1, "tipo_job": "create", "dados": {}})


def test_executar_os_batches_pedidos(monkeypatch):
    monkeypatch.setattr(svc, "ensure_credenciais_depol_schema", lambda: None)
    monkeypatch.setattr(svc, "_validate_os_exists", lambda _a, _n: None)
    monkeypatch.setattr(svc, "_validate_assets_for_exec", lambda _p: None)
    monkeypatch.setattr(
        svc,
        "_paths_config",
        lambda: {"jpg_dir": r"J:\jpg", "svg_dir": r"J:\svg"},
    )
    monkeypatch.setattr(
        svc,
        "get_modelo_by_arquivo",
        lambda _a: {"layout": svc.DEFAULT_LAYOUT},
    )

    pedidos = [
        {
            "id": 2,
            "status": svc.STATUS_VINCULADO,
            "ano_protocolo": 2026,
            "nro_protocolo": 100,
            "itens": [
                {
                    "ordem": 1,
                    "modelo_arquivo": "a.jpg",
                    "linha1": "X",
                    "linha2": None,
                    "linha3": None,
                }
            ],
        },
        {
            "id": 1,
            "status": svc.STATUS_FALHA,
            "ano_protocolo": 2026,
            "nro_protocolo": 100,
            "itens": [
                {
                    "ordem": 1,
                    "modelo_arquivo": "b.jpg",
                    "linha1": "Y",
                    "linha2": None,
                    "linha3": None,
                }
            ],
        },
    ]
    monkeypatch.setattr(svc, "list_pedidos", lambda **_kw: list(pedidos))

    created = {}

    def fake_create_job(**kwargs):
        created["dados"] = kwargs["dados"]
        return {"id": 99, "status": "pending"}

    updates = []

    def fake_exec(sql, params=None):
        if params and "job_id" in params:
            updates.append(params)
        return []

    monkeypatch.setattr(svc.db, "execute_query", fake_exec)

    def get_p(pid):
        base = next(p for p in pedidos if p["id"] == int(pid))
        return {**base, "status": svc.STATUS_EM_EXECUCAO, "job_id": 99}

    monkeypatch.setattr(svc, "get_pedido", get_p)

    fake_jobs = MagicMock()
    fake_jobs.create_credenciais_depol_job = fake_create_job
    import services as services_pkg

    monkeypatch.setattr(
        services_pkg, "papelaria_jobs_service", fake_jobs, raising=False
    )

    result = svc.executar_os(2026, 100, "10")
    assert result["job"]["id"] == 99
    assert result["num_pedidos"] == 2
    assert result["num_itens"] == 2
    assert created["dados"]["pedido_ids"] == [1, 2]
    assert len(updates) == 2
    assert {u["id"] for u in updates} == {1, 2}


def test_parse_layout_defaults():
    parsed = svc._parse_layout(None)
    assert parsed["page_w_mm"] == 85
    assert "1" in parsed["svgs"] and "3" in parsed["svgs"]
    partial = svc._parse_layout({"svgs": {"2": {"x_mm": 9, "y_mm": 8, "w_mm": 7, "h_mm": 6}}})
    # Posição compartilhada: propaga X/Y de "2" para todos
    assert partial["svgs"]["2"]["x_mm"] == 9.0
    assert partial["svgs"]["1"]["x_mm"] == 9.0
    assert partial["svgs"]["3"]["y_mm"] == 8.0
    assert partial["svgs"]["1"]["w_mm"] == svc.DEFAULT_LAYOUT["svgs"]["1"]["w_mm"]


def test_parse_layout_shared_position_from_1():
    parsed = svc._parse_layout(
        {
            "svgs": {
                "1": {"x_mm": 40, "y_mm": 50, "w_mm": 1, "h_mm": 1},
                "2": {"x_mm": 1, "y_mm": 2, "w_mm": 1, "h_mm": 1},
                "3": {"x_mm": 3, "y_mm": 4, "w_mm": 1, "h_mm": 1},
            }
        }
    )
    for key in ("1", "2", "3"):
        assert parsed["svgs"][key]["x_mm"] == 40.0
        assert parsed["svgs"][key]["y_mm"] == 50.0


def test_resolve_svg_path_rejects_other_files(monkeypatch, tmp_path):
    svg_dir = tmp_path / "svg"
    svg_dir.mkdir()
    (svg_dir / "TXT01.svg").write_text("<svg/>", encoding="utf-8")
    (svg_dir / "evil.svg").write_text("<svg/>", encoding="utf-8")
    monkeypatch.setattr(
        svc,
        "_paths_config",
        lambda: {"jpg_dir": str(tmp_path), "svg_dir": str(svg_dir)},
    )
    assert svc.resolve_svg_path("TXT01.svg").endswith("TXT01.svg")
    with pytest.raises(ValueError, match="não permitido"):
        svc.resolve_svg_path("evil.svg")


def test_require_admin_ok():
    request = MagicMock()
    request.state.sagra_permissions = {"sb_configuracoes": True}
    routes._require_admin(request)


def test_require_admin_denied():
    request = MagicMock()
    request.state.sagra_permissions = {"sb_credenciais_depol": True}
    with pytest.raises(HTTPException) as exc:
        routes._require_admin(request)
    assert exc.value.status_code == 403


def test_sync_modelos_from_folder(monkeypatch, tmp_path):
    jpg_dir = tmp_path / "jpg"
    jpg_dir.mkdir()
    (jpg_dir / "a.jpg").write_bytes(b"x")
    (jpg_dir / "b.jpeg").write_bytes(b"y")
    (jpg_dir / "ignore.txt").write_text("no", encoding="utf-8")

    monkeypatch.setattr(svc, "ensure_credenciais_depol_schema", lambda: None)
    monkeypatch.setattr(
        svc,
        "_paths_config",
        lambda: {"jpg_dir": str(jpg_dir), "svg_dir": str(tmp_path)},
    )

    existing = {"a.jpg"}
    inserts = []

    def fake_exec(sql, params=None):
        sql_l = " ".join(sql.split()).lower()
        if "select id from tabcredenciaisdepolmodelos" in sql_l:
            if params and params.get("a") in existing:
                return [{"ID": 1}]
            return []
        if "insert into tabcredenciaisdepolmodelos" in sql_l:
            inserts.append(params)
            return []
        if "select * from tabcredenciaisdepolmodelos" in sql_l:
            return [
                {
                    "ID": 1,
                    "ArquivoJpg": "a.jpg",
                    "NomeExibicao": "a",
                    "Ativo": 1,
                    "Ordem": 0,
                    "LayoutJson": svc.DEFAULT_LAYOUT,
                    "AtualizadoEm": None,
                },
                {
                    "ID": 2,
                    "ArquivoJpg": "b.jpeg",
                    "NomeExibicao": "b",
                    "Ativo": 1,
                    "Ordem": 1,
                    "LayoutJson": svc.DEFAULT_LAYOUT,
                    "AtualizadoEm": None,
                },
            ]
        return []

    monkeypatch.setattr(svc.db, "execute_query", fake_exec)
    # list_modelos_admin chama ensure; manter no-op também via schema
    monkeypatch.setattr(
        "services.credenciais_depol_service.ensure_credenciais_depol_schema",
        lambda: None,
    )
    result = svc.sync_modelos_from_folder()
    assert result["encontrados"] == 2
    assert result["inseridos"] == 1
    assert result["ja_existentes"] == 1
    assert len(inserts) == 1
    assert inserts[0]["a"] == "b.jpeg"
