from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Iterable
from typing import Any

from services.sequencia_producao_models import (
    SequenciaBlock,
    SequenciaDraft,
    SequenciaOsResumo,
    SequenciaSection,
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(str(value).replace(",", ".")))
    except (TypeError, ValueError):
        return None


def _norm(value: Any) -> str:
    text = _text(value).lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", text)


def compute_source_hash(os_row: dict[str, Any], componentes: list[dict[str, Any]]) -> str:
    payload = {
        "os": {
            key: os_row.get(key)
            for key in sorted(os_row)
            if key
            in {
                "NroProtocolo",
                "AnoProtocolo",
                "Titulo",
                "TipoPublicacaoLink",
                "FormatoLink",
                "MaquinaLink",
                "Tiragem",
                "TiragemFinal",
                "Pags",
                "FrenteVerso",
                "ModelosArq",
                "PapelLink",
                "PapelDescricao",
                "Cores",
                "CoresDescricao",
                "DescAcabamento",
                "Observ",
            }
        },
        "componentes": componentes,
    }
    encoded = json.dumps(payload, default=str, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _split_descricao_por_componente(value: str) -> dict[str, str]:
    result: dict[str, str] = {}
    if not value:
        return result
    matches = list(re.finditer(r"(?im)(capa|miolo|encarte|lamina|lâmina|folha)\s*:", value))
    for idx, match in enumerate(matches):
        label = match.group(1).capitalize()
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(value)
        result[label] = value[start:end].strip(" ;\n\r\t")
    return result


def _fallback_componentes(os_row: dict[str, Any]) -> list[dict[str, Any]]:
    papel_desc = _text(os_row.get("PapelDescricao"))
    cores_desc = _text(os_row.get("CoresDescricao"))
    papeis = _split_descricao_por_componente(papel_desc)
    cores = _split_descricao_por_componente(cores_desc)
    labels = list(dict.fromkeys([*papeis.keys(), *cores.keys()]))
    if not labels:
        labels = ["Trabalho"]
    componentes: list[dict[str, Any]] = []
    for ordem, label in enumerate(labels, start=1):
        paginas = None
        m = re.search(r"(\d+)\s*p[áa]?g", f"{papeis.get(label, '')} {cores.get(label, '')}", re.I)
        if m:
            paginas = _int_or_none(m.group(1))
        componentes.append(
            {
                "id": ordem,
                "nome": label,
                "tipo": label.lower(),
                "ordem": ordem,
                "lotes": [
                    {
                        "paginas": paginas,
                        "maquina_link": os_row.get("MaquinaLink"),
                        "papel_link": os_row.get("PapelLink"),
                        "papel_desc": papeis.get(label) or papel_desc,
                        "cores_link": os_row.get("Cores"),
                        "cores_desc": cores.get(label) or cores_desc,
                        "frente_verso": os_row.get("FrenteVerso"),
                    }
                ],
                "acabamentos": [],
            }
        )
    return componentes


def _usable_componentes(os_row: dict[str, Any], componentes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    usable = [comp for comp in componentes if comp.get("lotes")]
    return usable or _fallback_componentes(os_row)


def _all_acabamentos(os_row: dict[str, Any], componentes: Iterable[dict[str, Any]]) -> str:
    parts = [_text(os_row.get("DescAcabamento"))]
    for comp in componentes:
        for acab in comp.get("acabamentos") or []:
            if isinstance(acab, dict):
                parts.extend([_text(acab.get("label")), _text(acab.get("variacao_label")), _text(acab.get("obs"))])
            else:
                parts.append(_text(acab))
        for acab in comp.get("acabamentos_gerais") or []:
            if isinstance(acab, dict):
                parts.extend([_text(acab.get("label")), _text(acab.get("variacao_label")), _text(acab.get("obs"))])
            else:
                parts.append(_text(acab))
    return "; ".join(part for part in parts if part)


def _produto_kind(os_row: dict[str, Any], acabamento_text: str) -> str:
    joined = _norm(" ".join([_text(os_row.get("TipoPublicacaoLink")), _text(os_row.get("Titulo")), acabamento_text]))
    if any(token in joined for token in ("wire", "wire-o", "wire o", "wireo", "espiral")):
        return "wire"
    if any(token in joined for token in ("livro", "lombada", "cola pur", "hot melt", "brochura")):
        return "livro"
    if any(token in joined for token in ("folder", "folheto", "lamina", "lâmina", "cartaz")):
        return "lamina"
    return "canoa"


def _component_name(comp: dict[str, Any]) -> str:
    return _text(comp.get("nome") or comp.get("tipo") or "Trabalho")


def _first_lote(comp: dict[str, Any]) -> dict[str, Any]:
    lotes = comp.get("lotes") or []
    return lotes[0] if lotes and isinstance(lotes[0], dict) else {}


def _component_pages(comp: dict[str, Any]) -> int | None:
    lotes = comp.get("lotes") or []
    total = 0
    found = False
    for lote in lotes:
        if not isinstance(lote, dict):
            continue
        value = _int_or_none(lote.get("paginas"))
        if value is not None:
            total += value
            found = True
    return total if found else None


def _paper_label(lote: dict[str, Any]) -> str:
    return _text(lote.get("papel_desc") or lote.get("papel_link"))


def _colors_label(lote: dict[str, Any]) -> str:
    return _text(lote.get("cores_desc") or lote.get("cores_link"))


def _print_format(os_row: dict[str, Any], comp: dict[str, Any], lote: dict[str, Any]) -> tuple[str, list[str]]:
    warnings: list[str] = []
    formato = _norm(os_row.get("FormatoLink"))
    papel = _norm(_paper_label(lote))
    nome = _norm(_component_name(comp))
    paginas = _component_pages(comp)
    if "a5" in formato:
        if "capa" in nome and any(token in papel for token in ("couche", "couche fosco", "cf")):
            return "656 x 470mm", warnings
        if paginas == 12:
            return "656 x 318mm - SANFONA 12pgs", warnings
        return "656 x 470mm", warnings
    if "a4" in formato:
        if "capa" in nome and any(token in papel for token in ("couche", "cf")):
            return "455 x 328mm", warnings
        return "690 x 510mm", warnings
    if "a3" in formato:
        return "690 x 510mm", warnings
    warnings.append("Conferir formato de impressão antes de liberar a produção.")
    return _text(os_row.get("FormatoLink")) or "Conferir formato", warnings


def _impressao_lines(os_row: dict[str, Any], componentes: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    lines: list[str] = []
    warnings: list[str] = []
    tiragem = _int_or_none(os_row.get("Tiragem") or os_row.get("TiragemFinal"))
    if tiragem:
        lines.append(f"Tiragem: {tiragem:,}".replace(",", "."))
    for comp in componentes:
        nome = _component_name(comp)
        for lote in comp.get("lotes") or [_first_lote(comp)]:
            if not isinstance(lote, dict):
                continue
            fmt, fmt_warnings = _print_format(os_row, comp, lote)
            warnings.extend(fmt_warnings)
            detalhe = " - ".join(part for part in [_paper_label(lote), _colors_label(lote)] if part)
            prefix = f"{nome}: {fmt}"
            lines.append(f"{prefix} ({detalhe})" if detalhe else prefix)
    return lines or ["Conferir impressão conforme OS."], list(dict.fromkeys(warnings))


def _signature_pages(total_pages: int | None) -> list[int]:
    if not total_pages:
        return []
    remaining = max(0, total_pages)
    signatures: list[int] = []
    for size in (16, 12, 8, 4):
        while remaining >= size:
            signatures.append(size)
            remaining -= size
    if remaining:
        signatures.append(remaining)
    return signatures


def _dobra_lines(componentes: list[dict[str, Any]], kind: str) -> list[str]:
    if kind in {"wire", "lamina"}:
        return ["Sem dobra padrão; conferir necessidade de dobra pela arte/modelo."]
    lines: list[str] = []
    for comp in componentes:
        nome = _component_name(comp)
        pages = _component_pages(comp)
        norm_nome = _norm(nome)
        if "capa" in norm_nome and pages in (None, 4):
            lines.append("Capa - 4 pgs")
            continue
        for sig in _signature_pages(pages):
            if sig == 16:
                lines.extend(
                    [
                        f"{nome} - 16 pgs",
                        "Dobra1 vertical (esq. pra trás)",
                        "Dobra2 na cabeça (pra frente)",
                        "Dobra3 vertical (esq. pra trás)",
                    ]
                )
            elif sig == 12:
                lines.extend([f"{nome} - 12pgs sanfona", "Dobra sanfona conforme boneco/modelo"])
            elif sig == 8:
                lines.extend([f"{nome} - 8 pgs", "Dobra1 na cabeça (pra frente)", "Dobra2 vertical (esq. pra trás)"])
            elif sig == 4:
                lines.extend([f"{nome} - 4 pgs", "Dobra1 vertical (esq. pra trás)"])
            elif sig:
                lines.append(f"{nome} - {sig} pgs: conferir dobra pelo boneco/modelo")
    return lines or ["Conferir dobra conforme boneco/modelo."]


def _count_cadernos(componentes: list[dict[str, Any]]) -> int:
    count = 0
    for comp in componentes:
        nome = _norm(_component_name(comp))
        if "capa" in nome:
            continue
        count += len(_signature_pages(_component_pages(comp)))
    return max(count, 1)


def _acabamento_lines(acabamento_text: str, kind: str) -> list[str]:
    lines: list[str] = []
    if acabamento_text:
        lines.append(acabamento_text)
    if kind == "canoa":
        lines.append("Encadernação canoa com 2 grampos.")
    elif kind == "livro":
        lines.append("Preparar miolo para alceamento e capa para colagem.")
    elif kind == "wire":
        lines.append("Preparar lâminas/capas para furação e Wire-O.")
    return list(dict.fromkeys(lines)) or ["Conferir acabamento conforme OS."]


def _encadernacao_block(kind: str, acabamento_text: str) -> SequenciaBlock:
    if kind == "canoa":
        return SequenciaBlock(id="encadernacao-canoa", title="Encadernação (Canoa)", lines=["2 grampos"])
    if kind == "wire":
        lines = ["Wire-O na lateral esquerda"]
        if acabamento_text:
            lines.append(acabamento_text)
        return SequenciaBlock(id="encadernacao-wire", title="Wire-O", lines=lines, confidence="review")
    if kind == "livro":
        lines = ["Colagem da capa no miolo"]
        norm_acab = _norm(acabamento_text)
        if "orelha" in norm_acab:
            lines.append("Conferir orelhas antes da colagem.")
        if "lombada" in norm_acab:
            lines.append("Conferir lombada informada no acabamento.")
        return SequenciaBlock(id="encadernacao-capeadeira", title="Capeadeira", lines=lines, confidence="review")
    return SequenciaBlock(id="encadernacao", title="Encadernação", lines=["Não se aplica."], confidence="review")


def generate_sequencia_draft(os_row: dict[str, Any], componentes_rows: list[dict[str, Any]]) -> SequenciaDraft:
    componentes = _usable_componentes(os_row, componentes_rows)
    acabamento_text = _all_acabamentos(os_row, componentes)
    kind = _produto_kind(os_row, acabamento_text)
    source_hash = compute_source_hash(os_row, componentes_rows)
    warnings: list[str] = []

    impressao_lines, impressao_warnings = _impressao_lines(os_row, componentes)
    warnings.extend(impressao_warnings)
    if not componentes_rows:
        warnings.append("Componentes técnicos não encontrados; sequência inferida pelos campos descritivos da OS.")
    if kind in {"wire", "livro"}:
        warnings.append("Encadernação inferida pelos acabamentos; conferir manualmente antes de gerar o DOCX.")

    blocks: list[SequenciaBlock] = [
        SequenciaBlock(
            id="impressao-formato",
            title="Impressão > Formato de Impressão",
            lines=impressao_lines,
            confidence="review" if impressao_warnings else "automatic",
            warnings=impressao_warnings,
        ),
        SequenciaBlock(id="acabamento", title="Acabamento", lines=[]),
    ]
    norm_acab = _norm(acabamento_text)
    if any(token in norm_acab for token in ("laminacao", "laminação", "bopp")):
        blocks.append(SequenciaBlock(id="laminacao", title="Laminação", lines=["Laminar capa conforme acabamento informado."]))
    if any(token in norm_acab for token in ("serrilha", "picote")):
        blocks.append(SequenciaBlock(id="serrilha-picote", title="Serrilha/Picote", lines=["Executar conforme marcações da arte/modelo."], confidence="review"))

    corte_lines = ["Separar TR's e componentes conforme indicação da impressão."]
    if kind == "livro":
        corte_lines = ["Capas: separar capas para cola.", "Miolo: separar TR's."]
    elif kind == "wire":
        corte_lines = ["Capas e lâminas: manter soltas para furação."]
    elif kind == "lamina":
        corte_lines = ["Corte final conforme formato fechado."]
    blocks.extend(
        [
            SequenciaBlock(id="corte", title="Corte", lines=corte_lines),
            SequenciaBlock(id="dobra", title="Dobra (Dobradeira)", lines=_dobra_lines(componentes, kind), confidence="review"),
            SequenciaBlock(
                id="alceamento",
                title="Alceamento (AM graphics)",
                lines=[f"{_count_cadernos(componentes)} cadernos (empilhados)", "Um conjunto com todos os cadernos"]
                if kind != "wire"
                else ["Lâminas soltas na ordem da paginação."],
            ),
            _encadernacao_block(kind, acabamento_text),
            SequenciaBlock(id="refile-final", title="Refile Final (Guilhotina)", lines=["Guilhotina no CEDI"]),
        ]
    )

    unique_warnings = list(dict.fromkeys(warnings))
    return SequenciaDraft(
        os=SequenciaOsResumo(
            numero=int(os_row.get("NroProtocolo") or 0),
            ano=int(os_row.get("AnoProtocolo") or 0),
            titulo=_text(os_row.get("Titulo")) or None,
            produto=_text(os_row.get("TipoPublicacaoLink")) or None,
            formato=_text(os_row.get("FormatoLink")) or None,
            tiragem=_int_or_none(os_row.get("Tiragem") or os_row.get("TiragemFinal")),
            paginas=_int_or_none(os_row.get("Pags")),
        ),
        source_hash=source_hash,
        confidence="review" if unique_warnings else "automatic",
        warnings=unique_warnings,
        sections=[
            SequenciaSection(
                id="sequencia-producao",
                title="Sequência de produção",
                blocks=blocks,
                warnings=unique_warnings,
            )
        ],
    )
