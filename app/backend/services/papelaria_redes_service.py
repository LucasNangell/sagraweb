"""
Redes sociais na Prova PDF.

* **Catálogo** (universal): redes com nome, exemplo do campo e até 4 logos —
  um por **estilo** (Quadrado policromia, Quadrado PB, Policromia, PB). Nem
  toda rede precisa ter os 4. Tabela ``tabPapelariaRedesSociais`` (coluna
  ``LogosJson``); arquivos em ``Modelos/papelaria/redes``.
* **Bloco no modelo**: área do PDF onde ficam as redes, calculada a partir das
  linhas de exemplo, com disposição, alinhamento, tamanhos e estilo padrão.
  Fica em ``config.json`` do Prova PDF do modelo (chave ``redes``).
* **Renderização**: na prova, apaga o exemplo da área e desenha só as redes que
  o usuário escolheu, todas no mesmo estilo de logo.
"""
from __future__ import annotations

import json
import logging
import math
import re
import shutil
import threading
import time
from pathlib import Path
from typing import Any, Optional

from config_manager import PROJECT_ROOT
from database import db

logger = logging.getLogger(__name__)

MM = 72.0 / 25.4
PASTA_LOGOS = PROJECT_ROOT / "Modelos" / "papelaria" / "redes"
ASSETS_LOGOS = Path(__file__).resolve().parents[1] / "assets" / "papelaria_redes"
MAX_LOGO_BYTES = 2 * 1024 * 1024
DADOS_KEY = "__redes"
ESTILO_DADOS_KEY = "__redes_estilo"
CHAVE_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")  # «x» (X/Twitter) tem 1 letra
DISPOSICOES = ("vertical", "horizontal", "grade")
ALINH_H = ("esquerda", "centro", "direita")
ALINH_V = ("topo", "meio", "base")

# Estilos de logo (perfil de cores). Todas as redes de uma prova usam o mesmo.
ESTILOS: list[dict[str, str]] = [
    {"id": "quadrado_policromia", "rotulo": "Quadrado policromia"},
    {"id": "quadrado_pb", "rotulo": "Quadrado PB"},
    {"id": "policromia", "rotulo": "Policromia"},
    {"id": "pb", "rotulo": "PB"},
]
ESTILOS_IDS = tuple(e["id"] for e in ESTILOS)
ESTILO_PADRAO = "quadrado_policromia"

# Nome/exemplo das redes que vêm com logos em assets/papelaria_redes.
_PADRAO: dict[str, dict[str, str]] = {
    "tiktok": {"nome": "TikTok", "exemplo": "@usuario"},
    "x": {"nome": "X (Twitter)", "exemplo": "@usuario"},
    "kwai": {"nome": "Kwai", "exemplo": "@usuario"},
    "instagram": {"nome": "Instagram", "exemplo": "@usuario"},
    "facebook": {"nome": "Facebook", "exemplo": "facebook.com/usuario"},
    "whatsapp": {"nome": "WhatsApp", "exemplo": "+55 61 99999-9999"},
    "youtube": {"nome": "YouTube", "exemplo": "youtube.com/@canal"},
    "telegram": {"nome": "Telegram", "exemplo": "t.me/usuario"},
    "linktree": {"nome": "Linktree", "exemplo": "linktr.ee/usuario"},
    "threads": {"nome": "Threads", "exemplo": "@usuario"},
    "linkedin": {"nome": "LinkedIn", "exemplo": "linkedin.com/in/usuario"},
    "snapchat": {"nome": "Snapchat", "exemplo": "@usuario"},
    "flickr": {"nome": "Flickr", "exemplo": "flickr.com/usuario"},
    "twitter": {"nome": "Twitter (pássaro)", "exemplo": "@usuario"},
}
_ORDEM_PADRAO = list(_PADRAO)
_ARQUIVO_ASSET_RE = re.compile(r"^([a-z][a-z0-9_]*)__(" + "|".join(ESTILOS_IDS) + r")\.(pdf|png)$")
_MARCA_IMPORTADOS = ".assets_importados.json"

_SQL = """
CREATE TABLE IF NOT EXISTS tabPapelariaRedesSociais (
    Chave VARCHAR(40) NOT NULL PRIMARY KEY,
    Nome VARCHAR(60) NOT NULL,
    Exemplo VARCHAR(120) NULL,
    LogoArquivo VARCHAR(120) NULL,
    LogosJson JSON NULL,
    Ativo TINYINT(1) NOT NULL DEFAULT 1,
    Ordem INT NOT NULL DEFAULT 0,
    AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_lock = threading.Lock()
_cache: dict[str, Any] = {"em": 0.0, "dados": None}
_tabela_ok = False


class RedesError(ValueError):
    """Cadastro ou bloco de redes inválido."""


# ---------------------------------------------------------------------------
# Catálogo
# ---------------------------------------------------------------------------


def _tem_coluna(coluna: str) -> bool:
    rows = db.execute_query(
        """
        SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabPapelariaRedesSociais'
          AND COLUMN_NAME = %(c)s
        """,
        {"c": coluna},
    ) or [{"n": 0}]
    return bool(int(rows[0].get("n") or 0))


def ensure_tabela() -> None:
    global _tabela_ok
    if _tabela_ok:
        return
    db.execute_query(_SQL)
    if not _tem_coluna("LogosJson"):
        db.execute_query("ALTER TABLE tabPapelariaRedesSociais ADD COLUMN LogosJson JSON NULL AFTER LogoArquivo")
    _tabela_ok = True
    try:
        importar_logos_dos_assets()
    except Exception as exc:  # catálogo continua utilizável sem a importação
        logger.warning("Redes sociais: importação dos logos padrão falhou: %s", exc)


def _logos_da_linha(r: dict[str, Any]) -> dict[str, str]:
    bruto = r.get("LogosJson")
    if isinstance(bruto, (bytes, bytearray)):
        bruto = bruto.decode("utf-8")
    try:
        logos = json.loads(bruto) if isinstance(bruto, str) and bruto.strip() else (bruto or {})
    except json.JSONDecodeError:
        logos = {}
    out = {str(k): str(v) for k, v in (logos or {}).items() if str(k) in ESTILOS_IDS and v}
    # Logo único antigo (antes dos estilos) vale como «Quadrado policromia».
    if r.get("LogoArquivo") and ESTILO_PADRAO not in out:
        out[ESTILO_PADRAO] = str(r["LogoArquivo"])
    return out


def invalidar_cache() -> None:
    with _lock:
        _cache["dados"] = None


def listar() -> list[dict[str, Any]]:
    with _lock:
        if _cache["dados"] is not None and time.monotonic() - _cache["em"] < 15.0:
            return [dict(r, logos=dict(r["logos"])) for r in _cache["dados"]]
    ensure_tabela()
    rows = db.execute_query(
        "SELECT Chave, Nome, Exemplo, LogoArquivo, LogosJson, Ativo, Ordem FROM tabPapelariaRedesSociais ORDER BY Ordem, Chave"
    ) or []
    dados = []
    for r in rows:
        logos = _logos_da_linha(r)
        dados.append(
            {
                "chave": str(r["Chave"]),
                "nome": str(r.get("Nome") or r["Chave"]),
                "exemplo": str(r.get("Exemplo") or ""),
                "logos": logos,
                # Compatibilidade: primeiro logo disponível.
                "logo": next((logos[e] for e in ESTILOS_IDS if e in logos), None),
                "ativo": bool(r.get("Ativo")),
            }
        )
    with _lock:
        _cache["dados"] = dados
        _cache["em"] = time.monotonic()
    return [dict(r, logos=dict(r["logos"])) for r in dados]


def por_chave() -> dict[str, dict[str, Any]]:
    return {r["chave"]: r for r in listar()}


def _gravar_logos(chave: str, logos: dict[str, str]) -> None:
    db.execute_query(
        "UPDATE tabPapelariaRedesSociais SET LogosJson = %(j)s, LogoArquivo = NULL WHERE Chave = %(c)s",
        {"j": json.dumps(logos, ensure_ascii=False), "c": chave},
    )


def importar_logos_dos_assets() -> dict[str, int]:
    """
    Importa os logos padrão (``assets/papelaria_redes/<rede>__<estilo>.pdf``):
    cria a rede se faltar e preenche só os estilos vazios. Cada par
    rede+estilo é importado uma única vez (rede excluída não volta; logo
    enviado pelo admin não é sobrescrito).
    """
    if not ASSETS_LOGOS.is_dir():
        return {"redes": 0, "logos": 0}
    PASTA_LOGOS.mkdir(parents=True, exist_ok=True)
    marca = PASTA_LOGOS / _MARCA_IMPORTADOS
    try:
        importados = set(json.loads(marca.read_text(encoding="utf-8"))) if marca.is_file() else set()
    except (OSError, json.JSONDecodeError):
        importados = set()
    pendentes: dict[str, dict[str, Path]] = {}
    for arq in sorted(ASSETS_LOGOS.iterdir()):
        m = _ARQUIVO_ASSET_RE.match(arq.name)
        if m and f"{m.group(1)}__{m.group(2)}" not in importados:
            pendentes.setdefault(m.group(1), {})[m.group(2)] = arq
    if not pendentes:
        return {"redes": 0, "logos": 0}
    rows = db.execute_query(
        "SELECT Chave, LogoArquivo, LogosJson, Ordem FROM tabPapelariaRedesSociais"
    ) or []
    existentes = {str(r["Chave"]): _logos_da_linha(r) for r in rows}
    ordem_max = max([int(r.get("Ordem") or 0) for r in rows] or [0])
    novas = logos_n = 0
    for chave in sorted(pendentes, key=lambda c: _ORDEM_PADRAO.index(c) if c in _ORDEM_PADRAO else 999):
        estilos = pendentes[chave]
        if chave not in existentes:
            info = _PADRAO.get(chave, {"nome": chave.capitalize(), "exemplo": "@usuario"})
            ordem_max += 10
            db.execute_query(
                """
                INSERT INTO tabPapelariaRedesSociais (Chave, Nome, Exemplo, LogosJson, Ativo, Ordem)
                VALUES (%(c)s, %(n)s, %(e)s, '{}', 1, %(o)s)
                """,
                {"c": chave, "n": info["nome"], "e": info["exemplo"], "o": ordem_max},
            )
            existentes[chave] = {}
            novas += 1
        logos = dict(existentes[chave])
        for estilo, arq in estilos.items():
            if estilo not in logos:
                destino = f"{chave}__{estilo}{arq.suffix.lower()}"
                shutil.copyfile(arq, PASTA_LOGOS / destino)
                logos[estilo] = destino
                logos_n += 1
            importados.add(f"{chave}__{estilo}")
        _gravar_logos(chave, logos)
    marca.write_text(json.dumps(sorted(importados)), encoding="utf-8")
    invalidar_cache()
    logger.info("Redes sociais: %s rede(s) e %s logo(s) importados dos assets.", novas, logos_n)
    return {"redes": novas, "logos": logos_n}


def salvar_lista(raw: Any) -> list[dict[str, Any]]:
    """Substitui o catálogo (ordem = ordem da lista). Logos não mudam aqui."""
    if not isinstance(raw, list):
        raise RedesError("Envie a lista de redes.")
    atuais = por_chave()
    vistas: set[str] = set()
    itens: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise RedesError("Rede inválida.")
        chave = str(item.get("chave") or "").strip().lower()
        if not CHAVE_RE.match(chave):
            raise RedesError(f"Identificador inválido: «{chave or '(vazio)'}» (minúsculas, números e _).")
        if chave in vistas:
            raise RedesError(f"Rede repetida: {chave}.")
        vistas.add(chave)
        nome = str(item.get("nome") or "").strip()
        if not nome:
            raise RedesError(f"Informe o nome da rede {chave}.")
        itens.append(
            {
                "chave": chave,
                "nome": nome[:60],
                "exemplo": str(item.get("exemplo") or "").strip()[:120],
                "logos": (atuais.get(chave) or {}).get("logos") or {},
                "ativo": bool(item.get("ativo", True)),
            }
        )
    ensure_tabela()
    ops: list[Any] = [("DELETE FROM tabPapelariaRedesSociais", None)]
    for ordem, r in enumerate(itens):
        ops.append(
            (
                """
                INSERT INTO tabPapelariaRedesSociais (Chave, Nome, Exemplo, LogoArquivo, LogosJson, Ativo, Ordem)
                VALUES (%(c)s, %(n)s, %(e)s, NULL, %(l)s, %(a)s, %(o)s)
                """,
                {
                    "c": r["chave"],
                    "n": r["nome"],
                    "e": r["exemplo"],
                    "l": json.dumps(r["logos"], ensure_ascii=False),
                    "a": 1 if r["ativo"] else 0,
                    "o": (ordem + 1) * 10,
                },
            )
        )
    db.execute_transaction(ops)
    invalidar_cache()
    return listar()


def _estilo_valido(estilo: Optional[str]) -> str:
    e = (estilo or "").strip() or ESTILO_PADRAO
    if e not in ESTILOS_IDS:
        raise RedesError("Estilo de logo inválido.")
    return e


def salvar_logo(chave: str, filename: str, content: bytes, estilo: Optional[str] = None) -> dict[str, Any]:
    """Logo da rede num estilo: SVG e PDF viram PDF vetorial (1ª página); PNG fica PNG."""
    import fitz

    estilo = _estilo_valido(estilo)
    rede = por_chave().get(chave)
    if not rede:
        raise LookupError("Rede não encontrada.")
    if not content or len(content) > MAX_LOGO_BYTES:
        raise RedesError("Envie um logo de até 2 MB.")
    nome = (filename or "").lower()
    PASTA_LOGOS.mkdir(parents=True, exist_ok=True)
    try:
        if nome.endswith(".png"):
            fitz.Pixmap(content)  # valida
            sufixo, dados = ".png", content
        elif nome.endswith(".svg") or nome.endswith(".pdf"):
            with fitz.open(stream=content, filetype="svg" if nome.endswith(".svg") else "pdf") as src:
                pdf = fitz.open("pdf", src.convert_to_pdf(0, 0)) if nome.endswith(".svg") else fitz.open("pdf", content)
                with pdf:
                    um = fitz.open()
                    um.insert_pdf(pdf, from_page=0, to_page=0)
                    dados = um.tobytes(garbage=4, deflate=True)
                    um.close()
            sufixo = ".pdf"
        else:
            raise RedesError("Formato do logo: SVG, PDF ou PNG.")
    except RedesError:
        raise
    except Exception as exc:
        raise RedesError(f"Não foi possível ler o logo: {exc}") from exc
    for antigo in PASTA_LOGOS.glob(f"{chave}__{estilo}.*"):
        antigo.unlink(missing_ok=True)
    destino = f"{chave}__{estilo}{sufixo}"
    (PASTA_LOGOS / destino).write_bytes(dados)
    logos = dict(rede.get("logos") or {})
    logos[estilo] = destino
    _gravar_logos(chave, logos)
    invalidar_cache()
    return por_chave()[chave]


def remover_logo(chave: str, estilo: str) -> dict[str, Any]:
    estilo = _estilo_valido(estilo)
    rede = por_chave().get(chave)
    if not rede:
        raise LookupError("Rede não encontrada.")
    logos = dict(rede.get("logos") or {})
    logos.pop(estilo, None)
    _gravar_logos(chave, logos)
    invalidar_cache()
    return por_chave()[chave]


def _arquivo(nome: Optional[str]) -> Optional[Path]:
    if not nome:
        return None
    p = PASTA_LOGOS / str(nome)
    return p if p.is_file() else None


def caminho_logo(rede: dict[str, Any], estilo: Optional[str] = None, *, permitir_outro: bool = True) -> Optional[Path]:
    """Logo da rede no estilo pedido (ou, se faltar e permitido, no primeiro disponível)."""
    logos = rede.get("logos") or {}
    if estilo:
        p = _arquivo(logos.get(estilo))
        if p or not permitir_outro:
            return p
    for e in ESTILOS_IDS:
        p = _arquivo(logos.get(e))
        if p:
            return p
    return _arquivo(rede.get("logo"))


def logo_png(chave: str, estilo: Optional[str] = None, tamanho_px: int = 96) -> Optional[bytes]:
    """PNG do logo para exibir no admin/Papelaria."""
    import fitz

    rede = por_chave().get(chave)
    p = caminho_logo(rede, estilo, permitir_outro=not estilo) if rede else None
    if not p:
        return None
    if p.suffix.lower() == ".png":
        return p.read_bytes()
    with fitz.open(str(p)) as d:
        pg = d[0]
        zoom = tamanho_px / max(pg.rect.width, pg.rect.height, 1)
        return pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True).tobytes("png")


def normalizar_estilo_selecao(raw: Any) -> Optional[str]:
    e = str(raw or "").strip()
    if not e:
        return None
    if e not in ESTILOS_IDS:
        raise RedesError("Estilo de logo inválido.")
    return e


def normalizar_selecao(raw: Any) -> Optional[list[dict[str, str]]]:
    """Escolha do usuário: [{"chave", "valor"}] na ordem desejada (None = não informada)."""
    if raw in (None, ""):
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RedesError("Redes sociais: JSON inválido.") from exc
    if not isinstance(raw, list):
        raise RedesError("Redes sociais inválidas.")
    out: list[dict[str, str]] = []
    vistas: set[str] = set()
    for item in raw[:20]:
        if not isinstance(item, dict):
            continue
        chave = str(item.get("chave") or "").strip().lower()
        valor = str(item.get("valor") or "").strip()[:200]
        if not chave or chave in vistas:
            continue
        vistas.add(chave)
        out.append({"chave": chave, "valor": valor})
    return out


# ---------------------------------------------------------------------------
# Bloco de redes do modelo
# ---------------------------------------------------------------------------


def _rect(v: Any) -> Any:
    import fitz

    return fitz.Rect(*[float(x) for x in v])


def detectar_bloco(pdf: Any, pagina: int, marcadores: list[str]) -> dict[str, Any]:
    """
    A partir das linhas de exemplo escolhidas, calcula área (texto + ícones à
    esquerda), tamanho do ícone, espaçamentos, alinhamento e fonte de referência.
    """
    import fitz

    from services.papelaria_prova_pdf_service import _abrir, agrupar_spans_da_linha, _bbox_do_grupo, _texto_do_grupo

    if not marcadores:
        raise RedesError("Escolha as linhas de exemplo das redes sociais.")
    doc = _abrir(pdf)
    try:
        if not 1 <= pagina <= doc.page_count:
            raise RedesError("Página inválida.")
        pg = doc[pagina - 1]
        alvo = set(marcadores)
        linhas: list[tuple[str, Any]] = []
        for b in pg.get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                for g in agrupar_spans_da_linha(l["spans"]):
                    t = _texto_do_grupo(g)
                    if t in alvo:
                        linhas.append((t, fitz.Rect(_bbox_do_grupo(g))))
        if not linhas:
            raise RedesError("As linhas escolhidas não foram encontradas no PDF.")
        linhas.sort(key=lambda x: x[1].y0)
        caixas = [fitz.Rect(d["rect"]) for d in pg.get_drawings()] + [fitz.Rect(i["bbox"]) for i in pg.get_image_info()]
        area = fitz.Rect()
        icones: list[Any] = []
        gaps: list[float] = []
        for _t, r in linhas:
            area |= r
            cy = (r.y0 + r.y1) / 2
            icone = fitz.Rect()
            for c in caixas:
                if c.x1 <= r.x0 + 0.5 and r.x0 - c.x0 < 30 and abs((c.y0 + c.y1) / 2 - cy) < max(6, r.height) and c.width < 30 and c.height < 30:
                    icone |= c
            if not icone.is_empty:
                icones.append(icone)
                gaps.append(r.x0 - icone.x1)
                area |= icone
        lado = sorted(max(i.width, i.height) for i in icones)
        icone_mm = round((lado[len(lado) // 2] if lado else linhas[0][1].height * 1.4) / MM, 2)
        passos = [b[1].y0 - a[1].y0 for a, b in zip(linhas, linhas[1:])]
        altura_linha = max(icone_mm * MM, linhas[0][1].height)
        espaco_mm = round(max(0.0, (sorted(passos)[len(passos) // 2] - altura_linha) / MM), 2) if passos else 1.5
        gap_mm = round(max(0.3, (sorted(gaps)[len(gaps) // 2] if gaps else 2.0) / MM), 2)
        w = pg.rect.width
        cx = (area.x0 + area.x1) / 2
        if abs(cx - w / 2) <= w * 0.06:
            alinh_h = "centro"
        elif area.x1 >= w * 0.75 and area.x0 > w / 2:
            alinh_h = "direita"
        else:
            alinh_h = "esquerda"
        return {
            "ativo": True,
            "pagina": pagina,
            "area": [round(v, 2) for v in area],
            "marcadores": [t for t, _ in linhas],
            "fonte_marcador": linhas[0][0],
            "disposicao": "vertical",
            "alinhamento_h": alinh_h,
            "alinhamento_v": "meio",
            "icone_mm": icone_mm,
            "espaco_mm": espaco_mm,
            "gap_mm": gap_mm,
            "max": len(linhas),
            "permitidas": [],
            "estilo_padrao": ESTILO_PADRAO,
        }
    finally:
        doc.close()


def normalizar_bloco(raw: Any) -> Optional[dict[str, Any]]:
    if raw in (None, {}, ""):
        return None
    if not isinstance(raw, dict):
        raise RedesError("Bloco de redes inválido.")
    try:
        area = [float(x) for x in raw.get("area") or []]
        assert len(area) == 4 and area[2] > area[0] and area[3] > area[1]
    except Exception as exc:
        raise RedesError("Área do bloco de redes inválida.") from exc

    def num(nome: str, padrao: float, lo: float, hi: float) -> float:
        try:
            v = float(raw.get(nome, padrao))
        except (TypeError, ValueError):
            v = padrao
        return round(max(lo, min(hi, v)), 2)

    disp = raw.get("disposicao") if raw.get("disposicao") in DISPOSICOES else "vertical"
    ah = raw.get("alinhamento_h") if raw.get("alinhamento_h") in ALINH_H else "esquerda"
    av = raw.get("alinhamento_v") if raw.get("alinhamento_v") in ALINH_V else "meio"
    marcadores = [str(m) for m in raw.get("marcadores") or [] if str(m).strip()]
    fonte = str(raw.get("fonte_marcador") or (marcadores[0] if marcadores else "")).strip()
    if not fonte:
        raise RedesError("Escolha a linha de exemplo que define a fonte das redes.")
    return {
        "ativo": bool(raw.get("ativo", True)),
        "pagina": max(1, int(raw.get("pagina") or 1)),
        "area": [round(v, 2) for v in area],
        "marcadores": marcadores,
        "fonte_marcador": fonte,
        "disposicao": disp,
        "alinhamento_h": ah,
        "alinhamento_v": av,
        "icone_mm": num("icone_mm", 3.7, 1.0, 20.0),
        "espaco_mm": num("espaco_mm", 1.4, 0.0, 30.0),
        "gap_mm": num("gap_mm", 0.8, 0.0, 20.0),
        "max": int(num("max", 6, 1, 20)),
        "permitidas": [str(c) for c in raw.get("permitidas") or [] if str(c).strip()],
        "estilo_padrao": raw.get("estilo_padrao") if raw.get("estilo_padrao") in ESTILOS_IDS else ESTILO_PADRAO,
    }


def redes_do_bloco(bloco: dict[str, Any]) -> list[dict[str, Any]]:
    """Redes ativas que o bloco aceita, na ordem do catálogo."""
    permitidas = set(bloco.get("permitidas") or [])
    return [r for r in listar() if r["ativo"] and (not permitidas or r["chave"] in permitidas)]


def selecao_exemplo(bloco: dict[str, Any]) -> list[dict[str, str]]:
    """Prévia do admin: as redes do bloco com o texto de exemplo."""
    return [{"chave": r["chave"], "valor": r["exemplo"] or r["nome"]} for r in redes_do_bloco(bloco)][: int(bloco.get("max") or 6)]


# Degradê recortado (ex.: fundo do ícone do Instagram exportado pelo Corel):
# «q <caminho> W n [cm] /ShN sh Q» — a remoção do PyMuPDF não apaga «sh».
_DEGRADE_RE = re.compile(
    r"(?<![A-Za-z])q\s((?:(?!(?<![A-Za-z])[qQ](?![A-Za-z])).)*?)(?<![A-Za-z])W\s+n(?![A-Za-z])"
    r"(?:(?!(?<![A-Za-z])[qQ](?![A-Za-z])).)*?/[^\s/<>\[\]()]+\s+sh\s+Q(?![A-Za-z])",
    re.S,
)
_NUM_RE = re.compile(r"-?\d*\.?\d+")


def _bbox_caminho(trecho: str) -> Optional[tuple[float, float, float, float]]:
    """Caixa (coordenadas do PDF) de um caminho «m/l/c/re … h»."""
    xs: list[float] = []
    ys: list[float] = []
    for m in re.finditer(r"((?:-?\d*\.?\d+\s+){2,6})(m|l|c|v|y|re)(?![A-Za-z])", trecho):
        nums = [float(n) for n in _NUM_RE.findall(m.group(1))]
        if m.group(2) == "re" and len(nums) >= 4:
            x, y, w, h = nums[-4:]
            xs += [x, x + w]
            ys += [y, y + h]
        else:
            for i in range(0, len(nums) - 1, 2):
                xs.append(nums[i])
                ys.append(nums[i + 1])
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def _remover_degrades(doc: Any, page: Any, area: Any) -> None:
    """Tira os degradês recortados que estão inteiros dentro da área."""
    altura = page.rect.height
    for xref in page.get_contents():
        try:
            texto = doc.xref_stream(xref).decode("latin-1")
        except Exception:
            continue

        def trocar(m: re.Match[str]) -> str:
            caixa = _bbox_caminho(m.group(1))
            if caixa is None:
                return m.group(0)
            x0, y0, x1, y1 = caixa
            # PDF (origem embaixo) → página (origem em cima)
            if area.x0 <= x0 and x1 <= area.x1 and area.y0 <= altura - y1 and altura - y0 <= area.y1:
                return ""
            return m.group(0)

        novo = _DEGRADE_RE.sub(trocar, texto)
        if novo != texto:
            doc.update_stream(xref, novo.encode("latin-1"))


def aplicar_bloco(
    pdf_bytes: bytes,
    bloco: Optional[dict[str, Any]],
    selecao: Optional[list[dict[str, str]]],
    avisos: Optional[list[str]] = None,
    estilo: Optional[str] = None,
) -> bytes:
    """Apaga o exemplo da área do bloco e desenha as redes escolhidas."""
    import fitz

    from services import papelaria_prova_pdf_service as pdf_svc

    if not bloco or not bloco.get("ativo"):
        return pdf_bytes
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        pidx = int(bloco["pagina"]) - 1
        if not 0 <= pidx < doc.page_count:
            return pdf_bytes
        page = doc[pidx]
        area = _rect(bloco["area"])
        largura_pg, altura_pg = page.rect.width, page.rect.height

        # Referência de fonte/tamanho/cor (antes de apagar a área).
        fontes_pg = {pdf_svc._nome_sem_subconjunto(f[3]): (f[0], f[4]) for f in page.get_fonts(full=True)}
        originais = pdf_svc.cores_originais_por_texto(doc, page)
        cores = pdf_svc._cores_por_trecho(page)
        ref = None
        for b in page.get_text("rawdict")["blocks"]:
            for l in b.get("lines", []):
                for g in pdf_svc.agrupar_spans_da_linha(l["spans"]):
                    if pdf_svc._texto_do_grupo(g) == bloco["fonte_marcador"]:
                        ref = g
                        break
                if ref:
                    break
            if ref:
                break
        if ref is None:
            raise pdf_svc.ProvaPdfError(
                "Bloco de redes: a linha de referência de fonte não está no PDF. Refaça o bloco em Textos e prévia."
            )
        base = pdf_svc._span_base(ref)
        achada = pdf_svc._fonte_do_span(fontes_pg, base["font"])
        fonte = pdf_svc.ler_fonte_embutida(doc, achada[0]) if achada else None
        if fonte is None:
            raise pdf_svc.ProvaPdfError("Bloco de redes: a fonte do exemplo não está incorporada de forma editável.")
        xref, recurso = achada
        tam = float(base["size"])
        tc = pdf_svc._espacamento_do_marcador(fonte, [c for c in base["chars"] if c["c"].strip()], tam)
        texto_ref = pdf_svc._texto_span(base).strip()
        cor = originais.get(pdf_svc._texto_do_grupo(ref)) or originais.get(texto_ref) or pdf_svc._cor_do_span(cores, base["bbox"])
        bb = fitz.Rect(base["bbox"])
        origem_y = float(base["origin"][1])
        sobe = max(0.1, (origem_y - bb.y0) / tam)  # acima da linha de base
        desce = max(0.0, (bb.y1 - origem_y) / tam)

        # Apaga o exemplo: textos e desenhos dentro da área; imagens só se
        # estiverem inteiras na área (não apaga fundo que passe por ela).
        # Folga: caixas dos ícones podem passar a área em frações de ponto.
        apagar = fitz.Rect(area.x0 - 1.5, area.y0 - 1.5, area.x1 + 1.5, area.y1 + 1.5) & page.rect
        imagens = [fitz.Rect(i["bbox"]) for i in page.get_image_info()]
        cruzam = [r for r in imagens if r.intersects(apagar)]
        tirar_imagens = bool(cruzam) and all(apagar.contains(r) for r in cruzam)
        page.add_redact_annot(apagar, fill=False)
        page.apply_redactions(
            images=fitz.PDF_REDACT_IMAGE_REMOVE if tirar_imagens else fitz.PDF_REDACT_IMAGE_NONE,
            graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
            text=fitz.PDF_REDACT_TEXT_REMOVE,
        )
        _remover_degrades(doc, page, apagar)

        catalogo = por_chave()
        permitidas = set(bloco.get("permitidas") or [])
        itens: list[tuple[dict[str, Any], str]] = []
        for s in selecao or []:
            rede = catalogo.get(s["chave"])
            if not rede or not rede["ativo"] or (permitidas and rede["chave"] not in permitidas):
                continue
            if not s["valor"]:
                continue
            itens.append((rede, s["valor"]))
        itens = itens[: int(bloco.get("max") or 6)]
        if not itens:
            return doc.tobytes(garbage=3, deflate=True)
        estilo_logo = estilo if estilo in ESTILOS_IDS else bloco.get("estilo_padrao") or ESTILO_PADRAO

        for _rede, valor in itens:
            faltam = fonte.faltando(valor)
            if faltam:
                raise pdf_svc.ProvaPdfError(
                    f"A fonte {fonte.nome} do PDF não tem os caracteres {' '.join(faltam)} (redes sociais)."
                )

        def medir(f: float) -> dict[str, Any]:
            s_ = bloco["icone_mm"] * MM * f
            g_ = bloco["gap_mm"] * MM * f
            e_ = bloco["espaco_mm"] * MM * f
            t_ = tam * f
            larguras = [s_ + g_ + fonte.largura(v, t_, tc * f) for _r, v in itens]
            h_ = max(s_, t_ * (sobe + desce))
            n = len(itens)
            if bloco["disposicao"] == "horizontal":
                W, H = sum(larguras) + e_ * 2 * (n - 1), h_
            elif bloco["disposicao"] == "grade":
                linhas_g = math.ceil(n / 2)
                col = max(larguras)
                W, H = (col * 2 + e_ * 2) if n > 1 else col, linhas_g * h_ + (linhas_g - 1) * e_
            else:
                W, H = max(larguras), n * h_ + (n - 1) * e_
            return {"s": s_, "g": g_, "e": e_, "t": t_, "tc": tc * f, "h": h_, "larg": larguras, "W": W, "H": H}

        margem = pdf_svc.MARGEM_MINIMA_PT
        cx, cy = (area.x0 + area.x1) / 2, (area.y0 + area.y1) / 2
        ah, av = bloco["alinhamento_h"], bloco["alinhamento_v"]
        disp_w = (
            largura_pg - margem - area.x0 if ah == "esquerda"
            else area.x1 - margem if ah == "direita"
            else 2 * min(cx - margem, largura_pg - margem - cx)
        )
        disp_h = (
            altura_pg - margem - area.y0 if av == "topo"
            else area.y1 - margem if av == "base"
            else 2 * min(cy - margem, altura_pg - margem - cy)
        )
        m = medir(1.0)
        fator = min(1.0, disp_w / m["W"] if m["W"] else 1.0, disp_h / m["H"] if m["H"] else 1.0)
        if fator < 1.0:
            if fator < pdf_svc.FATOR_REDUCAO_MINIMO:
                fator = pdf_svc.FATOR_REDUCAO_MINIMO
                if avisos is not None:
                    avisos.append(
                        "Redes sociais: mesmo reduzido a 60% o bloco passa da margem de 3 mm — "
                        "use menos redes ou textos mais curtos."
                    )
            m = medir(fator)
        bx = area.x0 if ah == "esquerda" else area.x1 - m["W"] if ah == "direita" else cx - m["W"] / 2
        by = area.y0 if av == "topo" else area.y1 - m["H"] if av == "base" else cy - m["H"] / 2

        posicoes: list[tuple[float, float]] = []
        if bloco["disposicao"] == "horizontal":
            x = bx
            for w_ in m["larg"]:
                posicoes.append((x, by))
                x += w_ + m["e"] * 2
        elif bloco["disposicao"] == "grade":
            col = max(m["larg"]) + m["e"] * 2
            for i in range(len(itens)):
                posicoes.append((bx + (i % 2) * col, by + (i // 2) * (m["h"] + m["e"])))
        else:
            for i in range(len(itens)):
                posicoes.append((bx, by + i * (m["h"] + m["e"])))

        pdf_svc.garantir_recurso_fonte(doc, page, recurso, xref)
        ops = ["q"]
        for (rede, valor), (x, y) in zip(itens, posicoes):
            centro = y + m["h"] / 2
            caixa = fitz.Rect(x, centro - m["s"] / 2, x + m["s"], centro + m["s"] / 2)
            logo = caminho_logo(rede, estilo_logo, permitir_outro=False)
            if logo is None:
                logo = caminho_logo(rede)
                if logo is not None and avisos is not None:
                    rot = next((e["rotulo"] for e in ESTILOS if e["id"] == estilo_logo), estilo_logo)
                    avisos.append(f"A rede {rede['nome']} não tem logo «{rot}» — usado outro estilo.")
            if logo is not None:
                try:
                    if logo.suffix.lower() == ".png":
                        page.insert_image(caixa, filename=str(logo), keep_proportion=True)
                    else:
                        with fitz.open(str(logo)) as ld:
                            page.show_pdf_page(caixa, ld, 0, keep_proportion=True)
                except Exception as exc:
                    logger.warning("Logo da rede %s não pôde ser desenhado: %s", rede["chave"], exc)
            elif avisos is not None:
                avisos.append(f"A rede {rede['nome']} está sem logo cadastrado.")
            base_y = centro + (sobe - desce) / 2 * m["t"]
            tx = x + m["s"] + m["g"]
            ops.append(
                f"BT {cor} /{recurso} {m['t']:.4f} Tf {m['tc']:.4f} Tc "
                f"1 0 0 1 {tx:.4f} {altura_pg - base_y:.4f} Tm <{fonte.codificar(valor)}> Tj ET"
            )
        ops.append("Q")
        page.wrap_contents()
        novo = doc.get_new_xref()
        doc.update_object(novo, "<<>>")
        doc.update_stream(novo, ("\n".join(ops) + "\n").encode("latin-1"))
        conteudos = page.get_contents() + [novo]
        doc.xref_set_key(page.xref, "Contents", "[" + " ".join(f"{c} 0 R" for c in conteudos) + "]")
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()
