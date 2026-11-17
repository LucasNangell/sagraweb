"""Perfil de imposição v2: validação, compilação, juntada e equivalência com o fluxo antigo."""
from __future__ import annotations

import itertools
import re
from pathlib import Path
from unittest.mock import patch

import fitz
import pytest

from services import papelaria_imposicao_perfil_service as perfil_svc
from services import papelaria_imposicao_v2_service as v2_svc
from services.papelaria_jdf_service import build_apogee_jdf_xml


def _perfil_grade(**over):
    p = perfil_svc.perfil_vazio()
    p["folha"] = {"largura_mm": 297, "altura_mm": 210}
    p["pagina"] = {"fonte": "fixa", "largura_mm": 148, "altura_mm": 210}
    p["grade"] = {"colunas": 2, "linhas": 1, "espaco_h_mm": 0, "espaco_v_mm": 0, "alinhamento": "centro"}
    p["slots"]["frente"] = perfil_svc.gerar_slots_pela_grade(p)
    for key, value in over.items():
        p[key] = value
    return p


def _no_files(_path):
    return {"existe": False, "erro": "Arquivo não encontrado no servidor."}


# ---------------------------------------------------------------------------
# Normalização e validação
# ---------------------------------------------------------------------------


def test_perfil_vazio_tem_erros_de_folha_pagina_e_slots():
    val = perfil_svc.validar_perfil(perfil_svc.perfil_vazio(), verificar_arquivos=False)
    campos = {e["campo"] for e in val["erros"]}
    assert {"folha", "pagina", "slots.frente"} <= campos
    assert val["completo"] is False


def test_perfil_grade_simples_completo():
    val = perfil_svc.validar_perfil(_perfil_grade(), verificar_arquivos=False)
    assert val["erros"] == []
    assert val["completo"] is True
    assert perfil_svc.resumo_perfil(val["perfil"]) == "297×210 mm · 2 slots"


def test_versao_errada_e_rotacao_invalida():
    with pytest.raises(ValueError, match="versao"):
        perfil_svc.normalize_perfil({"versao": 1})
    p = _perfil_grade()
    p["slots"]["frente"][0]["rotacao"] = 45
    val = perfil_svc.validar_perfil(p, verificar_arquivos=False)
    assert val["perfil"] is None and "rotacao" in val["erros"][0]["mensagem"]


def test_slot_fora_da_folha_e_sobreposicao():
    p = perfil_svc.perfil_vazio()
    p["folha"] = {"largura_mm": 300, "altura_mm": 200}
    p["pagina"] = {"fonte": "fixa", "largura_mm": 100, "altura_mm": 100}
    p["posicionamento"] = "manual"
    p["slots"]["frente"] = [
        {"id": 1, "x_mm": 0, "y_mm": 0, "rotacao": 0, "pagina": 1},
        {"id": 2, "x_mm": 50, "y_mm": 50, "rotacao": 0, "pagina": 1},
        {"id": 3, "x_mm": 250, "y_mm": 0, "rotacao": 0, "pagina": 1},
    ]
    val = perfil_svc.validar_perfil(p, verificar_arquivos=False)
    assert any("slots.frente.3" == e["campo"] for e in val["erros"])
    assert any("se sobrepõem" in a["mensagem"] for a in val["avisos"])


def test_sangria_conta_para_sair_da_folha():
    p = _perfil_grade(sangria_mm=3)
    val = perfil_svc.validar_perfil(p, verificar_arquivos=False)
    assert any("sai da folha" in e["mensagem"] for e in val["erros"])


def test_marcas_tamanho_diferente_da_folha_bloqueia():
    p = _perfil_grade(marcas={"ativo": True, "pdf_path": r"\\srv\m.pdf", "carimbar_op": False})
    reader = lambda _p: {"existe": True, "largura_mm": 300.0, "altura_mm": 210.0}
    val = perfil_svc.validar_perfil(p, pdf_info_reader=reader)
    assert any(e["campo"] == "marcas.pdf_path" for e in val["erros"])
    ok_reader = lambda _p: {"existe": True, "largura_mm": 297.3, "altura_mm": 210.0}
    assert perfil_svc.validar_perfil(p, pdf_info_reader=ok_reader)["completo"] is True


def test_marcas_nao_encontradas_aviso_ou_erro_se_carimbar():
    p = _perfil_grade(marcas={"ativo": True, "pdf_path": r"\\srv\m.pdf", "carimbar_op": False})
    val = perfil_svc.validar_perfil(p, pdf_info_reader=_no_files)
    assert val["completo"] is True and val["avisos"]
    p["marcas"]["carimbar_op"] = True
    val = perfil_svc.validar_perfil(p, pdf_info_reader=_no_files)
    assert val["completo"] is False


def test_juntada_exige_pre_impresso_e_dois_slots():
    p = _perfil_grade()
    p["juntada"] = {**p["juntada"], "ativo": True}
    msgs = [e["mensagem"] for e in perfil_svc.validar_perfil(p, verificar_arquivos=False)["erros"]]
    assert any("pré-impressa" in m for m in msgs)
    p["arte"]["fonte"] = "pre_impresso"
    p["slots"]["frente"] = p["slots"]["frente"][:1]
    msgs = [e["mensagem"] for e in perfil_svc.validar_perfil(p, verificar_arquivos=False)["erros"]]
    assert any("2 slots" in m for m in msgs)


def test_rotacao_no_pdf_exige_mesma_orientacao():
    p = _perfil_grade(arte={"fonte": "pre_impresso", "rotacao": "no_pdf"})
    p["slots"]["frente"][1]["rotacao"] = 90
    msgs = [e["mensagem"] for e in perfil_svc.validar_perfil(p, verificar_arquivos=False)["erros"]]
    assert any("mesma orientação" in m for m in msgs)


def test_pagina_do_pdf_exige_grade():
    p = _perfil_grade(pagina={"fonte": "pdf"})
    p["posicionamento"] = "manual"
    msgs = [e["mensagem"] for e in perfil_svc.validar_perfil(p, verificar_arquivos=False)["erros"]]
    assert any("grade" in m for m in msgs)


# ---------------------------------------------------------------------------
# Conversão de coordenadas
# ---------------------------------------------------------------------------


def test_topo_esquerda_da_grade_bate_com_formula_do_jdf():
    p = perfil_svc.normalize_perfil(_perfil_grade())
    slots = perfil_svc.slots_topo_esquerda(p)
    assert [(s["x_mm"], s["y_mm"]) for s in slots] == [(0.5, 0.0), (148.5, 0.0)]
    assert slots[0]["largura_mm"] == 148 and slots[0]["altura_mm"] == 210


def test_manual_compilado_converte_y_para_canto_inferior():
    p = perfil_svc.perfil_vazio()
    p["folha"] = {"largura_mm": 400, "altura_mm": 300}
    p["pagina"] = {"fonte": "fixa", "largura_mm": 100, "altura_mm": 50}
    p["posicionamento"] = "manual"
    p["slots"]["frente"] = [{"id": 1, "x_mm": 10, "y_mm": 20, "rotacao": 90, "pagina": 1}]
    cfg = perfil_svc.compilar_config_jdf(perfil_svc.normalize_perfil(p))
    oc = cfg["grid"]["ocupadas"][0]
    # Girado 90°: ocupa 50×100; y_ll = 300 − 20 − 100 = 180
    assert oc["x_mm"] == 10 and oc["y_mm"] == 180 and oc["rotacao"] == 90


# ---------------------------------------------------------------------------
# Equivalência com o fluxo antigo (o JDF não pode mudar)
# ---------------------------------------------------------------------------

_V1_GENERICOS = [
    {  # A5 2×1 em A4 paisagem
        "folha_mm": {"largura": 297, "altura": 210},
        "pagina": {"origem": "fixixa", "largura_mm": 148, "altura_mm": 210},
        "grid": {"colunas": 2, "linhas": 1},
        "espacamento_mm": {"horizontal": 0, "vertical": 0},
        "sangria_mm": 0,
        "marcas_corte": False,
        "centralizar_na_folha": True,
        "work_style": "Simplex",
    },
    {  # cartão 5×2 com gap, sem centralizar, células explícitas com rotação
        "folha_mm": {"largura": 320, "altura": 450},
        "pagina": {"origem": "fixixa", "largura_mm": 55, "altura_mm": 90},
        "grid": {
            "colunas": 5,
            "linhas": 2,
            "ocupadas": [
                {"col": c, "row": r, "pagina": 1 + (c % 2), **({"rotacao": 180} if r else {})}
                for r in range(2)
                for c in range(5)
            ],
        },
        "espacamento_mm": {"horizontal": 3, "vertical": 4},
        "sangria_mm": 2,
        "marcas_corte": True,
        "marcas_pdf_path": r"\\srv\marcas\cartao_5x2.pdf",
        "centralizar_na_folha": False,
        "work_style": "Simplex",
    },
    {  # duplex com verso
        "folha_mm": {"largura": 330, "altura": 480},
        "pagina": {"origem": "fixixa", "largura_mm": 100, "altura_mm": 150},
        "grid": {
            "colunas": 3,
            "linhas": 3,
            "ocupadas_verso": [{"col": c, "row": r, "pagina": 2} for r in range(3) for c in range(3)],
        },
        "espacamento_mm": {"horizontal": 2, "vertical": 2},
        "marcas_corte": False,
        "centralizar_na_folha": True,
        "work_style": "Duplex",
    },
    {  # página lida do PDF (borda)
        "folha_mm": {"largura": 297, "altura": 210},
        "pagina": {"origem": "borda"},
        "grid": {"colunas": 2, "linhas": 1},
        "espacamento_mm": {"horizontal": 0, "vertical": 0},
        "marcas_corte": False,
        "centralizar_na_folha": True,
        "work_style": "Simplex",
    },
]


def _content_lines(xml: str) -> list[str]:
    return [ln.strip() for ln in xml.splitlines() if "ContentObject" in ln or "TrimSize" in ln or "ClipBox" in ln]


@pytest.mark.parametrize("cfg_v1", _V1_GENERICOS)
def test_perfil_convertido_gera_mesmo_jdf(cfg_v1):
    perfil = perfil_svc.perfil_from_v1(cfg_v1)
    val = perfil_svc.validar_perfil(perfil, verificar_arquivos=False)
    assert val["perfil"] is not None
    compilado = perfil_svc.compilar_config_jdf(val["perfil"])
    page = (148.0, 210.0)
    res = perfil_svc.comparar_configs(cfg_v1, compilado, page_size=page)
    assert res["iguais"], res["diferencas"]

    from services import papelaria_imposicao_config_service as cfg_svc

    a = cfg_svc.validate_imposicao_config_payload(cfg_v1)
    b = cfg_svc.validate_imposicao_config_payload(compilado)
    pw, ph = page if a["pagina"]["origem"] == "borda" else (a["pagina"]["largura_mm"], a["pagina"]["altura_mm"])
    kw = dict(
        ano=2026, nro=6227, descriptive_name="06227-X", comment="c", export_folder=r"C:\x",
        export_filename="X.pdf", base_pdf_path=r"C:\x\BaseSefoc.pdf", base_pdf_user_name="BaseSefoc",
        page_w_mm=pw, page_h_mm=ph,
    )
    with patch("services.papelaria_jdf_service._marcas_trim_origin_pt", return_value=(0.0, 0.0)):
        xml_a = build_apogee_jdf_xml(config=a, **kw)
        xml_b = build_apogee_jdf_xml(config=b, **kw)
    assert _content_lines(xml_a) == _content_lines(xml_b)
    assert re.findall(r"SourceWorkStyle=\"(\w+)\"", xml_a) == re.findall(r"SourceWorkStyle=\"(\w+)\"", xml_b)


def _legacy_opcoes(cfg):
    return {"digital": None, "offset": cfg, "fontes": {}, "variantes_disponiveis": ["offset"]}


@pytest.mark.parametrize(
    "produto,n_slots",
    [("Pasta Avulso c/ Bolso", 2), ("Timbrado A4", 4)],
)
def test_usuario_reproduz_fluxo_antigo_pre_impresso(produto, n_slots):
    """
    O fluxo antigo força folha/slots por nome de produto. O usuário, partindo
    da referência mostrada na comparação, chega a um perfil com zero diferenças.
    """
    salvo = {
        "folha_mm": {"largura": 297, "altura": 210},
        "pagina": {"origem": "fixixa", "largura_mm": 148, "altura_mm": 210},
        "grid": {"colunas": 2, "linhas": 1},
        "marcas_corte": True,
        "marcas_pdf_path": r"\\srv\marcas\folha_745x605.pdf",
        "usar_pre_impresso": True,
    }
    with patch(
        "services.papelaria_produto_imposicao_service.resolve_imposicao_opcoes",
        return_value=_legacy_opcoes(salvo),
    ):
        antigo = v2_svc.config_efetiva_antiga(produto=produto, variante="offset")
        perfil = v2_svc.perfil_from_antigo(antigo)
    assert perfil is not None
    assert perfil["folha"] == {"largura_mm": 745.0, "altura_mm": 605.0}
    assert len(perfil["slots"]["frente"]) == n_slots
    assert perfil["posicionamento"] == "manual"
    # O usuário configura o restante das regras na tela.
    perfil["arte"] = {"fonte": "pre_impresso", "rotacao": "no_pdf"}
    perfil["marcas"]["carimbar_op"] = True
    perfil["juntada"] = {
        **perfil["juntada"],
        "ativo": True,
        "regra_tiragem": "iguais" if n_slots == 2 else "proporcional_mdc",
        "preencher_todos_slots": True,
    }
    perfil["saida"]["destino_pdf"] = "offset"
    val = perfil_svc.validar_perfil(perfil, verificar_arquivos=False)
    assert val["completo"], val["erros"]
    res = perfil_svc.comparar_configs(antigo, perfil_svc.compilar_config_jdf(val["perfil"]))
    assert res["iguais"], res["diferencas"]


def test_slot_errado_aparece_na_comparacao():
    cfg = _V1_GENERICOS[0]
    perfil = perfil_svc.perfil_from_v1(cfg)
    perfil["posicionamento"] = "manual"
    perfil["slots"]["frente"] = [
        {"id": 1, "x_mm": 0.5, "y_mm": 0, "rotacao": 0, "pagina": 1},
        {"id": 2, "x_mm": 150, "y_mm": 0, "rotacao": 0, "pagina": 1},
    ]
    res = perfil_svc.comparar_configs(cfg, perfil_svc.compilar_config_jdf(perfil_svc.normalize_perfil(perfil)))
    assert not res["iguais"]
    assert [l["igual"] for l in res["linhas"]] == [True, False]


# ---------------------------------------------------------------------------
# Juntada: estratégias genéricas = regras antigas
# ---------------------------------------------------------------------------


def _perfil_juntada(n_slots, regra, preencher=True):
    p = perfil_svc.perfil_vazio()
    p["slots"]["frente"] = [{"id": i + 1, "pagina": 1, "rotacao": 0} for i in range(n_slots)]
    p["juntada"] = {**p["juntada"], "ativo": True, "regra_tiragem": regra, "preencher_todos_slots": preencher}
    return p


@pytest.mark.parametrize(
    "produto,regra,cap",
    [("Pasta Avulso s/ Bolso", "iguais", 2), ("Timbrado A4", "proporcional_mdc", 4)],
)
def test_alocacao_generica_igual_a_antiga(produto, regra, cap):
    from services import papelaria_imposicao_juntada_service as juntada_svc

    perfil = _perfil_juntada(cap, regra)
    valores = [250, 500, 1000, 750, 300]
    for n in range(1, cap + 1):
        for combo in itertools.product(valores, repeat=n):
            tiragens = list(combo)
            try:
                antigo = juntada_svc.alocar_slots(tiragens, produto=produto)
            except ValueError:
                with pytest.raises(ValueError):
                    perfil_svc.alocar_slots(perfil, tiragens)
                continue
            novo = perfil_svc.alocar_slots(perfil, tiragens)
            assert novo["slots"] == antigo["slots"], tiragens
            assert novo["folhas"] == antigo["folhas"]
            assert novo["total_slots"] == antigo["total_slots"]


def test_alocacao_livre_e_max_os():
    p = _perfil_juntada(4, "livre", preencher=False)
    out = perfil_svc.alocar_slots(p, [100, 300])
    assert out["slots"] == [1, 1] and out["folhas"] == 300
    p["juntada"]["max_os"] = 2
    with pytest.raises(ValueError, match="Máximo de 2"):
        perfil_svc.alocar_slots(p, [100, 300, 200])


# ---------------------------------------------------------------------------
# Pipeline pré-impresso: perfil v2 × fluxo antigo
# ---------------------------------------------------------------------------


def _pdf(path: Path, w_pt: float, h_pt: float, pages: int = 1) -> str:
    doc = fitz.open()
    for _ in range(pages):
        doc.new_page(width=w_pt, height=h_pt)
    doc.save(str(path))
    doc.close()
    return str(path)


def test_pipeline_v2_igual_ao_antigo_timbrado(tmp_path):
    from services import papelaria_jobs_service as jobs_svc

    mm = 72.0 / 25.4
    gang = _pdf(tmp_path / "gang.pdf", 210 * mm, 297 * mm, pages=4)
    salvo = {
        "folha_mm": {"largura": 745, "altura": 605},
        "pagina": {"origem": "fixixa", "largura_mm": 210, "altura_mm": 297},
        "grid": {"colunas": 2, "linhas": 2},
        "marcas_corte": True,
        "marcas_pdf_path": str(tmp_path / "marcas.pdf"),
        "usar_pre_impresso": True,
    }
    dados = {"juntada_slots": {"total_slots": 4}, "juntada_lote": [{"ano": 2026, "nro": 6001}]}
    with patch.object(jobs_svc, "get_os_folder_basename", return_value="06001-Teste"), patch(
        "services.papelaria_jdf_service.prepare_marcas_pdf_with_ops",
        side_effect=lambda **kw: kw["output_pdf_path"],
    ), patch(
        "services.papelaria_produto_imposicao_service.resolve_imposicao_opcoes",
        return_value=_legacy_opcoes(salvo),
    ):
        cfg_antigo, pdf_antigo = jobs_svc._prepare_pre_impresso_jdf_config(
            config=salvo, produto="Timbrado A4", dados=dict(dados), ano=2026, nro=6001,
            sefoc_dir=str(tmp_path), gang_pdf_path=gang,
        )
        antigo_ref = v2_svc.config_efetiva_antiga(produto="Timbrado A4", variante="offset")
        perfil = v2_svc.perfil_from_antigo(antigo_ref)
        perfil["arte"] = {"fonte": "pre_impresso", "rotacao": "no_pdf"}
        perfil["marcas"] = {"ativo": True, "pdf_path": salvo["marcas_pdf_path"], "carimbar_op": True}
        dados_v2 = {**dados, "imposicao_v2": {"perfil": perfil}}
        cfg_novo, pdf_novo = jobs_svc._prepare_pre_impresso_jdf_config(
            config={}, produto="Timbrado A4", dados=dados_v2, ano=2026, nro=6001,
            sefoc_dir=str(tmp_path), gang_pdf_path=gang,
        )
    assert cfg_novo["folha_mm"] == {"largura": 745.0, "altura": 605.0}
    assert cfg_novo["pagina"] == cfg_antigo["pagina"]
    key = lambda o: (o["pagina"], round(o["x_mm"], 3), round(o["y_mm"], 3), o.get("rotacao", 0))
    assert sorted(map(key, cfg_novo["grid"]["ocupadas"])) == sorted(map(key, cfg_antigo["grid"]["ocupadas"]))
    assert cfg_novo["marcas_corte"] and cfg_novo["marcas_pdf_path"].endswith("Marcas-OP.pdf")
    with fitz.open(pdf_antigo) as a, fitz.open(pdf_novo) as b:
        assert [tuple(round(v) for v in p.rect) for p in a] == [tuple(round(v) for v in p.rect) for p in b]


# ---------------------------------------------------------------------------
# Regra do projeto: nenhum nome de produto no código novo
# ---------------------------------------------------------------------------

_ARQUIVOS_GENERICOS = [
    "app/backend/services/papelaria_imposicao_perfil_service.py",
    "app/backend/services/papelaria_imposicao_perfil_store.py",
    "app/backend/routers/papelaria_imposicao_routes.py",
    "apps/web/src/features/papelaria/imposicao/perfil",
    "apps/web/src/features/configuracoes/components/PerfilImposicaoPanel.tsx",
    "apps/web/src/features/papelaria/components/PapelariaImposicaoVarianteDialog.tsx",
]


def test_codigo_generico_nao_cita_produtos():
    root = Path(__file__).resolve().parents[3]
    proibidos = re.compile(r"pasta\s*avulso|timbrado|cart[aã]o|\bbloco\b|\bct\s", re.IGNORECASE)
    achados = []
    for rel in _ARQUIVOS_GENERICOS:
        path = root / rel
        files = [path] if path.is_file() else sorted(path.rglob("*.ts*")) if path.is_dir() else []
        for f in files:
            for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), start=1):
                if proibidos.search(line):
                    achados.append(f"{f.relative_to(root)}:{n}: {line.strip()}")
    assert not achados, "Regras por nome de produto no código genérico:\n" + "\n".join(achados)


def test_read_pdf_info_real_e_validacao_com_arquivo(tmp_path):
    mm = 72.0 / 25.4
    path = _pdf(tmp_path / "marcas.pdf", 297 * mm, 210 * mm)
    info = perfil_svc.read_pdf_info(path)
    assert info["existe"] and info["paginas"] == 1
    assert info["largura_mm"] == pytest.approx(297, abs=0.05)
    assert perfil_svc.read_pdf_info(path) == info  # cache
    p = _perfil_grade(marcas={"ativo": True, "pdf_path": path, "carimbar_op": True})
    assert perfil_svc.validar_perfil(p)["completo"] is True
    assert perfil_svc.read_pdf_info(str(tmp_path / "nao.pdf"))["existe"] is False
    assert perfil_svc.read_pdf_info(str(tmp_path / "x.txt"))["erro"]
