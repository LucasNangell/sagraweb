"""
Geração Corel/PDF — Credenciais DEPOL (JPG + SVG TXT0N, páginas 85×120 mm).

PDF: MediaBox 85×120 mm; TrimBox 75×110 mm (sangria 5 mm) via PyMuPDF.
"""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import Any, Optional

from corel_generator import (
    CorelGenerationError,
    GenerationResult,
    _ativar_documento_para_exportacao,
    _ativar_pagina_principal,
    _copiar_arquivo_final,
    _corel_session,
    _garantir_camada_prova_sefoc_imprimivel,
    _is_com_disconnect_error,
    _preparar_corel_para_edicao,
    _release_corel_after_job,
    _sincronizar_documento_corel,
    alterar_texto,
    encerrar_corel_forcadamente,
    exportar_pdf,
    humanizar_erro_corel,
    reset_corel_session,
    salvar_documento,
)

logger = logging.getLogger(__name__)

# cdrUnit (CorelDRAW Object Model):
#   cdrTenthMicron=0, cdrInch=1, cdrFoot=2, cdrMillimeter=3, cdrCentimeter=4,
#   cdrPixel=5, cdrMile=6, cdrMeter=7, ...
# BUG histórico: usávamos 7 achando mm — 7 é cdrMeter → página ~km / PDF em branco.
_CDR_MILLIMETER = 3
_CAMADA_CONTEUDO = "CredenciaisDepol"

# Página Corel / MediaBox = arte com sangria; TrimBox = corte final.
_DEPOL_MEDIA_W_MM = 85.0
_DEPOL_MEDIA_H_MM = 120.0
_DEPOL_BLEED_MM = 5.0  # 5 mm cada lado → TrimBox 75×110 mm
_MM_TO_PT = 72.0 / 25.4

# Tipografia Linha 1 (pt) — resto permanece como no SVG
DEPOL_L1_DIGIT_AFTER_DOT_PT = 32.0
DEPOL_L1_ISOLATED_LETTER_PT = 38.0


def _mm_to_pt(mm: float) -> float:
    return float(mm) * _MM_TO_PT


def compute_linha1_font_ranges(texto: str) -> list[dict[str, Any]]:
    """
    Ranges de fonte na Linha 1 (índices 0-based [start, end)).

    - Dígito imediatamente após '.' → 32 pt
    - Token de exatamente 1 letra (separado por whitespace) → 38 pt
    - Texto monolítico só dígitos ou só letras (sem espaços/ponto) → []
    """
    text = texto or ""
    if not text:
        return []

    stripped = text.strip()
    # Monolítico só dígitos ou só letras (sem espaço nem ponto) → tamanho do SVG
    if "." not in text and not any(ch.isspace() for ch in text):
        if stripped.isdigit() or stripped.isalpha():
            return []

    # Mapa por índice: size_pt
    sizes: dict[int, float] = {}

    for i, ch in enumerate(text):
        if ch == "." and i + 1 < len(text) and text[i + 1].isdigit():
            sizes[i + 1] = DEPOL_L1_DIGIT_AFTER_DOT_PT

    # Tokens separados por whitespace
    start = None
    for i, ch in enumerate(text + " "):  # sentinel espaço no fim
        if ch.isspace():
            if start is not None:
                token = text[start:i]
                if len(token) == 1 and token.isalpha():
                    sizes[start] = DEPOL_L1_ISOLATED_LETTER_PT
                start = None
        elif start is None:
            start = i

    ranges: list[dict[str, Any]] = []
    for idx in sorted(sizes.keys()):
        ranges.append(
            {"start": idx, "end": idx + 1, "size_pt": float(sizes[idx])}
        )
    return ranges


def _aplicar_fonte_ranges_corel(
    shape: Any,
    ranges: list[dict[str, Any]],
    logs: list[str],
    *,
    texto: str = "",
) -> None:
    """
    Aplica Size (pt) por intervalo na Linha 1.

    API confiável no Corel (comunidade / Object Model):
      shape.Text.Story.Characters(Index, Count).Size = pt
    Index 1-based, Count = quantidade de caracteres.
    """
    if not ranges:
        return

    try:
        # Selecionar o shape ajuda em algumas versões COM
        try:
            shape.CreateSelection()
        except Exception:
            pass
        text_obj = shape.Text
        story = text_obj.Story
    except Exception as exc:
        logs.append(f"Aviso: Story indisponível para fonte Linha1: {exc}")
        return

    try:
        story_text = str(story.Text or "").replace("\r", "").replace("\n", "")
    except Exception:
        story_text = texto or ""
    try:
        story_len = int(story.Length)
    except Exception:
        story_len = len(story_text)

    def _norm(s: str) -> str:
        return (s or "").replace("\r", "").replace("\n", "")

    def _try_set_size(get_range, first: int, count: int, size_pt: float, label: str) -> float:
        tr = get_range()
        before = float(tr.Size)
        tr.Size = float(size_pt)
        after = float(tr.Size)
        if abs(after - float(size_pt)) > 1.5 and abs(after - before) < 0.15:
            raise RuntimeError(
                f"{label}: Size não alterou ({before:.1f}→{after:.1f}, pedido {size_pt})"
            )
        return after

    aplicados = 0
    for rg in ranges:
        start = int(rg["start"])
        end = int(rg["end"])
        size_pt = float(rg["size_pt"])
        if end <= start:
            continue
        first = start + 1
        count = end - start
        expected = _norm(texto[start:end]) if texto else ""
        if story_len > 0 and first + count - 1 > story_len:
            logs.append(
                f"Aviso: range fonte Characters({first},{count}) além do Story "
                f"(len={story_len}) — ignorado."
            )
            continue

        ok = False
        got_size = None
        errors: list[str] = []

        # 1) Characters(Index, Count) — forma documentada na comunidade Corel
        try:
            def _chars():
                return story.Characters(first, count)

            tr0 = _chars()
            got_txt = _norm(str(getattr(tr0, "Text", "") or ""))
            if expected and got_txt and got_txt != expected:
                raise RuntimeError(
                    f"Characters texto '{got_txt}' != esperado '{expected}'"
                )
            got_size = _try_set_size(_chars, first, count, size_pt, "Characters")
            ok = True
        except Exception as exc:
            errors.append(f"Characters: {exc}")

        # 2) Story.Range(First, Last) inclusivo
        if not ok:
            try:
                last = first + count - 1

                def _range():
                    return story.Range(first, last)

                got_size = _try_set_size(_range, first, count, size_pt, "Story.Range")
                ok = True
            except Exception as exc:
                errors.append(f"Story.Range: {exc}")

        # 3) Text.Range
        if not ok and text_obj is not None:
            try:
                last = first + count - 1

                def _text_range():
                    return text_obj.Range(first, last)

                got_size = _try_set_size(
                    _text_range, first, count, size_pt, "Text.Range"
                )
                ok = True
            except Exception as exc:
                errors.append(f"Text.Range: {exc}")

        # 4) SetRange + Size no Story
        if not ok:
            try:
                last = first + count - 1
                story.SetRange(first, last)
                before = float(story.Size)
                story.Size = float(size_pt)
                after = float(story.Size)
                if story_len > 0:
                    try:
                        story.SetRange(1, story_len)
                    except Exception:
                        pass
                if abs(after - float(size_pt)) > 1.5 and abs(after - before) < 0.15:
                    raise RuntimeError(f"SetRange Size não alterou ({before}→{after})")
                got_size = after
                ok = True
            except Exception as exc:
                errors.append(f"SetRange: {exc}")

        # 5) Um caractere por vez via Characters(i, 1)
        if not ok:
            try:
                for ci in range(first, first + count):
                    tr = story.Characters(ci, 1)
                    tr.Size = float(size_pt)
                got_size = float(story.Characters(first, count).Size)
                ok = True
            except Exception as exc:
                errors.append(f"Characters/loop: {exc}")

        if ok:
            aplicados += 1
            if got_size is not None:
                logs.append(
                    f"Fonte Linha1 chars {first}+{count}: {size_pt}pt "
                    f"(lido {got_size:.1f}pt)."
                )
            else:
                logs.append(f"Fonte Linha1 chars {first}+{count}: {size_pt}pt.")
        else:
            logs.append(
                f"Aviso: falha ao aplicar {size_pt}pt em chars {first}+{count}: "
                + " | ".join(errors[-3:])
            )

    if aplicados:
        logs.append(f"Fonte Linha1: {aplicados}/{len(ranges)} intervalo(s) ok.")
    elif ranges:
        logs.append(
            f"Aviso: nenhum intervalo de fonte Linha1 aplicado "
            f"({len(ranges)} range(s), texto={texto!r})."
        )


def _aplicar_fonte_linha1_na_pagina(
    page: Any, linha1: str, logs: list[str]
) -> None:
    """Reaplica 32/38 na Linha 1 após posicionamentos finais (evita reset)."""
    texto = (linha1 or "").strip()
    ranges = compute_linha1_font_ranges(texto)
    if not ranges:
        logs.append(
            f"Fonte Linha1: sem ranges especiais para {texto!r} — mantém SVG."
        )
        return
    shapes = _collect_text_shapes(page)
    if not shapes:
        logs.append("Aviso: sem shapes de texto para fonte Linha1.")
        return

    def _story_plain(sh: Any) -> str:
        try:
            return (
                str(sh.Text.Story.Text or "")
                .replace("\r", "")
                .replace("\n", "")
                .strip()
            )
        except Exception:
            return ""

    target = None
    for sh in shapes:
        if _story_plain(sh) == texto:
            target = sh
            break
    if target is None:
        target = shapes[0]
        logs.append(
            "Aviso: shape Linha1 não casou pelo texto — usando shapes[0] "
            f"('{getattr(target, 'Name', '?')}')."
        )

    nome = str(getattr(target, "Name", "") or "?")
    logs.append(
        f"Aplicando fonte Linha1 no shape '{nome}' "
        f"({len(ranges)} intervalo(s), texto={texto!r})."
    )
    _aplicar_fonte_ranges_corel(target, ranges, logs, texto=texto)

def _aplicar_trimbox_sangria_pdf(
    pdf_path: str,
    logs: list[str],
    *,
    bleed_mm: float = _DEPOL_BLEED_MM,
    expected_w_mm: float = _DEPOL_MEDIA_W_MM,
    expected_h_mm: float = _DEPOL_MEDIA_H_MM,
) -> None:
    """
    Após PublishToPDF: MediaBox/BleedBox = página com sangria;
    TrimBox = inset uniforme (corte 75×110 mm com bleed 5 mm).
    """
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:
        raise CorelGenerationError(
            "PyMuPDF (pymupdf) é necessário para gravar TrimBox no PDF DEPOL. "
            "Instale com: pip install pymupdf"
        ) from exc

    if not pdf_path or not os.path.isfile(pdf_path):
        raise CorelGenerationError(f"PDF para TrimBox não encontrado: {pdf_path}")

    bleed_pt = _mm_to_pt(bleed_mm)
    expected_w_pt = _mm_to_pt(expected_w_mm)
    expected_h_pt = _mm_to_pt(expected_h_mm)
    toler_pt = _mm_to_pt(1.0)  # 1 mm

    doc = fitz.open(pdf_path)
    try:
        if doc.page_count < 1:
            raise CorelGenerationError("PDF sem páginas para aplicar TrimBox.")

        for i in range(doc.page_count):
            page = doc[i]
            media = fitz.Rect(page.mediabox)
            w = float(media.width)
            h = float(media.height)
            if abs(w - expected_w_pt) > toler_pt or abs(h - expected_h_pt) > toler_pt:
                logs.append(
                    f"Aviso página {i + 1}: MediaBox {w / _MM_TO_PT:.2f}×"
                    f"{h / _MM_TO_PT:.2f} mm "
                    f"(esperado ~{expected_w_mm}×{expected_h_mm} mm)."
                )

            # Inset a partir do MediaBox real (preserva origem do Corel).
            trim = fitz.Rect(
                media.x0 + bleed_pt,
                media.y0 + bleed_pt,
                media.x1 - bleed_pt,
                media.y1 - bleed_pt,
            )
            if trim.width <= 0 or trim.height <= 0:
                raise CorelGenerationError(
                    f"TrimBox inválido na página {i + 1} "
                    f"(bleed={bleed_mm} mm vs MediaBox)."
                )

            page.set_mediabox(media)
            page.set_cropbox(media)
            page.set_bleedbox(media)
            page.set_trimbox(trim)

        tmp_path = pdf_path + ".trimtmp"
        try:
            doc.save(tmp_path, garbage=3, deflate=True)
        except Exception as exc:
            raise CorelGenerationError(
                f"Falha ao gravar PDF com TrimBox: {exc}"
            ) from exc
    finally:
        doc.close()

    try:
        os.replace(tmp_path, pdf_path)
    except OSError as exc:
        try:
            if os.path.isfile(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        raise CorelGenerationError(
            f"Não foi possível substituir PDF após TrimBox: {exc}"
        ) from exc

    trim_w = expected_w_mm - 2 * bleed_mm
    trim_h = expected_h_mm - 2 * bleed_mm
    logs.append(
        f"PDF TrimBox aplicado: corte {trim_w:.0f}×{trim_h:.0f} mm "
        f"(sangria {bleed_mm:.0f} mm; MediaBox ~{expected_w_mm:.0f}×{expected_h_mm:.0f} mm)."
    )


def _resolve_cdr_millimeter() -> int:
    """Prefere constante tipada do win32com; fallback numérico correto (=3)."""
    try:
        import win32com.client

        const = win32com.client.constants
        val = int(getattr(const, "cdrMillimeter"))
        if val == _CDR_MILLIMETER:
            return val
        # Se typelib divergir, ainda preferimos o valor documentado
        logger.warning(
            "win32com.constants.cdrMillimeter=%s (esperado %s) — usando constante tipada.",
            val,
            _CDR_MILLIMETER,
        )
        return val
    except Exception:
        return _CDR_MILLIMETER


def svg_filename_for_linhas(n: int) -> str:
    if n < 1 or n > 3:
        raise ValueError("num_linhas deve ser 1, 2 ou 3")
    return f"TXT0{n}.svg"


def count_linhas_item(item: dict[str, Any]) -> int:
    n = 0
    for key in ("linha1", "linha2", "linha3"):
        if str(item.get(key) or "").strip():
            n += 1
        else:
            break
    return max(1, n) if str(item.get("linha1") or "").strip() else 0


def _safe_join(base_dir: str, filename: str) -> str:
    base = os.path.basename((filename or "").strip())
    if not base or base in (".", "..") or ".." in base:
        raise CorelGenerationError(f"Nome de arquivo inválido: {filename!r}")
    full = os.path.normpath(os.path.join(base_dir, base))
    real_file = os.path.realpath(full)
    real_base = os.path.realpath(base_dir)
    if not real_base.endswith(os.sep):
        real_base = real_base + os.sep
    if not (real_file.startswith(real_base) or real_file == os.path.realpath(base_dir)):
        raise CorelGenerationError(f"Arquivo fora da pasta permitida: {base}")
    return full


def _ensure_document_millimeters(doc: Any, logs: list[str]) -> int:
    """
    Força Application/Document.Unit = milímetros e confere.
    Sem isso, SizeWidth/CenterX são interpretados na unidade errada
    (ex.: Unit=7 é cdrMeter → página gigantesca e PDF em branco).
    """
    unit_mm = _resolve_cdr_millimeter()
    app = _app_from_doc(doc)
    if app is not None:
        for attr in ("Unit", "Units"):
            try:
                setattr(app, attr, unit_mm)
            except Exception:
                pass

    try:
        doc.Unit = unit_mm
    except Exception as exc:
        raise CorelGenerationError(
            f"Não foi possível definir Document.Unit=mm ({unit_mm}): {exc}"
        ) from exc

    try:
        atual = int(doc.Unit)
    except Exception:
        atual = -1
    if atual != unit_mm:
        try:
            doc.Unit = unit_mm
            atual = int(doc.Unit)
        except Exception:
            pass
    if atual != unit_mm:
        raise CorelGenerationError(
            f"Document.Unit não ficou em milímetros "
            f"(lido={atual}, esperado={unit_mm}=cdrMillimeter). "
            "cdrMeter=7 — não use esse valor para mm."
        )
    logs.append(f"Document.Unit=cdrMillimeter ({unit_mm}).")
    return unit_mm


def _set_page_size_mm(
    page: Any, width_mm: float, height_mm: float, logs: list[str], doc: Any = None
) -> None:
    """Define página em mm; valida leitura após gravar (detecta unidade errada)."""
    if doc is not None:
        _ensure_document_millimeters(doc, logs)

    w = float(width_mm)
    h = float(height_mm)

    applied = False
    last_exc: Optional[Exception] = None
    try:
        page.SizeWidth = w
        page.SizeHeight = h
        applied = True
    except Exception as exc:
        last_exc = exc
    if not applied:
        try:
            page.SetSize(w, h)
            applied = True
        except Exception as exc:
            last_exc = exc
    if not applied and hasattr(page, "SetSizeEx"):
        try:
            page.SetSizeEx(w, h)
            applied = True
        except Exception as exc:
            last_exc = exc
    if not applied:
        raise CorelGenerationError(
            f"Não foi possível definir tamanho da página {w}×{h} mm: {last_exc}"
        ) from last_exc

    try:
        rw = float(page.SizeWidth)
        rh = float(page.SizeHeight)
    except Exception as exc:
        raise CorelGenerationError(
            f"Página definida mas SizeWidth/Height ilegíveis: {exc}"
        ) from exc

    if abs(rw - w) > 0.5 or abs(rh - h) > 0.5:
        raise CorelGenerationError(
            f"Tamanho de página incorreto após definir mm: "
            f"lido {rw:.3f}×{rh:.3f} (esperado {w}×{h} mm). "
            f"Document.Unit provavelmente não é milímetro."
        )
    logs.append(f"Página {getattr(page, 'Index', '?')}: {rw:.2f}×{rh:.2f} mm (ok).")


_CAMADAS_SISTEMA = frozenset(
    {
        "guides",
        "desktop",
        "guias",
        "grelha",
        "grid",
        "guidelines",
        "document grid",
        "grelha do documento",
        "guides layer",
        "camada de guias",
        "desktop layer",
    }
)


def _nome_camada(layer: Any) -> str:
    try:
        return str(getattr(layer, "Name", "") or "").strip()
    except Exception:
        return ""


def _e_camada_sistema(nome: str) -> bool:
    return (nome or "").strip().lower() in _CAMADAS_SISTEMA


def _ativar_camada_unica(page: Any, logs: list[str]) -> Any:
    """
    Garante uma única camada de conteúdo para imports.
    Move shapes de camadas extras para ela e remove camadas vazias
    (mantém Guides/Desktop do Corel).
    """
    layer = None
    try:
        for i in range(1, int(page.Layers.Count) + 1):
            cand = page.Layers.Item(i)
            if _nome_camada(cand).lower() == _CAMADA_CONTEUDO.lower():
                layer = cand
                break
    except Exception:
        pass

    if layer is None:
        # Evita renomear Guides/Desktop; cria camada dedicada quando possível
        try:
            active = page.ActiveLayer
            if active is not None and not _e_camada_sistema(_nome_camada(active)):
                layer = active
                try:
                    layer.Name = _CAMADA_CONTEUDO
                except Exception:
                    pass
        except Exception:
            pass
        if layer is None:
            try:
                layer = page.CreateLayer(_CAMADA_CONTEUDO)
            except Exception:
                try:
                    layer = page.ActiveLayer
                except Exception as exc:
                    raise CorelGenerationError(f"Sem camada ativa: {exc}") from exc

    try:
        layer.Activate()
    except Exception:
        pass
    for prop, val in (("Visible", True), ("Printable", True), ("Editable", True)):
        try:
            setattr(layer, prop, val)
        except Exception:
            pass

    removidas = 0
    movidas = 0
    try:
        for i in range(int(page.Layers.Count), 0, -1):
            try:
                cand = page.Layers.Item(i)
                if cand == layer:
                    continue
                nome = _nome_camada(cand)
                if _e_camada_sistema(nome):
                    continue
                try:
                    n_shapes = int(cand.Shapes.Count)
                except Exception:
                    n_shapes = 0
                if n_shapes > 0:
                    try:
                        cand.Shapes.All().MoveToLayer(layer)
                        movidas += n_shapes
                    except Exception:
                        try:
                            for si in range(int(cand.Shapes.Count), 0, -1):
                                cand.Shapes.Item(si).MoveToLayer(layer)
                                movidas += 1
                        except Exception:
                            continue
                try:
                    if int(cand.Shapes.Count) == 0:
                        cand.Delete()
                        removidas += 1
                except Exception:
                    pass
            except Exception:
                continue
    except Exception:
        pass

    if movidas:
        logs.append(f"Shapes movidos para camada única: {movidas}.")
    if removidas:
        logs.append(f"Camadas extras removidas: {removidas}.")
    logs.append(f"Camada única ativa: {_CAMADA_CONTEUDO}.")
    return layer


def _app_from_doc(doc: Any) -> Any:
    for attr in ("Application", "Parent"):
        try:
            app = getattr(doc, attr, None)
            if app is not None:
                return app
        except Exception:
            continue
    return None


def _materialize_local_file(caminho: str, logs: list[str]) -> tuple[str, Optional[str]]:
    """
    Import COM falha com frequência em UNC; copia para TEMP local quando necessário.
    Retorna (caminho_para_import, caminho_temp_para_limpar|None).
    """
    abs_path = os.path.abspath(caminho)
    if not os.path.isfile(abs_path):
        raise CorelGenerationError(f"Arquivo para importar não encontrado: {abs_path}")

    # UNC / caminho de rede
    is_unc = abs_path.startswith("\\\\") or abs_path.startswith("//")
    if not is_unc:
        return abs_path, None

    base = os.path.basename(abs_path)
    stem, ext = os.path.splitext(base)
    fd, temp_path = tempfile.mkstemp(prefix=f"sagra_depol_{stem}_", suffix=ext or ".bin")
    os.close(fd)
    try:
        shutil.copy2(abs_path, temp_path)
    except Exception as exc:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise CorelGenerationError(
            f"Não foi possível copiar {base} para TEMP local: {exc}"
        ) from exc
    logs.append(f"Cópia local para import: {os.path.basename(temp_path)}")
    return temp_path, temp_path


def _prepare_import_options(app: Any) -> Any:
    """Opções de import com bitmap embutido (não link externo para TEMP/UNC)."""
    if app is None:
        return None
    try:
        opts = app.CreateStructImportOptions()
    except Exception:
        return None
    for prop, val in (
        ("LinkBitmapExternally", False),
        ("MaintainLayers", False),  # evita criar camadas por objeto importado
        ("CombineMultilayerBitmaps", True),
    ):
        try:
            setattr(opts, prop, val)
        except Exception:
            pass
    return opts


def _invoke_layer_import(layer: Any, path: str, app: Any = None) -> None:
    """
    Layer.Import é Sub(FileName, [Filter], [StructImportOptions]).

    Preferir StructImportOptions com LinkBitmapExternally=False — senão o Corel
    pode linkar o JPG ao TEMP e o PDF sai em branco após apagar a cópia local.
    """
    path = str(path)
    errors: list[str] = []
    opts = _prepare_import_options(app)

    # 1) Import com options (bitmap embutido)
    if opts is not None:
        for filt in (257, -1, 0, 1):  # cdrAutoSense varia por versão
            try:
                layer.Import(path, filt, opts)
                return
            except Exception as exc:
                errors.append(f"Import(filter={filt},opts): {exc}")

    # 2) Dispatch dinâmico só com filename
    try:
        import win32com.client

        dyn = win32com.client.dynamic.Dispatch(layer)
        if opts is not None:
            try:
                dyn.Import(path, 257, opts)
                return
            except Exception as exc:
                errors.append(f"dynamic.Import+opts: {exc}")
        dyn.Import(path)
        return
    except Exception as exc:
        errors.append(f"dynamic.Import: {exc}")

    # 3) Chamada direta (1 arg)
    try:
        layer.Import(path)
        return
    except Exception as exc:
        errors.append(f"Import(path): {exc}")

    # 4) Invoke COM explícito só com BSTR do path
    try:
        import pythoncom

        ole = getattr(layer, "_oleobj_", None)
        if ole is not None:
            dispid = ole.GetIDsOfNames(0, "Import")
            if isinstance(dispid, (list, tuple)):
                dispid = dispid[0]
            ole.Invoke(dispid, 0, pythoncom.DISPATCH_METHOD, True, path)
            return
    except Exception as exc:
        errors.append(f"ole.Invoke: {exc}")

    raise CorelGenerationError(
        "Falha ao importar via COM — "
        + " | ".join(errors[-3:])
    )


def _com_call_one_arg(obj: Any, method: str, arg: str) -> None:
    """Chama método COM com 1 argumento, contornando opcionais Struct* do typelib."""
    arg = str(arg)
    errors: list[str] = []

    try:
        import win32com.client

        dyn = win32com.client.dynamic.Dispatch(obj)
        getattr(dyn, method)(arg)
        return
    except Exception as exc:
        errors.append(f"dynamic.{method}: {exc}")

    try:
        getattr(obj, method)(arg)
        return
    except Exception as exc:
        errors.append(f"{method}(arg): {exc}")

    try:
        import pythoncom

        ole = getattr(obj, "_oleobj_", None)
        if ole is not None:
            dispid = ole.GetIDsOfNames(0, method)
            if isinstance(dispid, (list, tuple)):
                dispid = dispid[0]
            ole.Invoke(dispid, 0, pythoncom.DISPATCH_METHOD, True, arg)
            return
    except Exception as exc:
        errors.append(f"ole.Invoke.{method}: {exc}")

    raise CorelGenerationError(
        f"Falha COM em {method} — " + " | ".join(errors[-3:])
    )


def _cdr_salvo_ok(caminho: str, *, min_bytes: int = 512) -> bool:
    try:
        return os.path.isfile(caminho) and os.path.getsize(caminho) >= min_bytes
    except OSError:
        return False


def _ativar_documento(corel: Any, doc: Any) -> None:
    try:
        corel.ActiveDocument = doc
    except Exception:
        pass
    for method_name in ("Activate", "MakeActive"):
        try:
            getattr(doc, method_name)()
            return
        except Exception:
            continue


def _save_document_as(
    doc: Any,
    caminho_cdr: str,
    logs: list[str],
    app: Any = None,
    *,
    min_bytes: int = 512,
) -> None:
    """
    Document.SaveAs(FileName, [StructSaveAsOptions]).

    Importante: algumas chamadas COM “retornam OK” sem gravar o arquivo.
    Sempre validamos existência/tamanho em disco.
    """
    caminho_cdr = os.path.abspath(caminho_cdr)
    os.makedirs(os.path.dirname(caminho_cdr) or ".", exist_ok=True)
    if os.path.exists(caminho_cdr):
        try:
            os.remove(caminho_cdr)
        except OSError:
            pass

    app = app or _app_from_doc(doc)
    if app is not None:
        _ativar_documento(app, doc)

    errors: list[str] = []

    def _ok(rotulo: str) -> bool:
        # Corel pode demorar um pouco para liberar o arquivo
        for _ in range(10):
            if _cdr_salvo_ok(caminho_cdr, min_bytes=min_bytes):
                logs.append(
                    f"CDR salvo ({rotulo}): {os.path.basename(caminho_cdr)} "
                    f"({os.path.getsize(caminho_cdr) // 1024} KB)."
                )
                return True
            time.sleep(0.2)
        errors.append(f"{rotulo}: sem arquivo em disco após SaveAs")
        return False

    # 1) StructSaveAsOptions (caminho preferencial — Overwrite explícito)
    if app is not None:
        try:
            opts = app.CreateStructSaveAsOptions()
            for prop, value in (
                ("Overwrite", True),
                ("EmbedICCProfile", False),
                ("IncludeCMXData", False),
            ):
                try:
                    setattr(opts, prop, value)
                except Exception:
                    pass
            doc.SaveAs(caminho_cdr, opts)
            if _ok("SaveAs+opts"):
                return
        except Exception as exc:
            errors.append(f"SaveAs+opts: {exc}")

    # 2) dynamic / Invoke só com path
    try:
        _com_call_one_arg(doc, "SaveAs", caminho_cdr)
        if _ok("SaveAs"):
            return
    except Exception as exc:
        errors.append(str(exc))

    # 3) ActiveDocument.SaveAs via application
    if app is not None:
        try:
            _ativar_documento(app, doc)
            active = app.ActiveDocument
            opts = None
            try:
                opts = app.CreateStructSaveAsOptions()
                opts.Overwrite = True
            except Exception:
                opts = None
            if opts is not None:
                active.SaveAs(caminho_cdr, opts)
            else:
                _com_call_one_arg(active, "SaveAs", caminho_cdr)
            if _ok("ActiveDocument.SaveAs"):
                return
        except Exception as exc:
            errors.append(f"ActiveDocument.SaveAs: {exc}")

    raise CorelGenerationError(
        "SaveAs CDR falhou (arquivo não gravado): "
        + (errors[-1] if errors else "erro desconhecido")
    )


def _clear_selection(doc: Any) -> None:
    for meth in ("ClearSelection",):
        try:
            getattr(doc, meth)()
            return
        except Exception:
            pass
    try:
        doc.Selection.RemoveAll()
    except Exception:
        pass


def _shape_static_id(shape: Any) -> Optional[int]:
    try:
        return int(shape.StaticID)
    except Exception:
        return None


def _snapshot_shape_ids(page: Any) -> set[int]:
    ids: set[int] = set()
    try:
        for i in range(1, int(page.Shapes.Count) + 1):
            sid = _shape_static_id(page.Shapes.Item(i))
            if sid is not None:
                ids.add(sid)
    except Exception:
        pass
    return ids


def _is_bitmap_shape(shape: Any) -> bool:
    """True para bitmap/JPG importado (não SVG)."""
    # cdrBitmapShape = 5 (CorelDRAW Object Model)
    try:
        if int(shape.Type) == 5:
            return True
    except Exception:
        pass
    try:
        bmp = getattr(shape, "Bitmap", None)
        if bmp is not None:
            # Bitmap property existe em vários tipos; confirma via Size/Handle
            try:
                _ = bmp.SizeWidth
                return True
            except Exception:
                pass
    except Exception:
        pass
    try:
        nome = str(getattr(shape, "Name", "") or "").lower()
        if "bitmap" in nome or nome.startswith("depoljpg"):
            return True
    except Exception:
        pass
    return False


def _shape_has_text(shape: Any) -> bool:
    try:
        if shape.Text is not None:
            return True
    except Exception:
        pass
    try:
        for i in range(1, int(shape.Shapes.Count) + 1):
            if _shape_has_text(shape.Shapes.Item(i)):
                return True
    except Exception:
        pass
    return False


def _list_new_shapes(page: Any, before_ids: set[int]) -> list[Any]:
    novos: list[Any] = []
    try:
        for i in range(1, int(page.Shapes.Count) + 1):
            sh = page.Shapes.Item(i)
            sid = _shape_static_id(sh)
            if sid is not None and sid not in before_ids:
                novos.append(sh)
    except Exception:
        pass
    return novos


def _group_shapes(doc: Any, shapes: list[Any], logs: list[str]) -> Any:
    """Agrupa apenas os shapes indicados; retorna o grupo (ou o único shape)."""
    if not shapes:
        return None
    if len(shapes) == 1:
        return shapes[0]
    try:
        _clear_selection(doc)
        for sh in shapes:
            try:
                sh.AddToSelection()
            except Exception:
                try:
                    doc.AddToSelection(sh)
                except Exception:
                    pass
        sel = doc.Selection
        if int(getattr(sel, "Count", 0) or 0) >= 2:
            sel.Group()
            grouped = _shape_from_selection_raw(doc)
            if grouped is not None:
                logs.append(f"Shapes importados agrupados ({len(shapes)}).")
                return grouped
    except Exception as exc:
        logs.append(f"Aviso ao agrupar import: {exc}")
    return shapes[-1]


def _shape_from_selection_raw(doc: Any) -> Any:
    try:
        sel = doc.Selection
        count = int(getattr(sel, "Count", 0) or 0)
        if count < 1:
            return None
        try:
            if getattr(sel, "Shapes", None) and int(sel.Shapes.Count) >= 1:
                return sel.Shapes.Item(1)
        except Exception:
            pass
        return sel.Item(1)
    except Exception:
        return None


def _name_shape(shape: Any, name: str) -> None:
    try:
        shape.Name = name
    except Exception:
        pass


def _find_shape_by_name(page: Any, name: str) -> Any:
    alvo = (name or "").strip().lower()
    if not alvo:
        return None
    try:
        for i in range(1, int(page.Shapes.Count) + 1):
            sh = page.Shapes.Item(i)
            if str(getattr(sh, "Name", "") or "").strip().lower() == alvo:
                return sh
    except Exception:
        pass
    return None


def _pick_imported_shape(
    doc: Any,
    page: Any,
    before_ids: set[int],
    logs: list[str],
    *,
    kind: str,
) -> Any:
    """
    Resolve o shape criado pelo último Import.
    kind='jpg' → bitmap; kind='svg' → não-bitmap (preferir com texto).
    Nunca usa a Selection cegamente: ela pode ainda apontar para o JPG.
    """
    novos = _list_new_shapes(page, before_ids)
    if not novos:
        # Fallback: shapes com índice > quantidade anterior
        logs.append("Aviso: nenhum StaticID novo após import — tentando Selection filtrada.")
        sel_shape = _shape_from_selection_raw(doc)
        if sel_shape is not None:
            if kind == "jpg" and _is_bitmap_shape(sel_shape):
                return sel_shape
            if kind == "svg" and not _is_bitmap_shape(sel_shape):
                return sel_shape

    if kind == "jpg":
        bitmaps = [s for s in novos if _is_bitmap_shape(s)]
        escolhido = bitmaps[-1] if bitmaps else (novos[-1] if novos else None)
    else:
        vetoriais = [s for s in novos if not _is_bitmap_shape(s)]
        com_texto = [s for s in vetoriais if _shape_has_text(s)]
        if len(com_texto) > 1:
            escolhido = _group_shapes(doc, com_texto, logs)
        elif len(com_texto) == 1:
            escolhido = com_texto[0]
        elif len(vetoriais) > 1:
            escolhido = _group_shapes(doc, vetoriais, logs)
        elif len(vetoriais) == 1:
            escolhido = vetoriais[0]
        else:
            # Não cair no JPG: se só há bitmap nos "novos", falha
            escolhido = None
            if novos and all(_is_bitmap_shape(s) for s in novos):
                logs.append(
                    "Import SVG não produziu shape vetorial novo "
                    "(Selection provavelmente era o JPG)."
                )

    return escolhido


def _import_file(
    doc: Any,
    page: Any,
    caminho: str,
    logs: list[str],
    *,
    pending_temps: Optional[list[str]] = None,
    kind: str = "auto",
) -> Any:
    """Importa arquivo na página ativa; retorna só o shape novo (jpg|svg)."""
    local_path, temp_to_clean = _materialize_local_file(caminho, logs)
    if temp_to_clean and pending_temps is not None:
        pending_temps.append(temp_to_clean)

    ext = os.path.splitext(caminho)[1].lower()
    if kind == "auto":
        if ext in (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"):
            kind = "jpg"
        else:
            kind = "svg"

    try:
        try:
            page.Activate()
        except Exception:
            pass

        layer = _ativar_camada_unica(page, logs)
        _clear_selection(doc)
        before_ids = _snapshot_shape_ids(page)

        app = _app_from_doc(doc)
        try:
            _invoke_layer_import(layer, local_path, app=app)
        except CorelGenerationError:
            try:
                _invoke_layer_import(doc.ActiveLayer, local_path, app=app)
            except Exception as exc:
                raise CorelGenerationError(
                    f"Falha ao importar {os.path.basename(caminho)}: {exc}"
                ) from exc

        logs.append(f"Importado: {os.path.basename(caminho)} ({kind})")
        shape = _pick_imported_shape(doc, page, before_ids, logs, kind=kind)
        if shape is None:
            raise CorelGenerationError(
                f"Não foi possível identificar o shape importado "
                f"({os.path.basename(caminho)}, kind={kind})."
            )
        if kind == "jpg":
            _name_shape(shape, "DepolJpg")
        else:
            _name_shape(shape, "DepolSvg")
            if _is_bitmap_shape(shape):
                raise CorelGenerationError(
                    "Shape SVG resolvido como bitmap (JPG) — abortando para não "
                    "reposicionar a imagem de fundo."
                )
        try:
            logs.append(
                f"Shape {kind}: Name={getattr(shape, 'Name', '?')} "
                f"StaticID={_shape_static_id(shape)} "
                f"Type={getattr(shape, 'Type', '?')} "
                f"size={float(shape.SizeWidth):.1f}×{float(shape.SizeHeight):.1f} mm"
            )
        except Exception:
            pass
        _clear_selection(doc)
        return shape
    finally:
        if temp_to_clean and pending_temps is None:
            try:
                os.remove(temp_to_clean)
            except OSError:
                pass


def _garantir_camadas_conteudo_imprimiveis(doc: Any, logs: list[str]) -> None:
    """
    CreateDocument não usa ProvaSefoc — conteúdo fica em Layer 1 etc.
    PDF em branco costuma ser camada com Printable=False ou Visible=False.
    """
    skip = {
        "guides",
        "desktop",
        "guias",
        "grelha",
        "grid",
        "guidelines",
        "document grid",
        "grelha do documento",
    }
    ajustadas = 0
    try:
        total_paginas = int(doc.Pages.Count)
    except Exception:
        return

    for numero_pagina in range(1, total_paginas + 1):
        try:
            page = doc.Pages.Item(numero_pagina)
            total_camadas = int(page.Layers.Count)
        except Exception:
            continue
        for indice in range(1, total_camadas + 1):
            try:
                layer = page.Layers.Item(indice)
                nome = str(getattr(layer, "Name", "") or "").strip().lower()
                if nome in skip:
                    continue
                changed = False
                try:
                    if not bool(layer.Visible):
                        layer.Visible = True
                        changed = True
                except Exception:
                    pass
                try:
                    if not bool(layer.Printable):
                        layer.Printable = True
                        changed = True
                except Exception:
                    pass
                if changed:
                    ajustadas += 1
            except Exception:
                continue

    if ajustadas:
        logs.append(
            f"Camadas de conteúdo tornadas visíveis/imprimíveis: {ajustadas}."
        )


def _fit_shape_to_page(shape: Any, page: Any, logs: list[str]) -> None:
    """Posiciona/escala shape para cobrir a página (full-bleed, canto inferior esquerdo)."""
    if shape is None:
        return
    try:
        w = float(page.SizeWidth)
        h = float(page.SizeHeight)
        _set_shape_box_bottom_left_mm(shape, 0.0, 0.0, w, h)
        logs.append("JPG enquadrado na página.")
    except Exception as exc:
        logs.append(f"Aviso ao enquadrar JPG: {exc}")


def _set_shape_box_bottom_left_mm(
    shape: Any, x_mm: float, y_mm: float, w_mm: float, h_mm: float
) -> None:
    """Tamanho + posição pela base inferior esquerda (JPG full-bleed)."""
    _CDR_BOTTOM_LEFT = 9
    try:
        shape.SizeWidth = float(w_mm)
        shape.SizeHeight = float(h_mm)
        shape.LeftX = float(x_mm)
        shape.BottomY = float(y_mm)
        return
    except Exception:
        pass
    try:
        try:
            shape.ReferencePoint = _CDR_BOTTOM_LEFT
        except Exception:
            pass
        shape.SetSize(float(w_mm), float(h_mm))
        shape.SetPosition(float(x_mm), float(y_mm))
    except Exception:
        raise


def _set_shape_center_position_mm(shape: Any, cx_mm: float, cy_mm: float) -> None:
    """
    Move o shape pelo centro sem alterar SizeWidth/SizeHeight.

    O tamanho do SVG já vem do arquivo importado; forçar w/h das configs
    achatava/distorcia o bloco.
    """
    cx = float(cx_mm)
    cy = float(cy_mm)
    _CDR_CENTER = 5  # cdrCenter

    def _lido() -> tuple[Optional[float], Optional[float]]:
        try:
            return float(shape.CenterX), float(shape.CenterY)
        except Exception:
            return None, None

    def _ok(got_cx: Optional[float], got_cy: Optional[float]) -> bool:
        return (
            got_cx is not None
            and got_cy is not None
            and abs(got_cx - cx) <= 0.25
            and abs(got_cy - cy) <= 0.25
        )

    # 1) CenterX/Y direto (não toca no tamanho)
    try:
        shape.CenterX = cx
        shape.CenterY = cy
    except Exception:
        pass
    if _ok(*_lido()):
        return

    # 2) Move relativo a partir do centro atual
    try:
        cur_cx, cur_cy = _lido()
        if cur_cx is not None and cur_cy is not None:
            shape.Move(cx - cur_cx, cy - cur_cy)
    except Exception:
        pass
    if _ok(*_lido()):
        return

    # 3) ReferencePoint = centro + SetPosition (sem SetSize)
    try:
        shape.ReferencePoint = _CDR_CENTER
        shape.SetPosition(cx, cy)
    except Exception:
        pass
    if _ok(*_lido()):
        return

    # 4) LeftX/BottomY com tamanho intrínseco atual
    try:
        w = float(shape.SizeWidth)
        h = float(shape.SizeHeight)
        if w > 0 and h > 0:
            shape.LeftX = cx - w / 2.0
            shape.BottomY = cy - h / 2.0
    except Exception:
        pass


def _position_shape_mm(
    shape: Any,
    box: dict[str, Any],
    logs: list[str],
) -> None:
    """Posiciona SVG pelo centro (x_mm/y_mm); preserva tamanho intrínseco do arquivo."""
    if shape is None:
        logs.append("Aviso: shape SVG ausente — posição não aplicada.")
        return
    if _is_bitmap_shape(shape):
        raise CorelGenerationError(
            "Tentativa de posicionar bitmap (JPG) como SVG — abortado."
        )
    try:
        cx = float(box.get("x_mm", 0))
        cy = float(box.get("y_mm", 0))
        try:
            native_w = float(shape.SizeWidth)
            native_h = float(shape.SizeHeight)
        except Exception:
            native_w, native_h = -1.0, -1.0

        _set_shape_center_position_mm(shape, cx, cy)

        try:
            got_cx = float(shape.CenterX)
            got_cy = float(shape.CenterY)
            got_w = float(shape.SizeWidth)
            got_h = float(shape.SizeHeight)
            logs.append(
                f"SVG posicionado (tamanho nativo): pedido centro cx={cx} cy={cy} mm; "
                f"lido cx={got_cx:.2f} cy={got_cy:.2f} "
                f"w={got_w:.2f} h={got_h:.2f} mm."
            )
            if abs(got_cy - cy) > 0.5 or abs(got_cx - cx) > 0.5:
                raise CorelGenerationError(
                    f"Posição SVG não bate com o layout do modelo "
                    f"(pedido centro {cx}×{cy} mm, lido {got_cx:.2f}×{got_cy:.2f} mm)."
                )
            if (
                native_w > 0
                and native_h > 0
                and (abs(got_w - native_w) > 0.5 or abs(got_h - native_h) > 0.5)
            ):
                raise CorelGenerationError(
                    f"Tamanho do SVG foi alterado indevidamente "
                    f"(nativo {native_w:.2f}×{native_h:.2f} mm → "
                    f"{got_w:.2f}×{got_h:.2f} mm)."
                )
        except CorelGenerationError:
            raise
        except Exception:
            logs.append(f"SVG posicionado no centro: cx={cx} cy={cy} mm (tamanho nativo).")
    except CorelGenerationError:
        raise
    except Exception as exc:
        logs.append(f"Aviso ao posicionar SVG: {exc}")


def _shape_center_y(shape: Any) -> float:
    try:
        return float(shape.CenterY)
    except Exception:
        return 0.0


def _shape_center_xy(shape: Any) -> tuple[float, float]:
    try:
        return float(shape.CenterX), float(shape.CenterY)
    except Exception:
        return 0.0, _shape_center_y(shape)


def compute_visual_slot_targets(
    role_centers: list[tuple[float, float]],
    *,
    eps_mm: float = 0.5,
) -> Optional[list[tuple[float, float]]]:
    """
    Alvos (cx, cy) para cada papel de linha (índice 0 = Linha 1).

    Os slots visuais são os centros atuais ordenados do topo → base
    (CenterY decrescente no Corel). Retorna None se já alinhado ou Y colapsado.
    """
    if len(role_centers) < 2:
        return None
    ys = [cy for _, cy in role_centers]
    if max(ys) - min(ys) <= eps_mm:
        return None
    slots = sorted(role_centers, key=lambda p: p[1], reverse=True)
    already = all(
        abs(role_centers[i][0] - slots[i][0]) <= eps_mm
        and abs(role_centers[i][1] - slots[i][1]) <= eps_mm
        for i in range(len(role_centers))
    )
    if already:
        return None
    return slots


def _align_role_shapes_to_visual_slots(shapes: list[Any], logs: list[str]) -> None:
    """
    Unifica papel (TXT01=Linha1/fonte) com posição visual (topo→base).

    Nos SVGs DEPOL o id TXT01 carrega a fonte da Linha 1, mas em TXT02.svg o
    objeto TXT02 (fonte pequena) fica geometricamente acima. Ordenar só por nome
    ou só por Y resolve metade do problema — aqui movemos os shapes de papel
    para os slots Y (snapshot), depois o texto/fonte seguem o nome.
    """
    if len(shapes) < 2:
        return
    try:
        centers = [_shape_center_xy(sh) for sh in shapes]
    except Exception as exc:
        logs.append(f"Aviso: não foi possível ler centros p/ realinhar linhas: {exc}")
        return
    targets = compute_visual_slot_targets(centers)
    if targets is None:
        logs.append(
            "Linhas: papel já alinhado aos slots visuais (ou Y colapsado) — sem mover."
        )
        return
    for sh, (cx, cy), (ox, oy) in zip(shapes, targets, centers):
        if abs(cx - ox) <= 0.5 and abs(cy - oy) <= 0.5:
            continue
        nome = str(getattr(sh, "Name", "") or "?")
        try:
            _set_shape_center_position_mm(sh, cx, cy)
            logs.append(
                f"Realinhou '{nome}' "
                f"({ox:.1f},{oy:.1f}) → ({cx:.1f},{cy:.1f}) mm."
            )
        except Exception as exc:
            logs.append(f"Aviso: falha ao realinhar '{nome}': {exc}")


def _collect_text_shapes(page: Any) -> list[Any]:
    """
    Coleta textos do SVG na ordem das linhas (1 → 2 → 3).

    Preferência: LINHA1..3, depois ids/nomes TXT01..TXT03 (papel + fonte da linha
    no SVG). A geometria pode discordar do nome — ver
    `_align_role_shapes_to_visual_slots` antes de gravar o texto.
    """
    texts: list[Any] = []
    named: dict[str, Any] = {}
    seen_ids: set[int] = set()
    line_keys = (
        "LINHA1",
        "LINHA2",
        "LINHA3",
        "TXT01",
        "TXT02",
        "TXT03",
    )

    def _add(sh: Any) -> None:
        sid = _shape_static_id(sh)
        if sid is not None:
            if sid in seen_ids:
                return
            seen_ids.add(sid)
        has_text = False
        try:
            _ = sh.Text.Story
            has_text = True
        except Exception:
            try:
                if int(sh.Type) in (6, 7):  # artistic / paragraph text
                    has_text = True
            except Exception:
                pass
        if not has_text:
            return
        nome = str(getattr(sh, "Name", "") or "").strip().upper()
        if nome in line_keys:
            named[nome] = sh
        texts.append(sh)

    def _walk(shapes: Any) -> None:
        try:
            count = int(shapes.Count)
        except Exception:
            return
        for i in range(1, count + 1):
            try:
                sh = shapes.Item(i)
            except Exception:
                continue
            # Desce em grupos: só folhas de texto (evita ordem Z invertida do grupo)
            try:
                if hasattr(sh, "Shapes") and int(sh.Shapes.Count) > 0:
                    _walk(sh.Shapes)
                    continue
            except Exception:
                pass
            _add(sh)

    # Limita ao grupo DepolSvg quando existir
    root = _find_shape_by_name(page, "DepolSvg")
    try:
        if root is not None and hasattr(root, "Shapes") and int(root.Shapes.Count) > 0:
            _walk(root.Shapes)
        else:
            _walk(page.Shapes)
    except Exception:
        try:
            _walk(page.Shapes)
        except Exception:
            pass

    ordered = [named[k] for k in ("LINHA1", "LINHA2", "LINHA3") if k in named]
    if ordered:
        return ordered

    ordered = [named[k] for k in ("TXT01", "TXT02", "TXT03") if k in named]
    if ordered:
        return ordered

    # Último recurso: ordem de coleta (não CenterY)
    return texts


def _shape_from_selection(doc: Any) -> Any:
    """Compat: selection atual (sem Group cego — evita misturar JPG+SVG)."""
    return _shape_from_selection_raw(doc)


def _resolve_svg_shape(page: Any, imported_svg: Any, logs: list[str]) -> Any:
    """Garante referência ao SVG (nunca ao bitmap DepolJpg)."""
    named = _find_shape_by_name(page, "DepolSvg")
    if named is not None and not _is_bitmap_shape(named):
        return named
    if imported_svg is not None and not _is_bitmap_shape(imported_svg):
        return imported_svg
    # Fallback: grupo/shape com texto que não seja o JPG
    jpg = _find_shape_by_name(page, "DepolJpg")
    jpg_id = _shape_static_id(jpg) if jpg is not None else None
    try:
        for i in range(int(page.Shapes.Count), 0, -1):
            sh = page.Shapes.Item(i)
            if _shape_static_id(sh) == jpg_id:
                continue
            if _is_bitmap_shape(sh):
                continue
            if _shape_has_text(sh):
                _name_shape(sh, "DepolSvg")
                logs.append("SVG resolvido via shape com texto na página.")
                return sh
    except Exception:
        pass
    raise CorelGenerationError(
        "Não foi possível localizar o SVG na página (evitando mover o JPG)."
    )


def _aplicar_linhas_na_pagina(page: Any, linhas: list[str], logs: list[str]) -> None:
    shapes = _collect_text_shapes(page)
    if not shapes:
        raise CorelGenerationError(
            "Nenhum objeto de texto encontrado após importar o SVG. "
            "Verifique TXT01/TXT02/TXT03."
        )
    # Papel (TXT01=fonte L1) → slots visuais (topo→base); texto por papel.
    # Fonte 32/38 é aplicada depois do posicionamento final da página.
    _align_role_shapes_to_visual_slots(shapes, logs)

    for idx, texto in enumerate(linhas):
        if idx >= len(shapes):
            logs.append(
                f"Aviso: SVG tem {len(shapes)} texto(s); linha {idx + 1} ignorada."
            )
            break
        nome = str(getattr(shapes[idx], "Name", "") or "?")
        logs.append(
            f"Linha {idx + 1} → shape '{nome}' "
            f"(CenterY≈{_shape_center_y(shapes[idx]):.1f} mm)."
        )
        alterar_texto(shapes[idx], texto, logs)
    logs.append(f"Texto aplicado em {min(len(linhas), len(shapes))} linha(s).")


def _gerar_credenciais_depol_impl(
    dados: dict[str, Any],
    temp_cdr_path: str,
    output_cdr_path: str,
    output_pdf_path: str,
    corel_visible: bool,
    logs: list[str],
) -> None:
    _corel_session._ensure_com()

    itens = dados.get("itens") or []
    if not isinstance(itens, list) or not itens:
        raise CorelGenerationError("Job DEPOL sem itens.")

    jpg_dir = str(dados.get("jpg_dir") or "").strip()
    svg_dir = str(dados.get("svg_dir") or "").strip()
    if not jpg_dir or not os.path.isdir(jpg_dir):
        raise CorelGenerationError(f"Pasta JPG inválida: {jpg_dir}")
    if not svg_dir or not os.path.isdir(svg_dir):
        raise CorelGenerationError(f"Pasta SVG inválida: {svg_dir}")

    page_w = float(dados.get("page_w_mm") or 85)
    page_h = float(dados.get("page_h_mm") or 120)

    os.makedirs(os.path.dirname(temp_cdr_path), exist_ok=True)
    if os.path.exists(temp_cdr_path):
        os.remove(temp_cdr_path)

    job_completed = False
    doc = None
    pending_temps: list[str] = []
    try:
        for attempt in range(2):
            force_new = attempt > 0
            try:
                corel = _corel_session.get_application(
                    corel_visible, force_new=force_new
                )
                if force_new:
                    logs.append("CorelDRAW reiniciado após desconexão COM.")
                else:
                    logs.append(f"CorelDRAW iniciado (Visible={corel_visible}).")

                _preparar_corel_para_edicao(corel, logs)
                try:
                    corel.Unit = _resolve_cdr_millimeter()
                except Exception:
                    pass
                doc = corel.CreateDocument()
                _ensure_document_millimeters(doc, logs)

                # Página 1 já em 85×120 mm ANTES do SaveAs inicial
                page0 = doc.Pages.Item(1)
                _set_page_size_mm(page0, page_w, page_h, logs, doc=doc)
                _ativar_camada_unica(page0, logs)

                # Estabelece FileName cedo (padrão Papelaria: Open/Save em arquivo existente).
                _save_document_as(
                    doc, temp_cdr_path, logs, app=corel, min_bytes=64
                )
                # SaveAs pode resetar Unit em algumas versões — reafirma mm
                _ensure_document_millimeters(doc, logs)

                # Página 1 será usada no primeiro item; demais itens adicionam páginas
                first = True
                for item in itens:
                    modelo = str(item.get("modelo_arquivo") or "").strip()
                    n = int(item.get("num_linhas") or count_linhas_item(item))
                    if n < 1:
                        raise CorelGenerationError(
                            f"Item sem linhas válidas (modelo {modelo})."
                        )
                    svg_name = str(item.get("svg_arquivo") or svg_filename_for_linhas(n))
                    jpg_path = _safe_join(jpg_dir, modelo)
                    svg_path = _safe_join(svg_dir, svg_name)
                    if not os.path.isfile(jpg_path):
                        raise CorelGenerationError(f"JPG não encontrado: {modelo}")
                    if not os.path.isfile(svg_path):
                        raise CorelGenerationError(f"SVG não encontrado: {svg_name}")

                    linhas = [
                        str(item.get(f"linha{i}") or "").strip()
                        for i in range(1, n + 1)
                    ]

                    if first:
                        page = doc.Pages.Item(1)
                        first = False
                    else:
                        page = doc.AddPages(1)
                        # AddPages pode retornar PageRange; pegar a última
                        try:
                            if hasattr(page, "Item"):
                                page = doc.Pages.Item(doc.Pages.Count)
                        except Exception:
                            page = doc.Pages.Item(doc.Pages.Count)

                    _set_page_size_mm(page, page_w, page_h, logs, doc=doc)
                    _ativar_camada_unica(page, logs)
                    imported_jpg = _import_file(
                        doc,
                        page,
                        jpg_path,
                        logs,
                        pending_temps=pending_temps,
                        kind="jpg",
                    )
                    _fit_shape_to_page(imported_jpg, page, logs)

                    imported_svg = _import_file(
                        doc,
                        page,
                        svg_path,
                        logs,
                        pending_temps=pending_temps,
                        kind="svg",
                    )
                    svg_layout = item.get("svg_layout")
                    if not isinstance(svg_layout, dict):
                        svg_layout = {}
                    svg_shape = _resolve_svg_shape(page, imported_svg, logs)
                    _position_shape_mm(svg_shape, svg_layout, logs)
                    _aplicar_linhas_na_pagina(page, linhas, logs)
                    # Re-resolve após texto/grupo (StaticID do grupo pode mudar)
                    svg_shape = _resolve_svg_shape(page, svg_shape, logs)
                    _position_shape_mm(svg_shape, svg_layout, logs)
                    _ativar_camada_unica(page, logs)
                    svg_shape = _resolve_svg_shape(page, None, logs)
                    _position_shape_mm(svg_shape, svg_layout, logs)
                    # Garante que o JPG voltou ao full-bleed (caso Selection errada antiga)
                    jpg_shape = _find_shape_by_name(page, "DepolJpg") or imported_jpg
                    _fit_shape_to_page(jpg_shape, page, logs)
                    # Fonte por caractere por último — após moves/camada (evita reset)
                    if linhas:
                        _aplicar_fonte_linha1_na_pagina(page, linhas[0], logs)

                # Consolida camadas em todas as páginas antes do PDF
                try:
                    for pi in range(1, int(doc.Pages.Count) + 1):
                        _ativar_camada_unica(doc.Pages.Item(pi), logs)
                except Exception as exc:
                    logs.append(f"Aviso ao consolidar camadas finais: {exc}")

                _garantir_camada_prova_sefoc_imprimivel(doc, logs)
                _garantir_camadas_conteudo_imprimiveis(doc, logs)
                _ativar_pagina_principal(doc, logs)
                _sincronizar_documento_corel(corel, doc, logs, antes_de_gravar=True)

                # Documento já tem caminho — Save() como na Papelaria
                try:
                    salvar_documento(doc, logs)
                except Exception as exc:
                    logs.append(f"Save() falhou ({exc}); tentando SaveAs novamente.")
                    _save_document_as(doc, temp_cdr_path, logs, app=corel)

                if not _cdr_salvo_ok(temp_cdr_path, min_bytes=512):
                    raise CorelGenerationError(
                        f"CDR temporário não encontrado após salvar: {temp_cdr_path}"
                    )

                # PDF com o documento ainda aberto (bitmaps/TEMP ainda acessíveis).
                # Copia o CDR antes do PublishToPDF para preservar artefato mesmo se
                # o export alterar o doc em memória.
                os.makedirs(os.path.dirname(output_cdr_path), exist_ok=True)
                _copiar_arquivo_final(
                    temp_cdr_path, output_cdr_path, logs, rotulo="CDR"
                )

                temp_pdf = os.path.join(
                    os.path.dirname(temp_cdr_path), "working.pdf"
                )
                if os.path.exists(temp_pdf):
                    try:
                        os.remove(temp_pdf)
                    except OSError:
                        pass

                _ativar_documento_para_exportacao(corel, doc, logs)
                _garantir_camadas_conteudo_imprimiveis(doc, logs)
                exportar_pdf(corel, doc, temp_pdf, logs)

                pdf_size = 0
                try:
                    pdf_size = os.path.getsize(temp_pdf)
                except OSError:
                    pass
                # PDF só com página em branco costuma ser bem pequeno; JPG de credencial
                # embutido deve gerar dezenas/centenas de KB.
                if pdf_size < 20_000:
                    logs.append(
                        f"PDF suspeito ({pdf_size} bytes) — nova tentativa após Save."
                    )
                    try:
                        salvar_documento(doc, logs)
                    except Exception:
                        pass
                    if os.path.exists(temp_pdf):
                        try:
                            os.remove(temp_pdf)
                        except OSError:
                            pass
                    exportar_pdf(corel, doc, temp_pdf, logs)
                    try:
                        pdf_size = os.path.getsize(temp_pdf)
                    except OSError:
                        pdf_size = 0
                    if pdf_size < 20_000:
                        raise CorelGenerationError(
                            f"PDF gerado parece em branco ({pdf_size} bytes). "
                            "Verifique camadas imprimíveis e bitmaps embutidos."
                        )

                _aplicar_trimbox_sangria_pdf(temp_pdf, logs)

                os.makedirs(os.path.dirname(output_pdf_path), exist_ok=True)
                _copiar_arquivo_final(
                    temp_pdf, output_pdf_path, logs, rotulo="PDF"
                )

                try:
                    doc.Close()
                except Exception:
                    pass
                doc = None

                job_completed = True
                break
            except Exception as exc:
                if doc is not None:
                    try:
                        doc.Close()
                    except Exception:
                        pass
                    doc = None
                if attempt == 0 and _is_com_disconnect_error(exc):
                    reset_corel_session()
                    logs.append("COM desconectado — nova tentativa.")
                    continue
                raise
    finally:
        for temp_path in pending_temps:
            try:
                if temp_path and os.path.isfile(temp_path):
                    os.remove(temp_path)
            except OSError:
                pass
        # Sempre encerra o Corel após o job (sucesso ou falha) — libera a fila.
        _release_corel_after_job(logs, completed=job_completed)


def gerar_credenciais_depol(
    dados: dict[str, Any],
    temp_dir: str,
    output_cdr_path: str,
    output_pdf_path: str,
    *,
    corel_visible: bool = False,
    job_timeout_sec: int = 300,
    job_id: Optional[int] = None,
) -> GenerationResult:
    logs: list[str] = []
    job_tag = f"job_{job_id}" if job_id else "job_depol"
    temp_job_dir = os.path.join(temp_dir, job_tag)
    os.makedirs(temp_job_dir, exist_ok=True)
    temp_cdr_path = os.path.join(temp_job_dir, "working.cdr")

    out_dir = os.path.dirname(output_cdr_path) or output_cdr_path
    if not os.path.isdir(out_dir):
        try:
            os.makedirs(out_dir, exist_ok=True)
        except OSError as exc:
            raise CorelGenerationError(
                f"Pasta de saída indisponível: {out_dir} ({exc})"
            ) from exc

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            _gerar_credenciais_depol_impl,
            dados,
            temp_cdr_path,
            output_cdr_path,
            output_pdf_path,
            corel_visible,
            logs,
        )
        try:
            future.result(timeout=max(30, job_timeout_sec))
        except FuturesTimeoutError as exc:
            encerrar_corel_forcadamente(matar_processo=True)
            raise CorelGenerationError(
                f"Geração DEPOL excedeu o tempo limite de {job_timeout_sec}s."
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

    if not os.path.isfile(output_cdr_path):
        raise CorelGenerationError("CDR final DEPOL não foi gerado.")
    if not os.path.isfile(output_pdf_path):
        raise CorelGenerationError("PDF final DEPOL não foi gerado.")

    return GenerationResult(
        cdr_path=output_cdr_path,
        pdf_path=output_pdf_path,
        logs=logs,
    )
