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
    _assert_documento_e_copia_temp,
    _corel_session,
    _fechar_documento_sem_salvar,
    _is_com_disconnect_error,
    _preparar_corel_para_edicao,
    _release_corel_after_job,
    _sincronizar_documento_corel,
    _stat_arquivo,
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
_NOMES_EXPORT_CABECALHO = ("Camara", "Cabecalho")
_NOMES_EXPORT_RODAPE = ("Rodape",)

# Filtros CorelDRAW Object Model (valores estáveis nas versões recentes).
_CDR_SVG = 1714
_CDR_EMF = 1283
_CDR_WMF = 13
_CDR_PNG = 802
_CDR_SELECTION = 1
_CDR_RGB_COLOR_IMAGE = 4
_MSO_TRUE = -1
_WD_HEADER_FOOTER_PRIMARY = 1
_WD_FORMAT_XML_DOCUMENT = 16
_WORD_PNG_DPI = 300


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
    shape = _buscar_shape_por_nome(doc, indice, nome)
    if shape is None:
        raise CorelGenerationError(
            f"Objeto '{nome}' não encontrado no modelo Timbrado A4."
        )
    return shape


def _buscar_shape_por_nome(
    doc: Any,
    indice: dict[str, list[dict[str, Any]]],
    nome: str,
) -> Any:
    ocorrencias = encontrar_shapes_no_documento(doc, nome, indice=indice)
    if ocorrencias:
        return ocorrencias[0]["shape"]
    alvo = _normalizar_rotulo(nome)
    for key, lista in (indice or {}).items():
        if lista and _normalizar_rotulo(key) == alvo:
            return lista[0]["shape"]
    return None


def _coletar_shapes_por_nomes(
    doc: Any,
    indice: dict[str, list[dict[str, Any]]],
    nomes: tuple[str, ...],
    logs: list[str],
    rotulo: str,
) -> list[Any]:
    shapes: list[Any] = []
    faltando: list[str] = []
    for nome in nomes:
        shape = _buscar_shape_por_nome(doc, indice, nome)
        if shape is None:
            faltando.append(nome)
            continue
        shapes.append(shape)
        l, b, r, t = _bounds_shape(shape)
        logs.append(
            f"{rotulo}: incluir '{_nome_shape(shape) or nome}' "
            f"({l:.2f},{b:.2f})-({r:.2f},{t:.2f})."
        )
    if faltando:
        raise CorelGenerationError(
            f"{rotulo}: objeto(s) não encontrado(s) no CDR: {', '.join(faltando)}."
        )
    return shapes


def _converter_para_curvas(shape: Any, logs: list[str], rotulo: str) -> Any:
    try:
        convertido = shape.ConvertToCurves()
        logs.append(f"{rotulo}: ConvertToCurves OK.")
        if convertido is not None and _eh_com(convertido):
            return convertido
        return shape
    except Exception as exc:
        logs.append(f"{rotulo}: ConvertToCurves aviso ({exc}).")
        return shape


def _converter_selecao_para_curvas(
    doc: Any,
    shape: Any,
    logs: list[str],
    rotulo: str,
) -> Any:
    """Texto artístico vira contorno — senão some no Word (fonte/transparência)."""
    if doc is not None and _selecionar_shape(doc, shape, logs, rotulo):
        try:
            sel = _dynamic_dispatch(doc).ActiveSelection
            convertido = sel.ConvertToCurves()
            logs.append(f"{rotulo}: Selection.ConvertToCurves OK.")
            if convertido is not None and _eh_com(convertido):
                return convertido
            return shape
        except Exception as exc:
            logs.append(f"{rotulo}: Selection.ConvertToCurves aviso ({exc}).")
    convertido = _converter_para_curvas(shape, logs, rotulo)
    if convertido is not None and _eh_com(convertido):
        return convertido
    return shape


def _eh_com(obj: Any) -> bool:
    ole = getattr(obj, "_oleobj_", None)
    if ole is None:
        return False
    # MagicMock inventa _oleobj_; wrappers COM reais expõem Invoke nativo.
    if type(ole).__name__ in {"MagicMock", "Mock", "NonCallableMagicMock"}:
        return False
    return True


def _dynamic_dispatch(obj: Any) -> Any:
    if obj is None or not _eh_com(obj):
        return obj
    try:
        import win32com.client

        return win32com.client.dynamic.Dispatch(obj)
    except Exception:
        return obj


def _filtro_export(corel: Any, nome: str, fallback: int) -> int:
    """Usa enum da Application Corel; constants do pywin32 pode ser do Word e quebra o COM."""
    if corel is not None:
        try:
            val = getattr(corel, nome)
            if val is not None:
                return int(val)
        except Exception:
            pass
    return int(fallback)


def _arquivo_exportado_ok(path: str) -> bool:
    return os.path.isfile(path) and os.path.getsize(path) > 0


def _remover_se_existir(path: str) -> None:
    if os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


def _aspectos_proximos(
    w1: float,
    h1: float,
    w2: float,
    h2: float,
    tolerancia: float = 0.02,
) -> bool:
    if w1 <= 0 or h1 <= 0 or w2 <= 0 or h2 <= 0:
        return False
    a1 = w1 / h1
    a2 = w2 / h2
    return abs(a1 - a2) / max(a2, 1e-9) <= tolerancia


def _dimensao_arquivo(path: str) -> Optional[tuple[float, float]]:
    ext = os.path.splitext(path)[1].lower()
    if ext in {".png", ".jpg", ".jpeg", ".tif", ".tiff"}:
        try:
            import fitz

            pix = fitz.Pixmap(path)
            try:
                return float(pix.width), float(pix.height)
            finally:
                pix = None
        except Exception:
            return None
    if ext == ".svg":
        try:
            text = Path(path).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return None
        import re

        vb = re.search(
            r'viewBox=["\']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)',
            text,
            re.I,
        )
        if vb:
            return abs(float(vb.group(3))), abs(float(vb.group(4)))
        w = re.search(r'\bwidth=["\']([-\d.]+)', text, re.I)
        h = re.search(r'\bheight=["\']([-\d.]+)', text, re.I)
        if w and h:
            return abs(float(w.group(1))), abs(float(h.group(1)))
    return None


def _proporcao_ok(path: str, shape_w: float, shape_h: float) -> bool:
    dims = _dimensao_arquivo(path)
    if dims is None:
        return True
    return _aspectos_proximos(dims[0], dims[1], shape_w, shape_h)


def _aceitar_export(
    path: str,
    shape_w: float,
    shape_h: float,
    logs: list[str],
    erros: list[str],
    rotulo: str,
    metodo: str,
) -> bool:
    if not _arquivo_exportado_ok(path):
        erros.append(f"{rotulo}: {metodo} não gerou arquivo ({os.path.basename(path)})")
        return False
    if not _proporcao_ok(path, shape_w, shape_h):
        dims = _dimensao_arquivo(path)
        erros.append(
            f"{rotulo}: {metodo} rejeitado por proporção "
            f"(arquivo {dims} vs shape {shape_w:.3f}×{shape_h:.3f})"
        )
        _remover_se_existir(path)
        return False
    logs.append(f"{rotulo}: {metodo} → {os.path.basename(path)}")
    return True


def _finalizar_export_filter(expflt: Any, logs: list[str], rotulo: str, metodo: str) -> None:
    if expflt is None:
        return
    if str(metodo).upper() == "SVG":
        for attr in ("TextAsCurves", "TextToCurves"):
            try:
                setattr(expflt, attr, True)
            except Exception:
                pass
    finish = getattr(expflt, "Finish", None)
    if not callable(finish):
        return
    try:
        finish()
    except Exception as exc:
        logs.append(f"{rotulo}: {metodo} Finish() falhou ({exc}).")


def _ativar_documento(doc: Any, logs: list[str], rotulo: str) -> None:
    if doc is None:
        return
    try:
        doc.Activate()
        return
    except Exception:
        pass
    try:
        doc.Application.ActiveDocument = doc
    except Exception as exc:
        logs.append(f"{rotulo}: aviso ao ativar documento ({exc}).")


def _ativar_contexto_shape(shape: Any) -> None:
    try:
        shape.Page.Activate()
    except Exception:
        pass
    try:
        shape.Layer.Activate()
    except Exception:
        pass


def _selecionar_shape(doc: Any, shape: Any, logs: list[str], rotulo: str) -> bool:
    doc = _dynamic_dispatch(doc)
    _ativar_documento(doc, logs, rotulo)
    _ativar_contexto_shape(shape)
    try:
        doc.ClearSelection()
    except Exception:
        pass
    try:
        shape.CreateSelection()
        return True
    except Exception as exc:
        logs.append(f"{rotulo}: CreateSelection falhou ({exc}).")
        return False


def _chamar_export_ex(doc: Any, abs_path: str, filtro: int, corel: Any = None) -> Any:
    path = str(abs_path)
    filtro_int = int(filtro)
    dyn = _dynamic_dispatch(doc)
    app = getattr(dyn, "Application", None) or corel
    opts = None
    if app is not None:
        try:
            opts = app.CreateStructExportOptions()
        except Exception:
            opts = None
    if opts is not None:
        for attr in ("TextAsCurves", "TextToCurves"):
            try:
                setattr(opts, attr, True)
            except Exception:
                pass
        rng = _filtro_export(app, "cdrSelection", _CDR_SELECTION)
        try:
            return dyn.ExportEx(path, filtro_int, rng, opts)
        except Exception:
            return dyn.ExportEx(path, filtro_int, opts)
    try:
        return dyn.ExportEx(path, filtro_int)
    except Exception:
        pass
    import pythoncom

    ole = getattr(dyn, "_oleobj_", None) or getattr(doc, "_oleobj_", None)
    if ole is None:
        raise RuntimeError("ExportEx: documento sem _oleobj_")
    dispid = ole.GetIDsOfNames(0, "ExportEx")
    if isinstance(dispid, (list, tuple)):
        dispid = dispid[0]
    return ole.Invoke(dispid, 0, pythoncom.DISPATCH_METHOD, True, path, filtro_int)


def _tentar_export_arquivo(
    temp_doc: Any,
    pasted: Any,
    dest_path: str,
    filtro: int,
    logs: list[str],
    erros: list[str],
    rotulo: str,
    metodo: str,
    shape_w: float,
    shape_h: float,
    corel: Any = None,
) -> bool:
    abs_path = str(os.path.abspath(dest_path))
    _remover_se_existir(abs_path)
    _ativar_documento(temp_doc, logs, rotulo)
    if pasted is not None:
        _selecionar_shape(temp_doc, pasted, logs, rotulo)

    try:
        expflt = _chamar_export_ex(temp_doc, abs_path, filtro, corel=corel)
        _finalizar_export_filter(expflt, logs, rotulo, metodo)
        return _aceitar_export(abs_path, shape_w, shape_h, logs, erros, rotulo, f"ExportEx {metodo}")
    except Exception as exc:
        erros.append(f"{rotulo}: ExportEx {metodo} falhou ({exc})")
        return False


def _chamar_export_bitmap(
    alvo: Any,
    abs_path: str,
    filtro: int,
    rng: int,
    img_type: int,
) -> Any:
    """Lista completa de 11 args com ints simples — forma que funcionou nos jobs #140/#141."""
    path = str(abs_path)
    dyn = _dynamic_dispatch(alvo)
    return dyn.ExportBitmap(
        path,
        int(filtro),
        int(rng),
        int(img_type),
        0,
        0,
        600,
        600,
        1,
        False,
        False,
    )


def _tentar_export_bitmap_png(
    doc: Any,
    shape: Any,
    dest_path: str,
    logs: list[str],
    erros: list[str],
    rotulo: str,
    shape_w: float,
    shape_h: float,
) -> bool:
    abs_path = os.path.abspath(dest_path)
    _remover_se_existir(abs_path)
    if not _selecionar_shape(doc, shape, logs, rotulo):
        erros.append(f"{rotulo}: ExportBitmap sem seleção")
        return False

    app = getattr(doc, "Application", None)
    filtro = _filtro_export(app, "cdrPNG", _CDR_PNG)
    rng = _filtro_export(app, "cdrSelection", _CDR_SELECTION)
    img_type = _filtro_export(app, "cdrRGBColorImage", _CDR_RGB_COLOR_IMAGE)
    try:
        expflt = _chamar_export_bitmap(doc, str(abs_path), filtro, rng, img_type)
        _finalizar_export_filter(expflt, logs, rotulo, "PNG")
        return _aceitar_export(abs_path, shape_w, shape_h, logs, erros, rotulo, "ExportBitmap PNG")
    except Exception as exc:
        erros.append(f"{rotulo}: ExportBitmap falhou ({exc})")
        return False


def _svg_tem_path(svg: str) -> bool:
    low = (svg or "").lower()
    return "<path" in low or "<polygon" in low or "<polyline" in low


def _exportar_shape_via_pdf(
    temp_doc: Any,
    dest_stem: str,
    width: float,
    height: float,
    logs: list[str],
    erros: list[str],
    rotulo: str,
) -> Optional[str]:
    pdf_temp = dest_stem + "_export.pdf"
    abs_pdf = os.path.abspath(pdf_temp)
    _remover_se_existir(abs_pdf)
    _ativar_documento(temp_doc, logs, rotulo)
    try:
        temp_doc.PublishToPDF(abs_pdf)
    except Exception as exc:
        erros.append(f"{rotulo}: PublishToPDF falhou ({exc})")
        return None
    if not _arquivo_exportado_ok(abs_pdf):
        erros.append(f"{rotulo}: PublishToPDF não gerou PDF")
        return None

    try:
        import fitz
    except Exception as exc:
        erros.append(f"{rotulo}: PyMuPDF indisponível ({exc})")
        return None

    try:
        pdf = fitz.open(abs_pdf)
        try:
            page = pdf[0]
            svg = page.get_svg_image(text_as_path=True)
            svg_path = dest_stem + ".svg"
            if _svg_tem_path(svg or ""):
                Path(svg_path).write_text(svg, encoding="utf-8")
                if _aceitar_export(
                    svg_path, width, height, logs, erros, rotulo, "PDF→SVG"
                ):
                    return os.path.abspath(svg_path)
            else:
                erros.append(f"{rotulo}: PDF→SVG sem path vetorial")

            png_path = dest_stem + ".png"
            pix = page.get_pixmap(dpi=600)
            pix_w = float(getattr(pix, "width", 0) or 0)
            pix_h = float(getattr(pix, "height", 0) or 0)
            if pix_w > 0 and pix_h > 0 and not _aspectos_proximos(pix_w, pix_h, width, height):
                erros.append(
                    f"{rotulo}: PDF→PNG rejeitado por proporção "
                    f"(pixmap {pix_w:.0f}×{pix_h:.0f} vs shape {width:.3f}×{height:.3f})"
                )
            else:
                pix.save(png_path)
                if _arquivo_exportado_ok(png_path):
                    logs.append(
                        f"{rotulo}: PDF→PNG 600dpi → {os.path.basename(png_path)}"
                    )
                    return os.path.abspath(png_path)
                erros.append(f"{rotulo}: PDF→PNG não gerou arquivo")
        finally:
            pdf.close()
    except Exception as exc:
        erros.append(f"{rotulo}: PyMuPDF falhou ({exc})")
    return None


def _dimensao_shape(shape: Any) -> tuple[float, float]:
    left, bottom, right, top = _bounds_shape(shape)
    return max(right - left, 0.01), max(top - bottom, 0.01)


def _bounds_shape(shape: Any) -> tuple[float, float, float, float]:
    try:
        left = float(shape.LeftX)
        bottom = float(shape.BottomY)
        right = float(shape.RightX)
        top = float(shape.TopY)
        if right > left and top > bottom:
            return left, bottom, right, top
    except Exception:
        pass
    w, h = 0.01, 0.01
    try:
        w = abs(float(shape.SizeWidth))
        h = abs(float(shape.SizeHeight))
    except Exception:
        pass
    return 0.0, 0.0, max(w, 0.01), max(h, 0.01)


def _union_rect(shapes: list[Any]) -> tuple[float, float, float, float]:
    lefts, bottoms, rights, tops = [], [], [], []
    for shape in shapes:
        left, bottom, right, top = _bounds_shape(shape)
        lefts.append(left)
        bottoms.append(bottom)
        rights.append(right)
        tops.append(top)
    return min(lefts), min(bottoms), max(rights), max(tops)


def _union_bounds(shapes: list[Any]) -> tuple[float, float]:
    left, bottom, right, top = _union_rect(shapes)
    return max(right - left, 0.01), max(top - bottom, 0.01)


def _deslocamento_para_pagina(shapes: list[Any], page_h: float) -> tuple[float, float]:
    left, _bottom, _right, top = _union_rect(shapes)
    return -left, page_h - top


def _nome_shape(shape: Any) -> str:
    try:
        return str(shape.Name or "").strip()
    except Exception:
        return ""


def _mover_shape(shape: Any, dx: float, dy: float) -> None:
    try:
        shape.Move(dx, dy)
        return
    except Exception:
        pass
    left, _bottom, _right, top = _bounds_shape(shape)
    try:
        shape.SetPosition(left + dx, top + dy)
        return
    except Exception:
        pass
    try:
        shape.CenterX = float(shape.CenterX) + dx
        shape.CenterY = float(shape.CenterY) + dy
    except Exception:
        raise


def _alinhar_shapes_na_pagina(
    shapes: list[Any],
    page_h: float,
    logs: list[str],
    rotulo: str,
) -> None:
    if not shapes:
        return
    dx, dy = _deslocamento_para_pagina(shapes, page_h)
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return
    for shape in shapes:
        try:
            _mover_shape(shape, dx, dy)
        except Exception as exc:
            logs.append(
                f"{rotulo}: Move de '{_nome_shape(shape)}' falhou ({exc})."
            )


def _copiar_colar_shapes(
    source_doc: Any,
    temp_doc: Any,
    shapes: list[Any],
    logs: list[str],
    rotulo: str,
) -> list[Any]:
    """Copia um a um — AddToSelection no Corel costuma ficar só com o primeiro."""
    colados: list[Any] = []
    for shape in shapes:
        _ativar_documento(source_doc, logs, rotulo)
        _ativar_contexto_shape(shape)
        try:
            source_doc.ClearSelection()
        except Exception:
            pass
        try:
            shape.CreateSelection()
        except Exception as exc:
            logs.append(f"{rotulo}: CreateSelection '{_nome_shape(shape)}' falhou ({exc}).")
        try:
            _dynamic_dispatch(source_doc).ActiveSelection.Copy()
        except Exception:
            shape.Copy()
        _ativar_documento(temp_doc, logs, rotulo)
        temp_doc.ActiveLayer.Paste()
        colados.append(temp_doc.ActiveShape)
        logs.append(f"{rotulo}: colado '{_nome_shape(shape) or '?'}'.")
    return colados


def _exportar_shape_imagem(
    corel: Any,
    shape: Any,
    dest_stem: str,
    logs: list[str],
    rotulo: str,
    source_doc: Any = None,
    shapes_faixa: Optional[list[Any]] = None,
) -> str:
    """
    Isola o(s) shape(s) numa página do mesmo tamanho, PublishToPDF + PyMuPDF
    (SVG em curvas / PNG 600dpi). Fallback: ExportEx / ExportBitmap nativos.
    """
    alvo = list(shapes_faixa) if shapes_faixa else [shape]
    width, height = _union_bounds(alvo)
    erros: list[str] = []
    tentativas: list[tuple[str, int, str]] = [
        (dest_stem + ".svg", _filtro_export(corel, "cdrSVG", _CDR_SVG), "SVG"),
        (dest_stem + ".emf", _filtro_export(corel, "cdrEMF", _CDR_EMF), "EMF"),
        (dest_stem + ".wmf", _filtro_export(corel, "cdrWMF", _CDR_WMF), "WMF"),
    ]
    png_path = dest_stem + ".png"

    temp_doc = None
    pasted: Any = None
    try:
        created = corel.CreateDocument()
        temp_doc = _dynamic_dispatch(created)
        _ativar_documento(temp_doc, logs, rotulo)
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

        colados: list[Any] = []
        if source_doc is not None:
            try:
                colados = _copiar_colar_shapes(
                    source_doc, temp_doc, alvo, logs, rotulo
                )
            except Exception as exc:
                logs.append(f"{rotulo}: Copy/Paste no documento origem falhou ({exc}).")
                erros.append(f"{rotulo}: Copy falhou ({exc})")
        else:
            try:
                temp_doc.ActiveLayer.Paste()
                colados = [temp_doc.ActiveShape]
            except Exception as exc:
                logs.append(f"{rotulo}: Paste no documento temp falhou ({exc}).")
                erros.append(f"{rotulo}: Paste falhou ({exc})")

        if colados:
            _alinhar_shapes_na_pagina(colados, height, logs, rotulo)
            convertidos: list[Any] = []
            for item in colados:
                convertidos.append(
                    _converter_para_curvas(item, logs, f"{rotulo}/temp")
                )
            pasted = convertidos[-1]
            try:
                _selecionar_shape(temp_doc, pasted, logs, rotulo)
                for extra in convertidos[:-1]:
                    try:
                        extra.AddToSelection()
                    except Exception:
                        pass
            except Exception:
                pass

            via_pdf = _exportar_shape_via_pdf(
                temp_doc, dest_stem, width, height, logs, erros, rotulo
            )
            if via_pdf:
                return via_pdf

            for dest_path, filtro, metodo in tentativas:
                if _tentar_export_arquivo(
                    temp_doc,
                    pasted,
                    dest_path,
                    filtro,
                    logs,
                    erros,
                    rotulo,
                    metodo,
                    width,
                    height,
                    corel=corel,
                ):
                    return os.path.abspath(dest_path)

            if _tentar_export_bitmap_png(
                temp_doc, pasted, png_path, logs, erros, rotulo, width, height
            ):
                logs.append(
                    f"{rotulo}: aviso — PNG nativo usado porque PDF/SVG/EMF/WMF falharam."
                )
                return os.path.abspath(png_path)

        detalhe = " | ".join(erros) if erros else "sem tentativas de export"
        raise CorelGenerationError(
            f"Não foi possível exportar {rotulo} para montar o DOCX. {detalhe}"
        )
    finally:
        if temp_doc is not None:
            try:
                if source_doc is not None:
                    _ativar_documento(source_doc, logs, rotulo)
            except Exception:
                pass
            _fechar_documento_sem_salvar(temp_doc, logs)


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

    origem_abs = os.path.abspath(caminho_modelo)
    fonte_abs = os.path.abspath(fonte_modelo)
    origem_stat = _stat_arquivo(origem_abs)
    cache_stat = (
        _stat_arquivo(fonte_abs)
        if os.path.normcase(fonte_abs) != os.path.normcase(origem_abs)
        else None
    )

    job_completed = False
    doc = None
    try:
        corel = _corel_session.get_application(corel_visible, force_new=False)
        _preparar_corel_para_edicao(corel, logs)
        temp_abs = os.path.abspath(temp_cdr)
        doc = corel.OpenDocument(temp_abs)
        logs.append(f"Documento aberto — {doc.Pages.Count} página(s).")
        _assert_documento_e_copia_temp(doc, temp_abs, origem_abs, logs)
        if cache_stat is not None:
            _assert_documento_e_copia_temp(doc, temp_abs, fonte_abs, logs)

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
        faixa_cab = _coletar_shapes_por_nomes(
            doc, indice, _NOMES_EXPORT_CABECALHO, logs, "Cabecalho"
        )
        faixa_rod = _coletar_shapes_por_nomes(
            doc, indice, _NOMES_EXPORT_RODAPE, logs, "Rodape"
        )
        shape_cab = faixa_cab[-1]
        shape_rod = faixa_rod[0]

        path_cab = _exportar_shape_imagem(
            corel,
            shape_cab,
            cabecalho_stem,
            logs,
            "Cabecalho",
            source_doc=doc,
            shapes_faixa=faixa_cab,
        )
        path_rod = _exportar_shape_imagem(
            corel,
            shape_rod,
            rodape_stem,
            logs,
            "Rodape",
            source_doc=doc,
            shapes_faixa=faixa_rod,
        )
        job_completed = True
        return path_cab, path_rod
    finally:
        if doc is not None:
            _fechar_documento_sem_salvar(doc, logs)
        _release_corel_after_job(logs, completed=job_completed)
        try:
            if _stat_arquivo(origem_abs) != origem_stat:
                logs.append(
                    "ERRO: o modelo Corel original foi modificado na geração "
                    "Timbrado A4 Digital."
                )
        except OSError:
            logs.append(
                "ERRO: não foi possível conferir o modelo Corel original após a geração."
            )
        if cache_stat is not None:
            try:
                if _stat_arquivo(fonte_abs) != cache_stat:
                    logs.append(
                        "ERRO: o cache do modelo Corel foi modificado na geração "
                        "Timbrado A4 Digital."
                    )
            except OSError:
                logs.append(
                    "ERRO: não foi possível conferir o cache do modelo Corel após a geração."
                )


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


def _caminho_para_word(imagem_path: str, logs: list[str]) -> str:
    """
    Word COM trava em AddPicture de SVG do PyMuPDF (conversão interna).
    Rasteriza o PDF irmão (_export.pdf) para PNG e mantém o SVG só na pasta Digital.
    """
    abs_path = os.path.abspath(imagem_path)
    if not abs_path.lower().endswith(".svg"):
        return abs_path
    stem, _ = os.path.splitext(abs_path)
    pdf = stem + "_export.pdf"
    png = stem + "_word.png"
    if not (_arquivo_exportado_ok(pdf)):
        logs.append(
            f"Word: sem PDF irmão para {os.path.basename(abs_path)}; "
            "inserção SVG pode travar."
        )
        return abs_path
    try:
        import fitz

        pdf_doc = fitz.open(pdf)
        try:
            pix = pdf_doc[0].get_pixmap(dpi=_WORD_PNG_DPI)
            pix.save(png)
        finally:
            pdf_doc.close()
    except Exception as exc:
        logs.append(f"Word: rasterização do PDF falhou ({exc}).")
        return abs_path
    if _arquivo_exportado_ok(png):
        logs.append(
            f"Word: {os.path.basename(png)} rasterizado do PDF ({_WORD_PNG_DPI} dpi)."
        )
        return os.path.abspath(png)
    return abs_path


def _proporcao_para_encaixe(imagem_path: str, novo: Any) -> Optional[float]:
    dims = _dimensao_arquivo(imagem_path)
    if dims and dims[1] > 0.01:
        return dims[0] / dims[1]
    try:
        nat_w = float(novo.Width)
        nat_h = float(novo.Height)
        if nat_w > 0.01 and nat_h > 0.01:
            return nat_w / nat_h
    except Exception:
        pass
    return None


def _encaixar_inline_na_caixa(novo: Any, box_w: float, box_h: float, imagem_path: str) -> None:
    """Usa a proporção do arquivo; nunca força Width e Height da caixa ao mesmo tempo."""
    ratio = _proporcao_para_encaixe(imagem_path, novo)
    try:
        novo.LockAspectRatio = 0
    except Exception:
        pass
    if ratio and ratio > 0:
        if box_h * ratio <= box_w:
            novo.Height = box_h
            novo.Width = box_h * ratio
        else:
            novo.Width = box_w
            novo.Height = box_w / ratio
    else:
        novo.Width = box_w
    try:
        novo.LockAspectRatio = _MSO_TRUE
    except Exception:
        pass


def _substituir_inline_por_imagem(ishape: Any, imagem_path: str, logs: list[str], rotulo: str) -> None:
    box_w = float(ishape.Width)
    box_h = float(ishape.Height)
    rng = ishape.Range
    ishape.Delete()
    novo = rng.InlineShapes.AddPicture(
        FileName=os.path.abspath(imagem_path),
        LinkToFile=False,
        SaveWithDocument=True,
    )
    _encaixar_inline_na_caixa(novo, box_w, box_h, imagem_path)
    logs.append(
        f"Word: {rotulo} substituído (caixa {box_w:.1f}×{box_h:.1f} pt) ← "
        f"{os.path.basename(imagem_path)}"
    )


def _montar_docx_com_imagens(
    template_path: str,
    dest_docx: str,
    cabecalho_img: str,
    rodape_img: str,
    temp_job_dir: str,
    logs: list[str],
    word: Any = None,
) -> None:
    import pythoncom
    import win32com.client  # type: ignore

    own_word = word is None
    if own_word:
        pythoncom.CoInitialize()
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

        if own_word:
            word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0
        try:
            word.ConfirmConversions = False
        except Exception:
            pass

        cab_word = _caminho_para_word(cabecalho_img, logs)
        rod_word = _caminho_para_word(rodape_img, logs)
        doc = word.Documents.Open(
            os.path.abspath(work_copy),
            False,
            False,
            False,
        )

        section = doc.Sections.Item(1)
        header = section.Headers.Item(_WD_HEADER_FOOTER_PRIMARY)
        footer = section.Footers.Item(_WD_HEADER_FOOTER_PRIMARY)

        ish_cab = _encontrar_inline_cabecalho(header)
        ish_rod = _encontrar_inline_rodape(footer)
        _substituir_inline_por_imagem(ish_cab, cab_word, logs, "Cabeçalho")
        _substituir_inline_por_imagem(ish_rod, rod_word, logs, "Rodapé")

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
        if own_word and word is not None:
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

    import pythoncom
    import win32com.client  # type: ignore

    pythoncom.CoInitialize()
    word = None
    try:
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0
        try:
            word.ConfirmConversions = False
        except Exception:
            pass
        _montar_docx_com_imagens(
            template_cor, dest_cor, path_cab, path_rod, temp_job_dir, logs, word=word
        )
        _montar_docx_com_imagens(
            template_pb, dest_pb, path_cab, path_rod, temp_job_dir, logs, word=word
        )
    finally:
        if word is not None:
            try:
                word.Quit()
            except Exception:
                pass
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass

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
