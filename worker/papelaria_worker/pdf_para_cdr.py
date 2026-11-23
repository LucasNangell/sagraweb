"""
«Gerar Corel» a partir do PDF final (modo Prova PDF).

O servidor monta o PDF do produto com os dados do job — o mesmo da prova:
campos, textos editados na prévia, frente/verso e redes sociais — e grava na
pasta da OS. Aqui o CorelDRAW abre esse PDF (texto importado como texto, com a
fonte original) e o documento é salvo como .cdr da OS (BaseSefoc.cdr). O
modelo .cdr não é usado.
"""
from __future__ import annotations

import os
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from typing import Any, Optional

import corel_generator as cg
from corel_generator import CorelGenerationError, GenerationResult

# Constantes do CorelDRAW (cdrShapeType / cdrFilter) — usadas quando o
# win32com não expõe win32com.client.constants.
CDR_TEXT_SHAPE = 6
CDR_GROUP_SHAPE = 7


def _contar_textos(doc: Any) -> int:
    """Objetos de texto (editáveis) no documento, inclusive dentro de grupos."""
    total = 0

    def visitar(shapes: Any) -> None:
        nonlocal total
        try:
            n = int(shapes.Count)
        except Exception:
            return
        for i in range(1, n + 1):
            try:
                shape = shapes.Item(i)
                tipo = int(shape.Type)
            except Exception:
                continue
            if tipo == CDR_TEXT_SHAPE:
                total += 1
            elif tipo == CDR_GROUP_SHAPE:
                try:
                    visitar(shape.Shapes)
                except Exception:
                    pass

    try:
        paginas = int(doc.Pages.Count)
    except Exception:
        return 0
    for p in range(1, paginas + 1):
        try:
            pagina = doc.Pages.Item(p)
        except Exception:
            continue
        try:
            camadas = pagina.Layers
            for c in range(1, int(camadas.Count) + 1):
                visitar(camadas.Item(c).Shapes)
        except Exception:
            visitar(getattr(pagina, "Shapes", None))
    return total


def _nomear_paginas(doc: Any, logs: list[str]) -> None:
    """Frente/Verso como nos .cdr da prova web."""
    nomes = ("Frente", "Verso")
    try:
        n = int(doc.Pages.Count)
    except Exception:
        return
    if n > len(nomes):
        return
    for i in range(1, n + 1):
        try:
            doc.Pages.Item(i).Name = nomes[i - 1]
        except Exception as exc:
            logs.append(f"Aviso: não foi possível nomear a página {i}: {exc}")
            return
    logs.append(f"Páginas nomeadas: {', '.join(nomes[:n])}.")


def _salvar_como_cdr(corel: Any, doc: Any, destino: str, logs: list[str]) -> None:
    """SaveAs com StructSaveAsOptions (o mesmo caminho robusto das credenciais)."""
    from credenciais_depol_generator import _save_document_as

    try:
        _save_document_as(doc, destino, logs, corel)
    except CorelGenerationError:
        raise
    except Exception as exc:
        raise CorelGenerationError(f"Não foi possível salvar o CDR: {exc}") from exc
    if not os.path.isfile(destino):
        raise CorelGenerationError("O CorelDRAW não gravou o CDR.")


def _gerar_cdr_de_pdf_impl(
    pdf_path: str,
    temp_pdf_path: str,
    temp_cdr_path: str,
    corel_visible: bool,
    logs: list[str],
    meta: dict[str, Any],
) -> None:
    t0 = time.perf_counter()
    cg._corel_session._ensure_com()
    os.makedirs(os.path.dirname(temp_cdr_path), exist_ok=True)
    # Cópia local: o Corel não trava o arquivo da pasta da OS.
    shutil.copy2(pdf_path, temp_pdf_path)
    corel_reused = cg._corel_session.has_application()
    concluido = False
    try:
        for tentativa in range(2):
            doc = None
            try:
                corel = cg._corel_session.get_application(corel_visible, force_new=tentativa > 0)
                logs.append(
                    "CorelDRAW reiniciado após desconexão COM."
                    if tentativa
                    else f"CorelDRAW {'reutilizado' if corel_reused else 'iniciado'} (Visible={corel_visible})."
                )
                doc = corel.OpenDocument(os.path.abspath(temp_pdf_path))
                paginas = int(doc.Pages.Count)
                logs.append(f"PDF importado no CorelDRAW — {paginas} página(s).")
                textos = _contar_textos(doc)
                meta["textos"] = textos
                if textos:
                    logs.append(f"{textos} texto(s) editável(is) no documento.")
                else:
                    logs.append(
                        "Aviso: o CorelDRAW importou o PDF sem textos editáveis (texto "
                        "como curvas). Nesta máquina, abra um PDF no CorelDRAW e marque "
                        "«Importar texto como: Texto» — a opção fica gravada."
                    )
                _nomear_paginas(doc, logs)
                cg._sincronizar_documento_corel(corel, doc, logs, antes_de_gravar=True)
                _salvar_como_cdr(corel, doc, temp_cdr_path, logs)
                cg._fechar_documento_corel(doc, logs)
                doc = None
                logs.append(f"Conversão PDF → CDR em {time.perf_counter() - t0:.1f}s.")
                concluido = True
                return
            except Exception as exc:
                if tentativa == 0 and cg._is_com_disconnect_error(exc):
                    cg.reset_corel_session()
                    cg._reset_com_in_current_thread()
                    logs.append("Conexão CorelDRAW perdida — nova tentativa com instância limpa.")
                    continue
                if isinstance(exc, CorelGenerationError):
                    raise
                raise CorelGenerationError(cg.humanizar_erro_corel(exc)) from exc
            finally:
                if doc is not None:
                    cg._fechar_documento_sem_salvar(doc, logs)
    finally:
        cg._release_corel_after_job(logs, completed=concluido)


def _executar(func: Any, *args: Any, timeout: float, **kwargs: Any) -> Any:
    """Na thread única do Corel quando o gerador a tem; senão numa thread própria."""
    executar_no_corel = getattr(cg, "executar_no_corel", None)
    if executar_no_corel is not None:
        return executar_no_corel(func, *args, timeout=timeout, **kwargs)
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(func, *args, **kwargs).result(timeout=timeout)


def validar_pdf_fonte(pdf_path: str, output_dir: str) -> None:
    if not pdf_path or not os.path.isfile(pdf_path):
        raise CorelGenerationError(
            f"PDF para gerar o Corel não encontrado na pasta da OS: {pdf_path or '(vazio)'}"
        )
    if not os.path.isdir(output_dir):
        raise CorelGenerationError(f"Pasta de saída inacessível: {output_dir}")


def gerar_cdr_de_pdf(
    *,
    pdf_path: str,
    temp_dir: str,
    output_cdr_path: str,
    output_pdf_path: str,
    corel_visible: bool = False,
    job_timeout_sec: int = 300,
    job_id: Optional[int] = None,
) -> GenerationResult:
    """
    Cria ``output_cdr_path`` importando ``pdf_path`` no CorelDRAW (texto
    editável). O PDF importado é o próprio PDF final: vira ``output_pdf_path``
    (BaseSefoc.pdf) sem nova exportação.
    """
    logs: list[str] = []
    output_dir = os.path.dirname(output_cdr_path) or os.path.dirname(output_pdf_path)
    validar_pdf_fonte(pdf_path, output_dir)
    temp_job_dir = os.path.join(temp_dir, f"job_{job_id}" if job_id else "job")
    os.makedirs(temp_job_dir, exist_ok=True)
    temp_pdf = os.path.join(temp_job_dir, "fonte.pdf")
    temp_cdr = os.path.join(temp_job_dir, "working.cdr")
    meta: dict[str, Any] = {}
    try:
        _executar(
            _gerar_cdr_de_pdf_impl,
            pdf_path,
            temp_pdf,
            temp_cdr,
            corel_visible,
            logs,
            meta,
            timeout=max(30, job_timeout_sec),
        )
    except FuturesTimeoutError as exc:
        cg.encerrar_corel_forcadamente(matar_processo=True)
        raise CorelGenerationError(
            f"Conversão do PDF excedeu o tempo limite de {job_timeout_sec}s — "
            "CorelDRAW encerrado. O job pode ser reprocessado por outro worker."
        ) from exc
    except CorelGenerationError:
        raise
    except Exception as exc:
        if cg._is_com_disconnect_error(exc):
            cg.reset_corel_session()
            raise CorelGenerationError(
                cg.humanizar_erro_corel(exc, contexto="CorelDRAW desconectado")
            ) from exc
        raise CorelGenerationError(cg.humanizar_erro_corel(exc)) from exc

    os.makedirs(os.path.dirname(output_cdr_path) or output_dir, exist_ok=True)
    cg._copiar_arquivo_final(temp_cdr, output_cdr_path, logs, rotulo="CDR BaseSefoc")
    if os.path.normcase(os.path.abspath(pdf_path)) != os.path.normcase(os.path.abspath(output_pdf_path)):
        cg._copiar_arquivo_final(pdf_path, output_pdf_path, logs, rotulo="PDF")
    return GenerationResult(
        cdr_path=os.path.abspath(output_cdr_path),
        pdf_path=output_pdf_path,
        logs=logs,
    )
