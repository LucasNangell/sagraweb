"""Geração de imposição: perfil v2 aprovado × fluxo antigo (roteamento e resultado)."""
from __future__ import annotations

import json

import pytest

from services import papelaria_imposicao_perfil_service as perfil_svc

CONFIG_ANTIGA = {
    "folha_mm": {"largura": 297, "altura": 210},
    "pagina": {"origem": "fixixa", "largura_mm": 148, "altura_mm": 210},
    "grid": {"colunas": 2, "linhas": 1},
    "espacamento_mm": {"horizontal": 0, "vertical": 0},
    "sangria_mm": 0,
    "marcas_corte": False,
    "centralizar_na_folha": True,
    "work_style": "Simplex",
}


@pytest.fixture
def ambiente(monkeypatch, tmp_path):
    from services import papelaria_jobs_service as svc

    captured: dict = {}
    sefoc = tmp_path / "Sefoc"
    sefoc.mkdir()
    (sefoc / "05954-Teste-BaseSefoc.pdf").write_bytes(b"%PDF-1.4")
    jdf_root = tmp_path / "JDFImportRoot"
    jdf_root.mkdir()

    class _Cursor:
        lastrowid = 91

        def execute(self, sql, params=None):
            captured["params"] = params

    def fake_transaction(operations):
        return [op(_Cursor()) for op in operations]

    def fake_query(sql, params=None):
        if "FROM tabProtocolos" in sql:
            return [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Produto X"}]
        if "SELECT * FROM tabPapelariaJobs WHERE ID" in sql:
            p = captured.get("params") or {}
            return [
                {
                    "ID": 91, "NroProtocolo": 5954, "AnoProtocolo": 2026,
                    "TipoJob": svc.TIPO_JOB_IMPOSICAO, "Produto": "Produto X", "ModeloID": 7,
                    "ArquivoModelo": "X.cdr", "DadosJson": p.get("dados") or "{}",
                    "Status": p.get("status") or "completed", "Prioridade": 0, "OrdemFila": 1,
                    "SolicitadoPor": "918713", "SolicitadoEm": None, "IniciadoEm": None,
                    "ConcluidoEm": None, "WorkerID": None, "ArquivoCdrGerado": None,
                    "ArquivoPdfGerado": None, "Erro": None, "Tentativas": 0, "Versao": 1,
                    "JobPaiID": None, "ProvaRevisao": p.get("prova_revisao"),
                }
            ]
        if "MAX(OrdemFila)" in sql:
            return [{"next_pos": 1}]
        return []

    monkeypatch.setattr(svc.db, "execute_query", fake_query)
    monkeypatch.setattr(svc.db, "execute_transaction", fake_transaction)
    monkeypatch.setattr("database.db.execute_query", fake_query)
    monkeypatch.setattr("database.db.execute_transaction", fake_transaction)
    monkeypatch.setattr(svc, "broadcast_job_update", lambda *a, **k: None)
    monkeypatch.setattr(svc, "resolve_os_papelaria_dir", lambda ano, nro, create=False: str(sefoc))
    monkeypatch.setattr(svc, "get_os_folder_basename", lambda ano, nro: f"{int(nro):05d}-Teste")
    monkeypatch.setattr("routers.os_routes._get_os_folder_path", lambda ano, nro: str(tmp_path))
    monkeypatch.setenv("SAGRA_JDF_IMPORT_ROOT", str(jdf_root))
    monkeypatch.setattr(
        "services.papelaria_models_service.get_modelo_by_id",
        lambda modelo_id: {
            "id": 7,
            "produto": "Produto X",
            "arquivo_modelo": "X.cdr",
            "imposicao_config_json": json.dumps(CONFIG_ANTIGA),
        },
    )
    return {"svc": svc, "jdf_root": jdf_root, "captured": captured, "sefoc": sefoc}


def _perfil_offset():
    perfil = perfil_svc.perfil_from_v1(CONFIG_ANTIGA)
    perfil["saida"]["destino_pdf"] = "offset"
    return perfil_svc.normalize_perfil(perfil)


def _content_objects(path):
    return [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines() if "ContentObject" in ln or "ClipBox" in ln]


def test_sem_perfil_aprovado_usa_fluxo_antigo(ambiente, monkeypatch):
    svc = ambiente["svc"]
    monkeypatch.setattr(
        "services.papelaria_imposicao_perfil_store.get_perfil_ativo", lambda produto, variante: None
    )
    job = svc.create_imposicao_job(ano=2026, nro=5954, solicitado_por="918713", modelo_id=7, variante="digital")
    assert "imposicao_v2" not in job["dados"]
    assert job["dados"]["imposicao_destino"] == "digital"


def test_perfil_aprovado_gera_pelo_perfil_e_mesmo_jdf(ambiente, monkeypatch):
    svc = ambiente["svc"]
    jdf_root = ambiente["jdf_root"]
    monkeypatch.setattr(
        "services.papelaria_imposicao_perfil_store.get_perfil_ativo", lambda produto, variante: None
    )
    antigo = svc.create_imposicao_job(ano=2026, nro=5954, solicitado_por="918713", modelo_id=7, variante="digital")
    jdf_antigo = jdf_root / antigo["dados"]["jdf_name"]
    linhas_antigas = _content_objects(jdf_antigo)
    jdf_antigo.unlink()

    registro = {"id": 1, "perfil": _perfil_offset(), "ativo": True, "aprovado_em": "2026-11-17"}
    monkeypatch.setattr(
        "services.papelaria_imposicao_perfil_store.get_perfil_ativo",
        lambda produto, variante: registro if variante == "offset" else None,
    )
    job = svc.create_imposicao_job(
        ano=2026,
        nro=5954,
        solicitado_por="918713",
        modelo_id=7,
        variante="offset",
        imposicao_config={"folha_mm": {"largura": 999, "altura": 999}},  # ignorado
    )
    dados = job["dados"]
    assert dados["imposicao_v2"]["variante"] == "offset"
    assert dados["imposicao_destino"] == "offset"
    assert dados["aguardando_apogee"] is True
    assert _content_objects(jdf_root / dados["jdf_name"]) == linhas_antigas


def test_digital_nao_e_trocado_por_offset_no_perfil(ambiente, monkeypatch):
    svc = ambiente["svc"]
    perfil = _perfil_offset()
    perfil["arte"]["fonte"] = "base_sefoc"
    perfil["saida"]["destino_pdf"] = "digital"
    registro = {"id": 2, "perfil": perfil, "ativo": True}
    monkeypatch.setattr(
        "services.papelaria_imposicao_perfil_store.get_perfil_ativo",
        lambda produto, variante: registro,
    )
    job = svc.create_imposicao_job(ano=2026, nro=5954, solicitado_por="1", modelo_id=7, variante="digital")
    assert job["dados"]["imposicao_variante"] == "digital"
    assert job["dados"]["imposicao_destino"] == "digital"


def test_perfil_pre_impresso_enfileira_worker_com_slots(ambiente, monkeypatch, tmp_path):
    svc = ambiente["svc"]
    perfil = perfil_svc.perfil_vazio()
    perfil["folha"] = {"largura_mm": 600, "altura_mm": 400}
    perfil["pagina"] = {"fonte": "fixa", "largura_mm": 200, "altura_mm": 150}
    perfil["posicionamento"] = "manual"
    perfil["slots"]["frente"] = [
        {"id": 1, "x_mm": 150, "y_mm": 105, "rotacao": 0, "pagina": 1},
        {"id": 2, "x_mm": 400, "y_mm": 105, "rotacao": 0, "pagina": 1},
        {"id": 3, "x_mm": 150, "y_mm": 295, "rotacao": 0, "pagina": 1},
    ]
    perfil["arte"]["fonte"] = "pre_impresso"
    perfil["juntada"] = {
        **perfil["juntada"],
        "ativo": True,
        "regra_tiragem": "livre",
        "preencher_todos_slots": True,
    }
    perfil["saida"]["destino_pdf"] = "offset"
    registro = {"id": 3, "perfil": perfil_svc.normalize_perfil(perfil), "ativo": True}
    monkeypatch.setattr(
        "services.papelaria_imposicao_perfil_store.get_perfil_ativo",
        lambda produto, variante: registro if variante == "offset" else None,
    )
    monkeypatch.setattr(svc, "_load_os_tiragem", lambda ano, nro: 500 if nro == 5954 else 200)
    monkeypatch.setattr(svc, "_validate_os_exists", lambda ano, nro, **k: {"produto": "Produto X"})
    monkeypatch.setattr(
        svc, "select_os_usable_cdr", lambda ano, nro: {"absolute_path": str(tmp_path / f"{nro}.cdr")}
    )
    job = svc.create_imposicao_job(
        ano=2026,
        nro=5954,
        solicitado_por="1",
        modelo_id=7,
        variante="offset",
        juntada_os=[{"ano": 2026, "nro": 6100}],
    )
    dados = job["dados"]
    assert job["status"] == svc.STATUS_PENDING
    assert dados["pre_impresso_pipeline"] is True
    assert [item["slots"] for item in dados["juntada_lote"]] == [2, 1]
    assert dados["juntada_slots"]["folhas"] == 500
    assert len(dados["imposicao_config"]["grid"]["ocupadas"]) == 3


def test_juntada_recusada_quando_perfil_nao_permite(ambiente, monkeypatch):
    svc = ambiente["svc"]
    registro = {"id": 4, "perfil": _perfil_offset(), "ativo": True}
    monkeypatch.setattr(
        "services.papelaria_imposicao_perfil_store.get_perfil_ativo",
        lambda produto, variante: registro,
    )
    monkeypatch.setattr(svc, "_validate_os_exists", lambda ano, nro, **k: {"produto": "Produto X"})
    with pytest.raises(ValueError, match="juntada não está ativa"):
        svc.create_imposicao_job(
            ano=2026, nro=5954, solicitado_por="1", modelo_id=7, variante="offset",
            juntada_os=[{"ano": 2026, "nro": 6100}],
        )


def test_poll_v2_respeita_destino_digital_com_pre_impresso(ambiente, monkeypatch, tmp_path):
    svc = ambiente["svc"]
    sefoc = ambiente["sefoc"]
    digital = sefoc / "Digital"
    digital.mkdir()
    job = {
        "id": 91,
        "tipo_job": svc.TIPO_JOB_IMPOSICAO,
        "status": svc.STATUS_COMPLETED,
        "ano_protocolo": 2026,
        "nro_protocolo": 5954,
        "arquivo_pdf": None,
        "dados": {
            "imposicao_v2": {"variante": "digital"},
            "imposicao_destino": "digital",
            "usar_pre_impresso": True,
            "imposicao_config": CONFIG_ANTIGA,
        },
    }
    monkeypatch.setattr(svc, "get_job", lambda job_id, **k: job)
    result = svc.poll_imposicao_apogee_result(91)
    assert result["status"] == "waiting_apogee"
    # Destino digital: procurou na pasta Digital, não criou a Offset.
    assert not (sefoc / "Offset").exists()


def test_rotas_v2_registradas():
    from routers.api import app

    paths = {getattr(r, "path", "") for r in app.routes}
    for path in (
        "/api/papelaria/admin/imposicao/perfis",
        "/api/papelaria/admin/imposicao/perfis/{variante}",
        "/api/papelaria/admin/imposicao/perfis/{variante}/ativar",
        "/api/papelaria/admin/imposicao/perfis/{variante}/comparar",
        "/api/papelaria/admin/imposicao/validar",
        "/api/papelaria/admin/imposicao/pdf-info",
        "/api/papelaria/admin/imposicao/pdf-thumb",
        "/api/papelaria/admin/imposicao/status",
        "/api/papelaria/admin/imposicao/modelos-perfil",
        "/api/papelaria/os/{ano}/{nro}/imposicao-variantes",
        "/api/papelaria/os/{ano}/{nro}/imposicao/previa-juntada",
    ):
        assert path in paths, path


def test_store_recusa_salvar_perfil_ativo_com_erros(monkeypatch):
    from services import papelaria_imposicao_perfil_store as store

    monkeypatch.setattr(store, "ensure_perfil_tables", lambda: None)
    monkeypatch.setattr(
        store, "get_perfil", lambda produto, variante: {"ativo": True, "perfil": _perfil_offset()}
    )
    escritas = []
    monkeypatch.setattr(store.db, "execute_query", lambda sql, params=None: escritas.append(sql) or [])
    with pytest.raises(ValueError, match="em uso na produção"):
        store.save_perfil(produto="Produto X", variante="offset", perfil=perfil_svc.perfil_vazio())
    assert not escritas


def test_store_ativar_exige_perfil_sem_erros(monkeypatch):
    from services import papelaria_imposicao_perfil_store as store

    monkeypatch.setattr(store, "ensure_perfil_tables", lambda: None)
    monkeypatch.setattr(
        store, "get_perfil", lambda produto, variante: {"ativo": False, "perfil": perfil_svc.perfil_vazio()}
    )
    with pytest.raises(ValueError, match="não pode ser ativado"):
        store.set_ativo(produto="Produto X", variante="digital", ativo=True)


def test_rotas_admin_com_produto_com_barra(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from routers import papelaria_imposicao_routes, papelaria_routes

    # App mínimo só com o router (sem o middleware de sessão da API real).
    app = FastAPI()
    app.include_router(papelaria_imposicao_routes.router, prefix="/api")
    from services import papelaria_imposicao_perfil_store as store
    from services import papelaria_imposicao_v2_service as v2

    app.dependency_overrides[papelaria_routes._require_import_access] = lambda: type("S", (), {"ponto": "918713"})()
    vistos = {}
    monkeypatch.setattr(store, "get_perfis_produto", lambda produto: vistos.setdefault("p", produto) and {"digital": None, "offset": None})
    monkeypatch.setattr(
        v2, "rascunho_da_configuracao_salva",
        lambda produto, variante: {"existe": False, "perfil": None, "completo_no_banco": False},
    )
    monkeypatch.setattr(store, "save_perfil", lambda **kw: {**kw, "id": 1, "ativo": False, "perfil": kw["perfil"]})
    try:
        client = TestClient(app)
        nome = "Produto c/ Barra"
        r = client.get("/api/papelaria/admin/imposicao/perfis", params={"produto": nome})
        assert r.status_code == 200, r.text
        assert vistos["p"] == nome
        r = client.post("/api/papelaria/admin/imposicao/validar", json={"perfil": perfil_svc.perfil_vazio()})
        assert r.status_code == 200 and r.json()["completo"] is False
        r = client.put(
            "/api/papelaria/admin/imposicao/perfis/offset",
            params={"produto": nome},
            json={"perfil": _perfil_offset()},
        )
        assert r.status_code == 200, r.text
        assert r.json()["validacao"]["completo"] is True
        r = client.put(
            "/api/papelaria/admin/imposicao/perfis/xpto", params={"produto": nome}, json={"perfil": {}}
        )
        assert r.status_code in (200, 400)
    finally:
        app.dependency_overrides.pop(papelaria_routes._require_import_access, None)


# ---------------------------------------------------------------------------
# PDF de marcas guardado no servidor
# ---------------------------------------------------------------------------


def _pdf_bytes(w_mm: float, h_mm: float) -> bytes:
    import fitz

    mm = 72.0 / 25.4
    doc = fitz.open()
    doc.new_page(width=w_mm * mm, height=h_mm * mm)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def storage_marcas(monkeypatch, tmp_path):
    from services import papelaria_imposicao_marcas_service as marcas_svc

    root = tmp_path / "storage_marcas"
    root.mkdir()

    def fake_dir(create=True):
        return root

    monkeypatch.setattr(marcas_svc, "storage_dir", fake_dir)
    return root


def test_upload_guarda_no_servidor_e_deduplica(storage_marcas):
    from services import papelaria_imposicao_marcas_service as marcas_svc

    data = _pdf_bytes(297, 210)
    a = marcas_svc.salvar_upload(data, r"C:\Users\fulano\Desktop\Marcas Folha A4.pdf")
    b = marcas_svc.salvar_upload(data, "outro nome.pdf")
    assert a["arquivo"].startswith(a["sha256"][:16])
    assert a["nome_original"] == "Marcas Folha A4.pdf"
    assert a["largura_mm"] == pytest.approx(297, abs=0.05)
    assert (storage_marcas / a["arquivo"]).is_file()
    assert a["sha256"] == b["sha256"]
    assert len(list(storage_marcas.glob("*.pdf"))) == 2  # nomes diferentes, mesmo conteúdo
    with pytest.raises(ValueError, match="não é um PDF"):
        marcas_svc.salvar_upload(b"not a pdf", "x.pdf")
    with pytest.raises(ValueError):
        marcas_svc.resolver_arquivo("../../config/.env")


def test_perfil_com_arquivo_valida_tamanho_e_falta(storage_marcas):
    from services import papelaria_imposicao_marcas_service as marcas_svc

    meta = marcas_svc.salvar_upload(_pdf_bytes(297, 210), "m.pdf")
    perfil = perfil_svc.perfil_from_v1(CONFIG_ANTIGA)
    perfil["marcas"] = {"ativo": True, "arquivo": meta["arquivo"], "nome_original": "m.pdf", "carimbar_op": False}
    val = perfil_svc.validar_perfil(perfil)
    assert val["completo"], val["erros"]
    assert val["perfil"]["marcas"]["pdf_path"] is None
    (storage_marcas / meta["arquivo"]).unlink()
    val = perfil_svc.validar_perfil(perfil)
    assert any("não está mais no servidor" in e["mensagem"] for e in val["erros"])
    perfil["marcas"] = {"ativo": True, "arquivo": None, "pdf_path": None}
    val = perfil_svc.validar_perfil(perfil)
    assert any("Envie o PDF de marcas" in e["mensagem"] for e in val["erros"])


def test_geracao_copia_marcas_para_pasta_da_os(ambiente, monkeypatch, storage_marcas):
    from services import papelaria_imposicao_marcas_service as marcas_svc

    svc = ambiente["svc"]
    meta = marcas_svc.salvar_upload(_pdf_bytes(297, 210), "Marcas A4.pdf")
    perfil = _perfil_offset()
    perfil["marcas"] = {"ativo": True, "arquivo": meta["arquivo"], "nome_original": "Marcas A4.pdf", "carimbar_op": False}
    registro = {"id": 9, "perfil": perfil_svc.normalize_perfil(perfil), "ativo": True}
    monkeypatch.setattr(
        "services.papelaria_imposicao_perfil_store.get_perfil_ativo",
        lambda produto, variante: registro if variante == "offset" else None,
    )
    job = svc.create_imposicao_job(ano=2026, nro=5954, solicitado_por="1", modelo_id=7, variante="offset")
    copia = ambiente["sefoc"] / "05954-Teste-Marcas.pdf"
    assert copia.is_file()
    assert job["dados"]["imposicao_config"]["marcas_pdf_path"] == str(copia)
    jdf = (ambiente["jdf_root"] / job["dados"]["jdf_name"]).read_text(encoding="utf-8")
    assert "05954-Teste-Marcas.pdf" in jdf
    assert str(storage_marcas) not in jdf  # Apogee nunca recebe o disco do servidor


def test_comparacao_considera_mesmo_pdf_em_lugares_diferentes(tmp_path, storage_marcas):
    from services import papelaria_imposicao_marcas_service as marcas_svc

    data = _pdf_bytes(297, 210)
    rede = tmp_path / "rede_marcas.pdf"
    rede.write_bytes(data)
    antigo = {**CONFIG_ANTIGA, "marcas_corte": True, "marcas_pdf_path": str(rede)}
    meta = marcas_svc.importar_de_caminho(str(rede))
    perfil = perfil_svc.perfil_from_v1(antigo)
    perfil["marcas"] = {"ativo": True, "arquivo": meta["arquivo"], "carimbar_op": False}
    res = perfil_svc.comparar_configs(antigo, perfil_svc.compilar_config_jdf(perfil_svc.normalize_perfil(perfil)))
    assert res["iguais"], res["diferencas"]
    outro = tmp_path / "outro.pdf"
    outro.write_bytes(_pdf_bytes(300, 210))
    res = perfil_svc.comparar_configs({**antigo, "marcas_pdf_path": str(outro)}, perfil_svc.compilar_config_jdf(perfil_svc.normalize_perfil(perfil)))
    assert not res["iguais"]


def test_rota_upload_e_miniatura_marcas(storage_marcas):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from routers import papelaria_imposicao_routes, papelaria_routes

    app = FastAPI()
    app.include_router(papelaria_imposicao_routes.router, prefix="/api")
    app.dependency_overrides[papelaria_routes._require_import_access] = lambda: type("S", (), {"ponto": "1"})()
    client = TestClient(app)
    r = client.post(
        "/api/papelaria/admin/imposicao/marcas-pdf",
        files={"file": ("Marcas 745x605.pdf", _pdf_bytes(745, 605), "application/pdf")},
    )
    assert r.status_code == 200, r.text
    meta = r.json()
    assert meta["largura_mm"] == pytest.approx(745, abs=0.05) and "path" not in meta
    r = client.get(f"/api/papelaria/admin/imposicao/marcas-pdf/{meta['arquivo']}/thumb")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    r = client.get(f"/api/papelaria/admin/imposicao/marcas-pdf/{meta['arquivo']}")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    r = client.get(f"/api/papelaria/admin/imposicao/marcas-pdf/{meta['arquivo']}/info")
    assert r.status_code == 200 and r.json()["existe"] is True
    r = client.get("/api/papelaria/admin/imposicao/marcas-pdf/..%2F..%2Fsegredo.pdf/info")
    assert r.status_code in (400, 404)
    r = client.post(
        "/api/papelaria/admin/imposicao/marcas-pdf",
        files={"file": ("x.pdf", b"nao e pdf", "application/pdf")},
    )
    assert r.status_code == 400
