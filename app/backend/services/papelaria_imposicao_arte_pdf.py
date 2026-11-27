"""
Imposição pré-impressa a partir do PDF base (sem CorelDRAW).

A imposição pré-impressa precisa, para cada OS do lote, de um PDF da arte sem
o Brasão (o papel já vem com ele impresso). O worker exporta esse PDF do .cdr
da OS. Quando a prova foi gerada no servidor (modo «Prova PDF») não há .cdr
atual: a arte vem do BaseSefoc.pdf e o servidor tira o Brasão recortando a
área dele do conteúdo da página.

Também recria PDFs intermediários (PreImpresso / ImposicaoGang) que tenham
sido apagados — p.ex. pela limpeza após o Apogee — quando o JDF é refeito.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

WORKER_ID_SERVIDOR = "servidor-imposicao-pdf"
# Brasão: o maior grupo de desenhos vetoriais encostados uns nos outros.
MIN_OBJETOS_BRASAO = 200
MAX_AREA_BRASAO = 0.25  # fração da página — acima disso não é o Brasão


def _jobs():
    from services import papelaria_jobs_service as jobs

    return jobs


# ---------------------------------------------------------------------------
# De onde vem a arte de cada OS
# ---------------------------------------------------------------------------


def prova_gerada_no_servidor(ano: int, nro: int) -> bool:
    """Última prova concluída da OS foi gerada pelo modo Prova PDF (sem Corel)."""
    from database import db
    from services.papelaria_prova_pdf_service import WORKER_ID_SERVIDOR as PROVA_PDF

    jobs = _jobs()
    rows = db.execute_query(
        """
        SELECT WorkerID FROM tabPapelariaJobs
        WHERE AnoProtocolo = %(ano)s AND NroProtocolo = %(nro)s
          AND TipoJob = %(tipo)s AND Status = %(status)s
        ORDER BY ID DESC
        LIMIT 1
        """,
        {"ano": int(ano), "nro": int(nro), "tipo": jobs.TIPO_JOB_CREATE, "status": jobs.STATUS_COMPLETED},
    )
    return bool(rows) and str(rows[0].get("WorkerID") or "").strip() == PROVA_PDF


def arte_da_os(ano: int, nro: int) -> dict[str, str]:
    """
    {"cdr_path", "arte_pdf_path"}: .cdr da OS (worker exporta) ou, quando a
    prova veio do servidor ou não há .cdr, o BaseSefoc.pdf.
    """
    jobs = _jobs()
    if not prova_gerada_no_servidor(ano, nro):
        try:
            info = jobs.select_os_usable_cdr(ano, nro)
            return {"cdr_path": info["absolute_path"], "arte_pdf_path": ""}
        except FileNotFoundError:
            pass
    try:
        base = jobs.resolve_base_sefoc_pdf_path(ano, nro)
    except FileNotFoundError:
        raise FileNotFoundError(
            f"OS {int(nro):05d}/{ano}: sem arquivo Corel (.cdr) nem PDF BaseSefoc na pasta. "
            "Gere a prova antes da imposição."
        ) from None
    return {"cdr_path": "", "arte_pdf_path": base}


def aplicar_arte_no_lote(lote: list[dict[str, Any]]) -> bool:
    """
    Completa cada item do lote com a origem da arte. Itens só com PDF já têm o
    PDF pré-impresso gerado aqui (``pre_pdf_pronto``). Retorna True quando o
    lote inteiro dispensa o CorelDRAW (o servidor faz a imposição).
    """
    todos_pdf = True
    for item in lote:
        arte = arte_da_os(int(item["ano"]), int(item["nro"]))
        item["cdr_path"] = arte["cdr_path"]
        if arte["arte_pdf_path"]:
            item["arte_pdf_path"] = arte["arte_pdf_path"]
            gerar_pre_impresso_de_pdf(arte["arte_pdf_path"], str(item["pre_pdf_path"]))
            item["pre_pdf_pronto"] = True
        else:
            todos_pdf = False
    return todos_pdf


# ---------------------------------------------------------------------------
# PDF pré-impresso a partir do PDF base
# ---------------------------------------------------------------------------


def area_do_brasao(page: Any) -> Optional[Any]:
    """Retângulo (coordenadas fitz) do maior grupo de desenhos vetoriais, se for o Brasão."""
    import fitz

    grupos: list[list[Any]] = []  # [retângulo expandido, nº de objetos]
    for desenho in page.get_drawings():
        r = fitz.Rect(desenho["rect"])
        e = fitz.Rect(r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1)
        tocados = [g for g in grupos if g[0].intersects(e)]
        if not tocados:
            grupos.append([e, 1])
            continue
        alvo = tocados[0]
        alvo[0] |= e
        alvo[1] += 1
        for g in tocados[1:]:
            alvo[0] |= g[0]
            alvo[1] += g[1]
            grupos.remove(g)
    if not grupos:
        return None
    rect, n = max(grupos, key=lambda g: g[1])
    if n < MIN_OBJETOS_BRASAO:
        return None
    if rect.get_area() > MAX_AREA_BRASAO * page.rect.get_area():
        return None
    return rect


def _recortar_area(doc: Any, page: Any, area: Any) -> None:
    """Nada da página é desenhado dentro de ``area`` (clip par-ímpar)."""
    pdf = area * ~page.transformation_matrix
    pdf.normalize()
    mb = page.mediabox
    page.wrap_contents()
    antes = doc.get_new_xref()
    doc.update_object(antes, "<<>>")
    doc.update_stream(
        antes,
        (
            f"q {mb.x0:.4f} {mb.y0:.4f} {mb.width:.4f} {mb.height:.4f} re "
            f"{pdf.x0:.4f} {pdf.y0:.4f} {pdf.width:.4f} {pdf.height:.4f} re W* n\n"
        ).encode("latin-1"),
    )
    depois = doc.get_new_xref()
    doc.update_object(depois, "<<>>")
    doc.update_stream(depois, b"\nQ\n")
    conteudos = [antes, *page.get_contents(), depois]
    doc.xref_set_key(page.xref, "Contents", "[" + " ".join(f"{x} 0 R" for x in conteudos) + "]")


def gerar_pre_impresso_de_pdf(origem: str, destino: str) -> list[str]:
    """Primeira página do PDF base, sem o Brasão, gravada em ``destino``."""
    import fitz

    logs: list[str] = []
    if not os.path.isfile(origem):
        raise FileNotFoundError(f"PDF base não encontrado: {origem}")
    src = fitz.open(origem)
    try:
        if src.page_count < 1:
            raise ValueError(f"PDF base sem páginas: {os.path.basename(origem)}")
        doc = fitz.open()
        try:
            doc.insert_pdf(src, from_page=0, to_page=0)
            page = doc[0]
            area = area_do_brasao(page)
            if area is None:
                logs.append(
                    f"Pré-impresso de {os.path.basename(origem)}: Brasão não identificado — PDF usado como está."
                )
            else:
                textos = [
                    s["text"]
                    for b in page.get_text("dict")["blocks"]
                    for linha in b.get("lines", [])
                    for s in linha["spans"]
                    if s["text"].strip() and fitz.Rect(s["bbox"]).intersects(area)
                ]
                if textos:
                    logs.append(
                        f"Pré-impresso de {os.path.basename(origem)}: área do Brasão encosta em texto — "
                        "PDF usado como está."
                    )
                else:
                    _recortar_area(doc, page, area)
                    logs.append(f"Pré-impresso de {os.path.basename(origem)}: Brasão removido do PDF base.")
            os.makedirs(os.path.dirname(destino) or ".", exist_ok=True)
            tmp = destino + ".tmp"
            doc.save(tmp, garbage=3, deflate=True)
            os.replace(tmp, destino)
        finally:
            doc.close()
    finally:
        src.close()
    for msg in logs:
        logger.info(msg)
    return logs


# ---------------------------------------------------------------------------
# PDF combinado (uma arte por slot) — mesma regra do worker
# ---------------------------------------------------------------------------


def _arte_por_slot(dados: dict[str, Any]) -> list[str]:
    lote = list(dados.get("juntada_lote") or [])
    slot_map = list(dados.get("juntada_slot_map") or [])
    if slot_map:
        por_os = {(int(i["ano"]), int(i["nro"])): str(i["pre_pdf_path"]) for i in lote}
        out = []
        for entry in sorted(slot_map, key=lambda e: int(e.get("slot") or 0)):
            chave = (int(entry["ano"]), int(entry["nro"]))
            if chave not in por_os:
                raise ValueError(f"Slot {entry.get('slot')}: OS {chave[1]:05d}/{chave[0]} fora do lote.")
            out.append(por_os[chave])
        return out
    out = []
    for item in lote:
        out.extend([str(item["pre_pdf_path"])] * max(1, int(item.get("slots") or 1)))
    return out


def montar_pdf_combinado(dados: dict[str, Any], gang_path: str) -> str:
    import fitz

    paginas = _arte_por_slot(dados)
    if not paginas:
        raise ValueError("Imposição pré-impressa sem OS no lote.")
    out = fitz.open()
    try:
        for src in paginas:
            with fitz.open(src) as doc:
                if doc.page_count < 1:
                    raise ValueError(f"PDF pré-impresso sem páginas: {src}")
                out.insert_pdf(doc, from_page=0, to_page=0)
        os.makedirs(os.path.dirname(gang_path) or ".", exist_ok=True)
        tmp = gang_path + ".tmp"
        out.save(tmp)
        os.replace(tmp, gang_path)
    finally:
        out.close()
    return gang_path


def garantir_pdfs_pre_impresso(dados: dict[str, Any], gang_path: str) -> list[str]:
    """
    Recria o que faltar: PDF pré-impresso de cada OS (a partir do PDF base) e o
    PDF combinado. Retorna as mensagens do que foi refeito.
    """
    jobs = _jobs()
    logs: list[str] = []
    lote = list(dados.get("juntada_lote") or [])
    if not lote:
        raise FileNotFoundError(f"PDF combinado (pré-impresso) ausente: {gang_path or '(vazio)'}")
    faltou = False
    for item in lote:
        pre = str(item.get("pre_pdf_path") or "").strip()
        if not pre:
            ia, ir = int(item["ano"]), int(item["nro"])
            sefoc = jobs.resolve_os_papelaria_dir(ia, ir, create=True)
            pre = os.path.normpath(os.path.join(sefoc, jobs.build_pre_impresso_pdf_name(ia, ir)))
            item["pre_pdf_path"] = pre
        if os.path.isfile(pre):
            continue
        faltou = True
        origem = str(item.get("arte_pdf_path") or "").strip()
        if not origem or not os.path.isfile(origem):
            origem = jobs.resolve_base_sefoc_pdf_path(int(item["ano"]), int(item["nro"]))
        logs.extend(gerar_pre_impresso_de_pdf(origem, pre))
    if faltou or not gang_path or not os.path.isfile(gang_path):
        dados_lote = {**dados, "juntada_lote": lote}
        montar_pdf_combinado(dados_lote, gang_path)
        logs.append(f"PDF combinado refeito: {os.path.basename(gang_path)}.")
    return logs


# ---------------------------------------------------------------------------
# Imposição inteira no servidor (lote sem CorelDRAW)
# ---------------------------------------------------------------------------


def reservar_para_servidor(cursor: Any, job_id: int) -> None:
    """Na transação do INSERT: job já nasce do servidor — nenhum worker o pega."""
    cursor.execute(
        """
        UPDATE tabPapelariaJobs
        SET WorkerID = %(worker)s, IniciadoEm = NOW(), Tentativas = 1
        WHERE ID = %(id)s
        """,
        {"worker": WORKER_ID_SERVIDOR, "id": int(job_id)},
    )


def processar_no_servidor(job_id: int) -> dict[str, Any]:
    """Job já em ``processing`` com WorkerID do servidor: monta o PDF combinado e grava o JDF."""
    jobs = _jobs()
    job = jobs.get_job(int(job_id))
    if not job:
        raise LookupError("Job de imposição não encontrado.")
    try:
        dados = dict(job.get("dados") or {})
        gang_path = str(dados.get("gang_pdf_path") or "").strip()
        if not gang_path:
            raise ValueError("gang_pdf_path ausente no job.")
        for msg in garantir_pdfs_pre_impresso(dados, gang_path):
            jobs.append_job_log(int(job_id), msg, "info")
        jobs.append_job_log(
            int(job_id),
            f"Imposição sem CorelDRAW: arte a partir do PDF base — {os.path.basename(gang_path)}.",
            "info",
        )
        return jobs._complete_pre_impresso_imposicao_job(job, worker_id=WORKER_ID_SERVIDOR)
    except Exception as exc:
        msg = f"Imposição no servidor falhou: {exc}"
        logger.exception("Job #%s — %s", job_id, msg)
        try:
            jobs.fail_job(int(job_id), WORKER_ID_SERVIDOR, msg, retryable=False)
        except Exception:  # noqa: BLE001
            logger.exception("Job #%s — falha ao registrar erro", job_id)
        raise
