"""Perfil de imposição v2 — modelo genérico, sem regras por nome de produto.

Todo produto de papelaria é descrito pelos mesmos campos (folha, página,
grade, slots, marcas, arte, juntada, saída). Nada aqui conhece nomes de
produtos: o que antes era fixo no código para alguns produtos agora
é configurado pelo usuário em Configurações → Papelaria → Produtos → Imposição.

Coordenadas dos slots (posicionamento manual): milímetros, origem no canto
SUPERIOR ESQUERDO da folha, y crescendo para baixo; (x, y) é o canto superior
esquerdo da área ocupada pelo slot já girado. A conversão para o sistema do
PDF/JDF (canto inferior esquerdo) acontece só em ``slots_pdf_ll``.

O perfil é "compilado" para o formato de configuração já aceito pelo gerador
de JDF (``compilar_config_jdf``), para que geração, reenvio, nomes de arquivo
e finalização usem exatamente o mesmo caminho de código que já funciona.
"""
from __future__ import annotations

import copy
import math
from typing import Any, Optional

VERSAO = 2
VARIANTES = ("digital", "offset")
ROTACOES = (0, 90, 180, 270)
FONTES_PAGINA = ("fixa", "pdf")
FACES = ("frente", "frente_verso")
POSICIONAMENTOS = ("grade", "manual")
ALINHAMENTOS = ("centro", "topo_esquerda")
FONTES_ARTE = ("base_sefoc", "pre_impresso")
ROTACAO_ARTE = ("no_jdf", "no_pdf")
REGRAS_TIRAGEM = ("iguais", "proporcional_mdc", "livre")
DESTINOS_PDF = ("digital", "offset")

#: Tolerância (mm) entre o tamanho do PDF de marcas e a folha.
TOLERANCIA_MARCAS_MM = 0.5
#: Tolerância (mm) para considerar slots/folha "encostados" sem sobrepor.
_EPS_MM = 0.01


def perfil_vazio() -> dict[str, Any]:
    """Perfil inicial em branco (sem nenhum valor herdado de produto)."""
    return {
        "versao": VERSAO,
        "folha": {"largura_mm": None, "altura_mm": None},
        "pagina": {"fonte": "fixa", "largura_mm": None, "altura_mm": None},
        "sangria_mm": 0.0,
        "faces": "frente",
        "posicionamento": "grade",
        "grade": {
            "colunas": 1,
            "linhas": 1,
            "espaco_h_mm": 0.0,
            "espaco_v_mm": 0.0,
            "alinhamento": "centro",
        },
        "slots": {"frente": [], "verso": []},
        "marcas": {"ativo": False, "pdf_path": None, "carimbar_op": False},
        "arte": {"fonte": "base_sefoc", "rotacao": "no_jdf"},
        "juntada": {
            "ativo": False,
            "situacao_candidatas": None,
            "produtos_compativeis": [],
            "regra_tiragem": "iguais",
            "max_os": None,
            "preencher_todos_slots": False,
        },
        "saida": {"destino_pdf": "digital", "jdf_hotfolder": None},
    }


# ---------------------------------------------------------------------------
# Normalização estrutural (tipos e campos). Erros aqui = JSON malformado.
# ---------------------------------------------------------------------------


def _num(value: Any, label: str, *, allow_none: bool = False) -> Optional[float]:
    if value is None or value == "":
        if allow_none:
            return None
        raise ValueError(f"{label} é obrigatório.")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        try:
            value = float(str(value).replace(",", "."))
        except (TypeError, ValueError):
            raise ValueError(f"{label} deve ser numérico.") from None
    num = float(value)
    if math.isnan(num) or math.isinf(num):
        raise ValueError(f"{label} deve ser numérico.")
    return num


def _int(value: Any, label: str, *, minimo: int = 0, allow_none: bool = False) -> Optional[int]:
    if value is None or value == "":
        if allow_none:
            return None
        raise ValueError(f"{label} é obrigatório.")
    if isinstance(value, bool):
        raise ValueError(f"{label} deve ser inteiro.")
    try:
        num = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} deve ser inteiro.") from None
    if int(num) != num:
        raise ValueError(f"{label} deve ser inteiro.")
    out = int(num)
    if out < minimo:
        raise ValueError(f"{label} deve ser >= {minimo}.")
    return out


def _bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "sim", "yes", "on"}


def _choice(value: Any, options: tuple[str, ...], label: str, default: str) -> str:
    if value is None or value == "":
        return default
    text = str(value).strip()
    if text not in options:
        raise ValueError(f"{label} inválido. Valores: {', '.join(options)}.")
    return text


def _text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _rotacao(value: Any, label: str) -> int:
    if value is None or value == "":
        return 0
    rot = _int(value, label, minimo=-100000) or 0
    rot = ((rot % 360) + 360) % 360
    if rot not in ROTACOES:
        raise ValueError(f"{label} deve ser 0, 90, 180 ou 270.")
    return rot


def _normalize_slots(raw: Any, label: str) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError(f"{label} deve ser uma lista.")
    out: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for idx, item in enumerate(raw):
        lab = f"{label}[{idx}]"
        if not isinstance(item, dict):
            raise ValueError(f"{lab} deve ser um objeto.")
        sid = _int(item.get("id"), f"{lab}.id", minimo=1, allow_none=True)
        if sid is None:
            sid = max(seen_ids, default=0) + 1
        if sid in seen_ids:
            raise ValueError(f"{lab}: id {sid} repetido.")
        seen_ids.add(sid)
        slot: dict[str, Any] = {
            "id": sid,
            "pagina": _int(item.get("pagina", 1), f"{lab}.pagina", minimo=1),
            "rotacao": _rotacao(item.get("rotacao"), f"{lab}.rotacao"),
        }
        col = _int(item.get("col"), f"{lab}.col", minimo=0, allow_none=True)
        row = _int(item.get("row"), f"{lab}.row", minimo=0, allow_none=True)
        if col is not None and row is not None:
            slot["col"] = col
            slot["row"] = row
        x = _num(item.get("x_mm"), f"{lab}.x_mm", allow_none=True)
        y = _num(item.get("y_mm"), f"{lab}.y_mm", allow_none=True)
        if x is not None and y is not None:
            slot["x_mm"] = round(x, 4)
            slot["y_mm"] = round(y, 4)
        out.append(slot)
    out.sort(key=lambda s: s["id"])
    return out


def normalize_perfil(data: Any) -> dict[str, Any]:
    """Valida a estrutura e devolve o perfil v2 normalizado (com defaults)."""
    if data is None:
        raise ValueError("Perfil de imposição vazio.")
    if not isinstance(data, dict):
        raise ValueError("Perfil de imposição deve ser um objeto JSON.")
    versao = data.get("versao", VERSAO)
    if versao not in (VERSAO, str(VERSAO)):
        raise ValueError("Perfil de imposição deve ter versao = 2.")

    base = perfil_vazio()

    folha = data.get("folha") or {}
    if not isinstance(folha, dict):
        raise ValueError("folha deve ser um objeto.")
    base["folha"] = {
        "largura_mm": _num(folha.get("largura_mm"), "folha.largura_mm", allow_none=True),
        "altura_mm": _num(folha.get("altura_mm"), "folha.altura_mm", allow_none=True),
    }

    pagina = data.get("pagina") or {}
    if not isinstance(pagina, dict):
        raise ValueError("pagina deve ser um objeto.")
    fonte = _choice(pagina.get("fonte"), FONTES_PAGINA, "pagina.fonte", "fixa")
    base["pagina"] = {
        "fonte": fonte,
        "largura_mm": (
            _num(pagina.get("largura_mm"), "pagina.largura_mm", allow_none=True)
            if fonte == "fixa"
            else None
        ),
        "altura_mm": (
            _num(pagina.get("altura_mm"), "pagina.altura_mm", allow_none=True)
            if fonte == "fixa"
            else None
        ),
    }

    sangria = _num(data.get("sangria_mm", 0), "sangria_mm", allow_none=True) or 0.0
    if sangria < 0:
        raise ValueError("sangria_mm deve ser >= 0.")
    base["sangria_mm"] = sangria
    base["faces"] = _choice(data.get("faces"), FACES, "faces", "frente")
    base["posicionamento"] = _choice(
        data.get("posicionamento"), POSICIONAMENTOS, "posicionamento", "grade"
    )

    grade = data.get("grade") or {}
    if not isinstance(grade, dict):
        raise ValueError("grade deve ser um objeto.")
    base["grade"] = {
        "colunas": _int(grade.get("colunas", 1), "grade.colunas", minimo=1),
        "linhas": _int(grade.get("linhas", 1), "grade.linhas", minimo=1),
        "espaco_h_mm": _num(grade.get("espaco_h_mm", 0), "grade.espaco_h_mm") or 0.0,
        "espaco_v_mm": _num(grade.get("espaco_v_mm", 0), "grade.espaco_v_mm") or 0.0,
        "alinhamento": _choice(
            grade.get("alinhamento"), ALINHAMENTOS, "grade.alinhamento", "centro"
        ),
    }
    if base["grade"]["espaco_h_mm"] < 0 or base["grade"]["espaco_v_mm"] < 0:
        raise ValueError("Espaços da grade devem ser >= 0.")

    slots = data.get("slots") or {}
    if not isinstance(slots, dict):
        raise ValueError("slots deve ser um objeto {frente, verso}.")
    base["slots"] = {
        "frente": _normalize_slots(slots.get("frente"), "slots.frente"),
        "verso": (
            _normalize_slots(slots.get("verso"), "slots.verso")
            if base["faces"] == "frente_verso"
            else []
        ),
    }

    marcas = data.get("marcas") or {}
    if not isinstance(marcas, dict):
        raise ValueError("marcas deve ser um objeto.")
    marcas_ativo = _bool(marcas.get("ativo"))
    base["marcas"] = {
        "ativo": marcas_ativo,
        "pdf_path": _text(marcas.get("pdf_path")) if marcas_ativo else None,
        "carimbar_op": _bool(marcas.get("carimbar_op")) if marcas_ativo else False,
    }

    arte = data.get("arte") or {}
    if not isinstance(arte, dict):
        raise ValueError("arte deve ser um objeto.")
    base["arte"] = {
        "fonte": _choice(arte.get("fonte"), FONTES_ARTE, "arte.fonte", "base_sefoc"),
        "rotacao": _choice(arte.get("rotacao"), ROTACAO_ARTE, "arte.rotacao", "no_jdf"),
    }

    juntada = data.get("juntada") or {}
    if not isinstance(juntada, dict):
        raise ValueError("juntada deve ser um objeto.")
    compat_raw = juntada.get("produtos_compativeis") or []
    if not isinstance(compat_raw, list):
        raise ValueError("juntada.produtos_compativeis deve ser uma lista.")
    compat: list[str] = []
    for item in compat_raw:
        text = _text(item)
        if text and text.lower() not in {c.lower() for c in compat}:
            compat.append(text)
    base["juntada"] = {
        "ativo": _bool(juntada.get("ativo")),
        "situacao_candidatas": _text(juntada.get("situacao_candidatas")),
        "produtos_compativeis": compat,
        "regra_tiragem": _choice(
            juntada.get("regra_tiragem"), REGRAS_TIRAGEM, "juntada.regra_tiragem", "iguais"
        ),
        "max_os": _int(juntada.get("max_os"), "juntada.max_os", minimo=1, allow_none=True),
        "preencher_todos_slots": _bool(juntada.get("preencher_todos_slots")),
    }

    saida = data.get("saida") or {}
    if not isinstance(saida, dict):
        raise ValueError("saida deve ser um objeto.")
    base["saida"] = {
        "destino_pdf": _choice(
            saida.get("destino_pdf"), DESTINOS_PDF, "saida.destino_pdf", "digital"
        ),
        "jdf_hotfolder": _text(saida.get("jdf_hotfolder")),
    }
    return base


# ---------------------------------------------------------------------------
# Geometria
# ---------------------------------------------------------------------------


def footprint_mm(page_w: float, page_h: float, rotacao: int) -> tuple[float, float]:
    """Largura × altura ocupada na folha depois da rotação."""
    if int(rotacao) % 180 == 90:
        return float(page_h), float(page_w)
    return float(page_w), float(page_h)


def pagina_mm(perfil: dict[str, Any]) -> Optional[tuple[float, float]]:
    pag = perfil.get("pagina") or {}
    if pag.get("fonte") != "fixa":
        return None
    w, h = pag.get("largura_mm"), pag.get("altura_mm")
    if not w or not h or w <= 0 or h <= 0:
        return None
    return float(w), float(h)


def folha_mm(perfil: dict[str, Any]) -> Optional[tuple[float, float]]:
    folha = perfil.get("folha") or {}
    w, h = folha.get("largura_mm"), folha.get("altura_mm")
    if not w or not h or w <= 0 or h <= 0:
        return None
    return float(w), float(h)


def _grade_cell_origin_ll(
    perfil: dict[str, Any],
    *,
    page_w: float,
    page_h: float,
    col: int,
    row: int,
) -> tuple[float, float]:
    """Canto inferior esquerdo da célula (mesma conta do gerador de JDF)."""
    from services.papelaria_jdf_service import compute_cell_origin_mm

    fw, fh = folha_mm(perfil) or (0.0, 0.0)
    grade = perfil["grade"]
    return compute_cell_origin_mm(
        folha_w_mm=fw,
        folha_h_mm=fh,
        page_w_mm=page_w,
        page_h_mm=page_h,
        cols=int(grade["colunas"]),
        rows=int(grade["linhas"]),
        gap_h_mm=float(grade["espaco_h_mm"]),
        gap_v_mm=float(grade["espaco_v_mm"]),
        centralizar=grade["alinhamento"] == "centro",
        col=col,
        row=row,
    )


def gerar_slots_pela_grade(
    perfil: dict[str, Any],
    *,
    pagina: int = 1,
) -> list[dict[str, Any]]:
    """Grade cheia (linha a linha) com a mesma página em todas as células."""
    grade = perfil["grade"]
    out: list[dict[str, Any]] = []
    n = 1
    for row in range(int(grade["linhas"])):
        for col in range(int(grade["colunas"])):
            out.append({"id": n, "col": col, "row": row, "pagina": int(pagina), "rotacao": 0})
            n += 1
    return out


def slots_topo_esquerda(
    perfil: dict[str, Any],
    *,
    face: str = "frente",
    page_size: Optional[tuple[float, float]] = None,
) -> list[dict[str, Any]]:
    """
    Slots com posição resolvida no sistema da tela (topo-esquerdo, mm).

    Cada item: id, pagina, rotacao, x_mm, y_mm, largura_mm, altura_mm
    (área ocupada já girada). ``page_size`` substitui o tamanho da página
    quando ``pagina.fonte = pdf``.
    """
    page = page_size or pagina_mm(perfil)
    folha = folha_mm(perfil)
    if page is None or folha is None:
        return []
    page_w, page_h = page
    _, folha_h = folha
    out: list[dict[str, Any]] = []
    for slot in (perfil.get("slots") or {}).get(face) or []:
        rot = int(slot.get("rotacao") or 0)
        fw, fh = footprint_mm(page_w, page_h, rot)
        if perfil["posicionamento"] == "grade":
            if "col" not in slot or "row" not in slot:
                continue
            x_ll, y_ll = _grade_cell_origin_ll(
                perfil, page_w=page_w, page_h=page_h, col=int(slot["col"]), row=int(slot["row"])
            )
            x_tl = x_ll
            y_tl = folha_h - y_ll - fh
        else:
            if slot.get("x_mm") is None or slot.get("y_mm") is None:
                continue
            x_tl = float(slot["x_mm"])
            y_tl = float(slot["y_mm"])
        out.append(
            {
                "id": int(slot["id"]),
                "pagina": int(slot.get("pagina") or 1),
                "rotacao": rot,
                "x_mm": x_tl,
                "y_mm": y_tl,
                "largura_mm": fw,
                "altura_mm": fh,
            }
        )
    return out


def topo_para_pdf_ll(y_tl: float, altura_ocupada: float, folha_h: float) -> float:
    """Converte y (topo-esquerdo) para y do canto inferior esquerdo do PDF."""
    return float(folha_h) - float(y_tl) - float(altura_ocupada)


def pdf_ll_para_topo(y_ll: float, altura_ocupada: float, folha_h: float) -> float:
    return float(folha_h) - float(y_ll) - float(altura_ocupada)


# ---------------------------------------------------------------------------
# Validação semântica (erros bloqueiam salvar/ativar; avisos não)
# ---------------------------------------------------------------------------


def _rects_sobrepoem(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return (
        a["x_mm"] < b["x_mm"] + b["largura_mm"] - _EPS_MM
        and b["x_mm"] < a["x_mm"] + a["largura_mm"] - _EPS_MM
        and a["y_mm"] < b["y_mm"] + b["altura_mm"] - _EPS_MM
        and b["y_mm"] < a["y_mm"] + a["altura_mm"] - _EPS_MM
    )


_PDF_INFO_CACHE: dict[tuple[str, float, int], dict[str, Any]] = {}


def read_pdf_info(path: str) -> dict[str, Any]:
    """
    Existe? páginas e tamanho (mm) da 1ª página. Nunca levanta exceção.
    Cache por (caminho, mtime, tamanho): a validação roda a cada edição.
    """
    import os

    raw_key = (path or "").strip()
    try:
        st = os.stat(raw_key) if raw_key.lower().endswith(".pdf") else None
    except OSError:
        st = None
    if st is not None:
        key = (raw_key.lower(), float(st.st_mtime), int(st.st_size))
        cached = _PDF_INFO_CACHE.get(key)
        if cached is not None:
            return dict(cached)
        info = _read_pdf_info_uncached(raw_key)
        if info.get("existe"):
            if len(_PDF_INFO_CACHE) > 256:
                _PDF_INFO_CACHE.clear()
            _PDF_INFO_CACHE[key] = dict(info)
        return info
    return _read_pdf_info_uncached(raw_key)


def _read_pdf_info_uncached(path: str) -> dict[str, Any]:
    import os

    info: dict[str, Any] = {
        "path": path,
        "existe": False,
        "paginas": 0,
        "largura_mm": None,
        "altura_mm": None,
        "erro": None,
    }
    raw = (path or "").strip()
    if not raw:
        info["erro"] = "Caminho vazio."
        return info
    if not raw.lower().endswith(".pdf"):
        info["erro"] = "O caminho deve apontar para um arquivo .pdf."
        return info
    try:
        if not os.path.isfile(raw):
            info["erro"] = "Arquivo não encontrado no servidor."
            return info
        import fitz  # pymupdf

        from services.papelaria_jdf_service import MM_TO_PT

        with fitz.open(raw) as doc:
            info["existe"] = True
            info["paginas"] = int(doc.page_count)
            if doc.page_count >= 1:
                rect = doc[0].rect
                info["largura_mm"] = round(rect.width / MM_TO_PT, 2)
                info["altura_mm"] = round(rect.height / MM_TO_PT, 2)
    except Exception as exc:  # pragma: no cover - depende de I/O
        info["erro"] = f"Não foi possível ler o PDF: {exc}"
    return info


def validar_perfil(
    perfil_raw: Any,
    *,
    verificar_arquivos: bool = True,
    pdf_info_reader=read_pdf_info,
) -> dict[str, Any]:
    """
    Valida o perfil. Retorna {"perfil", "erros", "avisos", "completo"}.

    ``erros``/``avisos`` = listas de {"campo", "mensagem"}. ``completo`` é
    True quando não há erros (pode ser ativado/gerado).
    """
    erros: list[dict[str, str]] = []
    avisos: list[dict[str, str]] = []

    def err(campo: str, msg: str) -> None:
        erros.append({"campo": campo, "mensagem": msg})

    def warn(campo: str, msg: str) -> None:
        avisos.append({"campo": campo, "mensagem": msg})

    try:
        perfil = normalize_perfil(perfil_raw)
    except ValueError as exc:
        return {
            "perfil": None,
            "erros": [{"campo": "", "mensagem": str(exc)}],
            "avisos": [],
            "completo": False,
        }

    folha = folha_mm(perfil)
    if folha is None:
        err("folha", "Informe largura e altura da folha (mm, maiores que zero).")
    pag = perfil["pagina"]
    if pag["fonte"] == "fixa" and pagina_mm(perfil) is None:
        err("pagina", "Informe largura e altura da página (mm, maiores que zero).")

    if pag["fonte"] == "pdf":
        if perfil["posicionamento"] != "grade":
            err(
                "posicionamento",
                "Com tamanho da página lido do PDF, use posicionamento pela grade.",
            )
        if perfil["arte"]["fonte"] == "pre_impresso":
            err("pagina", "Arte pré-impressa exige tamanho de página fixo.")

    frente = perfil["slots"]["frente"]
    if not frente:
        err("slots.frente", "Cadastre ao menos um slot na frente.")
    if perfil["faces"] == "frente_verso" and not perfil["slots"]["verso"]:
        err("slots.verso", "Frente e verso: cadastre ao menos um slot no verso.")

    grade = perfil["grade"]
    for face in ("frente", "verso"):
        seen_cells: set[tuple[int, int]] = set()
        for slot in perfil["slots"][face]:
            campo = f"slots.{face}.{slot['id']}"
            if perfil["posicionamento"] == "grade":
                if "col" not in slot or "row" not in slot:
                    err(campo, f"Slot {slot['id']}: informe coluna e linha da grade.")
                    continue
                if slot["col"] >= grade["colunas"] or slot["row"] >= grade["linhas"]:
                    err(campo, f"Slot {slot['id']}: célula fora da grade {grade['colunas']}×{grade['linhas']}.")
                cell = (slot["col"], slot["row"])
                if cell in seen_cells:
                    err(campo, f"Slot {slot['id']}: célula ({slot['col'] + 1}, {slot['row'] + 1}) repetida.")
                seen_cells.add(cell)
            elif slot.get("x_mm") is None or slot.get("y_mm") is None:
                err(campo, f"Slot {slot['id']}: informe X e Y.")

    # Geometria: dentro da folha e sem sobreposição.
    if folha is not None and pagina_mm(perfil) is not None:
        fw, fh = folha
        sangria = float(perfil["sangria_mm"])
        for face in ("frente", "verso"):
            resolved = slots_topo_esquerda(perfil, face=face)
            for slot in resolved:
                campo = f"slots.{face}.{slot['id']}"
                x0 = slot["x_mm"] - sangria
                y0 = slot["y_mm"] - sangria
                x1 = slot["x_mm"] + slot["largura_mm"] + sangria
                y1 = slot["y_mm"] + slot["altura_mm"] + sangria
                if x0 < -_EPS_MM or y0 < -_EPS_MM or x1 > fw + _EPS_MM or y1 > fh + _EPS_MM:
                    err(campo, f"Slot {slot['id']} ({face}) sai da folha {fw:g}×{fh:g} mm.")
            for i, a in enumerate(resolved):
                for b in resolved[i + 1:]:
                    if _rects_sobrepoem(a, b):
                        warn(
                            f"slots.{face}.{b['id']}",
                            f"Slots {a['id']} e {b['id']} ({face}) se sobrepõem.",
                        )
    elif pag["fonte"] == "pdf":
        warn("pagina", "Posições só podem ser conferidas com o tamanho real do PDF, na geração.")

    # Rotação aplicada no PDF: todas as áreas precisam ter a mesma orientação.
    if perfil["arte"]["rotacao"] == "no_pdf":
        orient = {int(s["rotacao"]) % 180 for s in frente}
        if len(orient) > 1:
            err(
                "arte.rotacao",
                "Com rotação aplicada no PDF, todos os slots precisam ter a mesma "
                "orientação (todos 0/180° ou todos 90/270°).",
            )
        if perfil["faces"] == "frente_verso":
            err("arte.rotacao", "Rotação no PDF só está disponível para impressão só frente.")

    # Marcas
    marcas = perfil["marcas"]
    if marcas["ativo"]:
        path = marcas["pdf_path"] or ""
        if not path:
            err("marcas.pdf_path", "Informe o caminho do PDF de marcas.")
        elif not path.lower().endswith(".pdf"):
            err("marcas.pdf_path", "O PDF de marcas deve ser um arquivo .pdf.")
        elif verificar_arquivos:
            info = pdf_info_reader(path)
            if not info.get("existe"):
                motivo = info.get("erro") or "Arquivo não encontrado."
                if marcas["carimbar_op"]:
                    err(
                        "marcas.pdf_path",
                        f"{motivo} Para carimbar a OP o servidor precisa ler o arquivo.",
                    )
                else:
                    warn("marcas.pdf_path", f"{motivo} O Apogee ainda poderá lê-lo.")
            elif folha is not None and info.get("largura_mm") and info.get("altura_mm"):
                mw, mh = float(info["largura_mm"]), float(info["altura_mm"])
                if (
                    abs(mw - folha[0]) > TOLERANCIA_MARCAS_MM
                    or abs(mh - folha[1]) > TOLERANCIA_MARCAS_MM
                ):
                    err(
                        "marcas.pdf_path",
                        f"PDF de marcas tem {mw:g}×{mh:g} mm; a folha é "
                        f"{folha[0]:g}×{folha[1]:g} mm.",
                    )
    elif marcas.get("carimbar_op"):
        err("marcas.carimbar_op", "Carimbar a OP exige PDF de marcas.")

    # Juntada
    junt = perfil["juntada"]
    capacidade = len(frente)
    if junt["ativo"]:
        if perfil["arte"]["fonte"] != "pre_impresso":
            err(
                "juntada.ativo",
                "Juntada exige arte pré-impressa (o PDF combinado é montado pelo worker).",
            )
        if capacidade < 2:
            err("juntada.ativo", "Juntada exige ao menos 2 slots na frente.")
        if junt["max_os"] is not None and junt["max_os"] > capacidade:
            err("juntada.max_os", f"Máximo de OSs ({junt['max_os']}) maior que os slots ({capacidade}).")
        if perfil["faces"] == "frente_verso":
            err("juntada.ativo", "Juntada está disponível apenas para impressão só frente.")
    if perfil["arte"]["fonte"] == "pre_impresso" and perfil["faces"] == "frente_verso":
        err("arte.fonte", "Arte pré-impressa está disponível apenas para impressão só frente.")

    # Páginas referenciadas (pipeline pré-impresso usa 1 página por slot).
    if perfil["arte"]["fonte"] == "pre_impresso":
        if any(int(s["pagina"]) != 1 for s in frente):
            warn(
                "slots.frente",
                "Com arte pré-impressa, cada slot recebe a arte da OS da vez; "
                "o número da página do PDF é ignorado.",
            )

    return {"perfil": perfil, "erros": erros, "avisos": avisos, "completo": not erros}


def resumo_perfil(perfil: Optional[dict[str, Any]]) -> Optional[str]:
    """Linha curta: '745×605 mm · 4 slots · marcas ✓ · juntada'."""
    if not perfil:
        return None
    parts: list[str] = []
    folha = folha_mm(perfil)
    if folha:
        parts.append(f"{folha[0]:g}×{folha[1]:g} mm")
    n = len((perfil.get("slots") or {}).get("frente") or [])
    if perfil.get("faces") == "frente_verso":
        nv = len((perfil.get("slots") or {}).get("verso") or [])
        parts.append(f"{n}+{nv} slots (frente e verso)")
    else:
        parts.append(f"{n} slot" + ("" if n == 1 else "s"))
    if (perfil.get("marcas") or {}).get("ativo"):
        parts.append("marcas ✓")
    if (perfil.get("arte") or {}).get("fonte") == "pre_impresso":
        parts.append("pré-impresso")
    if (perfil.get("juntada") or {}).get("ativo"):
        parts.append("juntada")
    return " · ".join(parts)


# ---------------------------------------------------------------------------
# Juntada (estratégias genéricas)
# ---------------------------------------------------------------------------


def _positive_int(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ValueError("Tiragem inválida.") from None
    if n < 1:
        raise ValueError("Tiragem deve ser >= 1.")
    return n


def preencher_slots_ate_capacidade(
    slots: list[int],
    tiragens: list[int],
    capacidade: int,
) -> list[int]:
    """Completa os slots até a capacidade (múltiplo exato ou maior tiragem primeiro)."""
    out = [max(0, int(s)) for s in slots]
    total = sum(out)
    cap = max(1, int(capacidade))
    if total < 1 or total >= cap:
        return out
    if cap % total == 0:
        k = cap // total
        return [s * k for s in out]
    remaining = cap - total
    while remaining > 0:
        order = sorted(
            range(len(out)),
            key=lambda i: (-int(tiragens[i]), out[i], i),
        )
        out[order[0]] += 1
        remaining -= 1
    return out


def capacidade_juntada(perfil: dict[str, Any]) -> int:
    cap = len((perfil.get("slots") or {}).get("frente") or [])
    junt = perfil.get("juntada") or {}
    max_os = junt.get("max_os")
    if max_os:
        return max(1, min(cap, int(max_os)))
    return max(1, cap)


def alocar_slots(perfil: dict[str, Any], tiragens: list[Any]) -> dict[str, Any]:
    """Distribui os slots da frente entre as OSs do lote (âncora primeiro)."""
    if not tiragens:
        raise ValueError("Informe ao menos uma tiragem.")
    nums = [_positive_int(t) for t in tiragens]
    capacidade = len((perfil.get("slots") or {}).get("frente") or [])
    if capacidade < 1:
        raise ValueError("Perfil sem slots na frente.")
    junt = perfil.get("juntada") or {}
    max_os = capacidade_juntada(perfil) if junt.get("ativo") else 1
    if len(nums) > max_os:
        raise ValueError(f"Máximo de {max_os} OS(s) na juntada deste produto.")
    regra = junt.get("regra_tiragem") or "iguais"
    preencher = bool(junt.get("preencher_todos_slots"))

    if regra == "iguais":
        if len(set(nums)) != 1:
            raise ValueError("As tiragens das OSs juntadas devem ser iguais.")
        base = [1] * len(nums)
        folhas = nums[0]
        unit = nums[0]
    elif regra == "proporcional_mdc":
        unit = nums[0]
        for n in nums[1:]:
            unit = math.gcd(unit, n)
        base = [n // unit for n in nums]
        folhas = unit
    else:  # livre
        base = [1] * len(nums)
        folhas = max(nums)
        unit = folhas

    if sum(base) > capacidade:
        raise ValueError(
            f"Slots necessários ({'+'.join(str(b) for b in base)} = {sum(base)}) "
            f"excedem os {capacidade} slots da folha."
        )
    slots = preencher_slots_ate_capacidade(base, nums, capacidade) if preencher else base
    return {
        "slots": slots,
        "unit": unit,
        "folhas": folhas,
        "total_slots": sum(slots),
        "max_slots": capacidade,
        "max_os": max_os,
        "regra": regra,
    }


# ---------------------------------------------------------------------------
# Compilação para o formato aceito pelo gerador de JDF
# ---------------------------------------------------------------------------


def _ocupadas_grade(slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for slot in slots:
        if "col" not in slot or "row" not in slot:
            continue
        entry: dict[str, Any] = {
            "col": int(slot["col"]),
            "row": int(slot["row"]),
            "pagina": int(slot.get("pagina") or 1),
        }
        if int(slot.get("rotacao") or 0):
            entry["rotacao"] = int(slot["rotacao"])
        out.append(entry)
    return out


def celulas_manual(perfil: dict[str, Any], slots: list[dict[str, Any]]) -> tuple[int, int, list[tuple[int, int]]]:
    """Células (col,row) para slots manuais: usa as gravadas ou numera na grade."""
    grade = perfil["grade"]
    cols, rows = int(grade["colunas"]), int(grade["linhas"])
    cells = [(s.get("col"), s.get("row")) for s in slots]
    gravadas_ok = all(c is not None and r is not None and c < cols and r < rows for c, r in cells)
    if gravadas_ok and len(set(cells)) == len(cells):
        return cols, rows, [(int(c), int(r)) for c, r in cells]
    if len(slots) <= cols * rows:
        seq = [(c, r) for r in range(rows) for c in range(cols)]
        return cols, rows, seq[: len(slots)]
    return 1, len(slots), [(0, i) for i in range(len(slots))]


def compilar_config_jdf(
    perfil: dict[str, Any],
    *,
    slots_frente: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """
    Converte o perfil v2 no dicionário de configuração aceito pelo gerador
    de JDF (``validate_imposicao_config_payload``/``build_apogee_jdf_xml``).

    Posicionamento pela grade → células da grade (mesma conta de sempre).
    Posicionamento manual → células com ``x_mm``/``y_mm`` absolutos no
    sistema do PDF (canto inferior esquerdo da área ocupada).
    """
    folha = folha_mm(perfil)
    if folha is None:
        raise ValueError("Perfil sem tamanho de folha.")
    folha_w, folha_h = folha
    grade = perfil["grade"]
    pag = perfil["pagina"]
    frente = slots_frente if slots_frente is not None else perfil["slots"]["frente"]
    verso = perfil["slots"]["verso"] if perfil["faces"] == "frente_verso" else []

    if pag["fonte"] == "fixa":
        pagina_cfg: dict[str, Any] = {
            "origem": "fixixa",
            "largura_mm": float(pag["largura_mm"]),
            "altura_mm": float(pag["altura_mm"]),
        }
    else:
        pagina_cfg = {"origem": "borda"}

    if perfil["posicionamento"] == "grade":
        cols, rows = int(grade["colunas"]), int(grade["linhas"])
        grid: dict[str, Any] = {"colunas": cols, "linhas": rows}
        grid["ocupadas"] = _ocupadas_grade(frente)
        if verso:
            grid["ocupadas_verso"] = _ocupadas_grade(verso)
    else:
        page = pagina_mm(perfil)
        if page is None:
            raise ValueError("Posicionamento manual exige tamanho de página fixo.")
        pw, ph = page

        def manual_ocupadas(slots: list[dict[str, Any]], cells: list[tuple[int, int]]) -> list[dict[str, Any]]:
            out = []
            for slot, (c, r) in zip(slots, cells):
                rot = int(slot.get("rotacao") or 0)
                _fw, fh = footprint_mm(pw, ph, rot)
                entry: dict[str, Any] = {
                    "col": c,
                    "row": r,
                    "pagina": int(slot.get("pagina") or 1),
                    "x_mm": round(float(slot["x_mm"]), 4),
                    "y_mm": round(topo_para_pdf_ll(float(slot["y_mm"]), fh, folha_h), 4),
                }
                if rot:
                    entry["rotacao"] = rot
                out.append(entry)
            return out

        cols, rows, cells_f = celulas_manual(perfil, frente)
        grid = {"colunas": cols, "linhas": rows, "ocupadas": manual_ocupadas(frente, cells_f)}
        if verso:
            vcols, vrows, cells_v = celulas_manual(perfil, verso)
            if (vcols, vrows) != (cols, rows):
                # Verso precisa caber na mesma grade nominal da frente.
                cells_v = [(0, i) for i in range(len(verso))]
                rows = max(rows, len(verso))
                grid["linhas"] = rows
            grid["ocupadas_verso"] = manual_ocupadas(verso, cells_v)

    marcas = perfil["marcas"]
    return {
        "folha_mm": {"largura": folha_w, "altura": folha_h},
        "pagina": pagina_cfg,
        "grid": grid,
        "espacamento_mm": {
            "horizontal": float(grade["espaco_h_mm"]),
            "vertical": float(grade["espaco_v_mm"]),
        },
        "sangria_mm": float(perfil["sangria_mm"]),
        "marcas_corte": bool(marcas["ativo"]),
        "marcas_pdf_path": marcas["pdf_path"] if marcas["ativo"] else None,
        "centralizar_na_folha": grade["alinhamento"] == "centro",
        "work_style": "Duplex" if perfil["faces"] == "frente_verso" else "Simplex",
        "usar_pre_impresso": perfil["arte"]["fonte"] == "pre_impresso",
        "jdf_import_root": perfil["saida"]["jdf_hotfolder"],
        "imposicao_pdf_path": None,
    }


def slots_para_lote(perfil: dict[str, Any], n_slots: int) -> list[dict[str, Any]]:
    """
    Primeiros ``n_slots`` slots da frente (ordem do id), cada um apontando
    para a página i+1 do PDF combinado (uma arte por slot).
    """
    frente = sorted(perfil["slots"]["frente"], key=lambda s: s["id"])
    n = max(1, min(int(n_slots), len(frente)))
    out = []
    for i, slot in enumerate(frente[:n]):
        item = copy.deepcopy(slot)
        item["pagina"] = i + 1
        out.append(item)
    return out


def pipeline_para(perfil: dict[str, Any]) -> str:
    """'worker' quando a arte é pré-impressa (export do CDR + PDF combinado)."""
    return "worker" if perfil["arte"]["fonte"] == "pre_impresso" else "sincrono"


# ---------------------------------------------------------------------------
# Conversão a partir da configuração antiga (só campos genéricos salvos)
# ---------------------------------------------------------------------------


def perfil_from_v1(cfg: Any) -> dict[str, Any]:
    """
    Converte uma configuração v1 (formato antigo) em rascunho v2.

    Usa somente o que está no próprio JSON. Não recebe nome de produto:
    o que o fluxo antigo forçava por produto não é inventado aqui.
    """
    from services import papelaria_imposicao_config_service as cfg_svc

    data = cfg_svc.validate_imposicao_config_payload(cfg, require_marcas_pdf=False)
    perfil = perfil_vazio()
    perfil["folha"] = {
        "largura_mm": float(data["folha_mm"]["largura"]),
        "altura_mm": float(data["folha_mm"]["altura"]),
    }
    pag = data["pagina"]
    if pag.get("origem") == "fixixa":
        perfil["pagina"] = {
            "fonte": "fixa",
            "largura_mm": float(pag["largura_mm"]),
            "altura_mm": float(pag["altura_mm"]),
        }
    else:
        perfil["pagina"] = {"fonte": "pdf", "largura_mm": None, "altura_mm": None}
    perfil["sangria_mm"] = float(data.get("sangria_mm") or 0)
    duplex = data.get("work_style") == "Duplex"
    perfil["faces"] = "frente_verso" if duplex else "frente"
    grid = data["grid"]
    perfil["grade"] = {
        "colunas": int(grid["colunas"]),
        "linhas": int(grid["linhas"]),
        "espaco_h_mm": float(data["espacamento_mm"]["horizontal"]),
        "espaco_v_mm": float(data["espacamento_mm"]["vertical"]),
        "alinhamento": "centro" if data.get("centralizar_na_folha", True) else "topo_esquerda",
    }

    def face_slots(face: str) -> list[dict[str, Any]]:
        return cfg_svc.resolve_grid_ocupadas(grid, face=face)

    frente_v1 = face_slots("frente")
    verso_v1 = face_slots("verso") if duplex else []
    manual = any(o.get("x_mm") is not None for o in frente_v1 + verso_v1)
    if manual and perfil["pagina"]["fonte"] == "fixa":
        perfil["posicionamento"] = "manual"
        pw, ph = perfil["pagina"]["largura_mm"], perfil["pagina"]["altura_mm"]
        folha_h = perfil["folha"]["altura_mm"]

        def conv(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            out = []
            ordered = sorted(items, key=lambda o: (o["pagina"], o["row"], o["col"]))
            for i, o in enumerate(ordered, start=1):
                rot = int(o.get("rotacao") or 0)
                _fw, fh = footprint_mm(pw, ph, rot)
                if o.get("x_mm") is not None:
                    x_tl = float(o["x_mm"])
                    y_tl = pdf_ll_para_topo(float(o["y_mm"]), fh, folha_h)
                else:
                    x_ll, y_ll = _grade_cell_origin_ll(
                        perfil, page_w=pw, page_h=ph, col=int(o["col"]), row=int(o["row"])
                    )
                    x_tl, y_tl = x_ll, pdf_ll_para_topo(y_ll, fh, folha_h)
                out.append(
                    {
                        "id": i,
                        "col": int(o["col"]),
                        "row": int(o["row"]),
                        "x_mm": round(x_tl, 4),
                        "y_mm": round(y_tl, 4),
                        "rotacao": rot,
                        "pagina": int(o["pagina"]),
                    }
                )
            return out

        perfil["slots"] = {"frente": conv(frente_v1), "verso": conv(verso_v1)}
    else:
        perfil["posicionamento"] = "grade"

        def conv_grade(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            ordered = sorted(items, key=lambda o: (o["row"], o["col"]))
            return [
                {
                    "id": i,
                    "col": int(o["col"]),
                    "row": int(o["row"]),
                    "rotacao": int(o.get("rotacao") or 0),
                    "pagina": int(o["pagina"]),
                }
                for i, o in enumerate(ordered, start=1)
            ]

        perfil["slots"] = {"frente": conv_grade(frente_v1), "verso": conv_grade(verso_v1)}

    if data.get("marcas_corte") and data.get("marcas_pdf_path"):
        perfil["marcas"] = {
            "ativo": True,
            "pdf_path": data["marcas_pdf_path"],
            "carimbar_op": False,
        }
    if data.get("usar_pre_impresso"):
        perfil["arte"] = {"fonte": "pre_impresso", "rotacao": "no_jdf"}
        perfil["saida"]["destino_pdf"] = "offset"
    perfil["saida"]["jdf_hotfolder"] = data.get("jdf_import_root") or None
    return normalize_perfil(perfil)


# ---------------------------------------------------------------------------
# Comparação de posições (fluxo antigo × perfil)
# ---------------------------------------------------------------------------


def posicoes_efetivas(
    config: dict[str, Any],
    *,
    page_size: Optional[tuple[float, float]] = None,
) -> dict[str, Any]:
    """
    Posições que o gerador de JDF usaria para uma configuração (v1/compilada).
    Retorna folha, página e lista (x_ll, y_ll, pagina, rotacao) por face.
    """
    from services import papelaria_imposicao_config_service as cfg_svc
    from services.papelaria_jdf_service import compute_content_positions

    cfg = cfg_svc.validate_imposicao_config_payload(config, require_marcas_pdf=False)
    folha = cfg["folha_mm"]
    pag = cfg["pagina"]
    if pag.get("origem") == "fixixa":
        pw, ph = float(pag["largura_mm"]), float(pag["altura_mm"])
    elif page_size:
        pw, ph = page_size
    else:
        raise ValueError("Informe o tamanho da página para comparar (página lida do PDF).")
    grid = cfg["grid"]
    common = {
        "folha_w_mm": float(folha["largura"]),
        "folha_h_mm": float(folha["altura"]),
        "page_w_mm": pw,
        "page_h_mm": ph,
        "cols": int(grid["colunas"]),
        "rows": int(grid["linhas"]),
        "gap_h_mm": float(cfg["espacamento_mm"]["horizontal"]),
        "gap_v_mm": float(cfg["espacamento_mm"]["vertical"]),
        "centralizar": bool(cfg["centralizar_na_folha"]),
    }
    frente = compute_content_positions(
        **common, ocupadas=cfg_svc.resolve_grid_ocupadas(grid, face="frente")
    )
    verso = []
    if cfg["work_style"] == "Duplex":
        verso = compute_content_positions(
            **common, ocupadas=cfg_svc.resolve_grid_ocupadas(grid, face="verso")
        )
    return {
        "folha": (float(folha["largura"]), float(folha["altura"])),
        "pagina": (pw, ph),
        "work_style": cfg["work_style"],
        "frente": frente,
        "verso": verso,
        "marcas_corte": bool(cfg["marcas_corte"]),
        "marcas_pdf_path": cfg.get("marcas_pdf_path"),
        "jdf_import_root": cfg.get("jdf_import_root"),
        "usar_pre_impresso": bool(cfg.get("usar_pre_impresso")),
    }


def comparar_configs(
    antigo: dict[str, Any],
    novo: dict[str, Any],
    *,
    page_size: Optional[tuple[float, float]] = None,
    tolerancia_pt: float = 0.01,
) -> dict[str, Any]:
    """Diferenças entre duas configurações compiladas (tolerância em pt)."""
    from services.papelaria_jdf_service import MM_TO_PT

    a = posicoes_efetivas(antigo, page_size=page_size)
    b = posicoes_efetivas(novo, page_size=page_size)
    tol_mm = tolerancia_pt / MM_TO_PT
    diffs: list[dict[str, Any]] = []

    def close(x: float, y: float) -> bool:
        return abs(float(x) - float(y)) <= tol_mm

    for campo, rot in (("folha", "Folha"), ("pagina", "Página")):
        if not (close(a[campo][0], b[campo][0]) and close(a[campo][1], b[campo][1])):
            diffs.append(
                {
                    "campo": campo,
                    "descricao": f"{rot}: {a[campo][0]:g}×{a[campo][1]:g} → {b[campo][0]:g}×{b[campo][1]:g} mm",
                }
            )
    if a["work_style"] != b["work_style"]:
        diffs.append({"campo": "faces", "descricao": f"Faces: {a['work_style']} → {b['work_style']}"})
    for campo, rot in (
        ("marcas_corte", "Marcas"),
        ("marcas_pdf_path", "PDF de marcas"),
        ("usar_pre_impresso", "Arte pré-impressa"),
    ):
        va, vb = a[campo] or None, b[campo] or None
        if (str(va).lower() if isinstance(va, str) else va) != (
            str(vb).lower() if isinstance(vb, str) else vb
        ):
            diffs.append({"campo": campo, "descricao": f"{rot}: {va} → {vb}"})

    folha_h_a = a["folha"][1]
    pw_a, ph_a = a["pagina"]

    def para_tela(pos: tuple, folha_h: float, pw: float, ph: float) -> dict[str, Any]:
        x, y, pagina, rot = pos[0], pos[1], pos[2], (pos[3] if len(pos) > 3 else 0)
        _fw, fh = footprint_mm(pw, ph, rot)
        return {
            "x_mm": round(float(x), 3),
            "y_mm": round(pdf_ll_para_topo(float(y), fh, folha_h), 3),
            "pagina": int(pagina),
            "rotacao": int(rot),
        }

    linhas: list[dict[str, Any]] = []
    for face in ("frente", "verso"):
        la, lb = a[face], b[face]
        n = max(len(la), len(lb))
        for i in range(n):
            pa = para_tela(la[i], folha_h_a, pw_a, ph_a) if i < len(la) else None
            pb = para_tela(lb[i], b["folha"][1], *b["pagina"]) if i < len(lb) else None
            igual = bool(
                pa
                and pb
                and close(pa["x_mm"], pb["x_mm"])
                and close(pa["y_mm"], pb["y_mm"])
                and pa["rotacao"] == pb["rotacao"]
                and pa["pagina"] == pb["pagina"]
            )
            linhas.append({"face": face, "ordem": i + 1, "antigo": pa, "novo": pb, "igual": igual})
            if not igual:
                diffs.append(
                    {
                        "campo": f"slots.{face}.{i + 1}",
                        "descricao": f"{face.capitalize()} · posição {i + 1}: {pa} → {pb}",
                    }
                )
    return {"iguais": not diffs, "diferencas": diffs, "linhas": linhas}
