"""
Verificações avançadas de pré-análise (itens 22–43 do roteiro técnico).
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from services.pre_analise.context import PreAnaliseContext
from services.pre_analise.pags_os import expects_capa_miolo_separate
from services.pre_analise.pdf_color_advanced import (
    TAC_LIMIT,
    analyze_black_in_four_color,
    analyze_colorspace_consistency,
    analyze_gray_images_in_cmyk,
    analyze_tac,
)
from services.pre_analise.pdf_color_preflight import (
    ERR_RGB_IMAGE,
    ERR_RGB_VECTOR,
    ERR_RICH_BLACK,
    analyze_color_preflight,
)
from services.pre_analise.pdf_partial_raster import analyze_partial_raster_pages
from services.pre_analise.pdf_layout_heuristics import (
    analyze_capa_miolo_junto,
    analyze_content_margin,
    analyze_fold_marks,
    analyze_holes_near_trim,
    analyze_imposition,
    is_folder_product,
)
from services.pre_analise.pdf_runner import basename, close_docs, open_folder_pdfs
from services.pre_analise.pdf_text_heuristics import (
    analyze_editoracao,
    analyze_page_numbering,
    analyze_rasterized_fonts,
    analyze_repeated_raster_logos,
)
from services.pre_analise.pdf_utils import list_pdfs
from services.pre_analise.result_helpers import achado, finalize_result


def _ctx(context: Optional[PreAnaliseContext]) -> PreAnaliseContext:
    if context is None:
        return PreAnaliseContext(folder_path="", ano=0, os_id=0)
    return context


def _run_per_doc(
    folder_path: str,
    titulo_ok: str,
    titulo_problema: str,
    codigo_ok: str,
    codigo_problema: str,
    analyze_fn,
    format_hit,
    *,
    severity: str = "warning",
    context: Optional[PreAnaliseContext] = None,
) -> Dict[str, Any]:
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", titulo_problema, err, "error")])

    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                achados.append(
                    achado(
                        "pdf_erro",
                        titulo_problema,
                        f"{basename(path)}: {doc}",
                        "error",
                    )
                )
                continue
            result = analyze_fn(doc)
            msg = format_hit(basename(path), result)
            if msg:
                achados.append(
                    achado(codigo_problema, titulo_problema, msg, severity, arquivo=basename(path))
                )
        if not achados:
            achados.append(achado(codigo_ok, titulo_ok, f"Nenhum problema em {titulo_ok.lower()}.", "ok"))
    finally:
        close_docs(docs, context)

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


# --- 22–27, 43: Cores ---


def run_cores_elementos_rgb(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context

    def fmt(name: str, r: Dict[str, Any]) -> Optional[str]:
        pages = r.get("pages_rgb") or []
        rgb_labels = {ERR_RGB_IMAGE, ERR_RGB_VECTOR}
        hidden_rgb = [h for h in (r.get("hidden") or []) if h in rgb_labels]
        if not pages and not hidden_rgb:
            return None
        parts = [f'"{name}": RGB em páginas {_fmt_pages(pages)}' if pages else f'"{name}": RGB']
        by_page = r.get("by_page") or {}
        img_pages = [
            p for p, labels in by_page.items() if ERR_RGB_IMAGE in labels
        ]
        vec_pages = [
            p for p, labels in by_page.items() if ERR_RGB_VECTOR in labels
        ]
        if img_pages:
            parts.append(
                f"imagem raster RGB nas págs. {_fmt_pages(sorted(img_pages))}"
            )
        if vec_pages:
            parts.append(
                f"vetor/texto RGB nas págs. {_fmt_pages(sorted(vec_pages))}"
            )
        if hidden_rgb:
            parts.append(f"oculto: {' | '.join(hidden_rgb)}")
        return " (" + "; ".join(parts[1:]) + ")." if len(parts) > 1 else parts[0] + "."

    return _run_per_doc(
        folder_path,
        "Cores — elementos RGB",
        "Cores — elementos gráficos em RGB",
        "cores_rgb_ok",
        "cores_elementos_rgb",
        analyze_color_preflight,
        fmt,
    )


def run_cores_texto_preto_4c(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context

    def analyze(doc):
        pf = analyze_color_preflight(doc)
        pages = pf.get("pages_rich_black") or []
        return {"pages_rich_black": pages, "hidden": pf.get("hidden") or []}

    def fmt(name: str, r: Dict[str, Any]) -> Optional[str]:
        pages = r.get("pages_rich_black") or []
        hidden = [h for h in (r.get("hidden") or []) if h == ERR_RICH_BLACK]
        if not pages and not hidden:
            return None
        msg = f'"{name}": preto composto (4 cores)'
        if pages:
            msg += f" nas págs. {_fmt_pages(pages)}"
        if hidden:
            msg += f"; também em metadados/oculto"
        return msg + "."

    return _run_per_doc(
        folder_path,
        "Cores — texto preto 4c",
        "Cores — textos pretos em quatro cores",
        "texto_preto_4c_ok",
        "texto_preto_4c",
        analyze,
        fmt,
    )


def run_cores_texto_elementos_preto_4c(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context

    def analyze(doc):
        pf = analyze_color_preflight(doc)
        return {
            "pages_rich_black": pf.get("pages_rich_black") or [],
            "by_page": pf.get("by_page") or {},
            "hidden": pf.get("hidden") or [],
        }

    def fmt(name: str, r: Dict[str, Any]) -> Optional[str]:
        pages = r.get("pages_rich_black") or []
        hidden = [h for h in (r.get("hidden") or []) if h == ERR_RICH_BLACK]
        if not pages and not hidden:
            return None
        msg = f'"{name}": preto composto (4 cores)'
        if pages:
            msg += f" nas págs. {_fmt_pages(pages)}"
        if hidden:
            msg += f"; metadados/oculto"
        return msg + "."

    return _run_per_doc(
        folder_path,
        "Cores — texto e elementos preto 4c",
        "Cores — textos e elementos pretos em quatro cores",
        "elementos_preto_4c_ok",
        "elementos_preto_4c",
        analyze,
        fmt,
    )


def run_cores_imagem_pb_4c(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context

    def fmt(name: str, hits: List[Dict[str, Any]]) -> Optional[str]:
        if not hits:
            return None
        pages = sorted({h["page"] for h in hits})
        return (
            f'"{name}": {len(hits)} imagem(ns) em tons de cinza armazenada(s) em CMYK '
            f"(págs. {_fmt_pages(pages)})."
        )

    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Imagens PB em 4c", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            hits = analyze_gray_images_in_cmyk(doc)
            msg = fmt(basename(path), hits)
            if msg:
                achados.append(achado("imagem_pb_4c", "Cores — imagens PB em quatro cores", msg, "warning"))
        if not achados:
            achados.append(
                achado("imagem_pb_4c_ok", "Cores — imagens PB em quatro cores", "Nenhuma imagem cinza em CMYK detectada.", "ok")
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_cores_tac_maximo(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "TAC", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            r = analyze_tac(doc, limit=TAC_LIMIT)
            if r.get("over_limit"):
                w = r.get("worst") or {}
                achados.append(
                    achado(
                        "tac_excesso",
                        "Cores — cobertura de tinta (TAC)",
                        f'"{basename(path)}": TAC máximo {r["max_tac"]}% '
                        f"(limite {TAC_LIMIT}%)"
                        + (f", pág. {w.get('page')}." if w.get("page") else "."),
                        "warning",
                        tac=r,
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "tac_ok",
                    "Cores — cobertura de tinta (TAC)",
                    f"TAC amostrado abaixo de {TAC_LIMIT}% em todos os PDFs.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_cores_espaco_incorreto(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Espaço de cor", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            issues = analyze_colorspace_consistency(doc)
            if issues:
                achados.append(
                    achado(
                        "espaco_cor",
                        "Cores — espaço de cor incorreto",
                        f'"{basename(path)}": {"; ".join(issues)}.',
                        "warning",
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "espaco_cor_ok",
                    "Cores — espaço de cor incorreto",
                    "Nenhuma inconsistência grave de espaço de cor entre páginas.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_calco_ciano_pretos(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context

    def fmt(name: str, r: Dict[str, Any]) -> Optional[str]:
        if r.get("calco_count", 0) == 0:
            return None
        return f'"{name}": {r["calco_count"]} objeto(s) preto(s) com excesso de ciano.'

    return _run_per_doc(
        folder_path,
        "Calço de ciano",
        "Calço inadequado de ciano em objetos pretos",
        "calco_ciano_ok",
        "calco_ciano",
        lambda d: analyze_black_in_four_color(d, include_paths=True),
        fmt,
    )


# --- 28: Fontes rasterizadas ---


def run_fontes_rasterizadas(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Fontes rasterizadas", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            parts: List[str] = []
            ocr = analyze_partial_raster_pages(doc)
            if ocr.get("pages"):
                parts.append(
                    f"raster parcial (texto em imagem) nas págs. "
                    f"{_fmt_pages(ocr['pages'])}"
                )
            elif ocr.get("method") == "unavailable":
                r = analyze_rasterized_fonts(doc)
                if r.get("type3_pages"):
                    parts.append(f"Type3 nas págs. {_fmt_pages(r['type3_pages'])}")
                if r.get("image_only_text_pages"):
                    parts.append(
                        f"pouco texto pesquisável com muitas imagens nas págs. "
                        f"{_fmt_pages(r['image_only_text_pages'])}"
                    )
            if parts:
                achados.append(
                    achado(
                        "fontes_raster",
                        "Fontes rasterizadas (como imagem)",
                        f'"{basename(path)}": {"; ".join(parts)}.',
                        "warning",
                        metodo=ocr.get("method"),
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "fontes_raster_ok",
                    "Fontes rasterizadas (como imagem)",
                    "Nenhum texto rasterizado ou fonte Type3 detectado.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


# --- 29: Capa e miolo juntos ---


def run_capa_miolo_junto(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    ctx = _ctx(context)
    pdfs = list_pdfs(folder_path)
    achados: List[Dict[str, Any]] = []

    if not expects_capa_miolo_separate(ctx.os_details):
        achados.append(
            achado(
                "capa_miolo_junto_na",
                "Capa e miolo no mesmo arquivo",
                "OS não exige capa e miolo em arquivos separados.",
                "info",
            )
        )
        return finalize_result(achados, pdf_count=len(pdfs))

    if len(pdfs) != 1:
        achados.append(
            achado(
                "capa_miolo_junto_ok",
                "Capa e miolo no mesmo arquivo",
                f"{len(pdfs)} PDF(s) na pasta; não é arquivo único com capa+miolo.",
                "ok",
            )
        )
        return finalize_result(achados, pdf_count=len(pdfs))

    err, docs = open_folder_pdfs(folder_path, context)
    if err:
        return finalize_result([achado("pymupdf", "Capa e miolo juntos", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            hit = analyze_capa_miolo_junto(doc, expects_separate=True)
            if hit:
                achados.append(
                    achado(
                        "capa_miolo_junto",
                        "Arquivo com capa e miolo juntos",
                        f'"{basename(path)}": {hit["message"]}',
                        "warning",
                        detalhes=hit,
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "capa_miolo_junto_ok",
                    "Arquivo com capa e miolo juntos",
                    "Arquivo único, mas sem indício de capa (4 pág.) + miolo na mesma peça.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(pdfs))


# --- 30–32: Numeração ---


def _numeracao_for_folder(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Dict[str, Any]]:
    err, docs = open_folder_pdfs(folder_path, context)
    out: Dict[str, Dict[str, Any]] = {}
    if err:
        return {"_error": {"msg": err}}
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            out[basename(path)] = analyze_page_numbering(doc)
    finally:
        close_docs(docs, context)
    return out


def run_numeracao_ausente(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    data = _numeracao_for_folder(folder_path, context)
    if "_error" in data:
        return finalize_result([achado("pymupdf", "Numeração ausente", data["_error"]["msg"], "error")])
    achados: List[Dict[str, Any]] = []
    for name, r in data.items():
        if r.get("missing_count", 0) > 0:
            achados.append(
                achado(
                    "numeracao_ausente",
                    "Numeração de páginas ausente",
                    f'"{name}": sem número no rodapé em {r["missing_count"]} página(s) '
                    f"(amostra após pré-textuais).",
                    "warning",
                    paginas=r.get("missing_pages"),
                )
            )
    if not achados:
        achados.append(
            achado("numeracao_ausente_ok", "Numeração de páginas ausente", "Numeração detectada no rodapé.", "ok")
        )
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_numeracao_excessiva(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    data = _numeracao_for_folder(folder_path, context)
    if "_error" in data:
        return finalize_result([achado("pymupdf", "Numeração excessiva", data["_error"]["msg"], "error")])
    achados: List[Dict[str, Any]] = []
    for name, r in data.items():
        if r.get("excess"):
            achados.append(
                achado(
                    "numeracao_excessiva",
                    "Numeração excessiva / sequência inadequada",
                    f'"{name}": {len(r["excess"])} página(s) com numeração fora do esperado.',
                    "warning",
                    detalhes=r["excess"][:15],
                )
            )
    if not achados:
        achados.append(
            achado(
                "numeracao_excessiva_ok",
                "Numeração excessiva / sequência inadequada",
                "Sequência de numeração dentro do esperado.",
                "ok",
            )
        )
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_numeracao_posicao(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    data = _numeracao_for_folder(folder_path, context)
    if "_error" in data:
        return finalize_result([achado("pymupdf", "Numeração posição", data["_error"]["msg"], "error")])
    achados: List[Dict[str, Any]] = []
    for name, r in data.items():
        if r.get("misaligned"):
            achados.append(
                achado(
                    "numeracao_posicao",
                    "Numeração — posição invertida / desalinhada",
                    f'"{name}": {len(r["misaligned"])} página(s) com número em lado atípico.',
                    "warning",
                    detalhes=r["misaligned"][:15],
                )
            )
    if not achados:
        achados.append(
            achado(
                "numeracao_posicao_ok",
                "Numeração — posição invertida / desalinhada",
                "Posição par/ímpar da numeração consistente.",
                "ok",
            )
        )
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


# --- 33–36: Layout e acabamento ---


def run_mancha_margem_7mm(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Margem 7 mm", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            hits = analyze_content_margin(doc)
            if hits:
                sample = hits[:6]
                detail = "; ".join(
                    f"p.{h['page']} {h['lado']} {h['mm']}mm ({h.get('tipo', 'elemento')})"
                    for h in sample
                )
                achados.append(
                    achado(
                        "margem_7mm",
                        "Mancha gráfica com margem abaixo de 7 mm",
                        f'"{basename(path)}": conteúdo a menos de 7 mm da trim ({detail}'
                        + ("…)" if len(hits) > 6 else ")"),
                        "warning",
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "margem_7mm_ok",
                    "Mancha gráfica com margem abaixo de 7 mm",
                    "Margens do conteúdo em relação à trim ≥ 7 mm.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_acabamento_furos_proximos(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Furos próximos", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            hits = analyze_holes_near_trim(doc)
            if hits:
                achados.append(
                    achado(
                        "furos_proximos",
                        "Acabamento — furos muito próximos do corte",
                        f'"{basename(path)}": {len(hits)} elemento(s) circular(es) perto da borda.',
                        "warning",
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "furos_proximos_ok",
                    "Acabamento — furos muito próximos do corte",
                    "Nenhum furo detectado próximo à borda de corte.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_acabamento_marcas_dobra(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    ctx = _ctx(context)
    if not is_folder_product(ctx.os_details):
        return finalize_result(
            [
                achado(
                    "marcas_dobra_na",
                    "Acabamento — marcas de dobra",
                    "Produto não identificado como folder/dobradura.",
                    "info",
                )
            ],
            pdf_count=len(list_pdfs(folder_path)),
        )
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Marcas de dobra", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            r = analyze_fold_marks(doc)
            if not r.get("has_fold_marks"):
                achados.append(
                    achado(
                        "marcas_dobra_ausente",
                        "Acabamento — falta de marcas de dobra",
                        f'"{basename(path)}": folder sem linhas de dobra detectadas.',
                        "warning",
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "marcas_dobra_ok",
                    "Acabamento — marcas de dobra",
                    "Marcas de dobra detectadas.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_paginas_imposicionadas(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Imposição", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            hits = analyze_imposition(doc)
            if hits:
                pages = sorted({h["page"] for h in hits})
                achados.append(
                    achado(
                        "imposicao",
                        "Páginas imposicionadas / distribuição inadequada",
                        f'"{basename(path)}": possível imposição nas págs. {_fmt_pages(pages)}.',
                        "warning",
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "imposicao_ok",
                    "Páginas imposicionadas / distribuição inadequada",
                    "Nenhuma imposição lateral detectada.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


# --- 37–40: Editoração ---


def run_editoracao_data_desatualizada(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    ctx = _ctx(context)
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Data desatualizada", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            r = analyze_editoracao(doc, ctx.os_details)
            if r.get("stale_years"):
                years = sorted({x["ano"] for x in r["stale_years"]})
                achados.append(
                    achado(
                        "data_desatualizada",
                        "Editoração — data desatualizada",
                        f'"{basename(path)}": ano(s) antigo(s) encontrado(s): {years[:5]}.',
                        "warning",
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "data_ok",
                    "Editoração — data desatualizada",
                    "Nenhuma data claramente desatualizada detectada.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_editoracao_indice_sumario(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    ctx = _ctx(context)
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Índice vs Sumário", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            r = analyze_editoracao(doc, ctx.os_details)
            if r.get("indice_como_sumario_pages"):
                achados.append(
                    achado(
                        "indice_sumario",
                        "Editoração — Índice usado como Sumário",
                        f'"{basename(path)}": palavra "ÍNDICE" sem "SUMÁRIO" nas págs. '
                        f'{_fmt_pages(r["indice_como_sumario_pages"])}.',
                        "warning",
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "indice_sumario_ok",
                    "Editoração — Índice usado como Sumário",
                    "Não detectado uso de ÍNDICE no lugar de SUMÁRIO.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_editoracao_sumario_ausente(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    ctx = _ctx(context)
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Sumário ausente", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            r = analyze_editoracao(doc, ctx.os_details)
            if r.get("sumario_ausente"):
                achados.append(
                    achado(
                        "sumario_ausente",
                        "Editoração — Sumário ausente",
                        f'"{basename(path)}": miolo com {doc.page_count} páginas sem '
                        f'página contendo "Sumário".',
                        "warning",
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "sumario_ok",
                    "Editoração — Sumário ausente",
                    "Sumário localizado ou miolo curto.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_editoracao_parlamentar(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    ctx = _ctx(context)
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Parlamentar", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            r = analyze_editoracao(doc, ctx.os_details)
            for issue in r.get("parlamentar_issues") or []:
                achados.append(
                    achado(
                        "parlamentar",
                        "Editoração — nome do parlamentar não informado",
                        f'"{basename(path)}": {issue}',
                        "warning",
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "parlamentar_ok",
                    "Editoração — nome do parlamentar não informado",
                    "Parlamentar identificado ou produto não legislativo.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


# --- Elementos gráficos ---


def run_logomarcas_raster(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    _ = context
    err, docs = open_folder_pdfs(folder_path, context)
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result([achado("pymupdf", "Logomarcas raster", err, "error")])
    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            hits = analyze_repeated_raster_logos(doc)
            if hits:
                achados.append(
                    achado(
                        "logo_raster",
                        "Logomarcas em raster",
                        f'"{basename(path)}": {len(hits)} imagem(ns) repetida(s) '
                        f"(possível logo bitmap).",
                        "warning",
                        logos=hits[:5],
                    )
                )
        if not achados:
            achados.append(
                achado(
                    "logo_raster_ok",
                    "Logomarcas em raster",
                    "Nenhuma logomarca repetida em raster detectada.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, context)
    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def _fmt_pages(pages: List[int]) -> str:
    if len(pages) <= 8:
        return ", ".join(str(p) for p in pages)
    return ", ".join(str(p) for p in pages[:8]) + f"… (+{len(pages) - 8})"
