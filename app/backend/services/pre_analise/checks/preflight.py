"""
Verificações de pré-análise — fontes, cores, imagens, marcas e sangria.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from services.pre_analise.context import PreAnaliseContext
from services.pre_analise.crop_marks import find_duplicate_crop_marks
from services.pre_analise.pdf_color_preflight import (
    ERR_RGB_IMAGE,
    ERR_RGB_VECTOR,
    analyze_color_preflight,
)
from services.pre_analise.pdf_deep import (
    MIN_IMAGE_DPI,
    analyze_bleed_excess,
    analyze_document_color_vs_pb,
    analyze_document_fonts,
    analyze_document_images,
    parse_os_cores_esperado,
    require_fitz,
)
from services.pre_analise.pdf_runner import close_docs, open_folder_pdfs
from services.pre_analise.pdf_utils import list_pdfs
from services.pre_analise.result_helpers import achado, finalize_result


def _ctx(context: Optional[PreAnaliseContext]) -> PreAnaliseContext:
    if context is None:
        return PreAnaliseContext(folder_path="", ano=0, os_id=0)
    return context


def _open_docs(folder_path: str, context: Optional[PreAnaliseContext] = None):
    return open_folder_pdfs(folder_path, context)


def _close_docs(docs, context: Optional[PreAnaliseContext] = None) -> None:
    close_docs(docs, context)


def run_fontes_ausentes(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = _open_docs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result(
            [achado("pymupdf", "Fontes ausentes", err, "error")], pdf_count=0
        )

    all_missing: List[str] = []
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                achados.append(
                    achado(
                        "pdf_erro",
                        "Fontes ausentes",
                        f"{os.path.basename(path)}: {doc}",
                        "error",
                    )
                )
                continue
            info = analyze_document_fonts(doc)
            for name in info["missing"]:
                all_missing.append(f"{os.path.basename(path)}: {name}")
        if all_missing:
            achados.append(
                achado(
                    "fontes_ausentes",
                    "Fontes textuais ausentes",
                    f"{len(all_missing)} fonte(s) não incorporada(s): "
                    f"{', '.join(all_missing[:6])}"
                    + ("…" if len(all_missing) > 6 else ""),
                    "error",
                    fontes=all_missing,
                )
            )
        else:
            achados.append(
                achado(
                    "fontes_ok",
                    "Fontes textuais ausentes",
                    "Todas as fontes detectadas estão incorporadas no PDF.",
                    "ok",
                )
            )
    finally:
        _close_docs(docs, _ctx(context))

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_fontes_restritas(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = _open_docs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result(
            [achado("pymupdf", "Fontes restritas", err, "error")], pdf_count=0
        )

    restricted: List[str] = []
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            info = analyze_document_fonts(doc)
            for name in info["restricted"]:
                restricted.append(f"{os.path.basename(path)}: {name}")
        if restricted:
            achados.append(
                achado(
                    "fontes_restritas",
                    "Fonte textual com restrições de uso",
                    f"Fonte(s) com indício de versão demo/restrita: "
                    f"{', '.join(restricted[:6])}"
                    + ("…" if len(restricted) > 6 else ""),
                    "error",
                    fontes=restricted,
                )
            )
        else:
            achados.append(
                achado(
                    "fontes_restritas_ok",
                    "Fonte textual com restrições de uso",
                    "Nenhuma fonte com restrição de uso detectada.",
                    "ok",
                )
            )
    finally:
        _close_docs(docs, _ctx(context))

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_arquivo_rgb(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = _open_docs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Arquivo em RGB", err, "error")])

    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                achados.append(
                    achado(
                        "pdf_erro",
                        "Arquivo em RGB",
                        f"{os.path.basename(path)}: não foi possível abrir.",
                        "error",
                    )
                )
                continue
            preflight = analyze_color_preflight(doc)
            rgb_pages = preflight.get("pages_rgb") or []
            if rgb_pages:
                detail_parts: List[str] = []
                for p in rgb_pages[:6]:
                    labels = preflight.get("by_page", {}).get(p, [])
                    if labels:
                        detail_parts.append(f"pág. {p} ({' | '.join(labels)})")
                    else:
                        detail_parts.append(f"pág. {p}")
                detail = "; ".join(detail_parts)
                if len(rgb_pages) > 6:
                    detail += f"… (+{len(rgb_pages) - 6} págs.)"
                achados.append(
                    achado(
                        "arquivo_rgb",
                        "Cores — arquivo em RGB",
                        f'"{os.path.basename(path)}": conteúdo RGB nas páginas '
                        f"{_fmt_pages(rgb_pages)}"
                        + (f" — {detail}." if detail else "."),
                        "warning",
                        arquivo=os.path.basename(path),
                        paginas=rgb_pages,
                        detalhes=preflight.get("by_page"),
                    )
                )
            hidden_rgb = [
                h
                for h in (preflight.get("hidden") or [])
                if h in (ERR_RGB_IMAGE, ERR_RGB_VECTOR)
            ]
            if hidden_rgb and not rgb_pages:
                achados.append(
                    achado(
                        "arquivo_rgb",
                        "Cores — arquivo em RGB",
                        f'"{os.path.basename(path)}": RGB em metadados/objetos ocultos '
                        f"({' | '.join(hidden_rgb)}).",
                        "warning",
                        arquivo=os.path.basename(path),
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "arquivo_rgb_ok",
                    "Cores — arquivo em RGB",
                    "Nenhuma página com RGB detectado em todos os PDFs analisados.",
                    "ok",
                )
            )
    finally:
        _close_docs(docs, _ctx(context))

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_imagens_baixa_resolucao(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = _open_docs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Resolução de imagens", err, "error")])

    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            result = analyze_document_images(doc, min_dpi=MIN_IMAGE_DPI)
            low = result["low_dpi"]
            if low:
                sample = low[:5]
                detail = "; ".join(
                    _fmt_low_dpi_hit(x) for x in sample
                )
                achados.append(
                    achado(
                        "imagem_baixa_dpi",
                        "Imagens sem qualidade de impressão",
                        f'"{os.path.basename(path)}": {len(low)} imagem(ns) abaixo de '
                        f"{MIN_IMAGE_DPI} dpi ({detail}"
                        + ("…)" if len(low) > 5 else ")"),
                        "warning",
                        imagens=low,
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "imagem_dpi_ok",
                    "Imagens sem qualidade de impressão",
                    f"Todas as imagens analisadas atendem ≥ {MIN_IMAGE_DPI} dpi.",
                    "ok",
                )
            )
    finally:
        _close_docs(docs, _ctx(context))

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_imagens_distorcidas(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = _open_docs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Imagens distorcidas", err, "error")])

    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            result = analyze_document_images(doc)
            dist = result["distorted"]
            if dist:
                detail = "; ".join(f"pág. {x['page']}" for x in dist[:6])
                achados.append(
                    achado(
                        "imagem_distorcida",
                        "Imagens distorcidas",
                        f'"{os.path.basename(path)}": {len(dist)} imagem(ns) com proporção '
                        f"alterada ({detail}"
                        + ("…)" if len(dist) > 6 else ")"),
                        "warning",
                        imagens=dist,
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "imagem_distorcida_ok",
                    "Imagens distorcidas",
                    "Nenhuma distorção de proporção detectada nas imagens.",
                    "ok",
                )
            )
    finally:
        _close_docs(docs, _ctx(context))

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_marcas_corte_duplicadas(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = _open_docs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result(
            [achado("pymupdf", "Marcas de corte duplicadas", err, "error")]
        )

    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            for pno in range(doc.page_count):
                page = doc.load_page(pno)
                issues = find_duplicate_crop_marks(page)
                if issues:
                    achados.append(
                        achado(
                            "marcas_duplicadas",
                            "Marcas de corte duplicadas",
                            f'"{os.path.basename(path)}" pág. {pno + 1}: '
                            f"{'; '.join(issues)}.",
                            "warning",
                            arquivo=os.path.basename(path),
                            pagina=pno + 1,
                        )
                    )
        if not achados:
            achados.append(
                achado(
                    "marcas_duplicadas_ok",
                    "Marcas de corte duplicadas",
                    "Nenhuma duplicata de marcas de corte detectada.",
                    "ok",
                )
            )
    finally:
        _close_docs(docs, _ctx(context))

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_sangria_excesso(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = _open_docs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result(
            [achado("pymupdf", "Sangria com excesso", err, "error")]
        )

    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            for pno in range(doc.page_count):
                page = doc.load_page(pno)
                issues = analyze_bleed_excess(page)
                if issues:
                    achados.append(
                        achado(
                            "sangria_excesso",
                            "Sangria com elementos gráficos excessivos",
                            f'"{os.path.basename(path)}" pág. {pno + 1}: '
                            f"{'; '.join(issues)}.",
                            "warning",
                            arquivo=os.path.basename(path),
                            pagina=pno + 1,
                        )
                    )
        if not achados:
            achados.append(
                achado(
                    "sangria_excesso_ok",
                    "Sangria com elementos gráficos excessivos",
                    "Nenhuma barra de calibragem nem marca de registro na sangria.",
                    "ok",
                )
            )
    finally:
        _close_docs(docs, _ctx(context))

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_divergencia_cores_os(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    ctx = _ctx(context)
    err, docs = _open_docs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Divergência de cores (OS)", err, "error")])

    esperado = parse_os_cores_esperado(
        ctx.os_details.get("Cores"),
        ctx.os_details.get("CoresDescricao"),
    )

    if esperado["unknown"]:
        achados.append(
            achado(
                "cores_os_indefinido",
                "Divergência na OS — Cores",
                f"Especificação de cores da OS não reconhecida automaticamente "
                f"({esperado['raw'] or '—'}).",
                "info",
            )
        )

    try:
        color_pages_all: List[str] = []
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            if esperado["pb_only"]:
                color_pages = analyze_document_color_vs_pb(doc)
                if color_pages:
                    color_pages_all.extend(
                        [f"{os.path.basename(path)} p.{p}" for p in color_pages]
                    )
        if esperado["pb_only"] and color_pages_all:
            achados.append(
                achado(
                    "cores_os",
                    "Divergência na OS — Cores",
                    f"OS indica miolo P&B, mas há conteúdo colorido no PDF: "
                    f"{', '.join(color_pages_all[:8])}"
                    + ("…" if len(color_pages_all) > 8 else ""),
                    "warning",
                    os_cores=esperado["raw"],
                    paginas=color_pages_all,
                )
            )
        elif esperado["pb_only"]:
            achados.append(
                achado(
                    "cores_os_ok",
                    "Divergência na OS — Cores",
                    "PDF compatível com especificação P&B da OS.",
                    "ok",
                )
            )
        elif esperado["color_expected"]:
            achados.append(
                achado(
                    "cores_os_ok",
                    "Divergência na OS — Cores",
                    f"OS indica impressão colorida ({esperado['raw']}).",
                    "info",
                )
            )
    finally:
        _close_docs(docs, _ctx(context))

    if not achados:
        achados.append(
            achado("cores_os_ok", "Divergência na OS — Cores", "Verificação concluída.", "ok")
        )

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def _fmt_pages(pages: List[int]) -> str:
    if len(pages) <= 8:
        return ", ".join(str(p) for p in pages)
    return ", ".join(str(p) for p in pages[:8]) + f"… (+{len(pages) - 8})"


def _fmt_low_dpi_hit(hit: Dict[str, Any]) -> str:
    loc = hit.get("location")
    loc_txt = f", parte {loc.lower()}" if loc else ""
    return f"pág. {hit['page']}{loc_txt} (~{int(hit['dpi'])} dpi)"
