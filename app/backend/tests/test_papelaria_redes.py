"""Redes sociais na Prova PDF: seleção, bloco do modelo e renderização."""
from __future__ import annotations

import json
import os

import pytest

fitz = pytest.importorskip("fitz")

_FONTE = r"C:\Windows\Fonts\arial.ttf"


def _pdf_verso_redes() -> bytes:
    """Verso 85×50 mm: 3 linhas «ícone + texto» e um degradê recortado (como o Corel exporta)."""
    if not os.path.isfile(_FONTE):
        pytest.skip("fonte Arial indisponível")
    doc = fitz.open()
    page = doc.new_page(width=240.9, height=141.7)
    page.insert_font(fontname="F1", fontfile=_FONTE)
    for i, texto in enumerate(["@exemplo.tiktok", "@exemplo.x", "exemplo.com/face"]):
        y = 40 + i * 14.4
        page.draw_rect(fitz.Rect(34, y - 8, 44.5, y + 2.5), color=None, fill=(0, 0, 0))
        page.insert_text((47, y), texto, fontname="F1", fontsize=7)
    data = doc.tobytes()
    doc.close()
    return data


def _logo_pdf(tmp_path, nome: str, cor: tuple[float, float, float]) -> str:
    d = fitz.open()
    p = d.new_page(width=10, height=10)
    p.draw_rect(p.rect, color=None, fill=cor)
    caminho = tmp_path / f"{nome}.pdf"
    d.save(caminho)
    d.close()
    return caminho.name


@pytest.fixture
def catalogo(tmp_path, monkeypatch):
    from services import papelaria_redes_service as svc

    monkeypatch.setattr(svc, "PASTA_LOGOS", tmp_path)
    redes = [
        {"chave": "instagram", "nome": "Instagram", "exemplo": "@usuario", "logo": _logo_pdf(tmp_path, "instagram", (1, 0, 0.5)), "ativo": True},
        {"chave": "whatsapp", "nome": "WhatsApp", "exemplo": "+55 61 99999-9999", "logo": _logo_pdf(tmp_path, "whatsapp", (0, 0.7, 0.3)), "ativo": True},
        {"chave": "kwai", "nome": "Kwai", "exemplo": "@usuario", "logo": None, "ativo": False},
    ]
    monkeypatch.setattr(svc, "listar", lambda: [dict(r) for r in redes])
    monkeypatch.setattr(svc, "por_chave", lambda: {r["chave"]: dict(r) for r in redes})
    return redes


def test_normalizar_selecao():
    from services import papelaria_redes_service as svc

    assert svc.normalizar_selecao(None) is None
    sel = svc.normalizar_selecao(
        json.dumps([{"chave": "Instagram", "valor": " @ana "}, {"chave": "instagram", "valor": "dup"}, {"chave": "x"}])
    )
    assert sel == [{"chave": "instagram", "valor": "@ana"}, {"chave": "x", "valor": ""}]
    with pytest.raises(svc.RedesError):
        svc.normalizar_selecao("{nao e json")


def test_detectar_bloco_pelas_linhas_de_exemplo():
    from services import papelaria_redes_service as svc

    bloco = svc.detectar_bloco(_pdf_verso_redes(), 1, ["@exemplo.tiktok", "@exemplo.x", "exemplo.com/face"])
    x0, y0, x1, y1 = bloco["area"]
    assert x0 == pytest.approx(34, abs=0.5)  # inclui os ícones à esquerda
    assert bloco["icone_mm"] == pytest.approx(10.5 / (72 / 25.4), abs=0.1)
    assert bloco["fonte_marcador"] == "@exemplo.tiktok"
    assert bloco["max"] == 3
    with pytest.raises(svc.RedesError):
        svc.detectar_bloco(_pdf_verso_redes(), 1, [])


def test_normalizar_bloco_valida_limites():
    from services import papelaria_redes_service as svc

    b = svc.normalizar_bloco(
        {"area": [1, 2, 30, 40], "marcadores": ["a"], "disposicao": "diagonal", "icone_mm": 999, "max": 0}
    )
    assert b["disposicao"] == "vertical" and b["icone_mm"] == 20.0 and b["max"] == 1
    assert b["fonte_marcador"] == "a"
    with pytest.raises(svc.RedesError):
        svc.normalizar_bloco({"area": [10, 10, 5, 5], "marcadores": ["a"]})


@pytest.mark.parametrize("disposicao", ["vertical", "horizontal", "grade"])
def test_aplicar_bloco_troca_exemplos_pelas_redes_escolhidas(catalogo, disposicao):
    from services import papelaria_redes_service as svc

    pdf = _pdf_verso_redes()
    bloco = {
        **svc.detectar_bloco(pdf, 1, ["@exemplo.tiktok", "@exemplo.x", "exemplo.com/face"]),
        "disposicao": disposicao,
    }
    sel = [
        {"chave": "whatsapp", "valor": "+55 61 98428 4040"},
        {"chave": "kwai", "valor": "@inativa"},  # inativa: não entra
        {"chave": "instagram", "valor": "@ana.dep"},
        {"chave": "desconhecida", "valor": "x"},
    ]
    avisos: list[str] = []
    out = svc.aplicar_bloco(pdf, bloco, sel, avisos)
    doc = fitz.open(stream=out, filetype="pdf")
    try:
        texto = doc[0].get_text().replace("\xa0", " ")
        desenhos = doc[0].get_drawings()
    finally:
        doc.close()
    assert "@exemplo" not in texto and "exemplo.com" not in texto
    assert "+55 61 98428 4040" in texto and "@ana.dep" in texto and "@inativa" not in texto
    # Os 3 quadrados pretos de exemplo saíram; entram os 2 logos escolhidos.
    pretos = [d for d in desenhos if d.get("fill") == (0.0, 0.0, 0.0)]
    assert not pretos
    assert len([d for d in desenhos if d.get("fill") and d["fill"] != (0.0, 0.0, 0.0)]) == 2
    assert avisos == []


def test_aplicar_bloco_sem_escolha_so_apaga_o_exemplo(catalogo):
    from services import papelaria_redes_service as svc

    pdf = _pdf_verso_redes()
    bloco = svc.detectar_bloco(pdf, 1, ["@exemplo.tiktok", "@exemplo.x", "exemplo.com/face"])
    out = svc.aplicar_bloco(pdf, bloco, [], [])
    doc = fitz.open(stream=out, filetype="pdf")
    try:
        assert "@exemplo" not in doc[0].get_text()
        assert not doc[0].get_drawings()
    finally:
        doc.close()


def test_remove_degrade_recortado_dentro_da_area():
    from services import papelaria_redes_service as svc

    trecho = "q 10 20 m 30 20 l 30 40 l 10 40 l h W n 1 0 0 1 10 20 cm /Sh1 sh Q"
    assert svc._bbox_caminho("10 20 m 30 20 l 30 40 l 10 40 l h") == (10, 20, 30, 40)
    assert svc._DEGRADE_RE.search("q/GS1 gs " + trecho + " Q")
    m = svc._DEGRADE_RE.search(trecho)
    assert m and m.group(0).endswith("sh Q")


def test_sanitizar_dados_redes():
    from services import papelaria_jobs_service as jobs

    limpos = jobs._sanitize_dados({"__redes": json.dumps([{"chave": "instagram", "valor": "@a"}])})
    assert json.loads(limpos["__redes"]) == [{"chave": "instagram", "valor": "@a"}]
    with pytest.raises(ValueError):
        jobs._sanitize_dados({"__redes": "{x"})


def test_prova_pdf_com_bloco_de_redes(tmp_path, monkeypatch, catalogo):
    """Fluxo do modelo: salvar o bloco tira as linhas de exemplo dos campos; a prévia aplica as redes."""
    from services import papelaria_prova_pdf_service as pdf_svc

    monkeypatch.setattr(pdf_svc, "RAIZ_MODELOS_PDF", tmp_path / "pdf")
    pdf_svc.salvar_pdf_modelo(31, filename="verso.pdf", content=_pdf_verso_redes())
    pdf_svc.salvar_campos(31, [{"marcador": "@exemplo.x", "pagina": 1, "template": "{nome}"}])
    linhas = ["@exemplo.tiktok", "@exemplo.x", "exemplo.com/face"]
    pdf_svc.salvar_bloco_redes(31, pdf_svc.detectar_bloco_redes(31, 1, linhas))
    cfg = pdf_svc.carregar_config(31)
    assert cfg["campos"] == []  # a linha de exemplo deixou de ser campo
    assert pdf_svc.tem_modelo_pdf(31) is True  # bloco de redes basta
    r = pdf_svc.previa_png(31, {"__redes": json.dumps([{"chave": "instagram", "valor": "@ana"}])}, dpi=40, modelo={})
    assert r["paginas"]
    pdf_svc.salvar_bloco_redes(31, None)
    assert "redes" not in pdf_svc.carregar_config(31)
