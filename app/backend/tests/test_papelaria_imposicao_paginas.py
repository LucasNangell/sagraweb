"""Perfil frente e verso com PDF da OS com menos páginas (ex.: só a frente)."""
from __future__ import annotations

import re

import pytest

from services import papelaria_imposicao_perfil_service as perfil_svc
from services import papelaria_jdf_service as jdf_svc


def _perfil_fv(*, posicionamento: str = "manual", paginas_faltantes: str | None = None) -> dict:
    """Frente: páginas 1 e 3. Verso: páginas 2 e 4."""
    p = perfil_svc.perfil_vazio()
    p["folha"] = {"largura_mm": 320, "altura_mm": 450}
    p["pagina"] = {"fonte": "fixa", "largura_mm": 148, "altura_mm": 210}
    p["faces"] = "frente_verso"
    p["posicionamento"] = posicionamento
    p["grade"].update({"colunas": 2, "linhas": 1, "espaco_h_mm": 4})
    if paginas_faltantes:
        p["paginas_faltantes"] = paginas_faltantes
    if posicionamento == "manual":
        p["slots"] = {
            "frente": [
                {"id": 1, "pagina": 1, "rotacao": 0, "x_mm": 84, "y_mm": 225},
                {"id": 2, "pagina": 3, "rotacao": 0, "x_mm": 236, "y_mm": 225},
            ],
            "verso": [
                {"id": 1, "pagina": 2, "rotacao": 0, "x_mm": 236, "y_mm": 225},
                {"id": 2, "pagina": 4, "rotacao": 0, "x_mm": 84, "y_mm": 225},
            ],
        }
    else:
        p["slots"] = {
            "frente": [
                {"id": 1, "pagina": 1, "rotacao": 0, "col": 0, "row": 0},
                {"id": 2, "pagina": 3, "rotacao": 0, "col": 1, "row": 0},
            ],
            "verso": [
                {"id": 1, "pagina": 2, "rotacao": 0, "col": 1, "row": 0},
                {"id": 2, "pagina": 4, "rotacao": 0, "col": 0, "row": 0},
            ],
        }
    return perfil_svc.normalize_perfil(p)


def _xml(config: dict) -> str:
    return jdf_svc.build_apogee_jdf_xml(
        ano=2026,
        nro=5954,
        descriptive_name="05954-Teste",
        comment="teste",
        export_folder=r"\\srv\Sefoc",
        export_filename="05954-Teste.pdf",
        base_pdf_path=r"\\srv\Sefoc\05954-Teste-BaseSefoc.pdf",
        base_pdf_user_name="05954-Teste-BaseSefoc",
        config=config,
        page_w_mm=148,
        page_h_mm=210,
    )


def _surface(xml: str, side: str) -> list[str]:
    m = re.search(rf'<Surface Side="{side}".*?</Surface>', xml, re.S)
    if not m:
        return []
    return re.findall(r'<ContentObject Ord="(\d+)"\s+CTM="([^"]+)"', m.group(0))


def test_padrao_e_adaptar_e_valor_invalido_recusado():
    assert perfil_svc.perfil_vazio()["paginas_faltantes"] == "adaptar"
    p = _perfil_fv()
    assert p["paginas_faltantes"] == "adaptar"
    p["paginas_faltantes"] = "ignorar_tudo"
    with pytest.raises(ValueError):
        perfil_svc.normalize_perfil(p)
    assert perfil_svc.max_pagina_perfil(_perfil_fv()) == 4


@pytest.mark.parametrize("posicionamento", ["manual", "grade"])
def test_so_pagina_1_sai_so_frente_na_mesma_posicao(posicionamento):
    perfil = _perfil_fv(posicionamento=posicionamento)
    completo = perfil_svc.compilar_config_jdf(perfil)
    xml_completo = _xml(completo)

    cfg, info = perfil_svc.adaptar_config_a_paginas(completo, 1)
    assert info["ajustado"] and info["so_frente"]
    assert info["slots_vazios_frente"] == 1
    assert cfg["work_style"] == "Simplex"
    assert "ocupadas_verso" not in cfg["grid"]
    # Original intacto (o job guarda as duas versões).
    assert completo["work_style"] == "Duplex"

    xml = _xml(cfg)
    assert 'SourceWorkStyle="Simplex"' in xml
    assert 'Side="Back"' not in xml
    frente = _surface(xml, "Front")
    assert [o for o, _ in frente] == ["0"]
    # A página 1 fica exatamente onde ficaria com o PDF completo.
    assert frente[0] in _surface(xml_completo, "Front")
    assert 'NPage="1"' in xml


def test_paginas_1_e_2_mantem_frente_e_verso_parciais():
    perfil = _perfil_fv()
    completo = perfil_svc.compilar_config_jdf(perfil)
    cfg, info = perfil_svc.adaptar_config_a_paginas(completo, 2)
    assert info["ajustado"] and not info["so_frente"]
    assert cfg["work_style"] == "Duplex"
    xml = _xml(cfg)
    assert [o for o, _ in _surface(xml, "Front")] == ["0"]
    assert [o for o, _ in _surface(xml, "Back")] == ["1"]
    assert _surface(xml, "Back")[0] in _surface(_xml(completo), "Back")


def test_pdf_completo_nao_muda_nada():
    completo = perfil_svc.compilar_config_jdf(_perfil_fv())
    cfg, info = perfil_svc.adaptar_config_a_paginas(completo, 4)
    assert cfg is completo
    assert info["ajustado"] is False
    cfg, info = perfil_svc.adaptar_config_a_paginas(completo, 6)
    assert info["ajustado"] is False


def test_modo_erro_recusa_pdf_incompleto():
    completo = perfil_svc.compilar_config_jdf(_perfil_fv(paginas_faltantes="erro"))
    with pytest.raises(ValueError, match="tem 1 página"):
        perfil_svc.adaptar_config_a_paginas(completo, 1, modo="erro")


def test_frente_sem_nenhuma_pagina_no_pdf_e_erro_claro():
    p = _perfil_fv()
    p["slots"]["frente"] = [{"id": 1, "pagina": 2, "rotacao": 0, "x_mm": 84, "y_mm": 225}]
    p["slots"]["verso"] = [{"id": 1, "pagina": 1, "rotacao": 0, "x_mm": 236, "y_mm": 225}]
    cfg = perfil_svc.compilar_config_jdf(perfil_svc.normalize_perfil(p))
    with pytest.raises(ValueError, match="nenhuma delas vai na frente"):
        perfil_svc.adaptar_config_a_paginas(cfg, 1)


def test_marcas_continuam_depois_das_paginas_existentes():
    perfil = _perfil_fv()
    perfil["marcas"].update({"ativo": True, "pdf_path": r"\\srv\Marcas\m.pdf"})
    completo = perfil_svc.compilar_config_jdf(perfil)
    cfg, _info = perfil_svc.adaptar_config_a_paginas(completo, 1)
    xml = _xml(cfg)
    # 1 página de arte + marcas: Ord 0 (arte) e Ord 1 (marcas).
    ords = re.findall(r'<ContentObject Ord="(\d+)"', xml)
    assert ords == ["0", "1"]
    assert 'Run="Arte4"' not in xml and 'Run="Arte2"' not in xml


def test_descricao_para_log():
    completo = perfil_svc.compilar_config_jdf(_perfil_fv())
    _cfg, info = perfil_svc.adaptar_config_a_paginas(completo, 1)
    texto = perfil_svc.descrever_adaptacao(info)
    assert "1 página" in texto and "só frente" in texto
    assert perfil_svc.descrever_adaptacao({"ajustado": False}) == ""


# ---------------------------------------------------------------------------
# Geração (job) e reenvio
# ---------------------------------------------------------------------------


def _pdf(path, n: int) -> None:
    import fitz

    mm = 72.0 / 25.4
    doc = fitz.open()
    for _ in range(n):
        doc.new_page(width=148 * mm, height=210 * mm)
    doc.save(str(path))
    doc.close()


@pytest.fixture
def ambiente(monkeypatch, tmp_path):
    from services import papelaria_jobs_service as svc

    state: dict = {}
    sefoc = tmp_path / "Sefoc"
    sefoc.mkdir()
    base = sefoc / "05954-Teste-BaseSefoc.pdf"
    jdf_root = tmp_path / "JDFImportRoot"
    jdf_root.mkdir()

    class _Cursor:
        lastrowid = 91

        def execute(self, sql, params=None):
            state["params"] = params

    def fake_transaction(operations):
        return [op(_Cursor()) for op in operations]

    def fake_query(sql, params=None):
        if "FROM tabProtocolos" in sql:
            return [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Produto X"}]
        if "UPDATE tabPapelariaJobs" in sql:
            state["params"] = {**(state.get("params") or {}), "dados": params["dados"]}
            return []
        if "SELECT * FROM tabPapelariaJobs WHERE ID" in sql:
            p = state.get("params") or {}
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
    monkeypatch.setattr(svc, "append_job_log", lambda job_id, msg, level="info": state.setdefault("logs", []).append(msg))
    monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
    monkeypatch.setattr(svc, "resolve_os_papelaria_dir", lambda ano, nro, create=False: str(sefoc))
    monkeypatch.setattr(svc, "get_os_folder_basename", lambda ano, nro: f"{int(nro):05d}-Teste")
    monkeypatch.setattr("routers.os_routes._get_os_folder_path", lambda ano, nro: str(tmp_path))
    monkeypatch.setenv("SAGRA_JDF_IMPORT_ROOT", str(jdf_root))
    monkeypatch.setattr(
        "services.papelaria_models_service.get_modelo_by_id",
        lambda modelo_id: {"id": 7, "produto": "Produto X", "arquivo_modelo": "X.cdr", "imposicao_config_json": None},
    )
    return {"svc": svc, "jdf_root": jdf_root, "base": base, "state": state}


def _usar_perfil(monkeypatch, perfil):
    registro = {"id": 1, "perfil": perfil, "ativo": True, "aprovado_em": "2026-11-17"}
    monkeypatch.setattr(
        "services.papelaria_imposicao_perfil_store.get_perfil_ativo",
        lambda produto, variante: registro if variante == "digital" else None,
    )


def test_job_com_pdf_so_frente_gera_simplex_sem_erro(ambiente, monkeypatch):
    svc = ambiente["svc"]
    _pdf(ambiente["base"], 1)
    _usar_perfil(monkeypatch, _perfil_fv())
    job = svc.create_imposicao_job(ano=2026, nro=5954, solicitado_por="918713", modelo_id=7, variante="digital")
    dados = job["dados"]
    assert dados["imposicao_config"]["work_style"] == "Simplex"
    assert dados["imposicao_config_base"]["work_style"] == "Duplex"
    assert dados["imposicao_paginas"]["so_frente"] is True
    xml = (ambiente["jdf_root"] / dados["jdf_name"]).read_text(encoding="utf-8")
    assert 'Side="Back"' not in xml
    assert any("só frente" in m for m in ambiente["state"]["logs"])


def test_job_com_pdf_completo_mantem_duplex(ambiente, monkeypatch):
    svc = ambiente["svc"]
    _pdf(ambiente["base"], 4)
    _usar_perfil(monkeypatch, _perfil_fv())
    job = svc.create_imposicao_job(ano=2026, nro=5954, solicitado_por="918713", modelo_id=7, variante="digital")
    dados = job["dados"]
    assert dados["imposicao_config"]["work_style"] == "Duplex"
    assert dados["imposicao_paginas"]["ajustado"] is False
    xml = (ambiente["jdf_root"] / dados["jdf_name"]).read_text(encoding="utf-8")
    assert [o for o, _ in _surface(xml, "Front")] == ["0", "2"]
    assert [o for o, _ in _surface(xml, "Back")] == ["1", "3"]


def test_job_modo_erro_recusa(ambiente, monkeypatch):
    svc = ambiente["svc"]
    _pdf(ambiente["base"], 1)
    _usar_perfil(monkeypatch, _perfil_fv(paginas_faltantes="erro"))
    with pytest.raises(ValueError, match="tem 1 página"):
        svc.create_imposicao_job(ano=2026, nro=5954, solicitado_por="918713", modelo_id=7, variante="digital")


def test_reenvio_refaz_ajuste_com_pdf_atual(ambiente, monkeypatch):
    svc = ambiente["svc"]
    _pdf(ambiente["base"], 1)
    _usar_perfil(monkeypatch, _perfil_fv())
    job = svc.create_imposicao_job(ano=2026, nro=5954, solicitado_por="918713", modelo_id=7, variante="digital")
    assert job["dados"]["imposicao_config"]["work_style"] == "Simplex"
    (ambiente["jdf_root"] / job["dados"]["jdf_name"]).unlink()

    # BaseSefoc refeito com as 4 páginas: o reenvio volta a frente e verso.
    ambiente["base"].unlink()
    _pdf(ambiente["base"], 4)
    novo = svc.resend_imposicao_jdf(int(job["id"]), solicitado_por="918713")
    dados = novo["dados"]
    assert dados["imposicao_config"]["work_style"] == "Duplex"
    assert dados["imposicao_paginas"]["ajustado"] is False
    xml = (ambiente["jdf_root"] / dados["jdf_name"]).read_text(encoding="utf-8")
    assert 'Side="Back"' in xml


def test_dialogo_avisa_quando_pdf_so_tem_a_frente(ambiente, monkeypatch):
    from services import papelaria_imposicao_v2_service as v2

    _pdf(ambiente["base"], 1)
    perfil = _perfil_fv()
    aviso = v2.aviso_paginas_os(ano=2026, nro=5954, perfil=perfil)
    assert aviso and "só frente" in aviso
    ambiente["base"].unlink()
    _pdf(ambiente["base"], 4)
    assert v2.aviso_paginas_os(ano=2026, nro=5954, perfil=perfil) is None
    # Sem PDF: sem aviso (a geração dá o erro de sempre).
    ambiente["base"].unlink()
    assert v2.aviso_paginas_os(ano=2026, nro=5954, perfil=perfil) is None
