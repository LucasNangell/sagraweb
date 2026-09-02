"""

Portal de aprovação de prova — token público (sem sessão interna).

"""

from __future__ import annotations



import logging

import secrets

from datetime import datetime

from typing import Any, Optional

from urllib.parse import quote



from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile

from fastapi.responses import FileResponse

from pydantic import BaseModel, Field



from database import db

from routers.andamento_helpers import (
    format_andamento_obs,
    format_ponto,
    preserve_line_breaks,
)

from routers.os_audit_service import log_andamento_added

from security.api_auth import resolve_client_ip

from services.proof_files_service import (

    latest_proof_pdf_path,

    resolve_proof_pdf_for_token_row,

)



logger = logging.getLogger(__name__)



router = APIRouter(tags=["proof-portal"])





def _latest_proof_pdf(ano: int, os_id: int) -> Optional[str]:

    """Fallback legado — preferir resolve_proof_pdf_for_token_row."""

    return latest_proof_pdf_path(ano, os_id)





def ensure_proof_token(

    os_id: int,

    ano: int,

    versao: str,

    arquivo_prova: str,

    ponto_envio: Optional[str] = None,

) -> str:

    """

    Garante token ativo de prova para a OS.



    Política de reuso/invalidação:

    - Reutiliza token pendente se mesma OS/ano, mesma versão e mesmo ArquivoProva.

    - Se existir token pendente com arquivo ou versão diferente, expira tokens pendentes

      anteriores (DataExpiracao = NOW()) e cria novo token.

    """

    from services.proof_files_service import validate_proof_filename



    arquivo_norm = validate_proof_filename(arquivo_prova)

    versao_norm = str(versao or "1").strip() or "1"

    ponto_clean = (ponto_envio or "").strip() or None



    rows = db.execute_query(

        """

        SELECT ID, Token, Versao, ArquivoProva

        FROM tabProofTokens

        WHERE NroProtocolo = %s AND AnoProtocolo = %s

          AND (Aprovado IS NULL)

          AND (DataExpiracao IS NULL OR DataExpiracao > NOW())

        ORDER BY ID DESC

        """,

        (os_id, ano),

    )



    for row in rows or []:

        existing_file = (row.get("ArquivoProva") or "").strip()

        existing_ver = str(row.get("Versao") or "").strip() or "1"

        if existing_file == arquivo_norm and existing_ver == versao_norm:

            db.execute_query(

                """

                UPDATE tabProofTokens

                SET PontoEnvio = %s, DataEnvio = NOW()

                WHERE ID = %s

                """,

                (ponto_clean, row["ID"]),

            )

            return str(row["Token"])



    if rows:

        db.execute_query(

            """

            UPDATE tabProofTokens

            SET DataExpiracao = NOW()

            WHERE NroProtocolo = %s AND AnoProtocolo = %s

              AND (Aprovado IS NULL)

              AND (DataExpiracao IS NULL OR DataExpiracao > NOW())

            """,

            (os_id, ano),

        )



    token = secrets.token_urlsafe(48)

    db.execute_query(

        """

        INSERT INTO tabProofTokens

            (NroProtocolo, AnoProtocolo, Versao, ArquivoProva, Token, PontoEnvio, DataEnvio)

        VALUES (%s, %s, %s, %s, %s, %s, NOW())

        """,

        (os_id, ano, versao_norm, arquivo_norm, token, ponto_clean),

    )

    return token





TIPO_PROVA_WEB = "prova_web"


def ensure_prova_web_token(
    os_id: int,
    ano: int,
    versao: str = "1",
    ponto_envio: Optional[str] = None,
) -> str:
    """
    Garante token ativo de Prova WEB (flipbook) para a OS.

    Mesma política de reuso/invalidação de ensure_proof_token, porém sem vínculo
    a um PDF de Sefoc: o conteúdo vem do registro tabProvaWeb, resolvido a cada
    requisição, então o link continua válido se o arquivo da prova for trocado.
    """
    versao_norm = str(versao or "1").strip() or "1"
    ponto_clean = (ponto_envio or "").strip() or None

    rows = db.execute_query(
        """
        SELECT ID, Token, Versao, TipoProva
        FROM tabProofTokens
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
          AND (Aprovado IS NULL)
          AND (DataExpiracao IS NULL OR DataExpiracao > NOW())
        ORDER BY ID DESC
        """,
        (os_id, ano),
    )

    for row in rows or []:
        if (row.get("TipoProva") or "").strip() != TIPO_PROVA_WEB:
            continue
        if (str(row.get("Versao") or "").strip() or "1") != versao_norm:
            continue
        db.execute_query(
            """
            UPDATE tabProofTokens
            SET PontoEnvio = %s, DataEnvio = NOW()
            WHERE ID = %s
            """,
            (ponto_clean, row["ID"]),
        )
        return str(row["Token"])

    if rows:
        db.execute_query(
            """
            UPDATE tabProofTokens
            SET DataExpiracao = NOW()
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
              AND (Aprovado IS NULL)
              AND (DataExpiracao IS NULL OR DataExpiracao > NOW())
            """,
            (os_id, ano),
        )

    token = secrets.token_urlsafe(48)
    db.execute_query(
        """
        INSERT INTO tabProofTokens
            (NroProtocolo, AnoProtocolo, Versao, TipoProva, Token, PontoEnvio, DataEnvio)
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        """,
        (os_id, ano, versao_norm, TIPO_PROVA_WEB, token, ponto_clean),
    )
    return token


def _is_prova_web_token(proof_row: dict) -> bool:
    return (proof_row.get("TipoProva") or "").strip() == TIPO_PROVA_WEB


def build_proof_portal_url(os_id: int, ano: int, token: str) -> str:

    from services.activation_email_service import resolve_link_web_base



    base = resolve_link_web_base()

    return f"{base.rstrip('/')}/portal/aprovacao/{token}?os={os_id}&ano={ano}"





def _validate_proof_token(os_id: int, ano: int, token: str) -> dict:

    rows = db.execute_query(

        """

        SELECT ID, Versao, ArquivoProva, TipoProva, Aprovado, DataExpiracao

        FROM tabProofTokens

        WHERE NroProtocolo = %s AND AnoProtocolo = %s AND Token = %s

        """,

        (os_id, ano, token),

    )

    if not rows:

        raise HTTPException(status_code=403, detail="Token inválido ou expirado.")

    row = rows[0]

    if row.get("DataExpiracao") and row["DataExpiracao"] < datetime.now():

        raise HTTPException(status_code=403, detail="Link de prova expirado.")

    if row.get("Aprovado") is not None:

        raise HTTPException(status_code=409, detail="Esta prova já foi respondida.")

    return row





@router.get("/client/proof/{ano}/{os_id}")

def get_proof_portal_data(ano: int, os_id: int, token: str = Query(...)):

    proof = _validate_proof_token(os_id, ano, token)

    dados = db.execute_query(

        """

        SELECT p.GabSalaUsuario as gabinete, d.Titulo as titulo,

               d.TipoPublicacaoLink as produto, p.NomeUsuario as solicitante

        FROM tabProtocolos p

        LEFT JOIN tabDetalhesServico d

          ON p.NroProtocolo = d.NroProtocoloLinkDet

         AND p.AnoProtocolo = d.AnoProtocoloLinkDet

        WHERE p.NroProtocolo = %s AND p.AnoProtocolo = %s

        """,

        (os_id, ano),

    )

    meta = dados[0] if dados else {}

    pdf_path, arquivo_nome = resolve_proof_pdf_for_token_row(proof, ano, os_id)

    from services.proof_papelaria_service import (
        build_portal_papelaria_edit_payload,
        resolve_papelaria_proof_context,
    )

    papelaria_ctx = resolve_papelaria_proof_context(proof, ano, os_id)
    papelaria_edit = (
        build_portal_papelaria_edit_payload(proof, ano, os_id)
        if papelaria_ctx
        else None
    )

    payload: dict[str, Any] = {
        "os": os_id,
        "ano": ano,
        "versao": proof.get("Versao") or "1",
        "titulo": meta.get("titulo") or "",
        "produto": meta.get("produto") or "",
        "solicitante": meta.get("solicitante") or "",
        "gabinete": meta.get("gabinete") or "",
        "hasPdf": bool(pdf_path),
        "arquivoNome": arquivo_nome or "",
        "isPapelaria": bool(papelaria_ctx),
        "isProvaWeb": _is_prova_web_token(proof),
    }
    if papelaria_edit:
        payload["papelaria"] = papelaria_edit
    if papelaria_ctx:
        payload["cores"] = (
            (papelaria_edit or {}).get("cores")
            or (papelaria_ctx.get("cores") or "")
        ).strip()
    return payload





@router.get("/client/proof/{ano}/{os_id}/pdf")
def serve_proof_pdf(
    ano: int,
    os_id: int,
    token: str = Query(...),
    parte: Optional[str] = Query(
        None, description="unico|capa|miolo — só token prova_web"
    ),
):
    proof = _validate_proof_token(os_id, ano, token)
    if _is_prova_web_token(proof) and parte:
        from services.prova_web_record_service import resolve_prova_web_pdf_parte

        pdf_path, display_name = resolve_prova_web_pdf_parte(ano, os_id, parte)
    else:
        pdf_path, display_name = resolve_proof_pdf_for_token_row(proof, ano, os_id)

    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF da prova não encontrado.")
    safe_name = (display_name or "prova.pdf").replace('"', "")
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=safe_name,
        content_disposition_type="inline",
    )





@router.get("/client/proof/{ano}/{os_id}/preview-pages")

def get_proof_preview_pages(ano: int, os_id: int, token: str = Query(...)):

    proof = _validate_proof_token(os_id, ano, token)

    from services.proof_papelaria_service import resolve_papelaria_proof_context

    from services import papelaria_preview_service as preview_svc



    ctx = resolve_papelaria_proof_context(proof, ano, os_id)

    if not ctx:

        return {

            "isPapelaria": False,

            "pages": [],

            "total_pages": 0,

            "truncated": False,

            "mockupConfigJson": None,

            "produto": "",

            "arquivoModelo": "",

            "frenteVerso": "",

        }



    try:

        from config_manager import config_manager

        return preview_svc.build_proof_preview_pages_payload(
            ano,
            os_id,
            int(ctx["proof_id"]),
            ctx["pdf_path"],
            token=token,
            mockup_meta=ctx,
            api_prefix=config_manager.get_api_path_prefix(),
        )

    except FileNotFoundError as e:

        raise HTTPException(status_code=404, detail=str(e))

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:

        logger.exception(

            "Erro preview-pages prova OS %s/%s: %s", os_id, ano, e

        )

        raise HTTPException(

            status_code=500,

            detail="Não foi possível gerar a visualização 3D a partir do PDF.",

        )





@router.get("/client/proof/{ano}/{os_id}/preview-pages/{page}.png")

def serve_proof_preview_page(

    ano: int,

    os_id: int,

    page: int,

    token: str = Query(...),

):

    if page < 1:

        raise HTTPException(status_code=400, detail="Página inválida.")



    proof = _validate_proof_token(os_id, ano, token)

    from services.proof_papelaria_service import resolve_papelaria_proof_context

    from services import papelaria_preview_service as preview_svc



    ctx = resolve_papelaria_proof_context(proof, ano, os_id)

    if not ctx:

        raise HTTPException(

            status_code=404,

            detail="Visualização 3D não disponível para esta prova.",

        )



    try:

        path = preview_svc.resolve_proof_preview_page_path(

            ano,

            os_id,

            int(ctx["proof_id"]),

            ctx["pdf_path"],

            page,

        )

        return FileResponse(path=path, media_type="image/png")

    except FileNotFoundError as e:

        raise HTTPException(status_code=404, detail=str(e))

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:

        logger.exception(

            "Erro PNG preview prova OS %s/%s pág %s: %s", os_id, ano, page, e

        )

        raise HTTPException(status_code=500, detail="Erro ao servir prévia.")


def _require_prova_web_context(
    ano: int, os_id: int
) -> tuple[dict, str, list[str], str]:
    """Retorna (record, mode, source_paths, os_folder) da Prova WEB (latest)."""
    from services.prova_web_record_service import (
        get_prova_web_record,
        is_render_ready,
        require_os_folder,
        resolve_record_sources,
    )
    from services.prova_web_render_service import pasta_render_for_versao

    record = get_prova_web_record(ano, os_id)
    if not record:
        raise HTTPException(
            status_code=404,
            detail="Nenhum arquivo de prova registrado para esta OS.",
        )
    if record.get("isDraft"):
        raise HTTPException(
            status_code=404,
            detail="A prova ainda não está disponível para o cliente.",
        )
    if not is_render_ready(record):
        raise HTTPException(
            status_code=503,
            detail="A visualização da prova está temporariamente indisponível.",
        )
    try:
        folder = require_os_folder(ano, os_id)
        mode, sources = resolve_record_sources(ano, os_id, record)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not record.get("pastaRender"):
        record["pastaRender"] = pasta_render_for_versao(int(record.get("versao") or 1))
    return record, mode, sources, folder


def _load_portal_flipbook_manifest(
    ano: int, os_id: int, record: dict, mode: str, sources: list[str], folder: str
) -> dict:
    """Serve cache; se ausente, tenta reenfileirar internamente e responde 503."""
    from services.prova_web_record_service import mark_prova_web_render_pending
    from services.prova_web_job_service import enqueue_prova_web_render
    from services.prova_web_render_service import try_load_cached_manifest

    pasta = record["pastaRender"]
    cached = try_load_cached_manifest(
        mode=mode,
        source_paths=sources,
        os_folder=folder,
        pasta_render=pasta,
        crop_json=record.get("cropJson"),
    )
    if cached:
        return cached

    versao = int(record.get("versao") or 1)
    try:
        mark_prova_web_render_pending(ano, os_id, versao)
        enqueue_prova_web_render(ano, os_id, versao)
    except Exception as exc:
        logger.warning(
            "Portal flipbook: falha ao reenfileirar OS %s/%s: %s", os_id, ano, exc
        )
    raise HTTPException(
        status_code=503,
        detail="A visualização da prova está sendo regenerada. Tente novamente em instantes.",
    )


@router.get("/client/proof/{ano}/{os_id}/flipbook/manifest")
def get_proof_flipbook_manifest(ano: int, os_id: int, token: str = Query(...)):
    """Manifest do flipbook da Prova WEB — escopo do token (sem sessão interna)."""
    proof = _validate_proof_token(os_id, ano, token)
    if not _is_prova_web_token(proof):
        raise HTTPException(
            status_code=404,
            detail="Esta prova não possui visualização com folheamento.",
        )

    from config_manager import config_manager

    record, mode, sources, folder = _require_prova_web_context(ano, os_id)
    try:
        manifest = _load_portal_flipbook_manifest(
            ano, os_id, record, mode, sources, folder
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Erro flipbook prova OS %s/%s: %s", os_id, ano, exc
        )
        raise HTTPException(
            status_code=500,
            detail="Não foi possível gerar a visualização da prova.",
        ) from exc

    api_prefix = config_manager.get_api_path_prefix()
    base = f"{api_prefix}/client/proof/{ano}/{os_id}/flipbook/pages"
    quoted = quote(token, safe="")
    pages = [
        {**page, "url": f"{base}/{page['page']}.png?token={quoted}"}
        for page in manifest.get("pages", [])
    ]
    book_mockup = manifest.get("bookMockup")
    if isinstance(book_mockup, dict) and book_mockup.get("spineFile"):
        book_mockup = {
            **book_mockup,
            "spineUrl": (
                f"{api_prefix}/client/proof/{ano}/{os_id}/flipbook/assets/"
                f"{book_mockup['spineFile']}?token={quoted}"
            ),
        }
    payload = {**manifest, "pages": pages}
    if book_mockup:
        payload["bookMockup"] = book_mockup
    from services.prova_web_record_service import (
        normalize_prova_web_folhear_modo,
        prova_web_pdf_sources_meta,
    )

    payload["pdfSources"] = prova_web_pdf_sources_meta(record)
    payload["folhearModo"] = normalize_prova_web_folhear_modo(record.get("folhearModo"))
    return payload


@router.get("/client/proof/{ano}/{os_id}/flipbook/pages/{page}.png")
def serve_proof_flipbook_page(
    ano: int,
    os_id: int,
    page: int,
    token: str = Query(...),
):
    if page < 1:
        raise HTTPException(status_code=400, detail="Página inválida.")

    proof = _validate_proof_token(os_id, ano, token)
    if not _is_prova_web_token(proof):
        raise HTTPException(status_code=404, detail="Página não disponível.")

    from services.prova_web_render_service import resolve_rendered_page_path

    record, mode, sources, folder = _require_prova_web_context(ano, os_id)
    try:
        _load_portal_flipbook_manifest(ano, os_id, record, mode, sources, folder)
        path = resolve_rendered_page_path(folder, record["pastaRender"], page)
    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Erro PNG flipbook prova OS %s/%s pág %s: %s", os_id, ano, page, exc
        )
        raise HTTPException(status_code=500, detail="Erro ao servir a página.") from exc
    return FileResponse(
        path=path,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )


@router.get("/client/proof/{ano}/{os_id}/flipbook/assets/{name}")
def serve_proof_flipbook_asset(
    ano: int,
    os_id: int,
    name: str,
    token: str = Query(...),
):
    """Asset auxiliar do flipbook/mockup (ex.: spine.png) no escopo do token."""
    proof = _validate_proof_token(os_id, ano, token)
    if not _is_prova_web_token(proof):
        raise HTTPException(status_code=404, detail="Asset não disponível.")

    from services.prova_web_render_service import resolve_rendered_asset_path

    record, mode, sources, folder = _require_prova_web_context(ano, os_id)
    try:
        _load_portal_flipbook_manifest(ano, os_id, record, mode, sources, folder)
        path = resolve_rendered_asset_path(folder, record["pastaRender"], name)
    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Erro asset flipbook prova OS %s/%s (%s): %s", os_id, ano, name, exc
        )
        raise HTTPException(status_code=500, detail="Erro ao servir o asset.") from exc
    return FileResponse(
        path=path,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )


@router.get("/client/proof/{ano}/{os_id}/preview-base/{face_id}")
def serve_proof_preview_base(
    ano: int,
    os_id: int,
    face_id: str,
    token: str = Query(...),
):
    """Imagem base da prévia ao vivo — escopo do token de prova (sem sessão interna)."""
    proof = _validate_proof_token(os_id, ano, token)
    from services.proof_papelaria_service import build_portal_papelaria_edit_payload
    from services import papelaria_live_preview_service as preview_svc
    from services.papelaria_models_service import get_modelo_by_id

    edit = build_portal_papelaria_edit_payload(proof, ano, os_id)
    if not edit or not edit.get("modelo_id"):
        raise HTTPException(status_code=404, detail="Prévia não disponível para esta prova.")

    modelo = get_modelo_by_id(int(edit["modelo_id"]))
    if not modelo:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    preview_config = None
    raw = modelo.get("preview_config_json")
    if raw:
        preview_config = preview_svc.parse_preview_config_json(raw)

    try:
        path = preview_svc.resolve_face_base_image_path(
            int(edit["modelo_id"]),
            face_id,
            preview_config=preview_config,
        )
        ext = path.lower().rsplit(".", 1)[-1]
        media = "image/png" if ext == "png" else "image/jpeg"
        return FileResponse(
            path=path,
            media_type=media,
            headers={"Cache-Control": "private, no-store"},
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


class ProofResponseRequest(BaseModel):

    token: str = Field(..., min_length=10)

    os_id: int

    ano: int

    aprovado: bool

    observacao: Optional[str] = Field(None, max_length=4000)

    nome_cliente: str = Field(..., min_length=2, max_length=255)

    ponto: str = Field(..., min_length=1, max_length=32)
    alteracoes_campos: Optional[dict[str, str]] = None


def _register_proof_andamento(

    *,

    os_id: int,

    ano: int,

    versao: str,

    aprovado: bool,

    observacao: str,

    nome_cliente: str,

    ponto_cliente: str,

    client_ip: str,
    papelaria_alteracao: bool = False,
) -> dict:

    ponto_formatado = format_ponto(ponto_cliente)

    ident_cliente = (
        f"{nome_cliente} - {ponto_formatado}"
        if ponto_formatado
        else nome_cliente
    )

    situacao = "Saída p/"
    if aprovado:
        obs = f"Prova v{versao} aprovada pelo cliente ({ident_cliente})"
    elif papelaria_alteracao:
        ver = str(versao or "1").strip() or "1"
        obs = f"Alterar Prova {ver}"
    else:
        obs_cliente = preserve_line_breaks(observacao.strip())
        obs = (
            f"O cliente ({ident_cliente}) solicitou as seguintes alterações:\n"
            f"{obs_cliente}"
        )

    obs_formatada = format_andamento_obs(obs)



    def transaction(cursor):

        cursor.execute(

            "UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s",

            (os_id, ano),

        )

        base_prefix = f"{os_id:05d}{ano}-"

        cursor.execute(

            f"SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE '{base_prefix}%'"

        )

        res = cursor.fetchone()

        next_seq = 1

        if res and res.get("max_cod"):

            try:

                next_seq = int(str(res["max_cod"]).split("-")[-1]) + 1

            except ValueError:

                next_seq = 1

        new_cod = f"{base_prefix}{next_seq:02d}"

        cursor.execute(

            """INSERT INTO tabAndamento

               (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink,

                `Data`, UltimoStatus, `Observaçao`, Ponto)

               VALUES (%s, %s, %s, %s, %s, NOW(), 1, %s, %s)""",

            (new_cod, os_id, ano, situacao, "SEFOC", obs_formatada, ponto_formatado),

        )

        log_andamento_added(

            cursor,

            nro=os_id,

            ano=ano,

            cod_status=new_cod,

            situacao=situacao,

            setor="SEFOC",

            obs=obs_formatada,

            ponto=ponto_formatado,

            origem="PORTAL_CLIENTE",

        )

        return new_cod



    cod = db.execute_transaction([transaction])[0]

    from routers.mdb_writer import push_andamento_to_mdb_after_mysql

    push_andamento_to_mdb_after_mysql(
        cod, os_id, ano, operation="insert", task_name="proof_portal_andamento"
    )

    return {"cod_status": cod, "situacao": situacao, "obs": obs_formatada}





def _resolve_proof_original_upload_dir(ano: int, os_id: int, versao: str) -> tuple[str, str]:
    """Pasta Original da OS para upload de exemplo no portal de prova."""
    import os

    from routers.analise_routes import (
        _get_os_folder_path,
        _list_original_folders,
        _resolve_original_folder_path,
    )
    from services.os_folder_structure import resolve_initial_original_dir

    target_os_dir = _get_os_folder_path(ano, os_id)
    if not target_os_dir or not os.path.isdir(target_os_dir):
        raise HTTPException(status_code=404, detail="Pasta da OS não encontrada.")

    ver = str(versao or "1").strip() or "1"
    if _list_original_folders(target_os_dir):
        try:
            folder_path = _resolve_original_folder_path(target_os_dir, f"v{ver}")
            return folder_path, os.path.basename(folder_path)
        except ValueError:
            pass

    folder_path, folder_name = resolve_initial_original_dir(target_os_dir)
    return folder_path, folder_name


@router.post("/client/proof/{ano}/{os_id}/upload-example")
async def upload_proof_example_file(
    ano: int,
    os_id: int,
    token: str = Form(...),
    file: UploadFile = File(...),
):
    proof = _validate_proof_token(os_id, ano, token)
    versao = str(proof.get("Versao") or "1")

    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")

    from routers.analise_routes import _save_client_upload_file

    dest_dir, folder_name = _resolve_proof_original_upload_dir(ano, os_id, versao)
    try:
        saved_name = _save_client_upload_file(file, dest_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("upload-proof-example error OS %s/%s: %s", os_id, ano, exc)
        raise HTTPException(status_code=500, detail="Falha ao gravar arquivo.") from exc

    logger.info(
        "Upload exemplo prova OS %s/%s: %s em %s",
        os_id,
        ano,
        saved_name,
        dest_dir,
    )
    return {"status": "ok", "filename": saved_name, "folder": folder_name}


@router.post("/client/proof/respond")

def respond_proof(req: ProofResponseRequest, request: Request):

    proof = _validate_proof_token(req.os_id, req.ano, req.token)

    versao = str(proof.get("Versao") or "1")

    client_ip = resolve_client_ip(request)



    alteracoes_campos: dict[str, str] | None = None
    papelaria_alteracao = False
    alteracoes_json: str | None = None
    job_id_papelaria: int | None = None

    if not req.aprovado:
        from services.proof_papelaria_service import build_portal_papelaria_edit_payload

        papelaria_edit = build_portal_papelaria_edit_payload(proof, req.ano, req.os_id)
        if papelaria_edit and req.alteracoes_campos:
            import json
            from services.papelaria_jobs_service import _sanitize_dados

            try:
                alteracoes_campos = _sanitize_dados(req.alteracoes_campos)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            papelaria_alteracao = True
            job_id_papelaria = papelaria_edit.get("job_id")
            alteracoes_json = json.dumps(
                {
                    "campos": alteracoes_campos,
                    "observacao_cliente": (req.observacao or "").strip(),
                    "versao": versao,
                    "modelo_id": papelaria_edit.get("modelo_id"),
                    "job_id": job_id_papelaria,
                },
                ensure_ascii=False,
            )
        elif not (req.observacao or "").strip():
            raise HTTPException(
                status_code=400,
                detail="Observações são obrigatórias ao solicitar alterações.",
            )

    db.execute_query(
        """
        UPDATE tabProofTokens
        SET Aprovado = %s, Observacao = %s, DataResposta = NOW(),
            ClienteNome = %s, DataExpiracao = NOW(),
            AlteracoesJson = %s, JobIdPapelaria = %s
        WHERE NroProtocolo = %s AND AnoProtocolo = %s AND Token = %s
        """,
        (
            1 if req.aprovado else 0,
            (req.observacao or "").strip() or None,
            req.nome_cliente.strip(),
            alteracoes_json,
            job_id_papelaria,
            req.os_id,
            req.ano,
            req.token,
        ),
    )

    andamento = _register_proof_andamento(
        os_id=req.os_id,
        ano=req.ano,
        versao=versao,
        aprovado=req.aprovado,
        observacao=req.observacao or "",
        nome_cliente=req.nome_cliente.strip(),
        ponto_cliente=req.ponto.strip(),
        client_ip=client_ip,
        papelaria_alteracao=papelaria_alteracao,
    )



    from routers.realtime import broadcast_os_system_update



    broadcast_os_system_update(

        req.os_id,

        req.ano,

        "proof_responded",

        setor="SEFOC",

        origem="portal_cliente",

    )



    return {

        "status": "ok",

        "aprovado": req.aprovado,

        "andamento": andamento,

    }


