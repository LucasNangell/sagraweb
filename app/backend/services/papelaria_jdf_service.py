"""Geração de JDF Apogee para imposição Papelaria (step & repeat)."""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any
from urllib.parse import quote
from xml.sax.saxutils import escape

MM_TO_PT = 72.0 / 25.4

DEFAULT_JDF_IMPORT_ROOT = r"\\apogee\JDFImportRoot\Papelaria"

# NamedFeatures do Hot Ticket / Export TP (Base Attribute Map MIS Export).
_EXPORT_FEATURE = "resultexport ExportPDF_Sefoc"
_ROOT_EXPORT_FEATURE = f"{_EXPORT_FEATURE} resultexport@Export ExportPDF_Sefoc"


def mm_to_pt(mm: float) -> float:
    return float(mm) * MM_TO_PT


def get_jdf_import_root(
    override: str | None = None,
    *,
    produto: str | None = None,
) -> str:
    """
    Hotfolder Apogee.
    Prioridade: override explícito → SAGRA_JDF_IMPORT_ROOT → default por produto.
    """
    explicit = (override or "").strip()
    if explicit:
        return os.path.normpath(explicit)
    env = (os.getenv("SAGRA_JDF_IMPORT_ROOT") or "").strip()
    if env:
        return os.path.normpath(env)
    if produto:
        from services.papelaria_imposicao_juntada_service import (
            default_jdf_import_root,
        )

        return os.path.normpath(default_jdf_import_root(produto))
    return os.path.normpath(DEFAULT_JDF_IMPORT_ROOT)


def _encode_file_url_path(posix_path: str) -> str:
    """Percent-encode segmentos (espaços → %20); preserva / e : (letra de unidade)."""
    return "/".join(quote(seg, safe=":") for seg in posix_path.split("/"))


def path_to_file_url(path: str) -> str:
    """Converte caminho Windows absoluto em file:///… (barra /, espaços %20)."""
    raw = (path or "").strip()
    if not raw:
        raise ValueError("Caminho de arquivo vazio.")
    # Mantém UNC sem forçar abspath local (pode não existir na máquina da API).
    if raw.startswith("\\\\") or raw.startswith("//"):
        rest = raw.lstrip("\\/").replace("\\", "/")
        return f"file://{_encode_file_url_path(rest)}"
    abs_path = os.path.abspath(os.path.normpath(raw))
    if abs_path.startswith("\\\\"):
        rest = abs_path[2:].replace("\\", "/")
        return f"file://{_encode_file_url_path(rest)}"
    drive = abs_path.replace("\\", "/")
    if re.match(r"^[A-Za-z]:/", drive):
        return f"file:///{_encode_file_url_path(drive)}"
    return f"file:///{_encode_file_url_path(drive.lstrip('/'))}"


def resolve_pagina_mm(
    config: dict[str, Any],
    *,
    pdf_width_mm: float | None = None,
    pdf_height_mm: float | None = None,
) -> tuple[float, float]:
    pagina = config.get("pagina") or {}
    origem = pagina.get("origem")
    if origem == "fixixa":
        return float(pagina["largura_mm"]), float(pagina["altura_mm"])
    if pdf_width_mm is None or pdf_height_mm is None:
        raise ValueError(
            "pagina.origem=borda exige dimensões do PDF BaseSefoc."
        )
    return float(pdf_width_mm), float(pdf_height_mm)


def read_pdf_page_size_mm(pdf_path: str) -> tuple[float, float]:
    import fitz  # pymupdf

    doc = fitz.open(pdf_path)
    try:
        if doc.page_count < 1:
            raise ValueError("PDF BaseSefoc sem páginas.")
        rect = doc[0].rect
        return rect.width / MM_TO_PT, rect.height / MM_TO_PT
    finally:
        doc.close()


def read_pdf_trimbox_origin_pt(pdf_path: str) -> tuple[float, float]:
    """
    Origem (x0, y0) da TrimBox da 1ª página, em pt.
    Se o PDF não tiver TrimBox distinta, cai na MediaBox (geralmente 0,0).
    """
    import fitz  # pymupdf

    doc = fitz.open(pdf_path)
    try:
        if doc.page_count < 1:
            return 0.0, 0.0
        tb = doc[0].trimbox
        return float(tb.x0), float(tb.y0)
    finally:
        doc.close()


def format_os_number(nro: int) -> str:
    """Número da OS sempre com 5 dígitos (zero à esquerda)."""
    return f"{int(nro):05d}"


def strip_leading_os_number(text: str, nro: int) -> str:
    """
    Remove um ou mais prefixos do Nr OS no início.
    Aceita com ou sem zero à esquerda e separadores -, _, espaço, —/–.
    Evita 06227-06227-… / "06227 — descrição".
    """
    raw = (text or "").strip()
    if not raw:
        return ""
    num = format_os_number(nro)
    bare = str(int(nro))
    return re.sub(
        rf"^(({re.escape(num)}|{re.escape(bare)})([-\s_—–:]+))+",
        "",
        raw,
        flags=re.IGNORECASE,
    ).strip("-_ \t—–:")


def ensure_os_prefixed_name(text: str, nro: int) -> str:
    """Garante um único prefixo NNNNN- no nome (colapsa duplicatas)."""
    num = format_os_number(nro)
    rest = strip_leading_os_number(text, nro)
    if not rest:
        return num
    return f"{num}-{rest}"


def build_jdf_filename(*, ano: int, nro: int, folder_basename: str) -> str:
    """
    Ex.: 2026_06227_AirtonFaleiro-BlocoA5_2x1.jdf

    O número da OS entra uma vez (após o ano). O basename da pasta/OS
    é limpo de prefixos '{nro}-' repetidos antes de compor o nome.
    """
    num = format_os_number(nro)
    rest = strip_leading_os_number(folder_basename, nro)
    safe = re.sub(r"[^\w\-]+", "_", rest, flags=re.UNICODE).strip("_")
    if safe:
        return f"{int(ano)}_{num}_{safe}.jdf"
    return f"{int(ano)}_{num}.jdf"


def compute_cell_origin_mm(
    *,
    folha_w_mm: float,
    folha_h_mm: float,
    page_w_mm: float,
    page_h_mm: float,
    cols: int,
    rows: int,
    gap_h_mm: float,
    gap_v_mm: float,
    centralizar: bool,
    col: int,
    row: int,
) -> tuple[float, float]:
    """Canto inferior-esquerdo (mm) de uma célula da grade (origem PDF)."""
    total_w = cols * page_w_mm + max(0, cols - 1) * gap_h_mm
    total_h = rows * page_h_mm + max(0, rows - 1) * gap_v_mm
    if centralizar:
        origin_x = max(0.0, (folha_w_mm - total_w) / 2.0)
        origin_y = max(0.0, (folha_h_mm - total_h) / 2.0)
    else:
        origin_x = 0.0
        origin_y = max(0.0, folha_h_mm - total_h)
    x = origin_x + col * (page_w_mm + gap_h_mm)
    # linhas de cima para baixo na folha (y cresce para cima no JDF)
    y = origin_y + (rows - 1 - row) * (page_h_mm + gap_v_mm)
    return (x, y)


def compute_content_positions(
    *,
    folha_w_mm: float,
    folha_h_mm: float,
    page_w_mm: float,
    page_h_mm: float,
    cols: int,
    rows: int,
    gap_h_mm: float,
    gap_v_mm: float,
    centralizar: bool,
    ocupadas: list[dict[str, int]] | None = None,
) -> list[tuple[float, float, int, int]]:
    """
    Retorna lista (x_mm, y_mm, pagina, rotacao) canto inferior-esquerdo.

    Se ``ocupadas`` for None, preenche a grade inteira (linha-major).
    Caso contrário, emite só as células informadas, ordenadas por ``pagina``.
    ``pagina`` é 1-based (índice da página no PDF).
    ``rotacao`` em graus (0/90/180/270, anti-horário).
    """
    if ocupadas is None:
        cells = [
            {"col": col, "row": row, "pagina": 1, "rotacao": 0}
            for row in range(rows)
            for col in range(cols)
        ]
    else:
        cells = sorted(
            ocupadas,
            key=lambda item: (
                int(item.get("pagina") or 0),
                int(item.get("row") or 0),
                int(item.get("col") or 0),
            ),
        )

    positions: list[tuple[float, float, int, int]] = []
    for cell in cells:
        col = int(cell["col"])
        row = int(cell["row"])
        pagina = max(1, int(cell.get("pagina") or 1))
        rotacao = int(cell.get("rotacao") or 0) % 360
        if rotacao not in (0, 90, 180, 270):
            rotacao = 0
        # Posição absoluta (Pasta/Timbrado marcas) tem prioridade sobre a grade.
        if cell.get("x_mm") is not None and cell.get("y_mm") is not None:
            x_mm = float(cell["x_mm"])
            y_mm = float(cell["y_mm"])
        else:
            x_mm, y_mm = compute_cell_origin_mm(
                folha_w_mm=folha_w_mm,
                folha_h_mm=folha_h_mm,
                page_w_mm=page_w_mm,
                page_h_mm=page_h_mm,
                cols=cols,
                rows=rows,
                gap_h_mm=gap_h_mm,
                gap_v_mm=gap_v_mm,
                centralizar=centralizar,
                col=col,
                row=row,
            )
        positions.append((x_mm, y_mm, pagina, rotacao))
    return positions


def content_ctm_and_trim(
    *,
    x_pt: float,
    y_pt: float,
    page_w_pt: float,
    page_h_pt: float,
    rotacao: int,
) -> tuple[str, float, float]:
    """
    CTM + TrimSize para ContentObject com rotação anti-horária.
    Retorna (ctm_str, trim_w, trim_h).
    """
    rot = int(rotacao) % 360
    if rot == 90:
        # 0 1 -1 0 ; origem (x+h, y)
        return (
            f"0 1 -1 0 {x_pt + page_h_pt:.3f} {y_pt:.3f}",
            page_h_pt,
            page_w_pt,
        )
    if rot == 180:
        return (
            f"-1 0 0 -1 {x_pt + page_w_pt:.3f} {y_pt + page_h_pt:.3f}",
            page_w_pt,
            page_h_pt,
        )
    if rot == 270:
        return (
            f"0 -1 1 0 {x_pt:.3f} {y_pt + page_w_pt:.3f}",
            page_h_pt,
            page_w_pt,
        )
    return f"1 0 0 1 {x_pt:.3f} {y_pt:.3f}", page_w_pt, page_h_pt


def _content_objects_xml(
    *,
    positions: list[tuple[float, float, int, int]] | list[tuple[float, float, int]],
    page_w_pt: float,
    page_h_pt: float,
    folha_w_pt: float,
    folha_h_pt: float,
    marcas_corte: bool,
    marcas_pdf_path: str,
    marcas_ord: int,
) -> str:
    """Monta ContentObject(s) de uma Surface; Ord = pagina-1 do PDF."""
    parts: list[str] = []
    for pos in positions:
        if len(pos) >= 4:
            x_mm, y_mm, pagina, rotacao = pos[0], pos[1], pos[2], pos[3]
        else:
            x_mm, y_mm, pagina = pos[0], pos[1], pos[2]
            rotacao = 0
        x_pt = mm_to_pt(x_mm)
        y_pt = mm_to_pt(y_mm)
        ord_idx = max(0, int(pagina) - 1)
        ctm, trim_w, trim_h = content_ctm_and_trim(
            x_pt=x_pt,
            y_pt=y_pt,
            page_w_pt=page_w_pt,
            page_h_pt=page_h_pt,
            rotacao=int(rotacao or 0),
        )
        # ClipBox = footprint na folha (após rotação TrimSize troca w/h).
        clip_x1 = x_pt + trim_w
        clip_y1 = y_pt + trim_h
        parts.append(
            f'              <ContentObject Ord="{ord_idx}"\n'
            f'                             CTM="{ctm}" '
            f'TrimCTM="{ctm}"\n'
            f'                             TrimSize="{trim_w:.3f} {trim_h:.3f}"\n'
            f'                             ClipBox="{x_pt:.3f} {y_pt:.3f} '
            f'{clip_x1:.3f} {clip_y1:.3f}"/>'
        )
    if marcas_corte:
        trim_x, trim_y = _marcas_trim_origin_pt(marcas_pdf_path)
        parts.append(
            f'              <ContentObject Ord="{marcas_ord}" '
            'CTM="1 0 0 1 0 0" '
            f'TrimCTM="1 0 0 1 {trim_x:.3f} {trim_y:.3f}"\n'
            f'                             ClipBox="0 0 {folha_w_pt:.3f} {folha_h_pt:.3f}"/>'
        )
    return "\n".join(parts)


def _export_filename_stem(export_filename: str) -> str:
    """GeneralID ExportFileName: sem extensão (.pdf)."""
    name = (export_filename or "").strip()
    if name.lower().endswith(".pdf"):
        return name[:-4]
    return name


def _named_features(*, root: bool) -> str:
    """
    Sempre inclui JDFNoMarks: marcas vêm do PDF como ContentObject (Ord=1),
    não das marcas automáticas do Apogee / MarkObject.
    """
    export = _ROOT_EXPORT_FEATURE if root else _EXPORT_FEATURE
    return f"Imposition JDFNoMarks {export}"


def _marcas_trim_origin_pt(marcas_pdf_path: str) -> tuple[float, float]:
    """Lê TrimBox do PDF de marcas; se falhar, (0, 0)."""
    try:
        return read_pdf_trimbox_origin_pt(marcas_pdf_path)
    except Exception:
        return 0.0, 0.0


def build_apogee_jdf_xml(
    *,
    ano: int,
    nro: int,
    descriptive_name: str,
    comment: str,
    export_folder: str,
    export_filename: str,
    base_pdf_path: str,
    base_pdf_user_name: str,
    config: dict[str, Any],
    page_w_mm: float,
    page_h_mm: float,
    agent_version: str = "1.0",
    timestamp: datetime | None = None,
) -> str:
    """
    Monta XML JDF no padrão Apogee (Product + PrePress step&repeat).

    Base Attribute Map "MIS Export" (raiz):
      Order Number     -> @JobID
      Job Name         -> @DescriptiveName
      Job Description  -> GeneralID[@IDUsage='JobDescription']
      Order Description-> GeneralID[@IDUsage='ExportFolder']
      (+ ExportFileName via GeneralID)

    Marcas de corte: PDF entra como 2ª página do RunList Document e
    ContentObject Ord=1 (não MarkObject), para o Apogee não expandir a MediaBox.
    """
    folha = config["folha_mm"]
    folha_w = float(folha["largura"])
    folha_h = float(folha["altura"])
    grid = config["grid"]
    cols = int(grid["colunas"])
    rows = int(grid["linhas"])
    gap_h = float((config.get("espacamento_mm") or {}).get("horizontal") or 0)
    gap_v = float((config.get("espacamento_mm") or {}).get("vertical") or 0)
    centralizar = bool(config.get("centralizar_na_folha", True))
    work_style = str(config.get("work_style") or "Simplex")
    marcas_corte = bool(config.get("marcas_corte", False))
    marcas_pdf_path = str(config.get("marcas_pdf_path") or "").strip()
    if marcas_corte and not marcas_pdf_path:
        raise ValueError(
            "Com marcas de corte ativas, informe o caminho do PDF de marcas."
        )

    nro5 = format_os_number(nro)
    # Job Name / JobPartID: sempre 5 dígitos (ex.: 06227).
    job_name = nro5
    root_id = f"ROOT_{nro5}"
    ts = timestamp or datetime.now(timezone(timedelta(hours=-3)))
    ts_str = ts.strftime("%Y-%m-%dT%H:%M:%S%z")
    if len(ts_str) >= 5 and ts_str[-5] in "+-":
        ts_str = f"{ts_str[:-2]}:{ts_str[-2:]}"

    folha_w_pt = mm_to_pt(folha_w)
    folha_h_pt = mm_to_pt(folha_h)
    page_w_pt = mm_to_pt(page_w_mm)
    page_h_pt = mm_to_pt(page_h_mm)

    from services.papelaria_imposicao_config_service import resolve_grid_ocupadas

    grid_dict = grid if isinstance(grid, dict) else {}
    ocupadas_frente = resolve_grid_ocupadas(grid_dict, face="frente")
    positions_frente = compute_content_positions(
        folha_w_mm=folha_w,
        folha_h_mm=folha_h,
        page_w_mm=page_w_mm,
        page_h_mm=page_h_mm,
        cols=cols,
        rows=rows,
        gap_h_mm=gap_h,
        gap_v_mm=gap_v,
        centralizar=centralizar,
        ocupadas=ocupadas_frente,
    )

    is_duplex = work_style == "Duplex"
    positions_verso: list[tuple[float, float, int]] = []
    if is_duplex:
        ocupadas_verso = resolve_grid_ocupadas(grid_dict, face="verso")
        positions_verso = compute_content_positions(
            folha_w_mm=folha_w,
            folha_h_mm=folha_h,
            page_w_mm=page_w_mm,
            page_h_mm=page_h_mm,
            cols=cols,
            rows=rows,
            gap_h_mm=gap_h,
            gap_v_mm=gap_v,
            centralizar=centralizar,
            ocupadas=ocupadas_verso,
        )

    max_pagina = 1
    for pos in positions_frente + positions_verso:
        pagina = int(pos[2])
        if pagina > max_pagina:
            max_pagina = pagina
    # Ord das marcas vem depois das páginas do PDF base (0..max_pagina-1).
    marcas_ord = max_pagina if marcas_corte else max_pagina

    contents_front = _content_objects_xml(
        positions=positions_frente,
        page_w_pt=page_w_pt,
        page_h_pt=page_h_pt,
        folha_w_pt=folha_w_pt,
        folha_h_pt=folha_h_pt,
        marcas_corte=marcas_corte,
        marcas_pdf_path=marcas_pdf_path,
        marcas_ord=marcas_ord,
    )
    contents_back = ""
    if is_duplex:
        contents_back = _content_objects_xml(
            positions=positions_verso,
            page_w_pt=page_w_pt,
            page_h_pt=page_h_pt,
            folha_w_pt=folha_w_pt,
            folha_h_pt=folha_h_pt,
            # Marcas só na frente (mesmo PDF de marcas na folha).
            marcas_corte=False,
            marcas_pdf_path="",
            marcas_ord=marcas_ord,
        )

    file_url = escape(path_to_file_url(base_pdf_path))
    export_folder_esc = escape(export_folder.replace("/", "\\"))
    # Job Name (DescriptiveName) já é NNNNN. JobDescription e ExportFileName
    # NÃO repetem o Nr OS nem o sufixo "Imposição" (o Apogee acrescenta).
    job_desc = strip_leading_os_number(descriptive_name, nro) or "Papelaria"
    export_stem = strip_leading_os_number(
        _export_filename_stem(export_filename),
        nro,
    ) or job_desc
    # Remove sufixo legado "_Imposição" / "-Imposição" se ainda vier no input.
    export_stem = re.sub(
        r"([_-]?Imposi[cç][aã]o)$",
        "",
        export_stem,
        flags=re.IGNORECASE,
    ).rstrip("_- ") or job_desc
    # Comment também sem Nr OS no início (alguns mapas usam como descrição).
    comment_clean = strip_leading_os_number(comment, nro) or comment
    job_desc_esc = escape(job_desc)
    export_stem_esc = escape(export_stem)
    comment_esc = escape(comment_clean)
    # UserFileName do PDF base: sem Nr OS (evita eco no nome do job).
    user_name_esc = escape(
        strip_leading_os_number(base_pdf_user_name, nro) or base_pdf_user_name
    )
    job_id = str(int(ano))
    job_part = nro5
    root_features = escape(_named_features(root=True))
    imp_features = escape(_named_features(root=False))

    if marcas_corte:
        marcas_url = escape(path_to_file_url(marcas_pdf_path))
        marcas_user = escape(
            os.path.splitext(os.path.basename(marcas_pdf_path.replace("/", "\\")))[0]
        )
        if max_pagina <= 1:
            # Compat: 1 página de arte + marcas (Ord 0 / Ord 1).
            document_runlist_xml = f"""      <RunList Class="Parameter" ID="RL_{nro5}" Status="Available" PartIDKeys="Run" NPage="2">
        <RunList Run="Arte" Pages="0">
          <LayoutElement>
            <FileSpec URL="{file_url}"
                      MimeType="application/pdf" FileVersion="1"
                      UserFileName="{user_name_esc}"/>
          </LayoutElement>
        </RunList>
        <RunList Run="Marcas" Pages="0">
          <LayoutElement>
            <FileSpec URL="{marcas_url}"
                      MimeType="application/pdf" FileVersion="1"
                      UserFileName="{marcas_user}"/>
          </LayoutElement>
        </RunList>
      </RunList>"""
        else:
            # Uma Run por página do PDF base (Pages=i) + Run de marcas.
            arte_runs: list[str] = []
            for page_idx in range(max_pagina):
                arte_runs.append(
                    f"""        <RunList Run="Arte{page_idx + 1}" Pages="{page_idx}">
          <LayoutElement>
            <FileSpec URL="{file_url}"
                      MimeType="application/pdf" FileVersion="1"
                      UserFileName="{user_name_esc}"/>
          </LayoutElement>
        </RunList>"""
                )
            n_page_total = max_pagina + 1
            document_runlist_xml = f"""      <RunList Class="Parameter" ID="RL_{nro5}" Status="Available" PartIDKeys="Run" NPage="{n_page_total}">
{chr(10).join(arte_runs)}
        <RunList Run="Marcas" Pages="0">
          <LayoutElement>
            <FileSpec URL="{marcas_url}"
                      MimeType="application/pdf" FileVersion="1"
                      UserFileName="{marcas_user}"/>
          </LayoutElement>
        </RunList>
      </RunList>"""
    else:
        document_runlist_xml = f"""      <RunList Class="Parameter" ID="RL_{nro5}" Status="Available" NPage="{max_pagina}">
        <LayoutElement>
          <FileSpec URL="{file_url}"
                    MimeType="application/pdf" FileVersion="1"
                    UserFileName="{user_name_esc}"/>
        </LayoutElement>
      </RunList>"""

    back_surface_xml = ""
    if is_duplex:
        back_surface_xml = f"""
            <Surface Side="Back" SurfaceContentsBox="0 0 {folha_w_pt:.3f} {folha_h_pt:.3f}">
{contents_back}
            </Surface>"""

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<JDF xmlns="http://www.CIP4.org/JDFSchema_1_1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     ID="{root_id}" Type="Product" Version="1.4" Status="Waiting"
     JobID="{escape(job_id)}" JobPartID="{job_part}" DescriptiveName="{escape(job_name)}"
     NamedFeatures="{root_features}">

  <GeneralID DataType="string" IDUsage="JobDescription" IDValue="{job_desc_esc}"/>
  <GeneralID DataType="string" IDUsage="ExportFolder"   IDValue="{export_folder_esc}"/>
  <GeneralID DataType="string" IDUsage="ExportFileName" IDValue="{export_stem_esc}"/>

  <Comment Name="JobDescription">{comment_esc}</Comment>

  <AuditPool>
    <Created Author="MIS" AgentName="SagraWEB" AgentVersion="{escape(agent_version)}" TimeStamp="{ts_str}"/>
  </AuditPool>

  <ResourcePool>
    <ColorantControl Class="Parameter" ID="CC_{nro5}" Status="Available" ProcessColorModel="DeviceCMYK">
      <ColorPool>
        <Color Name="Cyan"    CMYK="1 0 0 0" ColorType="Normal"/>
        <Color Name="Magenta" CMYK="0 1 0 0" ColorType="Normal"/>
        <Color Name="Yellow"  CMYK="0 0 1 0" ColorType="Normal"/>
        <Color Name="Black"   CMYK="0 0 0 1" ColorType="Normal"/>
      </ColorPool>
      <ColorantParams>
        <SeparationSpec Name="Cyan"/>
        <SeparationSpec Name="Magenta"/>
        <SeparationSpec Name="Yellow"/>
        <SeparationSpec Name="Black"/>
      </ColorantParams>
    </ColorantControl>

    <Media Class="Consumable" ID="PAP_{nro5}" MediaType="Paper" Status="Available"
           DescriptiveName="Folha imposicao" Dimension="{folha_w_pt:.3f} {folha_h_pt:.3f}"/>

    <Component ID="COMP_{nro5}" Class="Quantity" ComponentType="FinalProduct" Status="Unavailable"/>
  </ResourcePool>

  <ResourceLinkPool>
    <ComponentLink rRef="COMP_{nro5}" Usage="Output"/>
  </ResourceLinkPool>

  <JDF ID="PRE_{nro5}" JobPartID="PRE_{nro5}" Type="ProcessGroup" Category="PrePress"
       Status="Waiting" DescriptiveName="PrePress">

    <ResourcePool>
{document_runlist_xml}
      <RunList Class="Parameter" ID="RL_{nro5}_D" Status="Unavailable"/>
      <Layout Class="Parameter" ID="LAY_{nro5}" Status="Available" Automated="false">
        <Signature Name="SIG1">
          <Sheet Name="SHT1" SourceWorkStyle="{escape(work_style)}">
            <MediaRef rRef="PAP_{nro5}"/>
            <Surface Side="Front" SurfaceContentsBox="0 0 {folha_w_pt:.3f} {folha_h_pt:.3f}">
{contents_front}
            </Surface>{back_surface_xml}
          </Sheet>
        </Signature>
      </Layout>
    </ResourcePool>

    <JDF ID="PPP_{nro5}" JobPartID="PPP_{nro5}" Type="ProcessGroup" Types="PrePressPreparation"
         Category="MISPRE.PrePressPreparation" Status="Waiting" DescriptiveName="GB PrePressPreparation">
      <ResourceLinkPool>
        <RunListLink rRef="RL_{nro5}"   ProcessUsage="Document" Usage="Input"/>
        <RunListLink rRef="RL_{nro5}_D" ProcessUsage="Document" Usage="Output"/>
      </ResourceLinkPool>
    </JDF>

    <JDF ID="STR_{nro5}" JobPartID="STR_{nro5}" Type="ProcessGroup" Types="ImpositionPreparation"
         Category="MISPRE.ImpositionPreparation" Status="Waiting" DescriptiveName="GB ImpositionPreparation">
      <ResourceLinkPool>
        <LayoutLink rRef="LAY_{nro5}" Usage="Output"/>
      </ResourceLinkPool>
    </JDF>

    <JDF ID="IMP_{nro5}" JobPartID="IMP_{nro5}" Type="ProcessGroup"
         Types="Imposition DigitalDelivery ProofImaging"
         Category="MISPRE.ImpositionProofing" Status="Waiting" DescriptiveName="GB Export PDF Imposto"
         NamedFeatures="{imp_features}">
      <ResourceLinkPool>
        <RunListLink rRef="RL_{nro5}_D" ProcessUsage="Document" Usage="Input"/>
        <LayoutLink rRef="LAY_{nro5}" Usage="Input"/>
        <ColorantControlLink rRef="CC_{nro5}" Usage="Input"/>
        <MediaLink rRef="PAP_{nro5}" Usage="Input"/>
      </ResourceLinkPool>
    </JDF>
  </JDF>
</JDF>
"""
    return xml


def read_pdf_page_count(pdf_path: str) -> int:
    import fitz  # pymupdf

    doc = fitz.open(pdf_path)
    try:
        return int(doc.page_count)
    finally:
        doc.close()


def build_apogee_passthrough_jdf_xml(
    *,
    ano: int,
    nro: int,
    descriptive_name: str,
    comment: str,
    export_folder: str,
    export_filename: str,
    base_pdf_path: str,
    base_pdf_user_name: str,
    page_w_mm: float,
    page_h_mm: float,
    n_pages: int,
    agent_version: str = "1.0",
    timestamp: datetime | None = None,
) -> str:
    """
    Ticket Apogee para Hot Ticket com «Apogee Impose».

    Declara NamedFeatures Imposition (evita imposição indefinida), mas não
    envia Layout/ImpositionPreparation/ContentObjects — o template fica no
    Hot Ticket. Só o .jdf vai ao hotfolder; FileSpec aponta o PDF na Sefoc.
    """
    nro5 = format_os_number(nro)
    job_name = nro5
    root_id = f"ROOT_{nro5}"
    ts = timestamp or datetime.now(timezone(timedelta(hours=-3)))
    ts_str = ts.strftime("%Y-%m-%dT%H:%M:%S%z")
    if len(ts_str) >= 5 and ts_str[-5] in "+-":
        ts_str = f"{ts_str[:-2]}:{ts_str[-2:]}"

    page_w_pt = mm_to_pt(page_w_mm)
    page_h_pt = mm_to_pt(page_h_mm)
    n_page = max(1, int(n_pages))

    file_url = escape(path_to_file_url(base_pdf_path))
    export_folder_esc = escape(export_folder.replace("/", "\\"))
    job_desc = strip_leading_os_number(descriptive_name, nro) or "Papelaria"
    export_stem = strip_leading_os_number(
        _export_filename_stem(export_filename),
        nro,
    ) or job_desc
    export_stem = re.sub(
        r"([_-]?Imposi[cç][aã]o)$",
        "",
        export_stem,
        flags=re.IGNORECASE,
    ).rstrip("_- ") or job_desc
    comment_clean = strip_leading_os_number(comment, nro) or comment
    job_desc_esc = escape(job_desc)
    export_stem_esc = escape(export_stem)
    comment_esc = escape(comment_clean)
    user_name_esc = escape(
        strip_leading_os_number(base_pdf_user_name, nro) or base_pdf_user_name
    )
    job_id = str(int(ano))
    job_part = nro5
    # Declara Imposition para o Hot Ticket aplicar «Apogee Impose».
    # Sem Layout/ImpositionPreparation no JDF (template fica no Hot Ticket).
    root_features = escape(_named_features(root=True))
    export_features = escape(_named_features(root=False))

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<JDF xmlns="http://www.CIP4.org/JDFSchema_1_1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     ID="{root_id}" Type="Product" Version="1.4" Status="Waiting"
     JobID="{escape(job_id)}" JobPartID="{job_part}" DescriptiveName="{escape(job_name)}"
     NamedFeatures="{root_features}">

  <GeneralID DataType="string" IDUsage="JobDescription" IDValue="{job_desc_esc}"/>
  <GeneralID DataType="string" IDUsage="ExportFolder"   IDValue="{export_folder_esc}"/>
  <GeneralID DataType="string" IDUsage="ExportFileName" IDValue="{export_stem_esc}"/>

  <Comment Name="JobDescription">{comment_esc}</Comment>

  <AuditPool>
    <Created Author="MIS" AgentName="SagraWEB" AgentVersion="{escape(agent_version)}" TimeStamp="{ts_str}"/>
  </AuditPool>

  <ResourcePool>
    <ColorantControl Class="Parameter" ID="CC_{nro5}" Status="Available" ProcessColorModel="DeviceCMYK">
      <ColorPool>
        <Color Name="Cyan"    CMYK="1 0 0 0" ColorType="Normal"/>
        <Color Name="Magenta" CMYK="0 1 0 0" ColorType="Normal"/>
        <Color Name="Yellow"  CMYK="0 0 1 0" ColorType="Normal"/>
        <Color Name="Black"   CMYK="0 0 0 1" ColorType="Normal"/>
      </ColorPool>
      <ColorantParams>
        <SeparationSpec Name="Cyan"/>
        <SeparationSpec Name="Magenta"/>
        <SeparationSpec Name="Yellow"/>
        <SeparationSpec Name="Black"/>
      </ColorantParams>
    </ColorantControl>

    <Media Class="Consumable" ID="PAP_{nro5}" MediaType="Paper" Status="Available"
           DescriptiveName="Pagina arte" Dimension="{page_w_pt:.3f} {page_h_pt:.3f}"/>

    <Component ID="COMP_{nro5}" Class="Quantity" ComponentType="FinalProduct" Status="Unavailable"/>

    <RunList Class="Parameter" ID="RL_{nro5}" Status="Available" NPage="{n_page}">
      <LayoutElement>
        <FileSpec URL="{file_url}"
                  MimeType="application/pdf" FileVersion="1"
                  UserFileName="{user_name_esc}"/>
      </LayoutElement>
    </RunList>
    <RunList Class="Parameter" ID="RL_{nro5}_D" Status="Unavailable"/>
  </ResourcePool>

  <ResourceLinkPool>
    <ComponentLink rRef="COMP_{nro5}" Usage="Output"/>
  </ResourceLinkPool>

  <JDF ID="PRE_{nro5}" JobPartID="PRE_{nro5}" Type="ProcessGroup" Category="PrePress"
       Status="Waiting" DescriptiveName="PrePress">

    <JDF ID="PPP_{nro5}" JobPartID="PPP_{nro5}" Type="ProcessGroup" Types="PrePressPreparation"
         Category="MISPRE.PrePressPreparation" Status="Waiting" DescriptiveName="GB PrePressPreparation">
      <ResourceLinkPool>
        <RunListLink rRef="RL_{nro5}"   ProcessUsage="Document" Usage="Input"/>
        <RunListLink rRef="RL_{nro5}_D" ProcessUsage="Document" Usage="Output"/>
      </ResourceLinkPool>
    </JDF>

    <JDF ID="EXP_{nro5}" JobPartID="EXP_{nro5}" Type="ProcessGroup"
         Types="Imposition DigitalDelivery ProofImaging"
         Category="MISPRE.ImpositionProofing" Status="Waiting" DescriptiveName="GB Export PDF"
         NamedFeatures="{export_features}">
      <ResourceLinkPool>
        <RunListLink rRef="RL_{nro5}_D" ProcessUsage="Document" Usage="Input"/>
        <ColorantControlLink rRef="CC_{nro5}" Usage="Input"/>
        <MediaLink rRef="PAP_{nro5}" Usage="Input"/>
      </ResourceLinkPool>
    </JDF>
  </JDF>
</JDF>
"""


MARCAS_OP_PLACEHOLDER = "0000-0000-0000-0000_SM74"


def format_marcas_op_token(nros: list[int]) -> str:
    """NUMOP1-NUMOP2-…-NUMOPN_SM74 (números com 5 dígitos)."""
    parts = [format_os_number(int(n)) for n in nros if int(n) > 0]
    if not parts:
        raise ValueError("Nenhuma OP para o PDF de marcas.")
    return f"{'-'.join(parts)}_SM74"


def prepare_marcas_pdf_with_ops(
    *,
    source_pdf_path: str,
    output_pdf_path: str,
    nros: list[int],
    placeholder: str = MARCAS_OP_PLACEHOLDER,
) -> str:
    """
    Copia o PDF de marcas e substitui o placeholder TxtOPs pelo token das OPs.
    Retorna o caminho absoluto do PDF gerado.
    """
    import fitz  # pymupdf

    src = os.path.normpath((source_pdf_path or "").strip())
    if not src or not os.path.isfile(src):
        raise FileNotFoundError(f"PDF de marcas não encontrado: {src or '(vazio)'}")
    token = format_marcas_op_token(nros)
    dest = os.path.normpath(output_pdf_path)
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)

    doc = fitz.open(src)
    try:
        replaced = 0
        for page in doc:
            hits = page.search_for(placeholder)
            if not hits:
                continue
            # Tamanho de fonte aproximado a partir do texto da página.
            fontsize = 16.0
            for block in page.get_text("dict").get("blocks", []):
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        if placeholder in (span.get("text") or ""):
                            fontsize = float(span.get("size") or fontsize)
                            break
            for rect in hits:
                page.add_redact_annot(
                    rect,
                    text=token,
                    fontsize=fontsize,
                    fontname="helv",
                    align=fitz.TEXT_ALIGN_LEFT,
                    fill=(1, 1, 1),
                    text_color=(0, 0, 0),
                )
                replaced += 1
            page.apply_redactions()
        if replaced < 1:
            raise ValueError(
                f"Placeholder {placeholder!r} não encontrado no PDF de marcas."
            )
        doc.save(dest, deflate=True, garbage=3)
    finally:
        doc.close()
    if not os.path.isfile(dest):
        raise RuntimeError(f"PDF de marcas com OP não persistiu: {dest}")
    return dest


def write_jdf_file(jdf_xml: str, output_dir: str, filename: str) -> str:
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.normpath(os.path.join(output_dir, filename))
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(jdf_xml)
    return path
