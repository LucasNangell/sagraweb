"""Geração de JDF Apogee para imposição Papelaria (step & repeat)."""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any
from xml.sax.saxutils import escape

MM_TO_PT = 72.0 / 25.4

DEFAULT_JDF_IMPORT_ROOT = r"\\apogee\JDFImportRoot\Papelaria"


def mm_to_pt(mm: float) -> float:
    return float(mm) * MM_TO_PT


def get_jdf_import_root() -> str:
    raw = (os.getenv("SAGRA_JDF_IMPORT_ROOT") or "").strip()
    return os.path.normpath(raw or DEFAULT_JDF_IMPORT_ROOT)


def path_to_file_url(path: str) -> str:
    """Converte caminho Windows absoluto em file:///… (barra /)."""
    abs_path = os.path.abspath(os.path.normpath(path))
    # UNC \\server\share\… → file://server/share/…
    if abs_path.startswith("\\\\"):
        rest = abs_path[2:].replace("\\", "/")
        return f"file://{rest}"
    # C:\foo → file:///C:/foo
    drive = abs_path.replace("\\", "/")
    if re.match(r"^[A-Za-z]:/", drive):
        return f"file:///{drive}"
    return f"file:///{drive.lstrip('/')}"


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


def strip_leading_os_number(text: str, nro: int) -> str:
    """Remove um ou mais prefixos '{nro:05d}-' do início (evita 06227-06227-…)."""
    num = f"{int(nro):05d}"
    return re.sub(rf"^({re.escape(num)}-)+", "", (text or "").strip())


def build_jdf_filename(*, ano: int, nro: int, folder_basename: str) -> str:
    """
    Ex.: 2026_06227_AirtonFaleiro-BlocoA5_2x1.jdf

    O número da OS entra uma vez (após o ano). O basename da pasta/OS
    é limpo de prefixos '{nro}-' repetidos antes de compor o nome.
    """
    num = f"{int(nro):05d}"
    rest = strip_leading_os_number(folder_basename, nro)
    safe = re.sub(r"[^\w\-]+", "_", rest, flags=re.UNICODE).strip("_")
    if safe:
        return f"{int(ano)}_{num}_{safe}.jdf"
    return f"{int(ano)}_{num}.jdf"


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
) -> list[tuple[float, float]]:
    """Retorna lista (x_mm, y_mm) canto inferior-esquerdo de cada célula (origem PDF)."""
    total_w = cols * page_w_mm + (cols - 1) * gap_h_mm
    total_h = rows * page_h_mm + (rows - 1) * gap_v_mm
    if centralizar:
        origin_x = max(0.0, (folha_w_mm - total_w) / 2.0)
        origin_y = max(0.0, (folha_h_mm - total_h) / 2.0)
    else:
        origin_x = 0.0
        origin_y = max(0.0, folha_h_mm - total_h)

    positions: list[tuple[float, float]] = []
    for row in range(rows):
        for col in range(cols):
            x = origin_x + col * (page_w_mm + gap_h_mm)
            # linhas de cima para baixo na folha (y cresce para cima no JDF)
            y = origin_y + (rows - 1 - row) * (page_h_mm + gap_v_mm)
            positions.append((x, y))
    return positions


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
    """Monta XML JDF no padrão Apogee (Product + PrePress step&repeat)."""
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
    # marcas_corte / sangria: schema reservado; exemplo sem MarkObject

    nro5 = f"{int(nro):05d}"
    root_id = f"ROOT_{nro5}"
    ts = timestamp or datetime.now(timezone(timedelta(hours=-3)))
    ts_str = ts.strftime("%Y-%m-%dT%H:%M:%S%z")
    if len(ts_str) >= 5 and ts_str[-5] in "+-":
        ts_str = f"{ts_str[:-2]}:{ts_str[-2:]}"

    folha_w_pt = mm_to_pt(folha_w)
    folha_h_pt = mm_to_pt(folha_h)
    page_w_pt = mm_to_pt(page_w_mm)
    page_h_pt = mm_to_pt(page_h_mm)

    positions = compute_content_positions(
        folha_w_mm=folha_w,
        folha_h_mm=folha_h,
        page_w_mm=page_w_mm,
        page_h_mm=page_h_mm,
        cols=cols,
        rows=rows,
        gap_h_mm=gap_h,
        gap_v_mm=gap_v,
        centralizar=centralizar,
    )

    content_xml_parts: list[str] = []
    for x_mm, y_mm in positions:
        x_pt = mm_to_pt(x_mm)
        y_pt = mm_to_pt(y_mm)
        clip_x1 = x_pt + page_w_pt
        clip_y1 = y_pt + page_h_pt
        content_xml_parts.append(
            "              <ContentObject Ord=\"0\"\n"
            f"                             CTM=\"1 0 0 1 {x_pt:.3f} {y_pt:.3f}\" "
            f"TrimCTM=\"1 0 0 1 {x_pt:.3f} {y_pt:.3f}\"\n"
            f"                             TrimSize=\"{page_w_pt:.3f} {page_h_pt:.3f}\"\n"
            f"                             ClipBox=\"{x_pt:.3f} {y_pt:.3f} "
            f"{clip_x1:.3f} {clip_y1:.3f}\"/>"
        )
    contents = "\n".join(content_xml_parts)

    file_url = escape(path_to_file_url(base_pdf_path))
    export_folder_esc = escape(export_folder.replace("/", "\\"))
    export_name_esc = escape(export_filename)
    desc_esc = escape(descriptive_name)
    comment_esc = escape(comment)
    user_name_esc = escape(base_pdf_user_name)
    job_id = str(int(ano))
    job_part = nro5
    job_name = nro5  # DescriptiveName raiz = Job

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<JDF xmlns="http://www.CIP4.org/JDFSchema_1_1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xmlns:mis="http://www.exemplo.com.br/mis"
     ID="{root_id}" Type="Product" Version="1.4" Status="Waiting"
     JobID="{escape(job_id)}" JobPartID="{job_part}" DescriptiveName="{escape(job_name)}"
     mis:ExportFolder="{export_folder_esc}"
     mis:ExportFileName="{export_name_esc}">

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
       Status="Waiting" DescriptiveName="{desc_esc}">

    <ResourcePool>
      <RunList Class="Parameter" ID="RL_{nro5}" Status="Available" NPage="1">
        <LayoutElement>
          <FileSpec URL="{file_url}"
                    MimeType="application/pdf" FileVersion="1"
                    UserFileName="{user_name_esc}"/>
        </LayoutElement>
      </RunList>
      <RunList Class="Parameter" ID="RL_{nro5}_D" Status="Unavailable"/>

      <Layout Class="Parameter" ID="LAY_{nro5}" Status="Available" Automated="false">
        <Signature Name="SIG1">
          <Sheet Name="SHT1" SourceWorkStyle="{escape(work_style)}">
            <MediaRef rRef="PAP_{nro5}"/>
            <Surface Side="Front" SurfaceContentsBox="0 0 {folha_w_pt:.3f} {folha_h_pt:.3f}">
{contents}
            </Surface>
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
         NamedFeatures="resultexport ExportPDF_Sefoc">
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


def write_jdf_file(jdf_xml: str, output_dir: str, filename: str) -> str:
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.normpath(os.path.join(output_dir, filename))
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(jdf_xml)
    return path
