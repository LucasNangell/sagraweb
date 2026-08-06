"""
Verificações de pré-análise — faixa "muito fácil".

Scripts independentes; compartilham utilitários de pasta/PDF e contexto da OS.
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional, Tuple

from formato_dimensions import resolve_formato_dimensions
from services.pre_analise.context import PreAnaliseContext
from services.pre_analise.pags_os import (
    expects_capa_miolo_separate,
    is_grampo_canoa,
    parse_pags_field,
)
from services.pre_analise.pdf_utils import (
    classify_pdf_role,
    list_invalid_format_files,
    list_pdfs,
    max_page_dimensions_mm,
    pdf_info,
)
from services.pre_analise.result_helpers import achado, finalize_result

# Limites do manual (mm)
LIMITE_ACABAMENTO_LARGURA_MM = 560.0
LIMITE_ACABAMENTO_ALTURA_MM = 540.0
LIMITE_IMPRESSAO_LARGURA_MM = 750.0
LIMITE_IMPRESSAO_ALTURA_MM = 740.0
TOLERANCIA_FORMATO_MM = 5.0
GRAMPO_CANOA_MAX_PAGINAS_MIOLO = 80
CAPA_PAGES_EXPECTED = 4


def _ctx(context: Optional[PreAnaliseContext]) -> PreAnaliseContext:
    if context is None:
        return PreAnaliseContext(folder_path="", ano=0, os_id=0)
    return context


def _load_pdf_infos(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Tuple[List[str], List[Dict[str, Any]]]:
    if context is not None:
        from services.pre_analise.folder_session import get_pdf_infos

        return get_pdf_infos(context)
    names = list_pdfs(folder_path)
    infos = [pdf_info(os.path.join(folder_path, n)) for n in names]
    return names, infos


def _miolo_page_count(infos: List[Dict[str, Any]]) -> int:
    total = 0
    for info in infos:
        role = classify_pdf_role(info["name"], int(info.get("page_count") or 0))
        if role == "capa":
            continue
        total += int(info.get("page_count") or 0)
    return total


def _capa_page_count(infos: List[Dict[str, Any]]) -> int:
    for info in infos:
        if classify_pdf_role(info["name"], int(info.get("page_count") or 0)) == "capa":
            return int(info.get("page_count") or 0)
    return 0


def run_arquivo_formato_pasta(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """Arquivos .doc/.xls etc. na pasta da versão."""
    _ = context
    invalid = list_invalid_format_files(folder_path)
    pdfs = list_pdfs(folder_path)
    achados: List[Dict[str, Any]] = []

    if invalid:
        achados.append(
            achado(
                "formato_inadequado",
                "Arquivo em formato inadequado",
                f"Foram encontrados {len(invalid)} arquivo(s) que não são PDF: "
                f"{', '.join(invalid[:5])}"
                + ("…" if len(invalid) > 5 else "")
                + ". Encaminhar PDF.",
                "error",
                arquivos=invalid,
            )
        )
    if not pdfs and not invalid:
        achados.append(
            achado(
                "sem_pdf",
                "Nenhum PDF na pasta",
                "Nenhum arquivo PDF encontrado na pasta da versão analisada.",
                "error",
            )
        )
    elif not pdfs:
        pass
    else:
        achados.append(
            achado(
                "formato_pasta_ok",
                "Formatos na pasta",
                f"{len(pdfs)} PDF(s) na pasta; nenhum formato inadequado detectado.",
                "ok",
            )
        )

    if not achados:
        achados.append(
            achado("formato_pasta_ok", "Formatos na pasta", "Pasta verificada.", "ok")
        )

    return finalize_result(achados, pdf_count=len(pdfs))


def run_capa_miolo_arquivos(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """Capa e miolo devem vir em 2 PDFs separados quando o produto exige."""
    ctx = _ctx(context)
    pdfs = list_pdfs(folder_path)
    _, infos = _load_pdf_infos(folder_path, ctx)
    achados: List[Dict[str, Any]] = []

    if not expects_capa_miolo_separate(ctx.os_details):
        achados.append(
            achado(
                "capa_miolo_nao_exigido",
                "Capa e miolo separados",
                "Esta OS não indica encadernação com capa e miolo em arquivos distintos.",
                "info",
            )
        )
        return finalize_result(achados, pdf_count=len(pdfs), files=infos)

    if len(pdfs) == 2:
        roles = [
            classify_pdf_role(i["name"], int(i.get("page_count") or 0)) for i in infos
        ]
        achados.append(
            achado(
                "capa_miolo_ok",
                "Capa e miolo separados",
                "Dois PDFs na pasta, conforme esperado para capa e miolo.",
                "ok",
                arquivos=[i["name"] for i in infos],
                papeis=roles,
            )
        )
    elif len(pdfs) == 1:
        pages = int(infos[0].get("page_count") or 0) if infos else 0
        if pages > CAPA_PAGES_EXPECTED:
            achados.append(
                achado(
                    "capa_miolo_juntos",
                    "Arquivo com capa e miolo juntos",
                    f"Há apenas 1 PDF com {pages} página(s). Para este produto, "
                    "capa e miolo devem ser enviados em 2 arquivos PDF separados.",
                    "error",
                    arquivo=infos[0]["name"] if infos else None,
                    paginas=pages,
                )
            )
        else:
            achados.append(
                achado(
                    "capa_miolo_incompleto",
                    "Capa e miolo separados",
                    f"Apenas 1 PDF ({pages} pág.) — falta o arquivo do miolo ou da capa.",
                    "warning",
                )
            )
    elif len(pdfs) == 0:
        achados.append(
            achado(
                "sem_pdf",
                "Capa e miolo separados",
                "Nenhum PDF na pasta.",
                "error",
            )
        )
    else:
        achados.append(
            achado(
                "capa_miolo_multiplos",
                "Capa e miolo — múltiplos arquivos",
                f"Foram encontrados {len(pdfs)} PDFs. Quando há capa e miolo, "
                "envie exatamente 2 arquivos (um da capa e um do miolo).",
                "error",
                arquivos=pdfs,
            )
        )

    return finalize_result(achados, pdf_count=len(pdfs), files=infos)


def run_arquivo_desmembrado(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """Múltiplos PDFs quando deveria ser um único miolo."""
    ctx = _ctx(context)
    pdfs = list_pdfs(folder_path)
    achados: List[Dict[str, Any]] = []

    if expects_capa_miolo_separate(ctx.os_details):
        if len(pdfs) > 2:
            achados.append(
                achado(
                    "desmembrado",
                    "Arquivo desmembrado",
                    f"{len(pdfs)} PDFs na pasta; o esperado é 2 (capa + miolo).",
                    "error",
                    arquivos=pdfs,
                )
            )
        elif len(pdfs) <= 2:
            achados.append(
                achado(
                    "desmembrado_ok",
                    "Arquivo desmembrado",
                    "Quantidade de arquivos compatível com capa e miolo separados.",
                    "ok",
                )
            )
    else:
        if len(pdfs) > 1:
            achados.append(
                achado(
                    "desmembrado",
                    "Arquivo desmembrado",
                    f"{len(pdfs)} PDFs na pasta; o miolo deve ser um único arquivo "
                    "com todas as páginas na sequência.",
                    "warning",
                    arquivos=pdfs,
                )
            )
        elif len(pdfs) == 1:
            achados.append(
                achado(
                    "desmembrado_ok",
                    "Arquivo desmembrado",
                    "Um único PDF na pasta.",
                    "ok",
                )
            )
        else:
            achados.append(
                achado("sem_pdf", "Arquivo desmembrado", "Nenhum PDF na pasta.", "error")
            )

    return finalize_result(achados, pdf_count=len(pdfs))


def run_multiplo_de_4(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """Páginas do miolo (ou arquivo único) devem ser múltiplo de 4."""
    ctx = _ctx(context)
    _, infos = _load_pdf_infos(folder_path, context)
    achados: List[Dict[str, Any]] = []

    if expects_capa_miolo_separate(ctx.os_details) and len(infos) >= 2:
        miolo_pages = _miolo_page_count(infos)
        label = "miolo"
    else:
        miolo_pages = sum(int(i.get("page_count") or 0) for i in infos)
        label = "arquivo"

    if miolo_pages == 0:
        achados.append(
            achado("multiplo_4_sem_paginas", "Múltiplo de 4", "Não foi possível contar páginas.", "warning")
        )
    elif miolo_pages % 4 == 0:
        achados.append(
            achado(
                "multiplo_4_ok",
                "Múltiplo de 4",
                f"Páginas do {label}: {miolo_pages} (múltiplo de 4).",
                "ok",
                paginas=miolo_pages,
            )
        )
    else:
        resto = miolo_pages % 4
        falta = (4 - resto) if resto else 0
        achados.append(
            achado(
                "multiplo_4",
                "Múltiplo de 4 não atendido",
                f"O {label} tem {miolo_pages} página(s), não múltiplo de 4. "
                f"Incluir ou remover {falta} página(s) (múltiplo de 4 necessário para encadernação).",
                "warning",
                paginas=miolo_pages,
                ajuste_sugerido=falta,
            )
        )

    return finalize_result(achados, pdf_count=len(infos), files=infos)


def run_divergencia_pags_os(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """Compara páginas dos PDFs com o campo Pgs da OS."""
    ctx = _ctx(context)
    _, infos = _load_pdf_infos(folder_path)
    pags = parse_pags_field(ctx.os_details.get("Pags"))
    achados: List[Dict[str, Any]] = []

    folder_total = sum(int(i.get("page_count") or 0) for i in infos if not i.get("error"))
    miolo_pages = _miolo_page_count(infos) if expects_capa_miolo_separate(ctx.os_details) else folder_total
    capa_pages = _capa_page_count(infos)

    declared_total = pags.get("total_declared")
    declared_miolo = pags.get("miolo_declared")

    compare_to = declared_miolo if declared_miolo is not None and expects_capa_miolo_separate(ctx.os_details) else declared_total

    if compare_to is None:
        achados.append(
            achado(
                "pags_os_ausente",
                "Divergência de páginas (OS)",
                f"Pasta: {folder_total} página(s) em PDF; campo Pgs da OS não informado ou ilegível.",
                "info",
                paginas_pasta=folder_total,
            )
        )
    elif expects_capa_miolo_separate(ctx.os_details) and declared_miolo is not None:
        if miolo_pages == declared_miolo:
            achados.append(
                achado(
                    "pags_os_ok",
                    "Divergência de páginas (OS)",
                    f"Miolo: {miolo_pages} pág. no PDF = {declared_miolo} pág. na OS."
                    + (f" Capa: {capa_pages} pág. no PDF." if capa_pages else ""),
                    "ok",
                )
            )
        else:
            achados.append(
                achado(
                    "pags_os",
                    "Divergência de páginas (OS)",
                    f"Miolo no PDF: {miolo_pages} pág.; OS (Pgs): {declared_miolo} pág. de miolo.",
                    "warning",
                    pdf_miolo=miolo_pages,
                    os_miolo=declared_miolo,
                )
            )
    elif folder_total == compare_to:
        achados.append(
            achado(
                "pags_os_ok",
                "Divergência de páginas (OS)",
                f"PDF: {folder_total} pág. = Pgs da OS: {compare_to}.",
                "ok",
            )
        )
    else:
        achados.append(
            achado(
                "pags_os",
                "Divergência de páginas (OS)",
                f"PDF: {folder_total} pág.; Pgs da OS: {compare_to}.",
                "warning",
                pdf_total=folder_total,
                os_pags=compare_to,
            )
        )

    return finalize_result(achados, pdf_count=len(infos), files=infos)


def _imposition_sheet_note(formato_os: str, a_pdf: float, b_pdf: float) -> Optional[str]:
    """
    Chapa de imposição maior que o produto final (ex.: PDF A4, OS A5).
    """
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


def run_divergencia_formato_os(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """Compara dimensões do PDF com FormatoLink da OS."""
    ctx = _ctx(context)
    _, infos = _load_pdf_infos(folder_path)
    formato_os = str(ctx.os_details.get("FormatoLink") or "").strip()
    achados: List[Dict[str, Any]] = []

    dims_os = resolve_formato_dimensions(formato_os)
    dims_pdf = max_page_dimensions_mm(infos)

    if not dims_pdf:
        achados.append(
            achado(
                "formato_os_sem_pdf",
                "Divergência de formato (OS)",
                "Não foi possível medir o formato das páginas do PDF.",
                "warning",
            )
        )
        return finalize_result(achados, pdf_count=len(infos))

    alt_pdf, larg_pdf = dims_pdf
    if not dims_os:
        achados.append(
            achado(
                "formato_os_nao_mapeado",
                "Divergência de formato (OS)",
                f"PDF ≈ {min(alt_pdf, larg_pdf):g}×{max(alt_pdf, larg_pdf):g} mm; "
                f"formato da OS ({formato_os or '—'}) não reconhecido para comparação automática.",
                "info",
                pdf_mm={"altura": alt_pdf, "largura": larg_pdf},
            )
        )
        return finalize_result(achados, pdf_count=len(infos))

    alt_os, larg_os = dims_os
    a_pdf, b_pdf = sorted([alt_pdf, larg_pdf])
    a_os, b_os = sorted([alt_os, larg_os])

    imposition_note = _imposition_sheet_note(formato_os, a_pdf, b_pdf)
    if imposition_note:
        achados.append(
            achado(
                "formato_os_imposicao",
                "Divergência de formato (OS)",
                imposition_note,
                "ok",
                pdf_mm={"altura": alt_pdf, "largura": larg_pdf},
                os_mm={"altura": alt_os, "largura": larg_os},
            )
        )
        return finalize_result(achados, pdf_count=len(infos), files=infos)

    if abs(a_pdf - a_os) <= TOLERANCIA_FORMATO_MM and abs(b_pdf - b_os) <= TOLERANCIA_FORMATO_MM:
        achados.append(
            achado(
                "formato_os_ok",
                "Divergência de formato (OS)",
                f"Formato do PDF compatível com a OS ({formato_os}: "
                f"{min(alt_os, larg_os):g}×{max(alt_os, larg_os):g} mm).",
                "ok",
            )
        )
    else:
        achados.append(
            achado(
                "formato_os",
                "Divergência de formato (OS)",
                f"PDF ≈ {a_pdf:g}×{b_pdf:g} mm; OS ({formato_os}) ≈ {a_os:g}×{b_os:g} mm.",
                "warning",
                pdf_mm={"altura": alt_pdf, "largura": larg_pdf},
                os_mm={"altura": alt_os, "largura": larg_os},
            )
        )

    return finalize_result(achados, pdf_count=len(infos), files=infos)


def run_limites_formato(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """Limites de impressão e acabamento da Gráfica."""
    _ = context
    _, infos = _load_pdf_infos(folder_path)
    achados: List[Dict[str, Any]] = []
    dims = max_page_dimensions_mm(infos)

    if not dims:
        achados.append(
            achado("limites_sem_medida", "Limites de formato", "Sem medição de páginas.", "warning")
        )
        return finalize_result(achados, pdf_count=len(infos))

    alt, larg = dims
    max_dim = max(alt, larg)
    min_dim = min(alt, larg)

    if max_dim > LIMITE_IMPRESSAO_LARGURA_MM or alt > LIMITE_IMPRESSAO_ALTURA_MM:
        achados.append(
            achado(
                "limite_impressao",
                "Formato fora dos limites de impressão",
                f"Maior dimensão detectada: {max_dim:g}×{min_dim:g} mm "
                f"(limite referência impressão: {LIMITE_IMPRESSAO_LARGURA_MM:g}×{LIMITE_IMPRESSAO_ALTURA_MM:g} mm).",
                "warning",
            )
        )
    else:
        achados.append(
            achado(
                "limite_impressao_ok",
                "Limites de impressão",
                f"Dimensões dentro do limite de impressão ({max_dim:g}×{min_dim:g} mm).",
                "ok",
            )
        )

    if max_dim > LIMITE_ACABAMENTO_LARGURA_MM or alt > LIMITE_ACABAMENTO_ALTURA_MM:
        achados.append(
            achado(
                "limite_acabamento",
                "Formato fora dos limites de acabamento",
                f"Dimensão {max_dim:g}×{min_dim:g} mm excede referência de acabamento "
                f"({LIMITE_ACABAMENTO_LARGURA_MM:g}×{LIMITE_ACABAMENTO_ALTURA_MM:g} mm, capa aberta).",
                "warning",
            )
        )

    return finalize_result(achados, pdf_count=len(infos), files=infos)


def run_formato_produto_padrao(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """Verifica se o formato coincide com A3/A4/A5."""
    _ = context
    _, infos = _load_pdf_infos(folder_path)
    achados: List[Dict[str, Any]] = []
    dims = max_page_dimensions_mm(infos)

    if not dims:
        return finalize_result(
            [achado("formato_padrao", "Formato padrão", "Sem medição.", "warning")],
            pdf_count=len(infos),
        )

    alt, larg = dims
    a, b = sorted([alt, larg])
    padroes = {
        "A5": (148.0, 210.0),
        "A4": (210.0, 297.0),
        "A3": (297.0, 420.0),
    }
    matched = None
    for nome, (pa, pb) in padroes.items():
        if abs(a - pa) <= TOLERANCIA_FORMATO_MM and abs(b - pb) <= TOLERANCIA_FORMATO_MM:
            matched = nome
            break

    if matched:
        achados.append(
            achado(
                "formato_padrao_ok",
                "Formato padrão (produto)",
                f"Páginas compatíveis com formato {matched} ({a:g}×{b:g} mm).",
                "ok",
                iso=matched,
            )
        )
    else:
        achados.append(
            achado(
                "formato_padrao",
                "Formato fora do padrão A3/A4/A5",
                f"Dimensão {a:g}×{b:g} mm não corresponde a A3, A4 ou A5 (tolerância {TOLERANCIA_FORMATO_MM:g} mm).",
                "info",
            )
        )

    return finalize_result(achados, pdf_count=len(infos), files=infos)


def run_pdf_protegido(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """PDF bloqueado ou com restrições de edição."""
    _ = context
    _, infos = _load_pdf_infos(folder_path)
    achados: List[Dict[str, Any]] = []

    for info in infos:
        if info.get("error"):
            continue
        if info.get("protected"):
            achados.append(
                achado(
                    "pdf_protegido",
                    "PDF bloqueado ou protegido",
                    f'"{info["name"]}" está criptografado ou protegido contra edição.',
                    "error",
                    arquivo=info["name"],
                )
            )

    if not achados:
        achados.append(
            achado(
                "pdf_protegido_ok",
                "PDF bloqueado ou protegido",
                "Nenhum PDF com proteção detectada.",
                "ok",
            )
        )

    return finalize_result(achados, pdf_count=len(infos), files=infos)


def run_grampo_canoa_paginas(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """Excesso de páginas para grampo canoa."""
    ctx = _ctx(context)
    _, infos = _load_pdf_infos(folder_path)
    achados: List[Dict[str, Any]] = []

    if not is_grampo_canoa(ctx.os_details):
        achados.append(
            achado(
                "grampo_nao_aplica",
                "Grampo canoa — páginas",
                "Acabamento da OS não é grampo canoa.",
                "info",
            )
        )
        return finalize_result(achados, pdf_count=len(infos))

    miolo = _miolo_page_count(infos) if expects_capa_miolo_separate(ctx.os_details) else sum(
        int(i.get("page_count") or 0) for i in infos
    )

    if miolo > GRAMPO_CANOA_MAX_PAGINAS_MIOLO:
        achados.append(
            achado(
                "grampo_canoa_excesso",
                "Páginas em excesso para grampo canoa",
                f"Miolo com {miolo} página(s) (limite referência: {GRAMPO_CANOA_MAX_PAGINAS_MIOLO}).",
                "warning",
                paginas_miolo=miolo,
            )
        )
    else:
        achados.append(
            achado(
                "grampo_canoa_ok",
                "Grampo canoa — páginas",
                f"Miolo com {miolo} página(s), dentro do limite de referência.",
                "ok",
            )
        )

    return finalize_result(achados, pdf_count=len(infos), files=infos)
