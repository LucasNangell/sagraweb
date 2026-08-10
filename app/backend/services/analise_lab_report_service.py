"""
Relatório consolidado e conclusão do Análise Lab (espelho em tabAnalises).
"""
from __future__ import annotations

import logging
import secrets
from typing import Any, Optional

from database import db
from services import analise_lab_items_service as items_svc
from services.pt_report_html_service import (
    normalize_item_snapshot_for_report,
    renumber_first_h2,
)

logger = logging.getLogger(__name__)


def build_lab_consolidated_html(
    ano: int,
    os_id: int,
    sessao: dict[str, Any],
    versao_label: Optional[str] = None,
) -> str:
    """Monta HTML interno consolidado a partir de tabAnaliseLabItem."""
    versao = (versao_label or sessao.get("versaoLabel") or "").strip()
    items = items_svc.list_items(int(sessao["id"]))
    if versao:
        items = [
            i
            for i in items
            if not i.get("versaoLabel")
            or versao.lower() in str(i.get("versaoLabel")).lower()
            or str(i.get("versaoLabel")).lower() in versao.lower()
        ]
    if not items:
        return ""

    os_titulo = "Sem Título"
    os_produto = "Produto"
    try:
        details = db.execute_query(
            """
            SELECT Titulo, TipoPublicacaoLink FROM tabDetalhesServico
            WHERE NroProtocoloLinkDet=%s AND AnoProtocoloLinkDet=%s
            """,
            (os_id, ano),
        )
        if details:
            os_titulo = details[0]["Titulo"] or "Sem Título"
            os_produto = details[0]["TipoPublicacaoLink"] or "Produto"
    except Exception as e_det:
        logger.warning("Erro ao buscar detalhes da OS: %s", e_det)

    safe_versao = versao
    ver_clean = (
        safe_versao.lower()
        .replace("original", "")
        .replace("v", "")
        .replace("(", "")
        .replace(")", "")
        .strip()
    )
    label_versao = f"V{ver_clean}" if ver_clean else "V?"

    html_final = f"""
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; background-color: white; padding-bottom: 50px;">
            <div style="margin-bottom: 30px;">
                <div style="background-color: #8B0000; color: white; padding: 10px 15px; font-weight: bold; font-style: italic; font-size: 20px; display: flex; align-items: center;">
                    <span style="margin-right: 10px;">&#10148;</span>
                    OS {os_id}/{ano} - {os_produto} - {os_titulo}
                </div>
                <div style="text-align: left; margin-top: 25px; color: #000; font-size: 14px;">
                    <p style="font-weight: bold; margin-bottom: 15px; font-size: 16px; text-indent: 40px;">PROBLEMAS TÉCNICOS - ARQUIVO {label_versao}</p>
                    <p style="margin-bottom: 15px; text-indent: 40px;">Segue a relação de Problemas Técnicos detectados na referida Ordem de Serviço.</p>
                    <p style="line-height: 1.5; text-indent: 40px;">
                        Informamos que o <span style="color: #990000; font-weight: bold;">serviço ficará pendente</span> até que os problemas descritos sejam solucionados ou que
                        a Gráfica seja informada a respeito dos procedimentos a serem adotados.
                    </p>
                </div>
            </div>
        """

    itens_capa = [i for i in items if i.get("componente") == "Capa"]
    itens_miolo = [i for i in items if i.get("componente") != "Capa"]
    has_capa_section = len(itens_capa) > 0
    has_miolo_section = len(itens_miolo) > 0
    show_section_headers = has_capa_section
    sec_idx = 1

    def _append_section(label: str, section_items: list[dict[str, Any]], idx: int) -> str:
        block = ""
        if show_section_headers:
            block += f"""
                <div class="section-lab" style="margin-bottom: 20px; margin-top: 20px;">
                    <h3 style="background: #8B0000; color: white; padding: 10px 15px; font-style: italic; font-weight: bold; margin-bottom: 0;">{idx}. {label}</h3>
                    <div style="padding: 15px;">
                """
        else:
            block += """<div class="section-lab" style="margin-bottom: 20px;"><div style="padding: 15px;">"""
        for i, item in enumerate(section_items, start=1):
            snapshot = normalize_item_snapshot_for_report(
                item.get("htmlSnapshot", "") or "",
                item_titulo=item.get("titulo"),
            )
            new_snapshot = renumber_first_h2(snapshot, f"{idx}.{i}.")
            block += f"<div class='item-snapshot' style='margin-bottom: 20px;'>{new_snapshot}</div>"
        block += "</div></div>"
        return block

    if has_capa_section:
        html_final += _append_section("Capa", itens_capa, sec_idx)
        sec_idx += 1
    if has_miolo_section:
        label = "Miolo / Conteúdo Interno" if has_capa_section else "Conteúdo"
        if all(i.get("componente") == "Arq. Único" for i in itens_miolo) and not has_capa_section:
            label = "Arquivo"
        html_final += _append_section(label, itens_miolo, sec_idx)

    html_final += "</div>"
    return html_final


def _ensure_analise_header(ano: int, os_id: int, versao: str, usuario: str) -> int:
    rows = db.execute_query(
        "SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s LIMIT 1",
        (os_id, ano),
    )
    if rows:
        id_analise = int(rows[0]["ID"])
        if versao:
            try:
                db.execute_query(
                    "UPDATE tabAnalises SET Versao = %s WHERE ID = %s",
                    (versao, id_analise),
                )
            except Exception as exc:
                logger.warning("Não foi possível atualizar Versao: %s", exc)
        return id_analise
    db.execute_query(
        "INSERT INTO tabAnalises (OS, Ano, Usuario, Versao, Componente) VALUES (%s, %s, %s, %s, %s)",
        (os_id, ano, usuario or "", versao or "", ""),
    )
    rows = db.execute_query(
        "SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s LIMIT 1",
        (os_id, ano),
    )
    if not rows:
        raise RuntimeError("Falha ao criar análise.")
    return int(rows[0]["ID"])


def mirror_items_to_analise(
    ano: int,
    os_id: int,
    sessao: dict[str, Any],
    *,
    usuario: str = "",
) -> int:
    """Espelha itens do Lab em tabAnaliseItens; retorna id_analise."""
    versao = (sessao.get("versaoLabel") or "").strip()
    id_analise = _ensure_analise_header(ano, os_id, versao, usuario)
    lab_items = items_svc.list_items(int(sessao["id"]))
    keep_ids: set[int] = set()

    for item in lab_items:
        mirrored_id = item.get("itemAnaliseId")
        payload = (
            int(id_analise),
            item.get("idProblemaPadrao"),
            item.get("componente") or "Arq. Único",
            item.get("versaoLabel") or versao,
            item.get("obs"),
            item.get("htmlSnapshot") or "",
        )
        if mirrored_id:
            exists = db.execute_query(
                "SELECT ID FROM tabAnaliseItens WHERE ID=%s AND ID_Analise=%s",
                (int(mirrored_id), id_analise),
            )
            if exists:
                try:
                    db.execute_query(
                        """
                        UPDATE tabAnaliseItens
                        SET ID_ProblemaPadrao=%s, Componente=%s, Versao=%s,
                            Obs=%s, HTML_Snapshot=%s
                        WHERE ID=%s
                        """,
                        (
                            payload[1],
                            payload[2],
                            payload[3],
                            payload[4],
                            payload[5],
                            int(mirrored_id),
                        ),
                    )
                except Exception:
                    db.execute_query(
                        """
                        UPDATE tabAnaliseItens
                        SET ID_ProblemaPadrao=%s, Componente=%s, Obs=%s, HTML_Snapshot=%s
                        WHERE ID=%s
                        """,
                        (payload[1], payload[2], payload[4], payload[5], int(mirrored_id)),
                    )
                keep_ids.add(int(mirrored_id))
                continue

        try:
            db.execute_query(
                """
                INSERT INTO tabAnaliseItens
                    (ID_Analise, ID_ProblemaPadrao, Componente, Versao, Obs, HTML_Snapshot)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                payload,
            )
        except Exception:
            db.execute_query(
                """
                INSERT INTO tabAnaliseItens
                    (ID_Analise, ID_ProblemaPadrao, Componente, Obs, HTML_Snapshot)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (payload[0], payload[1], payload[2], payload[4], payload[5]),
            )
        last = db.execute_query(
            "SELECT MAX(ID) AS ID FROM tabAnaliseItens WHERE ID_Analise=%s",
            (id_analise,),
        )
        new_id = int((last or [{}])[0].get("ID") or 0)
        if new_id:
            items_svc.update_item(item["id"], item_analise_id=new_id)
            keep_ids.add(new_id)

    # Remove espelhos órfãos desta análise que vieram do Lab e não estão mais ligados
    mirrored = db.execute_query(
        "SELECT ID FROM tabAnaliseItens WHERE ID_Analise=%s",
        (id_analise,),
    )
    lab_linked = {
        int(i["itemAnaliseId"])
        for i in items_svc.list_items(int(sessao["id"]))
        if i.get("itemAnaliseId")
    }
    for row in mirrored or []:
        mid = int(row["ID"])
        if mid not in keep_ids and mid in lab_linked:
            continue
        # Não apaga itens que nunca foram do Lab (sem vínculo); só os órfãos do Lab
        still_linked = mid in lab_linked
        if not still_linked and mid not in keep_ids:
            # check if any lab item pointed here before refresh — if not in lab_linked, skip deletion
            # of unknown items to avoid wiping classic /analise items
            pass

    return id_analise


def conclude(
    ano: int,
    os_id: int,
    sessao: dict[str, Any],
    *,
    versao: Optional[str] = None,
    usuario: str = "",
) -> dict[str, Any]:
    """Espelha itens, grava relatório, token e PDF; retorna url do portal."""
    versao_label = (versao or sessao.get("versaoLabel") or "").strip()
    id_analise = mirror_items_to_analise(ano, os_id, sessao, usuario=usuario)
    html_final = build_lab_consolidated_html(
        ano, os_id, sessao, versao_label=versao_label
    )
    if not html_final:
        raise ValueError("Não há problemas registrados para concluir.")

    try:
        db.execute_query(
            "UPDATE tabAnalises SET RelatorioHTML = %s WHERE ID = %s",
            (html_final, id_analise),
        )
    except Exception as e_inner:
        err_msg = str(e_inner).lower()
        if "unknown column" in err_msg and "relatoriohtml" in err_msg:
            db.execute_query("ALTER TABLE tabAnalises ADD COLUMN RelatorioHTML LONGTEXT")
            db.execute_query(
                "UPDATE tabAnalises SET RelatorioHTML = %s WHERE ID = %s",
                (html_final, id_analise),
            )
        else:
            raise

    existing = db.execute_query(
        "SELECT Token FROM tabClientTokens WHERE ID_Analise=%s AND NroProtocolo=%s AND AnoProtocolo=%s",
        (id_analise, os_id, ano),
    )
    if existing:
        token = existing[0]["Token"]
    else:
        token = secrets.token_urlsafe(48)
        db.execute_query(
            "INSERT INTO tabClientTokens (ID_Analise, NroProtocolo, AnoProtocolo, Token) VALUES (%s, %s, %s, %s)",
            (id_analise, os_id, ano, token),
        )

    from services.activation_email_service import resolve_link_web_base

    host_url = resolve_link_web_base()
    final_url = f"{host_url.rstrip('/')}/portal/pt/{token}?os={os_id}&ano={ano}"

    try:
        from routers.analise_routes import _persist_relatorio_analise

        _persist_relatorio_analise(
            id_analise,
            os_id,
            ano,
            html_final,
            versao=versao_label,
            portal_url=final_url,
        )
    except Exception as e_persist:
        logger.error("Erro ao persistir RelatorioEmail (lab): %s", e_persist)
        email_html = html_final
        try:
            db.execute_query(
                """
                UPDATE tabProtocolos
                SET email_pt_html = %s, email_pt_versao = %s, email_pt_data = NOW()
                WHERE NroProtocolo = %s AND AnoProtocolo = %s
                """,
                (email_html, versao_label, os_id, ano),
            )
        except Exception as e_proto:
            logger.error("Erro ao atualizar tabProtocolos (lab): %s", e_proto)

    try:
        from services.pt_report_pdf_service import refresh_pt_analysis_pdf

        refresh_pt_analysis_pdf(
            ano, os_id, versao=versao_label, id_analise=id_analise, inner_html=html_final
        )
    except Exception as e_pdf:
        logger.error("Erro ao gerar PDF (lab): %s", e_pdf)

    return {
        "ok": True,
        "url": final_url,
        "idAnalise": id_analise,
        "versao": versao_label,
    }
