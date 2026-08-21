"""
Timbrado A4 Digital — preenche Cabecalho/Rodape no CDR temp, exporta SVG em curvas
e monta DOCX Cor/PB a partir dos templates Word (posição dos placeholders).
"""
from __future__ import annotations

import logging
import os
import shutil
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from corel_generator import (
    CorelGenerationError,
    _corel_session,
    _fechar_documento_corel,
    _is_com_disconnect_error,
    _preparar_corel_para_edicao,
    _release_corel_after_job,
    _sincronizar_documento_corel,
    aplicar_campo,
    construir_indice_shapes_documento,
    encerrar_corel_forcadamente,
    encontrar_shapes_no_documento,
    extrair_variaveis,
    humanizar_erro_corel,
    normalizar_gabinete,
    overlay_campos_com_templates_preview,
    reset_corel_session,
    resolver_modelo_em_cache,
    validar_acesso_job,
)

logger = logging.getLogger(__name__)

_TEMPLATE_COR = "TimbradoA4Digital - Cor Personalizado - TIFF v2.docx"
_TEMPLATE_PB = "TimbradoA4Digital - PB Personalizado - TIFF v2.docx"

# Filtros CorelDRAW Object Model (valores estáveis nas versões recentes).
_CDR_SVG = 1714
_CDR_EMF = 1283
_CDR_WMF = 13
_WD_HEADER_FOOTER_PRIMARY = 1
_WD_FORMAT_XML_DOCUMENT = 16


@dataclass
class TimbradoDigitalResult:
    artefatos: list[str] = field(default_factory=list)
    logs: list[str] = field(default_factory=list)


def resolve_timbrado_a4_digital_templates_dir(
    models_dir: str,
    configured: str = "",
) -> str:
    configured = (configured or "").strip()
    if configured:
        return os.path.abspath(configured)
    models = Path(models_dir)
    # .../Papelaria/CSP/WEB → .../Papelaria/Timbrado A4 Digital
    return str((models.parent.parent / "Timbrado A4 Digital").resolve())


def _resolve_template_path(templates_dir: str, filename: str) -> str:
    path = os.path.join(templates_dir, filename)
    if os.path.isfile(path):
        return path
    # Fallback legado .doc
    legacy = os.path.splitext(path)[0] + ".doc"
    if os.path.isfile(legacy):
        return legacy
    raise CorelGenerationError(
        f"Template Timbrado A4 Digital não encontrado: {filename} "
        f"(nem .doc legado) em {templates_dir}"
    )


def _shape_por_nome(
    doc: Any,
    nome: str,
    indice: dict[str, list[dict[str, Any]]],
) -> Any:
    ocorrencias = encontrar_shapes_no_documento(doc, nome, indice=indice)
    if not ocorrencias:
        raise CorelGenerationError(
            f"Objeto '{nome}' não encontrado no modelo Timbrado A4."
        )
    return ocorrencias[0]["shape"]


def _converter_para_curvas(shape: Any, logs: list[str], rotulo: str) -> Any:
    try:
        convertido = shape.ConvertToCurves()
        logs.append(f"{rotulo}: ConvertToCurves OK.")
        return convertido if convertido is not None else shape
    except Exception as exc:
        # Já pode ser curva / grupo
        logs.append(f"{rotulo}: ConvertToCurves aviso ({exc}).")
        return shape


def _constante_corel(nome: str, fallback: int) -> int:
    try:
        from win32com.client import constants  # type: ignore

        val = int(getattr(constants, nome, fallback))
        return val if val else fallback
    except Exception:
        return fallback


def _tentar_export_arquivo(
    temp_doc: Any,
    pasted: Any,
    dest_path: str,
    filtro: int,
    logs: list[str],
    rotulo: str,
    metodo: str,
) -> bool:
    abs_path = os.path.abspath(dest_path)
    if os.path.exists(abs_path):
        try:
            os.remove(abs_path)
        except OSError:
            pass
    try:
        temp_doc.ClearSelection()
        pasted.CreateSelection()
        sel = temp_doc.ActiveSelection
        sel.Export(abs_path, filtro)
        if os.path.isfile(abs_path) and os.path.getsize(abs_path) > 0:
            logs.append(f"{rotulo}: {metodo} via ActiveSelection.Export → {os.path.basename(abs_path)}")
            return True
    except Exception as exc:
        logs.append(f"{rotulo}: Selection.Export {metodo} falhou ({exc}).")
    try:
        temp_doc.ExportEx(abs_path, filtro)
        if os.path.isfile(abs_path) and os.path.getsize(abs_path) > 0:
            logs.append(f"{rotulo}: {metodo} via ExportEx → {os.path.basename(abs_path)}")
            return True
    except Exception as exc:
        logs.append(f"{rotulo}: ExportEx {metodo} falhou ({exc}).")
    return False


def _exportar_shape_imagem(
    corel: Any,
    shape: Any,
    dest_stem: str,
    logs: list[str],
    rotulo: str,
) -> str:
    """
    Exporta o shape (curvas quando possível) para imagem usável no Word.

    Tenta SVG primeiro; se o filtro Corel falhar, cai para EMF/WMF (formato
    nativo dos templates). SVG não é obrigatório — o essencial é alimentar o DOCX.
    Retorna o caminho absoluto do arquivo gerado.
    """
    shape = _converter_para_curvas(shape, logs, rotulo)

    left = float(shape.LeftX)
    bottom = float(shape.BottomY)
    right = float(shape.RightX)
    top = float(shape.TopY)
    width = max(right - left, 0.01)
    height = max(top - bottom, 0.01)

    tentativas: list[tuple[str, int, str]] = [
        (dest_stem + ".svg", _constante_corel("cdrSVG", _CDR_SVG), "SVG"),
        (dest_stem + ".emf", _constante_corel("cdrEMF", _CDR_EMF), "EMF"),
        (dest_stem + ".wmf", _constante_corel("cdrWMF", _CDR_WMF), "WMF"),
    ]

    temp_doc = None
    try:
        temp_doc = corel.CreateDocument()
        try:
            temp_doc.Unit = shape.Application.ActiveDocument.Unit
        except Exception:
            pass
        page = temp_doc.Pages.Item(1)
        try:
            page.SizeWidth = width
            page.SizeHeight = height
        except Exception:
            try:
                page.SetSize(width, height)
            except Exception as exc:
                logs.append(f"{rotulo}: aviso ao definir página de export ({exc}).")

        shape.Copy()
        temp_doc.ActiveLayer.Paste()
        pasted = temp_doc.ActiveShape
        try:
            pasted.SetPosition(0.0, height)
        except Exception:
            try:
                pasted.CenterX = width / 2.0
                pasted.CenterY = height / 2.0
            except Exception:
                pass
        pasted = _converter_para_curvas(pasted, logs, f"{rotulo}/temp")

        for dest_path, filtro, metodo in tentativas:
            if _tentar_export_arquivo(
                temp_doc, pasted, dest_path, filtro, logs, rotulo, metodo
            ):
                return os.path.abspath(dest_path)

        raise CorelGenerationError(
            f"Não foi possível exportar imagem de {rotulo} (SVG/EMF/WMF) "
            f"para montar o DOCX."
        )
    finally:
        if temp_doc is not None:
            try:
                temp_doc.Close()
            except Exception:
                pass


def _preencher_e_exportar_imagens(
    *,
    modelo: dict[str, Any],
    dados: dict[str, Any],
    caminho_modelo: str,
    temp_job_dir: str,
    cabecalho_stem: str,
    rodape_stem: str,
    corel_visible: bool,
    models_cache_dir: str,
    logs: list[str],
    exclusoes: Optional[list[str]] = None,
    preview_config: Optional[dict[str, Any]] = None,
) -> tuple[str, str]:
    fonte_modelo = caminho_modelo
    if models_cache_dir:
        fonte_modelo = resolver_modelo_em_cache(caminho_modelo, models_cache_dir)
        if fonte_modelo != caminho_modelo:
            logs.append(f"Modelo em cache local: {os.path.basename(fonte_modelo)}.")

    temp_cdr = os.path.join(temp_job_dir, "timbrado_digital_working.cdr")
    if os.path.exists(temp_cdr):
        os.remove(temp_cdr)
    shutil.copy(fonte_modelo, temp_cdr)
    logs.append("Cópia temp do TimbradoA4.cdr criada.")

    job_completed = False
    doc = None
    try:
        corel = _corel_session.get_application(corel_visible, force_new=False)
        _preparar_corel_para_edicao(corel, logs)
        doc = corel.OpenDocument(os.path.abspath(temp_cdr))
        logs.append(f"Documento aberto — {doc.Pages.Count} página(s).")

        campos = overlay_campos_com_templates_preview(
            modelo.get("campos") or {},
            preview_config,
        )
        if not campos:
            raise CorelGenerationError("Modelo sem campos configurados.")

        indice = construir_indice_shapes_documento(doc)
        for nome_campo, texto_modelo in campos.items():
            if exclusoes and nome_campo in exclusoes:
                continue
            logs.append(f"Aplicando campo: {nome_campo}")
            aplicar_campo(
                doc,
                nome_campo,
                texto_modelo,
                dados,
                logs,
                indice_shapes=indice,
            )

        _sincronizar_documento_corel(corel, doc, logs, antes_de_gravar=False)

        # Reindexa após edição (nomes preservados).
        indice = construir_indice_shapes_documento(doc)
        shape_cab = _shape_por_nome(doc, "Cabecalho", indice)
        shape_rod = _shape_por_nome(doc, "Rodape", indice)

        path_cab = _exportar_shape_imagem(
            corel, shape_cab, cabecalho_stem, logs, "Cabecalho"
        )
        path_rod = _exportar_shape_imagem(
            corel, shape_rod, rodape_stem, logs, "Rodape"
        )
        job_completed = True
        return path_cab, path_rod
    finally:
        if doc is not None:
            try:
                _fechar_documento_corel(doc, logs)
            except Exception:
                try:
                    doc.Close()
                except Exception:
                    pass
        _release_corel_after_job(logs, completed=job_completed)


def _titulo_inline_shape(ishape: Any) -> str:
    for attr in ("AlternativeText", "Title"):
        try:
            val = getattr(ishape, attr, None)
            if val and str(val).strip():
                return str(val).strip()
        except Exception:
            pass
    try:
        # Algumas versões expõem título via Hyperlink / Field
        return str(ishape.Range.Text or "").strip()[:40]
    except Exception:
        return ""


def _normalizar_rotulo(texto: str) -> str:
    import unicodedata
    import re

    t = unicodedata.normalize("NFKD", texto or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", t.lower())


def _encontrar_inline_cabecalho(header: Any) -> Any:
    count = int(header.Range.InlineShapes.Count)
    if count <= 0:
        raise CorelGenerationError("Template sem imagens no cabeçalho.")

    candidatos: list[tuple[float, Any]] = []
    for i in range(1, count + 1):
        ish = header.Range.InlineShapes.Item(i)
        titulo = _normalizar_rotulo(_titulo_inline_shape(ish))
        if "cabecalho" in titulo or "cabealho" in titulo:
            return ish
        candidatos.append((float(ish.Width), ish))

    # Brasão é ~quadrado estreito; cabeçalho é a faixa larga.
    candidatos.sort(key=lambda item: item[0], reverse=True)
    return candidatos[0][1]


def _encontrar_inline_rodape(footer: Any) -> Any:
    count = int(footer.Range.InlineShapes.Count)
    if count <= 0:
        raise CorelGenerationError("Template sem imagens no rodapé.")
    for i in range(1, count + 1):
        ish = footer.Range.InlineShapes.Item(i)
        titulo = _normalizar_rotulo(_titulo_inline_shape(ish))
        if "rodape" in titulo:
            return ish
    return footer.Range.InlineShapes.Item(1)


def _substituir_inline_por_imagem(ishape: Any, imagem_path: str, logs: list[str], rotulo: str) -> None:
    width = float(ishape.Width)
    height = float(ishape.Height)
    rng = ishape.Range
    ishape.Delete()
    novo = rng.InlineShapes.AddPicture(
        FileName=os.path.abspath(imagem_path),
        LinkToFile=False,
        SaveWithDocument=True,
    )
    novo.Width = width
    novo.Height = height
    logs.append(
        f"Word: {rotulo} substituído ({width:.1f}×{height:.1f} pt) ← {os.path.basename(imagem_path)}"
    )


def _montar_docx_com_imagens(
    template_path: str,
    dest_docx: str,
    cabecalho_img: str,
    rodape_img: str,
    temp_job_dir: str,
    logs: list[str],
) -> None:
    import pythoncom
    import win32com.client  # type: ignore

    pythoncom.CoInitialize()
    word = None
    doc = None
    work_copy = os.path.join(
        temp_job_dir,
        f"work_{os.path.splitext(os.path.basename(dest_docx))[0]}"
        + os.path.splitext(template_path)[1],
    )
    try:
        if os.path.exists(work_copy):
            os.remove(work_copy)
        shutil.copy(template_path, work_copy)

        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0
        doc = word.Documents.Open(os.path.abspath(work_copy), ReadOnly=False)

        section = doc.Sections.Item(1)
        header = section.Headers.Item(_WD_HEADER_FOOTER_PRIMARY)
        footer = section.Footers.Item(_WD_HEADER_FOOTER_PRIMARY)

        ish_cab = _encontrar_inline_cabecalho(header)
        ish_rod = _encontrar_inline_rodape(footer)
        _substituir_inline_por_imagem(ish_cab, cabecalho_img, logs, "Cabeçalho")
        _substituir_inline_por_imagem(ish_rod, rodape_img, logs, "Rodapé")

        abs_dest = os.path.abspath(dest_docx)
        if os.path.exists(abs_dest):
            os.remove(abs_dest)
        doc.SaveAs(abs_dest, _WD_FORMAT_XML_DOCUMENT)
        logs.append(f"DOCX gravado: {os.path.basename(abs_dest)}")
    finally:
        if doc is not None:
            try:
                doc.Close(False)
            except Exception:
                pass
        if word is not None:
            try:
                word.Quit()
            except Exception:
                pass
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass
        if os.path.isfile(work_copy):
            try:
                os.remove(work_copy)
            except OSError:
                pass


def _gerar_timbrado_a4_digital_impl(
    *,
    modelo: dict[str, Any],
    dados: dict[str, Any],
    caminho_modelo: str,
    templates_dir: str,
    temp_job_dir: str,
    output_dir: str,
    output_cabecalho_svg: str,
    output_rodape_svg: str,
    output_docx_cor: str,
    output_docx_pb: str,
    corel_visible: bool,
    models_cache_dir: str,
    logs: list[str],
    exclusoes: Optional[list[str]] = None,
    preview_config: Optional[dict[str, Any]] = None,
) -> list[str]:
    os.makedirs(temp_job_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    template_cor = _resolve_template_path(templates_dir, _TEMPLATE_COR)
    template_pb = _resolve_template_path(templates_dir, _TEMPLATE_PB)
    logs.append(f"Template Cor: {os.path.basename(template_cor)}")
    logs.append(f"Template PB: {os.path.basename(template_pb)}")

    tmp_cab_stem = os.path.join(temp_job_dir, "cabecalho")
    tmp_rod_stem = os.path.join(temp_job_dir, "rodape")

    path_cab, path_rod = _preencher_e_exportar_imagens(
        modelo=modelo,
        dados=dados,
        caminho_modelo=caminho_modelo,
        temp_job_dir=temp_job_dir,
        cabecalho_stem=tmp_cab_stem,
        rodape_stem=tmp_rod_stem,
        corel_visible=corel_visible,
        models_cache_dir=models_cache_dir,
        logs=logs,
        exclusoes=exclusoes,
        preview_config=preview_config,
    )

    dest_cor = os.path.join(output_dir, output_docx_cor)
    dest_pb = os.path.join(output_dir, output_docx_pb)

    for dest in (dest_cor, dest_pb):
        if os.path.exists(dest):
            os.remove(dest)

    # SVG/EMF opcionais na pasta Sefoc (auditoria); só copia se o export preferido existir.
    artefatos: list[str] = []
    for src, preferred_name in (
        (path_cab, output_cabecalho_svg),
        (path_rod, output_rodape_svg),
    ):
        if src.lower().endswith(".svg"):
            dest_svg = os.path.join(output_dir, preferred_name)
            if os.path.exists(dest_svg):
                os.remove(dest_svg)
            shutil.copy2(src, dest_svg)
            artefatos.append(preferred_name)
            logs.append(f"SVG copiado para Sefoc: {preferred_name}")
        else:
            logs.append(
                f"Export {os.path.basename(src)} usado no DOCX "
                f"(SVG opcional não disponível)."
            )

    _montar_docx_com_imagens(
        template_cor, dest_cor, path_cab, path_rod, temp_job_dir, logs
    )
    _montar_docx_com_imagens(
        template_pb, dest_pb, path_cab, path_rod, temp_job_dir, logs
    )

    for name in (output_docx_cor, output_docx_pb):
        path = os.path.join(output_dir, name)
        if not os.path.isfile(path) or os.path.getsize(path) <= 0:
            raise CorelGenerationError(f"Artefato DOCX não gerado: {name}")
        artefatos.append(name)
    return artefatos


def gerar_timbrado_a4_digital(
    *,
    modelo: dict[str, Any],
    dados: dict[str, Any],
    caminho_modelo: str,
    templates_dir: str,
    temp_dir: str,
    output_dir: str,
    output_cabecalho_svg: str,
    output_rodape_svg: str,
    output_docx_cor: str,
    output_docx_pb: str,
    corel_visible: bool = False,
    job_timeout_sec: int = 300,
    job_id: Optional[int] = None,
    exclusoes: Optional[list[str]] = None,
    preview_config: Optional[dict[str, Any]] = None,
) -> TimbradoDigitalResult:
    logs: list[str] = []
    job_tag = f"job_{job_id}" if job_id else "job"
    temp_job_dir = os.path.join(temp_dir, job_tag, "timbrado_digital")
    os.makedirs(temp_job_dir, exist_ok=True)

    dados_norm = dict(dados)
    if dados_norm.get("gabinete"):
        dados_norm["gabinete"] = normalizar_gabinete(str(dados_norm["gabinete"]))
    if dados_norm.get("uf"):
        dados_norm["uf"] = str(dados_norm["uf"]).upper()
    campos_texto = " ".join((modelo.get("campos") or {}).values())
    if "anexo" in extrair_variaveis(campos_texto) and not dados_norm.get("anexo"):
        dados_norm["anexo"] = "IV"

    models_cache_dir = os.path.join(temp_dir, "_models_cache")
    validar_acesso_job(
        caminho_modelo,
        output_dir,
        models_cache_dir=models_cache_dir,
    )
    if not os.path.isdir(templates_dir):
        raise CorelGenerationError(
            f"Pasta de templates Timbrado A4 Digital indisponível: {templates_dir}"
        )

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            _gerar_timbrado_a4_digital_impl,
            modelo=modelo,
            dados=dados_norm,
            caminho_modelo=caminho_modelo,
            templates_dir=templates_dir,
            temp_job_dir=temp_job_dir,
            output_dir=output_dir,
            output_cabecalho_svg=output_cabecalho_svg,
            output_rodape_svg=output_rodape_svg,
            output_docx_cor=output_docx_cor,
            output_docx_pb=output_docx_pb,
            corel_visible=corel_visible,
            models_cache_dir=models_cache_dir,
            logs=logs,
            exclusoes=exclusoes,
            preview_config=preview_config,
        )
        try:
            artefatos = future.result(timeout=max(30, job_timeout_sec))
        except FuturesTimeoutError as exc:
            encerrar_corel_forcadamente(matar_processo=True)
            raise CorelGenerationError(
                f"Timbrado A4 Digital excedeu o tempo limite de {job_timeout_sec}s."
            ) from exc
        except Exception as exc:
            if _is_com_disconnect_error(exc):
                reset_corel_session()
                raise CorelGenerationError(
                    humanizar_erro_corel(exc, contexto="CorelDRAW desconectado")
                ) from exc
            if isinstance(exc, CorelGenerationError):
                raise
            raise CorelGenerationError(humanizar_erro_corel(exc)) from exc

    return TimbradoDigitalResult(artefatos=list(artefatos), logs=logs)
