"""
Verificação unificada de formato e marcas de corte.

Motor baseado em formato.py (AnalisePDF): marcas vetoriais, TrimBox, OpenCV,
capa com orelhas/lombada, comparação com OS, limites da gráfica, ISO A3/A4/A5
e marcas de corte duplicadas.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from formato_dimensions import resolve_formato_dimensions
from services.pre_analise.context import PreAnaliseContext
from services.pre_analise.format_detector import (
    FormatDetector,
    dominant_pattern,
    sampling_status,
)
from services.pre_analise.pags_os import lombada_esperada_mm, os_especifica_lombada
from services.pre_analise.result_helpers import achado, finalize_result

logger = logging.getLogger(__name__)

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

LIMITE_ACABAMENTO_LARGURA_MM = 560.0
LIMITE_ACABAMENTO_ALTURA_MM = 540.0
LIMITE_IMPRESSAO_LARGURA_MM = 750.0
LIMITE_IMPRESSAO_ALTURA_MM = 740.0
TOLERANCIA_FORMATO_MM = 5.0
TOLERANCIA_LOMBADA_MM = 0.2

_METHODS_WITH_CROP_MARKS = {
    "Marcas de corte (Geometria Vetorial)",
    "Marcas de corte (OpenCV)",
}

_METHOD_TO_METODO = {
    "Marcas de corte (Geometria Vetorial)": "marcas_de_corte",
    "Marcas de corte (OpenCV)": "marcas_de_corte",
    "Trimbox": "trimbox",
    "Formato do Arquivo": "mediabox",
}


def _format_label(altura_mm: float, largura_mm: float) -> str:
    a = min(altura_mm, largura_mm)
    b = max(altura_mm, largura_mm)
    return f"{a:g} × {b:g} mm"


def _method_label(method: str) -> str:
    labels = {
        "Marcas de corte (Geometria Vetorial)": "Marcas de corte (geometria vetorial)",
        "Marcas de corte (OpenCV)": "Marcas de corte (OpenCV)",
        "Trimbox": "TrimBox do PDF",
        "Formato do Arquivo": "Formato do arquivo (MediaBox)",
    }
    return labels.get(method, method)


def _capa_to_page(result: Dict[str, Any]) -> Dict[str, Any]:
    dados = result["dados"]
    altura = float(dados["aberto_h"])
    largura = float(dados["aberto_w"])
    tipo = dados.get("tipo", "Capa")

    parts = [
        f"{tipo}.",
        f"Formato aberto: {_format_label(altura, largura)}.",
        f"Formato do arquivo: {result['file_w']}×{result['file_h']} mm.",
        "Medição: marcas de vinco e corte (geometria vetorial).",
    ]
    if "Capa com Orelhas" in tipo:
        parts.append(
            f"Capa/contracapa {dados.get('capa')} mm; lombada {dados.get('lombada')} mm; "
            f"orelhas esq. {dados.get('orelha_esq')} mm / dir. {dados.get('orelha_dir')} mm."
        )
    elif "Simples" in tipo:
        parts.append(
            f"Capa/contracapa {dados.get('capa')} mm; lombada {dados.get('lombada')} mm."
        )

    return {
        "page": result["page"],
        "marcas_de_corte": True,
        "metodo": "marcas_de_corte",
        "formato_mm": {"altura": altura, "largura": largura},
        "formato_label": _format_label(altura, largura),
        "mensagem": " ".join(parts),
        "is_capa": True,
        "capa_tipo": tipo,
    }


def _miolo_to_page(result: Dict[str, Any], extra: str = "") -> Dict[str, Any]:
    method = result.get("method", "Formato do Arquivo")
    aviso = result.get("aviso", "")
    altura = float(result["print_h"])
    largura = float(result["print_w"])
    marcas = method in _METHODS_WITH_CROP_MARKS

    msg = (
        f"Formato de impressão: {_format_label(altura, largura)}. "
        f"Formato do arquivo: {result['file_w']}×{result['file_h']} mm. "
        f"Forma de medição: {_method_label(method)}{aviso}."
    )
    if extra:
        msg += f" {extra}"

    return {
        "page": result["page"],
        "marcas_de_corte": marcas,
        "metodo": _METHOD_TO_METODO.get(method, "mediabox"),
        "formato_mm": {"altura": altura, "largura": largura},
        "formato_label": _format_label(altura, largura),
        "mensagem": msg,
    }


def _build_pages_output(
    results: List[Dict[str, Any]], total_pages: int
) -> List[Dict[str, Any]]:
    pages_out: List[Dict[str, Any]] = []
    capas = [r for r in results if r.get("is_capa")]
    normais = [r for r in results if not r.get("is_capa")]

    for r in capas:
        pages_out.append(_capa_to_page(r))

    if not normais:
        return sorted(pages_out, key=lambda x: x["page"])

    padrao = dominant_pattern(results)
    divergentes = [
        r
        for r in normais
        if padrao
        and (r["print_w"], r["print_h"], r["file_w"], r["file_h"]) != padrao
    ]

    amostragem = sampling_status(results, total_pages)
    extra_uniform = ""
    if amostragem == "amostragem_rapida":
        extra_uniform = (
            f"Formato uniforme em {total_pages} página(s) "
            f"(confirmado por amostragem de {len(normais)} págs)."
        )
    elif not divergentes:
        extra_uniform = f"Formato uniforme em {total_pages} página(s)."

    if divergentes:
        for r in divergentes:
            pages_out.append(_miolo_to_page(r))
        rep = next(
            r
            for r in normais
            if padrao
            and (r["print_w"], r["print_h"], r["file_w"], r["file_h"]) == padrao
        )
        pages_out.append(
            _miolo_to_page(rep, f"Padrão dominante do arquivo. {extra_uniform}")
        )
    else:
        pages_out.append(_miolo_to_page(normais[0], extra_uniform))

    return sorted(pages_out, key=lambda x: x["page"])


def _dims_from_results(results: List[Dict[str, Any]]) -> Optional[Tuple[float, float]]:
    dims: List[Tuple[float, float]] = []
    for r in results:
        if r.get("is_capa"):
            d = r["dados"]
            dims.append((float(d["aberto_h"]), float(d["aberto_w"])))
        else:
            dims.append((float(r["print_h"]), float(r["print_w"])))
    if not dims:
        return None
    return (max(d[0] for d in dims), max(d[1] for d in dims))


def _list_pdfs(folder_path: str) -> List[str]:
    if not folder_path or not os.path.isdir(folder_path):
        return []
    return sorted(
        f
        for f in os.listdir(folder_path)
        if os.path.isfile(os.path.join(folder_path, f)) and f.lower().endswith(".pdf")
    )


def _imposition_sheet_note(formato_os: str, a_pdf: float, b_pdf: float) -> Optional[str]:
    upper = (formato_os or "").upper()
    tol = TOLERANCIA_FORMATO_MM
    if re.search(r"\bA5\b", upper):
        if abs(a_pdf - 210.0) <= tol and abs(b_pdf - 297.0) <= tol:
            return (
                f"PDF em chapa A4 ({a_pdf:g}×{b_pdf:g} mm) compatível com imposição "
                f"para produto A5 da OS ({formato_os})."
            )
    if re.search(r"\bA6\b", upper):
        if abs(a_pdf - 148.0) <= tol and abs(b_pdf - 210.0) <= tol:
            return (
                f"PDF em chapa A5 ({a_pdf:g}×{b_pdf:g} mm) compatível com imposição "
                f"para produto A6 da OS ({formato_os})."
            )
    return None


def _analyze_pdf_file(
    full_path: str,
    detector: FormatDetector,
    doc: Optional[Any] = None,
) -> Dict[str, Any]:
    name = os.path.basename(full_path)
    if fitz is None:
        return {
            "name": name,
            "error": "PyMuPDF não está instalado no servidor (pip install pymupdf).",
            "pages": [],
        }

    own_doc = doc is None
    opened: Optional[Any] = None
    try:
        if doc is None:
            raw_results, total_pages = detector.detect(full_path)
            opened = fitz.open(full_path)
            doc = opened
        else:
            raw_results, total_pages = detector.detect_document(doc, full_path)

        pages = _build_pages_output(raw_results, total_pages)
        dims = _dims_from_results(raw_results)

        duplicatas: List[Dict[str, Any]] = []
        seen_pages = {r["page"] for r in raw_results}
        for page_num in sorted(seen_pages):
            page = doc[page_num - 1]
            for issue in detector.find_duplicate_marks(page):
                duplicatas.append({"page": page_num, "issue": issue})

        out: Dict[str, Any] = {
            "name": name,
            "pages": pages,
            "error": None,
            "total_pages": total_pages,
            "paginas_analisadas": len(raw_results),
            "formato_mm": (
                {"altura": dims[0], "largura": dims[1]} if dims else None
            ),
        }

        amostragem = sampling_status(raw_results, total_pages)
        if amostragem:
            out["amostragem"] = amostragem
        if duplicatas:
            out["marcas_duplicadas"] = duplicatas
        capa_profiles = [
            {
                "page": r["page"],
                "dados": r["dados"],
                "file_w": r["file_w"],
                "file_h": r["file_h"],
            }
            for r in raw_results
            if r.get("is_capa") and r.get("dados")
        ]
        if capa_profiles:
            out["capa_profiles"] = capa_profiles
            out["capas_detectadas"] = len(capa_profiles)

        return out
    except Exception as exc:
        logger.warning("Erro ao analisar PDF %s: %s", full_path, exc)
        return {"name": name, "error": str(exc), "pages": []}
    finally:
        if own_doc and opened is not None:
            opened.close()


def _achados_por_arquivo(files: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    achados: List[Dict[str, Any]] = []

    for f in files:
        if f.get("error"):
            continue
        name = f["name"]
        pages = f.get("pages") or []

        if pages and all(not p.get("marcas_de_corte") for p in pages):
            achados.append(
                achado(
                    "sem_marcas_corte",
                    "Marcas de corte",
                    f'"{name}": marcas de corte não detectadas; '
                    "utilizado TrimBox ou formato do arquivo.",
                    "warning",
                    arquivo=name,
                )
            )

        for dup in f.get("marcas_duplicadas") or []:
            achados.append(
                achado(
                    "marcas_duplicadas",
                    "Marcas de corte duplicadas",
                    f'"{name}" pág. {dup["page"]}: {dup["issue"]}.',
                    "warning",
                    arquivo=name,
                    pagina=dup["page"],
                )
            )

        if f.get("formato_mm"):
            mm = f["formato_mm"]
            achados.append(
                achado(
                    "formato_arquivo",
                    "Formato medido",
                    f'"{name}": {_format_label(mm["altura"], mm["largura"])}.',
                    "ok",
                    arquivo=name,
                    formato_mm=mm,
                )
            )

    return achados


def _achados_pasta(
    files: List[Dict[str, Any]], context: Optional[PreAnaliseContext]
) -> List[Dict[str, Any]]:
    achados: List[Dict[str, Any]] = []
    valid = [f for f in files if not f.get("error") and f.get("formato_mm")]

    if not valid:
        achados.append(
            achado(
                "formato_sem_medida",
                "Formato",
                "Não foi possível medir o formato dos PDFs.",
                "warning",
            )
        )
        return achados

    alt_pdf = max(f["formato_mm"]["altura"] for f in valid)
    larg_pdf = max(f["formato_mm"]["largura"] for f in valid)
    a_pdf, b_pdf = sorted([alt_pdf, larg_pdf])

    ctx = context or PreAnaliseContext(folder_path="", ano=0, os_id=0)
    formato_os = str(ctx.os_details.get("FormatoLink") or "").strip()
    dims_os = resolve_formato_dimensions(formato_os)

    if dims_os:
        alt_os, larg_os = dims_os
        a_os, b_os = sorted([alt_os, larg_os])
        imposition = _imposition_sheet_note(formato_os, a_pdf, b_pdf)
        if imposition:
            achados.append(
                achado(
                    "formato_os_imposicao",
                    "Formato × OS",
                    imposition,
                    "ok",
                    pdf_mm={"altura": alt_pdf, "largura": larg_pdf},
                    os_mm={"altura": alt_os, "largura": larg_os},
                )
            )
        elif (
            abs(a_pdf - a_os) <= TOLERANCIA_FORMATO_MM
            and abs(b_pdf - b_os) <= TOLERANCIA_FORMATO_MM
        ):
            achados.append(
                achado(
                    "formato_os_ok",
                    "Formato × OS",
                    f"Formato compatível com a OS ({formato_os}: "
                    f"{min(alt_os, larg_os):g}×{max(alt_os, larg_os):g} mm).",
                    "ok",
                )
            )
        else:
            achados.append(
                achado(
                    "formato_os",
                    "Formato × OS",
                    f"PDF ≈ {a_pdf:g}×{b_pdf:g} mm; OS ({formato_os}) ≈ "
                    f"{a_os:g}×{b_os:g} mm.",
                    "warning",
                    pdf_mm={"altura": alt_pdf, "largura": larg_pdf},
                    os_mm={"altura": alt_os, "largura": larg_os},
                )
            )
    elif formato_os:
        achados.append(
            achado(
                "formato_os_nao_mapeado",
                "Formato × OS",
                f"PDF ≈ {a_pdf:g}×{b_pdf:g} mm; formato da OS ({formato_os}) "
                "não reconhecido para comparação automática.",
                "info",
                pdf_mm={"altura": alt_pdf, "largura": larg_pdf},
            )
        )

    max_dim = max(alt_pdf, larg_pdf)
    min_dim = min(alt_pdf, larg_pdf)
    if max_dim > LIMITE_IMPRESSAO_LARGURA_MM or alt_pdf > LIMITE_IMPRESSAO_ALTURA_MM:
        achados.append(
            achado(
                "limite_impressao",
                "Limites de impressão",
                f"Maior dimensão: {max_dim:g}×{min_dim:g} mm "
                f"(limite referência: {LIMITE_IMPRESSAO_LARGURA_MM:g}×"
                f"{LIMITE_IMPRESSAO_ALTURA_MM:g} mm).",
                "warning",
            )
        )
    else:
        achados.append(
            achado(
                "limite_impressao_ok",
                "Limites de impressão",
                f"Dentro do limite de impressão ({max_dim:g}×{min_dim:g} mm).",
                "ok",
            )
        )

    if max_dim > LIMITE_ACABAMENTO_LARGURA_MM or alt_pdf > LIMITE_ACABAMENTO_ALTURA_MM:
        achados.append(
            achado(
                "limite_acabamento",
                "Limites de acabamento",
                f"Dimensão {max_dim:g}×{min_dim:g} mm excede referência de acabamento "
                f"({LIMITE_ACABAMENTO_LARGURA_MM:g}×{LIMITE_ACABAMENTO_ALTURA_MM:g} mm).",
                "warning",
            )
        )

    padroes = {"A5": (148.0, 210.0), "A4": (210.0, 297.0), "A3": (297.0, 420.0)}
    matched = None
    for nome, (pa, pb) in padroes.items():
        if abs(a_pdf - pa) <= TOLERANCIA_FORMATO_MM and abs(b_pdf - pb) <= TOLERANCIA_FORMATO_MM:
            matched = nome
            break
    if matched:
        achados.append(
            achado(
                "formato_padrao_ok",
                "Formato ISO",
                f"Compatível com {matched} ({a_pdf:g}×{b_pdf:g} mm).",
                "ok",
                iso=matched,
            )
        )
    else:
        achados.append(
            achado(
                "formato_padrao",
                "Formato ISO",
                f"{a_pdf:g}×{b_pdf:g} mm não corresponde a A3, A4 ou A5 "
                f"(tolerância {TOLERANCIA_FORMATO_MM:g} mm).",
                "info",
            )
        )

    return achados


def _achados_lombada_capa(
    files: List[Dict[str, Any]], context: Optional[PreAnaliseContext]
) -> List[Dict[str, Any]]:
    """
    Compara lombada medida no PDF de capa com DescAcabamento da OS
    (ex.: «Lombada de 21mm»), para produtos com capa.
    """
    achados: List[Dict[str, Any]] = []
    ctx = context or PreAnaliseContext(folder_path="", ano=0, os_id=0)
    os_details = ctx.os_details or {}

    if not os_especifica_lombada(os_details):
        return achados

    esperado = lombada_esperada_mm(os_details)
    acab_raw = str(os_details.get("DescAcabamento") or "").strip()

    if esperado is None:
        achados.append(
            achado(
                "lombada_os_sem_medida",
                "Lombada (capa)",
                f"Acabamento da OS menciona lombada, mas a medida não foi reconhecida "
                f'("{acab_raw[:120]}{"…" if len(acab_raw) > 120 else ""}"). '
                f"Informe no padrão «Lombada de 21mm».",
                "warning",
            )
        )
        return achados

    capa_candidates = [
        f
        for f in files
        if not f.get("error")
        and ("capa" in f["name"].lower() or f.get("capa_profiles"))
    ]

    if not capa_candidates:
        achados.append(
            achado(
                "capa_ausente_lombada",
                "Lombada (capa)",
                f"OS exige lombada de {esperado:g} mm, mas nenhum PDF de capa foi "
                "encontrado na pasta (nome com «capa» ou geometria de capa).",
                "warning",
                lombada_os_mm=esperado,
            )
        )
        return achados

    for f in capa_candidates:
        name = f["name"]
        profiles = f.get("capa_profiles") or []
        eh_capa_pelo_nome = "capa" in name.lower()

        if not profiles:
            if eh_capa_pelo_nome:
                achados.append(
                    achado(
                        "lombada_nao_detectada",
                        "Lombada (capa)",
                        f'"{name}": marcas de vinco/corte não permitiram medir a lombada '
                        f"(esperado {esperado:g} mm conforme OS).",
                        "warning",
                        arquivo=name,
                        lombada_os_mm=esperado,
                    )
                )
            continue

        for prof in profiles:
            dados = prof.get("dados") or {}
            lombada_pdf = dados.get("lombada")
            tipo = str(dados.get("tipo") or "Capa")
            pagina = prof.get("page")

            if lombada_pdf is None:
                achados.append(
                    achado(
                        "lombada_ausente",
                        "Lombada (capa)",
                        f'"{name}" pág. {pagina}: lombada não identificada ({tipo}). '
                        f"OS exige {esperado:g} mm.",
                        "warning",
                        arquivo=name,
                        pagina=pagina,
                        lombada_os_mm=esperado,
                        capa_tipo=tipo,
                    )
                )
                continue

            medida = float(lombada_pdf)
            if abs(medida - esperado) > TOLERANCIA_LOMBADA_MM:
                achados.append(
                    achado(
                        "lombada_incompativel",
                        "Lombada (capa)",
                        f'"{name}" pág. {pagina}: lombada medida {medida:g} mm, '
                        f"incompatível com a OS ({esperado:g} mm, tolerância "
                        f"±{TOLERANCIA_LOMBADA_MM:g} mm).",
                        "warning",
                        arquivo=name,
                        pagina=pagina,
                        lombada_pdf_mm=medida,
                        lombada_os_mm=esperado,
                    )
                )
            else:
                achados.append(
                    achado(
                        "lombada_ok",
                        "Lombada (capa)",
                        f'"{name}" pág. {pagina}: lombada {medida:g} mm compatível com a OS '
                        f"({esperado:g} mm).",
                        "ok",
                        arquivo=name,
                        pagina=pagina,
                        lombada_pdf_mm=medida,
                        lombada_os_mm=esperado,
                    )
                )

    return achados


def _anotar_lombada_nas_paginas(
    files: List[Dict[str, Any]], context: Optional[PreAnaliseContext]
) -> None:
    """Marca páginas de capa no relatório `files` quando a lombada diverge da OS."""
    ctx = context or PreAnaliseContext(folder_path="", ano=0, os_id=0)
    esperado = lombada_esperada_mm(ctx.os_details or {})
    if esperado is None:
        return

    for f in files:
        if f.get("error"):
            continue
        pages_by_num = {int(p["page"]): p for p in f.get("pages") or []}
        for prof in f.get("capa_profiles") or []:
            pagina = int(prof.get("page") or 0)
            lombada_pdf = (prof.get("dados") or {}).get("lombada")
            page = pages_by_num.get(pagina)
            if not page or lombada_pdf is None:
                continue
            medida = float(lombada_pdf)
            page["lombada_pdf_mm"] = medida
            page["lombada_os_mm"] = esperado
            if abs(medida - esperado) > TOLERANCIA_LOMBADA_MM:
                page["lombada_alerta"] = True
                page["lombada_mensagem"] = (
                    f"Lombada {medida:g} mm no arquivo; OS exige {esperado:g} mm "
                    f"(tolerância ±{TOLERANCIA_LOMBADA_MM:g} mm)."
                )


def run_formato_check(
    folder_path: str, context: Optional[Any] = None
) -> Dict[str, Any]:
    """Verificação unificada de formato e marcas de corte na pasta da versão."""
    if fitz is None:
        return finalize_result(
            [
                achado(
                    "pymupdf",
                    "Formato",
                    "Biblioteca PyMuPDF não disponível no servidor.",
                    "error",
                )
            ],
            pdf_count=0,
            files=[],
        )

    if not folder_path or not os.path.isdir(folder_path):
        return finalize_result(
            [
                achado(
                    "pasta",
                    "Formato",
                    "Pasta da versão não encontrada ou inacessível.",
                    "error",
                )
            ],
            pdf_count=0,
            files=[],
        )

    pdf_names = _list_pdfs(folder_path)
    if not pdf_names:
        return finalize_result(
            [
                achado(
                    "sem_pdf",
                    "Formato",
                    "Nenhum arquivo PDF encontrado na pasta da versão.",
                    "warning",
                )
            ],
            pdf_count=0,
            files=[],
        )

    detector = FormatDetector()
    from services.pre_analise.pdf_runner import (
        close_docs,
        open_folder_pdfs,
        session_has_open_docs,
    )

    files: List[Dict[str, Any]] = []
    if context is not None and session_has_open_docs(context):
        err, docs = open_folder_pdfs(folder_path, context)
        if err:
            return finalize_result(
                [achado("pymupdf", "Formato", err, "error")],
                pdf_count=0,
                files=[],
            )
        try:
            for path, doc in docs:
                if isinstance(doc, Exception):
                    files.append(
                        {
                            "name": os.path.basename(path),
                            "error": str(doc),
                            "pages": [],
                        }
                    )
                else:
                    files.append(_analyze_pdf_file(path, detector, doc=doc))
        finally:
            close_docs(docs, context)
    else:
        files = [
            _analyze_pdf_file(os.path.join(folder_path, name), detector)
            for name in pdf_names
        ]

    achados = _achados_por_arquivo(files)
    achados.extend(_achados_pasta(files, context))
    achados.extend(_achados_lombada_capa(files, context))
    _anotar_lombada_nas_paginas(files, context)

    errors = [f for f in files if f.get("error")]
    if errors and len(errors) == len(files):
        achados.insert(
            0,
            achado(
                "leitura_pdf",
                "Formato",
                f"{len(errors)} arquivo(s) com erro de leitura.",
                "error",
            ),
        )

    result = finalize_result(achados, pdf_count=len(pdf_names), files=files)

    sem_marcas = [
        f
        for f in files
        if not f.get("error")
        and f.get("pages")
        and all(not p.get("marcas_de_corte") for p in f["pages"])
    ]
    lombada_problemas = [
        a for a in achados if a.get("codigo", "").startswith("lombada_") and a.get("codigo") != "lombada_ok"
    ]

    if result["status"] in ("warning", "error"):
        # finalize_result já montou mensagem a partir dos alertas (lombada, formato×OS, etc.)
        pass
    else:
        parts = [f"{len(pdf_names)} PDF(s) analisado(s)."]
        if sem_marcas:
            parts.append(f"{len(sem_marcas)} sem marcas de corte.")
        if errors:
            parts.append(f"{len(errors)} com erro de leitura.")
        result["mensagem"] = " ".join(parts)

    if errors and len(errors) == len(files):
        result["status"] = "error"
    elif result["status"] == "ok" and (
        sem_marcas
        or lombada_problemas
        or any(a.get("codigo") == "marcas_duplicadas" for a in achados)
    ):
        result["status"] = "warning"

    return result
