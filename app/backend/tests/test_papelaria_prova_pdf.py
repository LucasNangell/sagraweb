"""Modo «Prova PDF»: prova gerada no servidor a partir do PDF do modelo."""
from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

fitz = pytest.importorskip("fitz")

_FONTE = r"C:\Windows\Fonts\arial.ttf"


def _pdf_modelo() -> bytes:
    """Cartão 90×50 mm com fonte TrueType embutida inteira (Type0/Identity-H)."""
    if not os.path.isfile(_FONTE):
        pytest.skip("fonte Arial indisponível")
    doc = fitz.open()
    page = doc.new_page(width=255.1, height=141.7)
    page.insert_font(fontname="F1", fontfile=_FONTE)
    page.insert_text((20, 40), "NOMETITULAR", fontname="F1", fontsize=11)
    page.insert_text((20, 60), "Fixo Maria José", fontname="F1", fontsize=8)
    data = doc.tobytes()
    doc.close()
    return data


def _textos(pdf: bytes) -> str:
    doc = fitz.open(stream=pdf, filetype="pdf")
    try:
        return " ".join(p.get_text() for p in doc).replace(" ", " ")
    finally:
        doc.close()


def test_analisar_pdf_lista_textos_e_fonte():
    from services import papelaria_prova_pdf_service as svc

    analise = svc.analisar_pdf(_pdf_modelo())
    marcadores = [t["marcador"] for t in analise["textos"]]
    assert "NOMETITULAR" in marcadores
    assert "Fixo Maria José" in marcadores
    assert analise["fontes"] and analise["fontes"][0]["editavel"] is True


def test_renderizar_troca_marcador_e_mantem_fixo():
    from services import papelaria_prova_pdf_service as svc

    campos = [
        {
            "marcador": "NOMETITULAR",
            "pagina": 1,
            "template": "{nome_deputado}",
            "alinhamento": "auto",
            "ancora": "auto",
            "entrelinha": 1.2,
            "reduzir_para_caber": True,
        }
    ]
    saida = svc.renderizar(_pdf_modelo(), campos, {"nome_deputado": "José Maria"})
    texto = _textos(saida)
    assert "José Maria" in texto
    assert "NOMETITULAR" not in texto
    assert "Fixo Maria José" in texto


@pytest.mark.parametrize(
    "template,dados,esperado",
    [
        ("{nome_deputado}", {}, ""),
        ("{partido}/{uf}", {}, ""),
        ("{partido}/{uf}", {"partido": "PSD", "uf": "SP"}, "PSD/SP"),
        ("Fone: {telefone}", {"telefone": "  "}, ""),
        ("Fone: {telefone}", {"telefone": "3215-5569"}, "Fone: 3215-5569"),
        (
            "Câmara dos Deputados\nGabinete {gabinete}\nFone: {telefone}",
            {"telefone": "1"},
            "Câmara dos Deputados\nFone: 1",
        ),
        ("Texto fixo", {}, "Texto fixo"),
    ],
)
def test_texto_do_campo_remove_linhas_sem_informacao(template, dados, esperado):
    from services import papelaria_prova_pdf_service as svc

    plain, _ranges = svc._texto_do_campo(template, dados)
    assert plain == esperado


def test_texto_do_campo_parseia_negrito_inline():
    from services import papelaria_prova_pdf_service as svc

    plain, ranges = svc._texto_do_campo(
        "Gabinete {genero_curto} **{nome_deputado}**",
        {"genero": "Deputada Federal", "nome_deputado": "Maria Silva"},
    )
    assert plain == "Gabinete Deputada Maria Silva"
    assert ranges
    assert plain[ranges[0][0] : ranges[0][1]] == "Maria Silva"


def test_segmentos_por_linha_respeita_offsets():
    from services import papelaria_prova_pdf_service as svc

    segs = svc._segmentos_por_linha(
        "Alpha\nBeta Gamma",
        [(6, 10)],  # "Beta"
    )
    assert segs[0] == [("Alpha", False)]
    assert segs[1] == [("Beta", True), (" Gamma", False)]


def test_renderizar_campo_vazio_remove_texto_do_modelo():
    from services import papelaria_prova_pdf_service as svc

    campos = [
        {"marcador": "NOMETITULAR", "pagina": 1, "template": "Dep. {nome_deputado}"},
    ]
    texto = _textos(svc.renderizar(_pdf_modelo(), campos, {"nome_deputado": ""}))
    assert "NOMETITULAR" not in texto
    assert "Dep." not in texto
    assert "Fixo Maria José" in texto


_FONTE_BOLD = r"C:\Windows\Fonts\arialbd.ttf"


def _pdf_modelo_com_bold() -> bytes:
    if not os.path.isfile(_FONTE) or not os.path.isfile(_FONTE_BOLD):
        pytest.skip("fontes Arial/Arial Bold indisponíveis")
    doc = fitz.open()
    page = doc.new_page(width=255.1, height=141.7)
    page.insert_font(fontname="F1", fontfile=_FONTE)
    page.insert_font(fontname="F2", fontfile=_FONTE_BOLD)
    page.insert_text((20, 40), "NOMETITULAR", fontname="F1", fontsize=11)
    # Garante que a Bold fique nos recursos da página.
    page.insert_text((20, 120), " ", fontname="F2", fontsize=1)
    data = doc.tobytes()
    doc.close()
    return data


def test_renderizar_aplica_negrito_inline():
    from services import papelaria_prova_pdf_service as svc

    campos = [
        {
            "marcador": "NOMETITULAR",
            "pagina": 1,
            "template": "Dep. **{nome_deputado}**",
            "alinhamento": "esquerda",
            "ancora": "topo",
            "entrelinha": 1.2,
            "reduzir_para_caber": True,
        }
    ]
    saida = svc.renderizar(
        _pdf_modelo_com_bold(), campos, {"nome_deputado": "José Maria"}
    )
    texto = _textos(saida)
    assert "José Maria" in texto
    assert "**" not in texto
    assert "NOMETITULAR" not in texto


def test_renderizar_negrito_sem_fonte_bold_usa_regular_com_aviso():
    from services import papelaria_prova_pdf_service as svc

    campos = [
        {
            "marcador": "NOMETITULAR",
            "pagina": 1,
            "template": "**{nome_deputado}**",
            "alinhamento": "auto",
            "ancora": "auto",
            "entrelinha": 1.2,
            "reduzir_para_caber": True,
        }
    ]
    avisos: list[str] = []
    saida = svc.renderizar(
        _pdf_modelo(), campos, {"nome_deputado": "Maria"}, avisos=avisos
    )
    assert "Maria" in _textos(saida)
    assert "**" not in _textos(saida)
    assert avisos and "negrito" in avisos[0].lower()


def test_salvar_campos_ignora_marcador_inexistente(tmp_path, monkeypatch):
    from services import papelaria_prova_pdf_service as svc

    monkeypatch.setattr(svc, "RAIZ_MODELOS_PDF", tmp_path)
    svc.salvar_pdf_modelo(7, filename="modelo.pdf", content=_pdf_modelo())
    assert svc.tem_modelo_pdf(7) is False  # sem campo ligado ainda
    res = svc.salvar_campos(
        7,
        [
            {"marcador": "NOMETITULAR", "pagina": 1, "template": "{nome_deputado}"},
            {"marcador": "Não existe", "pagina": 1, "template": "{x}"},
        ],
    )
    assert [c["marcador"] for c in res["campos"]] == ["NOMETITULAR"]
    assert svc.tem_modelo_pdf(7) is True
    svc.remover_modelo_pdf(7)
    assert svc.tem_modelo_pdf(7) is False


def test_salvar_campos_vazio_nao_apaga_sem_limpar(tmp_path, monkeypatch):
    from services import papelaria_prova_pdf_service as svc
    import pytest

    monkeypatch.setattr(svc, "RAIZ_MODELOS_PDF", tmp_path)
    svc.salvar_pdf_modelo(7, filename="modelo.pdf", content=_pdf_modelo())
    svc.salvar_campos(
        7,
        [{"marcador": "NOMETITULAR", "pagina": 1, "template": "{nome_deputado}"}],
    )
    with pytest.raises(svc.ProvaPdfError, match="limpeza"):
        svc.salvar_campos(7, [])
    assert [c["marcador"] for c in svc.carregar_config(7)["campos"]] == [
        "NOMETITULAR"
    ]
    res = svc.salvar_campos(7, [], limpar=True)
    assert res["campos"] == []


def test_salvar_pdf_rejeita_arquivo_invalido(tmp_path, monkeypatch):
    from services import papelaria_prova_pdf_service as svc

    monkeypatch.setattr(svc, "RAIZ_MODELOS_PDF", tmp_path)
    with pytest.raises(Exception):
        svc.salvar_pdf_modelo(7, filename="x.pdf", content=b"nao e pdf")


def test_modo_prova_pdf_persiste(tmp_path, monkeypatch):
    from services import papelaria_prova_modo as modo

    monkeypatch.setattr(modo, "_SETTINGS_PATH", tmp_path / "papelaria_settings.json")
    modo.set_modo(modo.MODO_PROVA_PDF)
    assert modo.get_modo() == "prova_pdf"


# --------------------------------------------------------------------------
# create_job: só desvia para o servidor quando o modo é prova_pdf E há PDF.
# --------------------------------------------------------------------------


def _run_create(monkeypatch, *, modo: str, tem_pdf: bool):
    from services import papelaria_jobs_service as svc

    inserted: dict = {}
    executados: list[str] = []
    logs: list[str] = []
    gerados: list[int] = []

    class _FakeCursor:
        lastrowid = 42

        def execute(self, sql, params=None):
            executados.append(sql)
            if "INSERT INTO tabPapelariaJobs" in sql:
                inserted.update(params)

    def fake_query(sql, params=None):
        if "FROM tabProtocolos" in sql:
            return [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Ct Visita"}]
        if "MAX(OrdemFila)" in sql:
            return [{"next_pos": 3}]
        if "INSERT INTO tabPapelariaJobLog" in sql:
            logs.append(params["msg"])
        return []

    monkeypatch.setattr(svc.db, "execute_query", fake_query)
    monkeypatch.setattr(
        svc.db, "execute_transaction", lambda ops: [op(_FakeCursor()) for op in ops]
    )
    monkeypatch.setattr(
        svc,
        "get_job",
        lambda job_id: {"id": job_id, "ano_protocolo": 2026, "nro_protocolo": 5954, "status": "pending", "dados": {}},
    )
    cdrs_consultados: list[int] = []

    def _cdrs(ano, nro):
        cdrs_consultados.append(nro)
        return []

    monkeypatch.setattr(svc, "list_os_usable_cdrs", _cdrs)
    monkeypatch.setattr("services.papelaria_prova_modo.get_modo", lambda: modo)
    monkeypatch.setattr(
        "services.papelaria_prova_pdf_service.tem_modelo_pdf", lambda modelo_id: tem_pdf
    )

    def _gerar(job_id):
        gerados.append(job_id)
        return {"id": job_id, "status": "completed"}

    monkeypatch.setattr("services.papelaria_prova_pdf_service.gerar_prova_do_job", _gerar)
    from tests.test_papelaria_jobs_service import MODEL_SAMPLE

    with patch.object(svc, "broadcast_job_update"), patch(
        "services.papelaria_models_service.get_modelo_by_id", return_value=MODEL_SAMPLE
    ):
        job = svc.create_job(
            ano=2026,
            nro=5954,
            modelo_id=1,
            dados={"nome_deputado": "Fulano", "email": "a@b.c"},
            solicitado_por="918713",
        )
    return {
        "job": job,
        "inserted": inserted,
        "sql": executados,
        "logs": logs,
        "gerados": gerados,
        "cdrs": cdrs_consultados,
    }


def test_create_prova_pdf_com_modelo_gera_no_servidor(monkeypatch):
    from services import papelaria_jobs_service as svc

    r = _run_create(monkeypatch, modo="prova_pdf", tem_pdf=True)
    assert r["inserted"]["status"] == svc.STATUS_PROCESSING
    assert any("WorkerID" in s for s in r["sql"])
    assert r["gerados"] == [42]
    assert r["cdrs"] == []  # não procura Corel na pasta
    assert r["job"]["status"] == "completed"


def test_create_prova_pdf_sem_modelo_vai_para_worker(monkeypatch):
    from services import papelaria_jobs_service as svc

    r = _run_create(monkeypatch, modo="prova_pdf", tem_pdf=False)
    assert r["inserted"]["status"] == svc.STATUS_PENDING
    assert r["gerados"] == []
    assert any("gerado pelo CorelDRAW" in m for m in r["logs"])


@pytest.mark.parametrize("modo", ["prova_web", "prova_email"])
def test_create_outros_modos_inalterados(monkeypatch, modo):
    from services import papelaria_jobs_service as svc

    r = _run_create(monkeypatch, modo=modo, tem_pdf=True)
    assert r["inserted"]["status"] == svc.STATUS_PENDING
    assert r["gerados"] == []
    assert not any("WorkerID" in s for s in r["sql"])
    assert not any("Prova PDF" in m for m in r["logs"])
    assert json.loads(r["inserted"]["dados"])["nome_deputado"] == "Fulano"


# --------------------------------------------------------------------------
# Linha com estilos mistos (ex.: nome em negrito no meio do cabeçalho) vira
# UM texto do PDF — antes cada troca de fonte virava um campo independente.
# --------------------------------------------------------------------------


def _pdf_linha_mista() -> bytes:
    if not os.path.isfile(_FONTE) or not os.path.isfile(_FONTE_BOLD):
        pytest.skip("fontes Arial/Arial Bold indisponíveis")
    reg, bold = fitz.Font(fontfile=_FONTE), fitz.Font(fontfile=_FONTE_BOLD)
    doc = fitz.open()
    page = doc.new_page(width=420, height=141.7)
    page.insert_font(fontname="F1", fontfile=_FONTE)
    page.insert_font(fontname="F2", fontfile=_FONTE_BOLD)
    x, y, tam = 20.0, 40.0, 10.0
    for trecho, nome, fonte in (
        ("Gabinete do Deputado ", "F1", reg),
        ("Nome Deputado", "F2", bold),
        (", PARTIDO/UF", "F1", reg),
    ):
        page.insert_text((x, y), trecho, fontname=nome, fontsize=tam)
        x += fonte.text_length(trecho, fontsize=tam)
    page.insert_text((300, 40), "LED", fontname="F1", fontsize=tam)  # longe: texto à parte
    data = doc.tobytes()
    doc.close()
    return data


def test_analisar_pdf_junta_linha_com_estilos_mistos():
    from services import papelaria_prova_pdf_service as svc

    textos = svc.analisar_pdf(_pdf_linha_mista())["textos"]
    marcadores = [t["marcador"] for t in textos]
    assert "Gabinete do Deputado Nome Deputado, PARTIDO/UF" in marcadores
    assert "Nome Deputado" not in marcadores
    assert "LED" in marcadores
    linha = next(t for t in textos if t["marcador"].startswith("Gabinete"))
    assert len(linha["fontes"]) == 2
    assert [tr["negrito"] for tr in linha["trechos"]] == [False, True, False]


def test_renderizar_linha_mista_substitui_a_linha_inteira():
    from services import papelaria_prova_pdf_service as svc

    campos = [
        {
            "marcador": "Gabinete do Deputado Nome Deputado, PARTIDO/UF",
            "pagina": 1,
            "template": "Gabinete do {genero} **{nome_deputado}**, {partido}/{uf}",
        }
    ]
    dados = {"genero": "Deputada", "nome_deputado": "Maria Silva", "partido": "PT", "uf": "DF"}
    texto = _textos(svc.renderizar(_pdf_linha_mista(), campos, dados))
    assert "Maria Silva" in texto
    assert "PT/DF" in texto
    assert "PARTIDO/UF" not in texto
    assert "Nome Deputado" not in texto
    assert "LED" in texto


def test_renderizar_campo_legado_de_trecho_isolado_continua_funcionando():
    from services import papelaria_prova_pdf_service as svc

    campos = [{"marcador": "Nome Deputado", "pagina": 1, "template": "{nome_deputado}"}]
    texto = _textos(svc.renderizar(_pdf_linha_mista(), campos, {"nome_deputado": "Ana"}))
    assert "Ana" in texto
    assert "Gabinete do Deputado" in texto
    assert "PARTIDO/UF" in texto


def test_previa_png_aceita_modelo_e_usa_cache_de_cores(tmp_path, monkeypatch):
    """Prévia ao vivo: não consulta o banco quando recebe o modelo e reaproveita a leitura de cores."""
    from services import papelaria_prova_pdf_service as svc
    from services import papelaria_models_service as models_svc

    monkeypatch.setattr(svc, "RAIZ_MODELOS_PDF", tmp_path)
    svc.salvar_pdf_modelo(9, filename="modelo.pdf", content=_pdf_modelo())
    svc.salvar_campos(9, [{"marcador": "NOMETITULAR", "pagina": 1, "template": "{nome_deputado}"}])

    def _sem_banco(*_a, **_k):
        raise AssertionError("não deveria consultar o banco")

    monkeypatch.setattr(models_svc, "get_modelo_by_id", _sem_banco)
    chamadas: list[int] = []
    original = svc._cores_originais_por_texto
    monkeypatch.setattr(
        svc, "_cores_originais_por_texto", lambda doc, page: chamadas.append(1) or original(doc, page)
    )
    svc._CACHE_CORES.clear()
    r1 = svc.previa_png(9, {"nome_deputado": "Ana"}, dpi=50, modelo={})
    r2 = svc.previa_png(9, {"nome_deputado": "Bia"}, dpi=50, modelo={})
    assert r1["paginas"] and r2["paginas"] and r1["paginas"] != r2["paginas"]
    assert len(chamadas) == 1
