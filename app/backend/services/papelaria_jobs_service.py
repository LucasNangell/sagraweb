"""
Fila de jobs de geração Corel/PDF para Papelaria.
Sem COM no servidor — worker Windows processará na fase seguinte.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
from datetime import datetime
from typing import Any, Optional

from config_manager import PROJECT_ROOT
from database import db

logger = logging.getLogger(__name__)

STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"

PROVA_REVISAO_PENDING = "pending"
PROVA_REVISAO_APPROVED = "approved"
PROVA_REVISAO_DISCARDED = "discarded"

TIPO_JOB_CREATE = "create"
TIPO_JOB_MANUAL_COREL = "manual_corel"
TIPO_JOB_EXPORT_EXISTING_CDR = "export_existing_cdr"
TIPO_JOB_CREDENCIAIS_DEPOL = "credenciais_depol"
TIPO_JOB_TIMBRADO_A4_DIGITAL = "timbrado_a4_digital"
TIPO_JOB_IMPOSICAO = "imposicao"

CDR_BACKUP_NAME_FRAGMENT = "cópia_de_segurança"
INPUT_CDR_DADOS_KEY = "__input_cdr"
# Create: .cdr já existente na pasta da OS usado no lugar do modelo (relativo à OS).
BASE_CDR_DADOS_KEY = "__base_cdr"
# Usuário escolheu manter os textos do Corel da pasta (não aplicar o formulário).
MANTER_DADOS_COREL_KEY = "__manter_dados_corel"
# «Gerar Corel» a partir do PDF final: nome do PDF (na pasta da OS) que o
# worker importa no CorelDRAW. Definido só pelo servidor.
PDF_FONTE_COREL_DADOS_KEY = "__pdf_fonte_corel"
ARTEFATOS_DADOS_KEY = "__artefatos"

OBS_ENVIAR_TIMBRADO_DIGITAL = "Enviar Timbrado Digital"
SITUACAO_ENCAM_DOCUM = "Encam. de Docum."
SETOR_SEFOC = "SEFOC"

PRODUTO_TIMBRADO_A4_DIGITAL = "Timbrado A4 (Digital)"
PROVA_REVISAO_NA = "n_a"

TIMBRADO_A4_DIGITAL_SVG_CABECALHO = "cabecalho.svg"
TIMBRADO_A4_DIGITAL_SVG_RODAPE = "rodape.svg"

TERMINAL_STATUSES = frozenset({STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELLED})
CANCELLABLE_STATUSES = frozenset({STATUS_PENDING, STATUS_PROCESSING})

MAX_DADOS_JSON_BYTES = 32 * 1024
MAX_WORKER_RETRIES = 3
_PATH_PATTERN = re.compile(r"[\\/]{2,}|:[\\/]|[a-zA-Z]:\\")
_UNSAFE_FILENAME = re.compile(r'[\\/*?:"<>|]|\.\.')

_tables_ready = False
_worker_heartbeats: dict[str, datetime] = {}
_worker_meta: dict[str, dict[str, Any]] = {}

_DEFAULT_WORKER_HEARTBEAT_STALE_SEC = 75
_DEFAULT_PROCESSING_MAX_SEC = 360
_DEFAULT_JOB_STALL_SEC = 30


def ensure_papelaria_jobs_tables() -> None:
    global _tables_ready
    if _tables_ready:
        return

    sql_path = PROJECT_ROOT / "deploy" / "sql" / "create_papelaria_jobs.sql"
    if sql_path.is_file():
        raw = sql_path.read_text(encoding="utf-8")
        for stmt in raw.split(";"):
            s = stmt.strip()
            if s:
                db.execute_query(s)

    _ensure_prova_revisao_column()
    _backfill_prova_revisao_pending()
    _tables_ready = True
    logger.info(
        "Tabelas tabPapelariaJobs/tabPapelariaJobLog/tabPapelariaWorkerHeartbeat verificadas/criadas"
    )


def _ensure_prova_revisao_column() -> None:
    rows = db.execute_query(
        "SHOW COLUMNS FROM tabPapelariaJobs LIKE 'ProvaRevisao'"
    )
    if rows:
        return
    db.execute_query(
        """
        ALTER TABLE tabPapelariaJobs
        ADD COLUMN ProvaRevisao VARCHAR(20) NULL
        AFTER ArquivoPdfGerado
        """
    )
    logger.info("Coluna tabPapelariaJobs.ProvaRevisao adicionada")


def _backfill_prova_revisao_pending() -> None:
    """Jobs concluídos antes da coluna ou via API antiga ficam aguardando revisão."""
    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET ProvaRevisao = %(pending)s
        WHERE Status = %(completed)s
          AND ArquivoPdfGerado IS NOT NULL
          AND TRIM(ArquivoPdfGerado) <> ''
          AND (ProvaRevisao IS NULL OR TRIM(ProvaRevisao) = '')
        """,
        {"pending": PROVA_REVISAO_PENDING, "completed": STATUS_COMPLETED},
    )


def _parse_json_field(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    return None


def _format_datetime(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    return str(value)


def _row_to_job(row: dict[str, Any], include_logs: bool = False) -> dict[str, Any]:
    dados = _parse_json_field(row.get("DadosJson")) or {}
    job = {
        "id": row["ID"],
        "nro_protocolo": row["NroProtocolo"],
        "ano_protocolo": row["AnoProtocolo"],
        "tipo_job": row.get("TipoJob") or "create",
        "produto": row.get("Produto") or "",
        "modelo_id": row.get("ModeloID"),
        "arquivo_modelo": row.get("ArquivoModelo") or "",
        "dados": dados,
        "status": row.get("Status") or STATUS_PENDING,
        "prioridade": row.get("Prioridade") or 0,
        "ordem_fila": row.get("OrdemFila"),
        "solicitado_por": row.get("SolicitadoPor") or "",
        "solicitado_em": _format_datetime(row.get("SolicitadoEm")),
        "iniciado_em": _format_datetime(row.get("IniciadoEm")),
        "concluido_em": _format_datetime(row.get("ConcluidoEm")),
        "worker_id": row.get("WorkerID"),
        "arquivo_cdr": _basename_only(row.get("ArquivoCdrGerado")),
        "arquivo_pdf": _basename_only(row.get("ArquivoPdfGerado")),
        "erro": row.get("Erro"),
        "tentativas": row.get("Tentativas") or 0,
        "versao": row.get("Versao") or 1,
        "job_pai_id": row.get("JobPaiID"),
        "tem_arquivo_pdf": bool(row.get("ArquivoPdfGerado")),
        "tem_arquivo_cdr": bool(row.get("ArquivoCdrGerado")),
        "prova_revisao": _resolve_prova_revisao_from_row(row),
        "artefatos": _artefatos_from_dados(dados),
    }
    if include_logs:
        job["logs"] = list_job_logs(row["ID"], limit=20)
    return job


def _artefatos_from_dados(dados: Any) -> list[str]:
    if not isinstance(dados, dict):
        return []
    raw = dados.get(ARTEFATOS_DADOS_KEY)
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw if str(item).strip()]


def is_timbrado_a4_digital_produto(produto: str) -> bool:
    from services.papelaria_models_service import normalizar_texto_produto

    return normalizar_texto_produto(produto) == normalizar_texto_produto(
        PRODUTO_TIMBRADO_A4_DIGITAL
    )


def _resolve_prova_revisao_from_row(row: dict[str, Any]) -> Optional[str]:
    revisao = (row.get("ProvaRevisao") or "").strip() or None
    if revisao:
        return revisao
    status = (row.get("Status") or "").strip()
    has_pdf = bool((row.get("ArquivoPdfGerado") or "").strip())
    if status == STATUS_COMPLETED and has_pdf:
        return PROVA_REVISAO_PENDING
    return None


def _basename_only(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    return os.path.basename(str(path).replace("\\", "/"))


def next_queue_position() -> int:
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        "SELECT COALESCE(MAX(OrdemFila), 0) + 1 AS next_pos FROM tabPapelariaJobs"
    )
    return int(rows[0]["next_pos"]) if rows else 1


def _validate_os_exists(
    ano: int,
    nro: int,
    *,
    require_papelaria: bool = True,
) -> dict[str, Any]:
    """
    Confirma que a OS existe.

    require_papelaria=True (jobs Papelaria): exige nro >= 5000 ou produto de papelaria.
    require_papelaria=False (ex.: Credenciais DEPOL): qualquer OS válida.
    """
    if require_papelaria and nro < 5000:
        from services import papelaria_models_service as models_svc

        if not models_svc.is_papelaria_os_by_product(ano, nro):
            raise ValueError(
                "OS de papelaria deve ter número >= 5000 ou possuir produto de papelaria configurado."
            )
    rows = db.execute_query(
        """
        SELECT p.NroProtocolo, p.AnoProtocolo, d.TipoPublicacaoLink AS produto
        FROM tabProtocolos p
        LEFT JOIN tabDetalhesServico d
          ON p.NroProtocolo = d.NroProtocoloLinkDet
         AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE p.NroProtocolo = %(nro)s AND p.AnoProtocolo = %(ano)s
        """,
        {"nro": nro, "ano": ano},
    )
    if not rows:
        raise LookupError("OS não encontrada.")
    return rows[0]


def _sanitize_dados(dados: dict[str, Any]) -> dict[str, str]:
    if not isinstance(dados, dict):
        raise ValueError("Campo 'dados' deve ser um objeto JSON.")

    cleaned: dict[str, str] = {}
    for key, value in dados.items():
        if not isinstance(key, str) or not key.strip():
            raise ValueError("Chaves de 'dados' inválidas.")
        key_stripped = key.strip()
        if re.search(r"[\\/]{2,}|\.{2}", key_stripped):
            raise ValueError("Chaves de 'dados' não podem conter caminhos.")
        if key_stripped == "__campos_dinamicos_layout":
            if not isinstance(value, str):
                raise ValueError("Layout de campos dinâmicos inválido.")
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("Layout de campos dinâmicos: JSON inválido.") from exc
            if not isinstance(parsed, dict):
                raise ValueError("Layout de campos dinâmicos deve ser um objeto.")
            cleaned[key_stripped] = value.strip()
            continue
        if key_stripped == "__exclusoes":
            if not isinstance(value, str):
                raise ValueError("Lista de exclusões inválida.")
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("Lista de exclusões: JSON inválido.") from exc
            if not isinstance(parsed, list):
                raise ValueError("Lista de exclusões deve ser uma lista.")
            cleaned[key_stripped] = value.strip()
            continue
        if key_stripped == "__campos_produto":
            from services.papelaria_campos_produto import validar_campos_produto

            produto = validar_campos_produto(value)
            if produto:
                cleaned[key_stripped] = json.dumps(produto, ensure_ascii=False)
            continue
        if key_stripped == "__redes_estilo":
            from services.papelaria_redes_service import RedesError, normalizar_estilo_selecao

            try:
                estilo = normalizar_estilo_selecao(value)
            except RedesError as exc:
                raise ValueError(str(exc)) from exc
            if estilo:
                cleaned[key_stripped] = estilo
            continue
        if key_stripped == "__redes":
            from services.papelaria_redes_service import RedesError, normalizar_selecao

            try:
                sel = normalizar_selecao(value)
            except RedesError as exc:
                raise ValueError(str(exc)) from exc
            if sel is not None:
                cleaned[key_stripped] = json.dumps(sel, ensure_ascii=False)
            continue
        if key_stripped == "__repeticao":
            from services.papelaria_prova_pdf_service import repeticao_dos_dados

            if repeticao_dos_dados({"__repeticao": value}) is None:
                raise ValueError("Repetição inválida.")
            cleaned[key_stripped] = str(value).strip()
            continue
        if key_stripped == "__textos":
            from services.papelaria_prova_pdf_service import ProvaPdfError, normalizar_textos

            try:
                textos = normalizar_textos(value)
            except ProvaPdfError as exc:
                raise ValueError(str(exc)) from exc
            for chave_txt, texto_editado in textos.items():
                if _PATH_PATTERN.search(texto_editado) or "\\\\" in texto_editado:
                    raise ValueError("Texto editado não pode conter caminho de arquivo.")
            if textos:
                cleaned[key_stripped] = json.dumps(textos, ensure_ascii=False)
            continue
        if key_stripped == "__campos_extras":
            from services.papelaria_campos_extras_service import (
                CamposExtrasError,
                normalizar_campos_extras,
            )

            try:
                extras = normalizar_campos_extras(value)
            except CamposExtrasError as exc:
                raise ValueError(str(exc)) from exc
            for extra in extras:
                for trecho in (extra.get("texto") or "", extra.get("rede_valor") or ""):
                    if _PATH_PATTERN.search(trecho) or "\\\\" in trecho:
                        raise ValueError("Campo extra não pode conter caminho de arquivo.")
            if extras:
                cleaned[key_stripped] = json.dumps(extras, ensure_ascii=False)
            continue
        if key_stripped == "__campos_estilo":
            from services.papelaria_campos_estilo_service import (
                CamposEstiloError,
                normalizar_campos_estilo,
            )

            try:
                estilos = normalizar_campos_estilo(value)
            except CamposEstiloError as exc:
                raise ValueError(str(exc)) from exc
            if estilos:
                cleaned[key_stripped] = json.dumps(estilos, ensure_ascii=False)
            continue
        if key_stripped == "__composicao":
            from services.papelaria_faces_service import ComposicaoError, normalizar_composicao

            try:
                comp = normalizar_composicao(value, permitir_repeticao="__repeticao" in dados)
            except ComposicaoError as exc:
                raise ValueError(str(exc)) from exc
            if comp:
                cleaned[key_stripped] = json.dumps(comp, ensure_ascii=False)
            continue
        if key_stripped in (
            INPUT_CDR_DADOS_KEY,
            BASE_CDR_DADOS_KEY,
            MANTER_DADOS_COREL_KEY,
            PDF_FONTE_COREL_DADOS_KEY,
        ):
            # Definidos só pelo servidor (nunca aceitar caminho vindo do cliente).
            continue
        if value is None:
            cleaned[key.strip()] = ""
            continue
        if not isinstance(value, (str, int, float, bool)):
            raise ValueError(f"Valor inválido para campo '{key_stripped}'.")
        text = str(value).strip()
        if _PATH_PATTERN.search(text) or "\\\\" in text:
            raise ValueError(f"Campo '{key_stripped}' não pode conter caminho de arquivo.")
        if len(text) > 2000:
            raise ValueError(f"Campo '{key_stripped}' excede tamanho máximo.")
        cleaned[key_stripped] = text

    payload = json.dumps(cleaned, ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_DADOS_JSON_BYTES:
        raise ValueError("Payload de dados excede o limite permitido (32 KB).")
    return cleaned


def _validate_required_fields(
    modelo: dict[str, Any],
    dados: dict[str, str],
) -> list[str]:
    from services.papelaria_campos_produto import carregar_de_dados, variaveis_ocultas

    missing: list[str] = []
    # Variáveis só usadas por objetos que viraram campos do produto não são exigidas.
    ocultas = variaveis_ocultas(modelo.get("campos") or {}, carregar_de_dados(dados))
    exclusoes: list[str] = list(ocultas)
    exclusoes_raw = dados.get("__exclusoes")
    if exclusoes_raw:
        try:
            parsed = json.loads(exclusoes_raw) if isinstance(exclusoes_raw, str) else exclusoes_raw
            if isinstance(parsed, list):
                exclusoes = [str(item) for item in parsed]
        except Exception:
            pass

    for field in modelo.get("campos_formulario") or []:
        if not field.get("required"):
            continue
        key = field.get("key", "")
        if key in exclusoes:
            continue
        if not str(dados.get(key, "")).strip():
            missing.append(key)
    return missing


def _product_match_warning(os_produto: str, modelo_produto: str) -> Optional[str]:
    from services.papelaria_models_service import normalizar_texto_produto

    os_norm = normalizar_texto_produto(os_produto)
    mod_norm = normalizar_texto_produto(modelo_produto)
    if not os_norm or not mod_norm:
        return None
    if os_norm == mod_norm:
        return None
    if os_norm in mod_norm or mod_norm in os_norm:
        return (
            f"Modelo '{modelo_produto}' selecionado manualmente "
            f"(produto OS: '{os_produto}')."
        )
    return (
        f"Modelo '{modelo_produto}' pode não corresponder ao produto da OS "
        f"('{os_produto}')."
    )


def broadcast_job_update(job: dict[str, Any]) -> None:
    try:
        from services.papelaria_sp_status_service import invalidate_folder_signals

        invalidate_folder_signals(job["ano_protocolo"], job["nro_protocolo"])
        dados = job.get("dados") if isinstance(job.get("dados"), dict) else {}
        for membro in dados.get("juntada_membros") or []:
            if isinstance(membro, dict) and membro.get("ano") and membro.get("nro"):
                invalidate_folder_signals(int(membro["ano"]), int(membro["nro"]))
    except Exception:
        pass
    try:
        from routers.realtime import schedule_broadcast

        schedule_broadcast(
            {
                "type": "papelaria_job_update",
                "job_id": job["id"],
                "ano": job["ano_protocolo"],
                "nro": job["nro_protocolo"],
                "status": job["status"],
            }
        )
    except Exception as exc:
        logger.warning("Falha ao emitir papelaria_job_update: %s", exc)


def append_job_log(
    job_id: int,
    mensagem: str,
    nivel: str = "info",
    detalhe: Optional[dict[str, Any]] = None,
) -> None:
    ensure_papelaria_jobs_tables()
    db.execute_query(
        """
        INSERT INTO tabPapelariaJobLog (JobID, Nivel, Mensagem, DetalheJson)
        VALUES (%(job_id)s, %(nivel)s, %(msg)s, %(detalhe)s)
        """,
        {
            "job_id": job_id,
            "nivel": nivel,
            "msg": mensagem[:4000],
            "detalhe": json.dumps(detalhe, ensure_ascii=False) if detalhe else None,
        },
    )


def create_job(
    ano: int,
    nro: int,
    modelo_id: int,
    dados: dict[str, Any],
    solicitado_por: str,
    tipo_job: str = "create",
    job_pai_id: Optional[int] = None,
    manter_dados_corel: bool = False,
    gerar_corel: bool = False,
) -> dict[str, Any]:
    """
    ``gerar_corel``: exceção pedida na página Papelaria — gera o arquivo
    CorelDRAW pelo worker. Com PDF do modelo configurado, o servidor monta o
    PDF final (o mesmo da prova) e o worker o importa no CorelDRAW com os
    textos editáveis; sem PDF, usa o modelo .cdr (fluxo antigo).
    """
    ensure_papelaria_jobs_tables()
    from services import papelaria_models_service as models_svc

    os_row = _validate_os_exists(ano, nro)
    modelo = models_svc.get_modelo_by_id(modelo_id)
    if not modelo:
        raise LookupError("Modelo não encontrado ou inativo.")

    dados_clean = _sanitize_dados(dados)
    if "__campos_produto" in dados_clean:
        from services.papelaria_campos_produto import validar_campos_produto

        produto = validar_campos_produto(
            dados_clean["__campos_produto"], modelo.get("campos") or {}
        )
        if produto:
            dados_clean["__campos_produto"] = json.dumps(produto, ensure_ascii=False)
        else:
            dados_clean.pop("__campos_produto", None)
    missing = _validate_required_fields(modelo, dados_clean)
    if missing:
        raise ValueError(f"Campos obrigatórios ausentes: {', '.join(missing)}")

    if "gabinete" in dados_clean and dados_clean["gabinete"]:
        dados_clean["gabinete"] = models_svc.normalizar_gabinete(dados_clean["gabinete"])
    if "uf" in dados_clean and dados_clean["uf"]:
        dados_clean["uf"] = dados_clean["uf"].upper()

    # Modo «Prova PDF»: modelo com PDF configurado gera no servidor (sem worker).
    prova_pdf_servidor = False
    # Repetição de SP: a prova sai da base recortada da prova antiga (só desta OS).
    if "__repeticao" in dados_clean:
        from services import papelaria_repeticao_service as rep_svc
        from services.papelaria_prova_pdf_service import repeticao_dos_dados

        rep = repeticao_dos_dados(dados_clean)
        if rep != (int(ano), int(nro)) or not rep_svc.tem_base(ano, nro):
            raise ValueError("A base da repetição desta SP não existe — use «Replicar SP» de novo.")
    if tipo_job == TIPO_JOB_CREATE:
        from services.papelaria_prova_modo import MODO_PROVA_PDF, get_modo

        if get_modo() == MODO_PROVA_PDF:
            from services import papelaria_prova_pdf_service as prova_pdf_svc

            prova_pdf_servidor = prova_pdf_svc.tem_modelo_pdf(modelo_id) or "__repeticao" in dados_clean

    corel_do_pdf = False
    if gerar_corel:
        from services import papelaria_prova_pdf_service as prova_pdf_svc

        prova_pdf_servidor = False
        corel_do_pdf = (
            "__composicao" in dados_clean
            or "__repeticao" in dados_clean
            or prova_pdf_svc.tem_modelo_pdf(modelo_id)
        )
        if not corel_do_pdf:
            if str(modelo.get("arquivo_modelo") or "").lower().endswith(".pdf"):
                raise ValueError(
                    "Este modelo ainda não tem textos ligados aos campos. Configure em "
                    "Configurações → Papelaria → Textos e prévia."
                )
            # Sem PDF: o worker usa o .cdr do modelo (composição não se aplica).
            dados_clean.pop("__composicao", None)

    # Frente e verso independentes (frente de um modelo + verso de outro).
    if "__composicao" in dados_clean:
        from services.papelaria_faces_service import ComposicaoError, validar_composicao
        from services.papelaria_prova_modo import MODO_PROVA_PDF, get_modo

        if tipo_job != TIPO_JOB_CREATE or get_modo() != MODO_PROVA_PDF:
            raise ValueError("Frente e verso independentes exigem o modo de geração Prova PDF.")
        try:
            comp = validar_composicao(
                dados_clean["__composicao"], modelo, permitir_repeticao="__repeticao" in dados_clean
            )
        except ComposicaoError as exc:
            raise ValueError(str(exc)) from exc
        if comp is None:
            dados_clean.pop("__composicao", None)
        else:
            dados_clean["__composicao"] = json.dumps(comp, ensure_ascii=False)
            prova_pdf_servidor = not gerar_corel

    # PDF final (o mesmo da prova) que o worker importa no CorelDRAW.
    pdf_fonte_corel: Optional[bytes] = None
    if corel_do_pdf:
        from services import papelaria_prova_pdf_service as prova_pdf_svc

        try:
            pdf_fonte_corel, _n_campos = prova_pdf_svc.renderizar_pdf_final(
                modelo_id, dados_clean, modelo
            )
        except prova_pdf_svc.ProvaPdfError as exc:
            raise ValueError(str(exc)) from exc
        _cdr_nome, pdf_nome = build_output_filenames(ano, nro)
        try:
            sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=True)
            with open(os.path.join(sefoc_dir, pdf_nome), "wb") as fh:
                fh.write(pdf_fonte_corel)
        except OSError as exc:
            raise ValueError(f"Não foi possível gravar o PDF na pasta da OS: {exc}") from exc
        dados_clean[PDF_FONTE_COREL_DADOS_KEY] = pdf_nome

    if (
        tipo_job == TIPO_JOB_CREATE
        and not prova_pdf_servidor
        and pdf_fonte_corel is None
        and str(modelo.get("arquivo_modelo") or "").lower().endswith(".pdf")
    ):
        raise ValueError(
            "Este modelo ainda não tem textos ligados aos campos. Configure em "
            "Configurações → Papelaria → Textos e prévia."
        )

    # Já existe Corel na pasta da OS (fora cópia de segurança)? A prova é
    # montada a partir dele, com os campos do formulário aplicados por cima.
    base_cdr: Optional[dict[str, Any]] = None
    if tipo_job == TIPO_JOB_CREATE and not prova_pdf_servidor and pdf_fonte_corel is None:
        base_cdr = find_os_base_cdr(ano, nro)
        if base_cdr:
            dados_clean[BASE_CDR_DADOS_KEY] = base_cdr["relative_path"]
            if manter_dados_corel:
                dados_clean[MANTER_DADOS_COREL_KEY] = "1"

    ordem = next_queue_position()
    produto_os = (os_row.get("produto") or modelo["produto"] or "").strip()
    produto_job = modelo["produto"]

    insert_params = {
        "nro": nro,
        "ano": ano,
        "tipo": tipo_job,
        "produto": produto_job,
        "modelo_id": modelo_id,
        "arquivo": modelo["arquivo_modelo"],
        "dados": json.dumps(dados_clean, ensure_ascii=False),
        "status": STATUS_PENDING,
        "ordem": ordem,
        "ponto": solicitado_por,
        "job_pai": job_pai_id,
    }
    if prova_pdf_servidor:
        # Já nasce «processing» do servidor: nenhum worker pega este job.
        insert_params["status"] = STATUS_PROCESSING

    def _insert_job(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabPapelariaJobs (
                NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao, JobPaiID
            ) VALUES (
                %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                %(dados)s, %(status)s, 0, %(ordem)s, %(ponto)s, 1, %(job_pai)s
            )
            """,
            insert_params,
        )
        job_id_novo = int(cursor.lastrowid)
        if prova_pdf_servidor:
            from services.papelaria_prova_pdf_service import WORKER_ID_SERVIDOR

            cursor.execute(
                """
                UPDATE tabPapelariaJobs
                SET WorkerID = %(worker)s, IniciadoEm = NOW(), Tentativas = 1
                WHERE ID = %(id)s
                """,
                {"worker": WORKER_ID_SERVIDOR, "id": job_id_novo},
            )
        return job_id_novo

    results = db.execute_transaction([_insert_job])
    job_id = int(results[0])
    job = get_job(job_id)
    if not job:
        raise RuntimeError("Falha ao recuperar job criado.")

    if prova_pdf_servidor:
        append_job_log(job_id, "Prova PDF: gerando no servidor a partir do PDF do modelo.", "info")
        from services import papelaria_prova_pdf_service as prova_pdf_svc

        job = prova_pdf_svc.gerar_prova_do_job(job_id)
        warning = _product_match_warning(produto_os, produto_job)
        if warning:
            append_job_log(job_id, warning, "warning")
            job["warnings"] = [warning]
        return job

    append_job_log(job_id, "Job criado e aguardando processamento.", "info")
    if pdf_fonte_corel is not None:
        append_job_log(
            job_id,
            "Gerar Corel: PDF final montado no servidor (igual à prova) — o worker "
            "importa no CorelDRAW mantendo os textos editáveis.",
            "info",
        )
    elif tipo_job == TIPO_JOB_CREATE:
        from services.papelaria_prova_modo import MODO_PROVA_PDF, get_modo

        if get_modo() == MODO_PROVA_PDF:
            append_job_log(
                job_id,
                "Prova PDF: modelo sem PDF configurado — gerado pelo CorelDRAW (worker).",
                "warning",
            )
    if base_cdr:
        append_job_log(
            job_id,
            (
                f"Prova a partir do Corel da pasta da OS ({base_cdr['filename']}); "
                + (
                    "mantendo os dados originais do Corel (escolha do usuário)."
                    if manter_dados_corel
                    else "os campos do formulário serão aplicados sobre ele."
                )
            ),
            "info",
        )
    warning = _product_match_warning(produto_os, produto_job)
    if warning:
        append_job_log(job_id, warning, "warning")
        job["warnings"] = [warning]

    broadcast_job_update(job)
    return job


def _lote_nros_from_dados(dados: dict[str, Any], *, ano: int, nro: int) -> list[int]:
    """Números de OP do lote (âncora + juntada), na ordem."""
    nros: list[int] = []
    lote = dados.get("juntada_lote")
    if isinstance(lote, list) and lote:
        for item in lote:
            if not isinstance(item, dict):
                continue
            try:
                nros.append(int(item.get("nro") or 0))
            except (TypeError, ValueError):
                continue
    if not nros:
        nros = [int(nro)]
        for m in dados.get("juntada_membros") or []:
            if isinstance(m, dict):
                try:
                    nros.append(int(m.get("nro") or 0))
                except (TypeError, ValueError):
                    continue
    return [n for n in nros if n > 0] or [int(nro)]


def _prepare_pre_impresso_jdf_config(
    *,
    config: dict[str, Any],
    produto: str,
    dados: dict[str, Any],
    ano: int,
    nro: int,
    sefoc_dir: str,
    gang_pdf_path: str = "",
) -> tuple[dict[str, Any], str]:
    """
    Folha 745×605, placements por centro, marcas com OP e gang pré-rotacionado.

    Retorna (config_para_jdf, caminho_pdf_base). O PDF base tem páginas já
    rotacionadas (MediaBox = footprint) para o JDF usar só translação.
    """
    from services import papelaria_jdf_service as jdf_svc
    from services import papelaria_imposicao_juntada_service as juntada_svc

    v2_meta = dados.get("imposicao_v2") if isinstance(dados, dict) else None
    if isinstance(v2_meta, dict) and isinstance(v2_meta.get("perfil"), dict):
        # Perfil v2: posições, rotação e marcas vêm do perfil salvo no job.
        from services import papelaria_imposicao_v2_service as imposicao_v2_svc

        return imposicao_v2_svc.preparar_config_pipeline(
            perfil=v2_meta["perfil"],
            dados=dados,
            ano=ano,
            nro=nro,
            sefoc_dir=sefoc_dir,
            gang_pdf_path=gang_pdf_path,
        )

    cfg = dict(config or {})
    slots_info = dados.get("juntada_slots") if isinstance(dados, dict) else None
    n_slots = 0
    if isinstance(slots_info, dict):
        try:
            n_slots = int(slots_info.get("total_slots") or 0)
        except (TypeError, ValueError):
            n_slots = 0
    if n_slots < 1:
        n_slots = juntada_svc.max_slots(produto)

    padrao = juntada_svc.grid_padrao_pre_impresso(produto)
    grid = dict(cfg.get("grid") or {})
    cols = int(padrao.get("colunas") or grid.get("colunas") or 1)
    rows = int(padrao.get("linhas") or grid.get("linhas") or 1)
    ocupadas = juntada_svc.placements_pre_impresso(produto, n_slots=n_slots)
    if juntada_svc.is_pasta_avulso_familia(produto):
        page_w = float(juntada_svc.PAGINA_PASTA_MM["largura_mm"])
        page_h = float(juntada_svc.PAGINA_PASTA_MM["altura_mm"])
    else:
        page_w = float(juntada_svc.PAGINA_TIMBRADO_MM["largura_mm"])
        page_h = float(juntada_svc.PAGINA_TIMBRADO_MM["altura_mm"])

    marcas_src = str(cfg.get("marcas_pdf_path") or "").strip()
    if not marcas_src:
        raise ValueError(
            "Pasta/Timbrado exigem PDF de marcas na configuração de imposição."
        )
    nros = _lote_nros_from_dados(dados, ano=ano, nro=nro)
    prefix = get_os_folder_basename(ano, nro)
    marcas_out = os.path.normpath(
        os.path.join(sefoc_dir, f"{prefix}-Marcas-OP.pdf")
    )
    marcas_ready = jdf_svc.prepare_marcas_pdf_with_ops(
        source_pdf_path=marcas_src,
        output_pdf_path=marcas_out,
        nros=nros,
    )

    gang_src = os.path.normpath((gang_pdf_path or "").strip())
    if not gang_src or not os.path.isfile(gang_src):
        raise FileNotFoundError(
            f"PDF ganged pré-impresso ausente: {gang_src or '(vazio)'}"
        )
    rotations = [int(o.get("rotacao") or 0) for o in ocupadas]
    # Completa rotações se o gang tiver mais páginas que slots (não deve).
    while len(rotations) < jdf_svc.read_pdf_page_count(gang_src):
        rotations.append(0)
    baked_path = os.path.normpath(
        os.path.join(sefoc_dir, f"{prefix}-ImposicaoGang-Rotated.pdf")
    )
    baked_path = jdf_svc.bake_page_rotations_into_pdf(
        source_pdf_path=gang_src,
        output_pdf_path=baked_path,
        rotations=rotations,
    )

    # Após bake: footprint vira MediaBox; JDF só translada (rotacao=0).
    foot_w, foot_h = juntada_svc._footprint_mm(
        page_w, page_h, rotations[0] if rotations else 0
    )
    ocupadas_flat: list[dict[str, Any]] = []
    for o in ocupadas:
        ocupadas_flat.append(
            {
                **o,
                "rotacao": 0,
                # x_mm/y_mm já são LL do footprint (calculados do centro).
            }
        )
    pagina = {
        "origem": "fixixa",
        "largura_mm": foot_w,
        "altura_mm": foot_h,
    }

    cfg.update(
        {
            "folha_mm": dict(juntada_svc.FOLHA_PRE_IMPRESSO_MM),
            "pagina": pagina,
            "grid": {
                **grid,
                "colunas": cols,
                "linhas": rows,
                "ocupadas": ocupadas_flat,
            },
            "marcas_corte": True,
            "marcas_pdf_path": marcas_ready,
            "jdf_import_root": juntada_svc.resolve_jdf_import_root(
                cfg, produto=produto
            )
            or juntada_svc.DEFAULT_JDF_IMPORT_ROOT_PAPELARIA,
        }
    )
    return cfg, baked_path


def _arquivo_dentro_da_pasta(path: str, pasta: str) -> bool:
    try:
        real_file = os.path.normcase(os.path.realpath(path))
        real_dir = os.path.normcase(os.path.realpath(pasta))
    except (OSError, ValueError):
        return False
    return os.path.dirname(real_file) == real_dir


def _fonte_marcas_pdf(
    *,
    perfil: Optional[dict[str, Any]],
    produto: Optional[str],
    variante: Optional[str],
) -> Optional[tuple[str, bool]]:
    """
    PDF de marcas original (guardado no servidor ou caminho de rede) do perfil
    de imposição: o do job e, se não servir, o perfil ativo do produto.
    Devolve ``(caminho, carimbar_op)`` ou None.
    """
    from services import papelaria_imposicao_perfil_service as perfil_svc

    candidatos: list[dict[str, Any]] = []
    if isinstance(perfil, dict):
        candidatos.append(perfil)
    if produto and variante:
        try:
            from services import papelaria_imposicao_perfil_store as perfil_store

            reg = perfil_store.get_perfil_ativo(produto, variante)
            if reg and isinstance(reg.get("perfil"), dict):
                candidatos.append(reg["perfil"])
        except Exception as exc:  # noqa: BLE001 — sem banco: fica só com o do job
            logger.info("Perfil de imposição %s/%s indisponível: %s", produto, variante, exc)
    for p in candidatos:
        try:
            src = perfil_svc.marcas_pdf(p)
        except Exception:  # noqa: BLE001
            src = None
        if src and os.path.isfile(src):
            return src, bool((p.get("marcas") or {}).get("carimbar_op"))
    return None


def _recriar_marcas_pdf(
    ausente: str,
    *,
    ano: int,
    nro: int,
    sefoc_dir: str,
    perfil: Optional[dict[str, Any]],
    produto: Optional[str],
    variante: Optional[str],
    nros: Optional[list[int]],
) -> Optional[str]:
    """
    Recria na pasta da OS o PDF de marcas que sumiu (a limpeza pós-Apogee
    apaga ``-Marcas.pdf``/``-Marcas-OP.pdf``): copia do original do perfil ou,
    com carimbo de OP, carimba de novo. None quando não há original.
    """
    fonte = _fonte_marcas_pdf(perfil=perfil, produto=produto, variante=variante)
    if not fonte:
        return None
    src, carimbar = fonte
    from services import papelaria_jdf_service as jdf_svc

    prefix = get_os_folder_basename(ano, nro)
    os.makedirs(sefoc_dir, exist_ok=True)
    if carimbar or os.path.basename(ausente).lower().endswith("-marcas-op.pdf"):
        dest = jdf_svc.prepare_marcas_pdf_with_ops(
            source_pdf_path=src,
            output_pdf_path=os.path.join(sefoc_dir, f"{prefix}-Marcas-OP.pdf"),
            nros=list(nros or [int(nro)]),
        )
    else:
        dest = os.path.normpath(os.path.join(sefoc_dir, f"{prefix}-Marcas.pdf"))
        tmp = f"{dest}.tmp"
        shutil.copyfile(src, tmp)
        os.replace(tmp, dest)
    logger.info("PDF de marcas recriado na pasta da OS (%s ausente): %s", os.path.basename(ausente), dest)
    return os.path.normpath(dest)


def ensure_marcas_pdf_na_pasta_os(
    config: dict[str, Any],
    *,
    ano: int,
    nro: int,
    sefoc_dir: str,
    perfil: Optional[dict[str, Any]] = None,
    produto: Optional[str] = None,
    variante: Optional[str] = None,
    nros: Optional[list[int]] = None,
) -> dict[str, Any]:
    """
    O Apogee lê o PDF de marcas pelo caminho gravado no JDF; ele precisa estar
    na pasta da OS (rede). Se a configuração aponta para outro lugar (caminho de
    rede do modelo/produto, storage do servidor), copia como
    ``{prefixo}-Marcas.pdf`` na pasta Sefoc da OS e devolve a config ajustada.
    Se o arquivo sumiu (ex.: limpeza depois do Apogee), recria a partir do
    PDF de marcas do perfil de imposição.
    """
    if not config.get("marcas_corte"):
        return config
    src = str(config.get("marcas_pdf_path") or "").strip()
    if not src or not sefoc_dir:
        return config
    if _arquivo_dentro_da_pasta(src, sefoc_dir) and os.path.isfile(src):
        return config
    if not os.path.isfile(src):
        try:
            recriado = _recriar_marcas_pdf(
                src,
                ano=ano,
                nro=nro,
                sefoc_dir=sefoc_dir,
                perfil=perfil,
                produto=produto,
                variante=variante,
                nros=nros,
            )
        except OSError as exc:
            raise RuntimeError(
                f"Não foi possível recriar o PDF de marcas na pasta da OS ({sefoc_dir}): {exc}"
            ) from exc
        if recriado:
            return {**config, "marcas_pdf_path": recriado}
        raise FileNotFoundError(
            f"PDF de marcas não encontrado pelo servidor: {src}, e o perfil de imposição "
            "do produto não tem um PDF de marcas para recriá-lo. "
            "Envie o PDF de marcas de novo na configuração de imposição."
        )
    prefix = get_os_folder_basename(ano, nro)
    dest = os.path.normpath(os.path.join(sefoc_dir, f"{prefix}-Marcas.pdf"))
    try:
        os.makedirs(sefoc_dir, exist_ok=True)
        tmp = f"{dest}.tmp"
        shutil.copyfile(src, tmp)
        os.replace(tmp, dest)
    except OSError as exc:
        raise RuntimeError(
            f"Não foi possível copiar o PDF de marcas para a pasta da OS ({sefoc_dir}): {exc}"
        ) from exc
    logger.info("PDF de marcas copiado para a pasta da OS: %s", dest)
    return {**config, "marcas_pdf_path": dest}


def _build_imposicao_jdf_artifacts(
    *,
    ano: int,
    nro: int,
    produto: str,
    config: dict[str, Any],
    base_pdf_path: str,
    comment: Optional[str] = None,
    descriptive_name: Optional[str] = None,
    jdf_dir: Optional[str] = None,
    sem_imposicao: bool = False,
    dados: Optional[dict[str, Any]] = None,
) -> dict[str, str]:
    """
    Monta XML/nome/pasta do JDF e grava no hotfolder Apogee (síncrono na API).
    ``dados`` do job (reenvio): perfil/variante/OPs para recriar o PDF de marcas.
    """
    from services import papelaria_jdf_service as jdf_svc

    sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    if not sem_imposicao:
        meta = (dados or {}).get("imposicao_v2")
        meta = meta if isinstance(meta, dict) else {}
        config = ensure_marcas_pdf_na_pasta_os(
            config,
            ano=ano,
            nro=nro,
            sefoc_dir=sefoc_dir,
            perfil=meta.get("perfil") if isinstance(meta.get("perfil"), dict) else None,
            produto=str(meta.get("produto") or produto or "") or None,
            variante=str(meta.get("variante") or (dados or {}).get("imposicao_variante") or "") or None,
            nros=_lote_nros_from_dados(dados, ano=ano, nro=nro) if dados else None,
        )
    prefix = get_os_folder_basename(ano, nro)
    # Nome “humano” sem o Nr OS (já vai em JobPartID / nome do .jdf).
    label = jdf_svc.strip_leading_os_number(prefix, nro) or prefix
    pagina = config.get("pagina") or {}
    if (not sem_imposicao) and pagina.get("origem") == "fixixa":
        page_w_mm = float(pagina["largura_mm"])
        page_h_mm = float(pagina["altura_mm"])
    else:
        page_w_mm, page_h_mm = jdf_svc.read_pdf_page_size_mm(base_pdf_path)

    grid = config.get("grid") or {}
    cols = int(grid.get("colunas") or 1)
    rows = int(grid.get("linhas") or 1)
    jdf_suffix = "passthrough" if sem_imposicao else f"{cols}x{rows}"
    jdf_name = jdf_svc.build_jdf_filename(
        ano=ano,
        nro=nro,
        folder_basename=f"{label}_{jdf_suffix}",
    )
    # Sem Nr OS e sem "_Imposição": Job Name já é NNNNN; o sufixo
    # "Imposição" é acrescentado pelo próprio Apogee no export.
    export_pdf_name = f"{label}.pdf"
    desc = (descriptive_name or label).strip() or label
    cmt = (comment or "").strip() or (
        f"imposição {jdf_suffix} ({produto or 'Papelaria'})"
    )
    # Prioridade: jdf_dir explícito → config.jdf_import_root → env → default produto.
    resolved_jdf_dir = jdf_svc.get_jdf_import_root(
        (jdf_dir or str(config.get("jdf_import_root") or "") or None),
        produto=produto,
    )

    # Só o .jdf vai ao hotfolder. O PDF fica na Sefoc e é referenciado no FileSpec.
    if sem_imposicao:
        jdf_xml = jdf_svc.build_apogee_passthrough_jdf_xml(
            ano=ano,
            nro=nro,
            descriptive_name=desc,
            comment=cmt,
            export_folder=sefoc_dir,
            export_filename=export_pdf_name,
            base_pdf_path=base_pdf_path,
            base_pdf_user_name=os.path.splitext(os.path.basename(base_pdf_path))[0],
            page_w_mm=page_w_mm,
            page_h_mm=page_h_mm,
            n_pages=jdf_svc.read_pdf_page_count(base_pdf_path),
        )
    else:
        jdf_xml = jdf_svc.build_apogee_jdf_xml(
            ano=ano,
            nro=nro,
            descriptive_name=desc,
            comment=cmt,
            export_folder=sefoc_dir,
            export_filename=export_pdf_name,
            base_pdf_path=base_pdf_path,
            base_pdf_user_name=os.path.splitext(os.path.basename(base_pdf_path))[0],
            config=config,
            page_w_mm=page_w_mm,
            page_h_mm=page_h_mm,
        )
    try:
        jdf_path = jdf_svc.write_jdf_file(jdf_xml, resolved_jdf_dir, jdf_name)
    except OSError as exc:
        raise RuntimeError(
            f"Não foi possível gravar o JDF em {resolved_jdf_dir}: {exc}"
        ) from exc
    if not os.path.isfile(jdf_path):
        raise RuntimeError(f"JDF não persistiu no hotfolder: {jdf_path}")
    return {
        "jdf_name": jdf_name,
        "jdf_path": jdf_path,
        "jdf_dir": resolved_jdf_dir,
        "jdf_xml": jdf_xml,
        "base_pdf_path": base_pdf_path,
    }


def build_pre_impresso_pdf_name(ano: int, nro: int) -> str:
    prefix = get_os_folder_basename(ano, nro)
    return f"{prefix}-BaseSefoc-PreImpresso.pdf"


def build_imposicao_gang_pdf_name(ano: int, nro: int) -> str:
    prefix = get_os_folder_basename(ano, nro)
    return f"{prefix}-ImposicaoGang.pdf"


def build_imposicao_offset_pdf_name(
    *,
    ano: int,
    nro: int,
    config: dict[str, Any],
) -> str:
    """{NUMOS-NomePasta}_Offset_{N}Up[_CC]_{Largura}x{Altura}.pdf"""
    prefix = get_os_folder_basename(ano, nro)
    grid = config.get("grid") or {}
    from services.papelaria_imposicao_config_service import resolve_grid_ocupadas

    n_up = max(1, len(resolve_grid_ocupadas(grid if isinstance(grid, dict) else {})))
    folha = format_folha_impressao_label(config.get("folha_mm") or {})
    safe_folha = re.sub(r"[^\w.\-]+", "-", folha).strip("-") or "Folha"
    cc = "CC_" if bool(config.get("marcas_corte")) else ""
    return f"{prefix}_Offset_{n_up}Up_{cc}{safe_folha}.pdf"


def merge_pdf_pages(sources: list[str], dest_path: str) -> str:
    """Concatena a 1ª página de cada PDF fonte em um único arquivo."""
    import fitz

    if not sources:
        raise ValueError("Nenhum PDF para juntar.")
    os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
    out = fitz.open()
    try:
        for src in sources:
            if not os.path.isfile(src):
                raise FileNotFoundError(f"PDF ausente para juntada: {src}")
            with fitz.open(src) as doc:
                if doc.page_count < 1:
                    raise ValueError(f"PDF sem páginas: {os.path.basename(src)}")
                out.insert_pdf(doc, from_page=0, to_page=0)
        out.save(dest_path)
    finally:
        out.close()
    return dest_path


def _load_os_tiragem(ano: int, nro: int) -> int:
    from services.papelaria_imposicao_juntada_service import _os_tiragem

    rows = db.execute_query(
        """
        SELECT d.Tiragem AS tiragem, d.TiragemSolicitada AS tiragem_solicitada
        FROM tabDetalhesServico d
        WHERE d.NroProtocoloLinkDet = %(nro)s AND d.AnoProtocoloLinkDet = %(ano)s
        LIMIT 1
        """,
        {"nro": int(nro), "ano": int(ano)},
    )
    if not rows:
        raise ValueError(f"OS {nro}/{ano} sem detalhes de tiragem.")
    return _os_tiragem(rows[0])


def create_imposicao_job(
    ano: int,
    nro: int,
    solicitado_por: str,
    arquivo_cdr: Optional[str] = None,
    modelo_id: Optional[int] = None,
    variante: Optional[str] = None,
    imposicao_config: Optional[dict[str, Any]] = None,
    juntada_os: Optional[list[dict[str, Any]]] = None,
    slot_os: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Gera JDF Apogee (sync) ou enfileira pipeline pré-impresso/juntada (worker)."""
    ensure_papelaria_jobs_tables()
    from services import papelaria_imposicao_config_service as imposicao_cfg_svc
    from services import papelaria_models_service as models_svc
    from services import papelaria_produto_imposicao_service as produto_imp_svc
    from services import papelaria_imposicao_juntada_service as juntada_svc

    if not modelo_id:
        raise ValueError(
            "Selecione o modelo antes de gerar a imposição (JDF)."
        )

    os_row = _validate_os_exists(ano, nro)
    modelo = models_svc.get_modelo_by_id(int(modelo_id))
    if not modelo:
        raise LookupError("Modelo não encontrado ou inativo.")

    produto_job = (modelo.get("produto") or os_row.get("produto") or "").strip() or "Papelaria"

    # Perfil v2 aprovado para a variante → caminho genérico (sem regras por produto).
    from services import papelaria_imposicao_perfil_store as perfil_store

    perfis_ativos = {
        v: reg
        for v in ("digital", "offset")
        if (reg := perfil_store.get_perfil_ativo(produto_job, v))
    }
    var_v2: Optional[str] = None
    if variante:
        var_req = produto_imp_svc.normalize_variante(variante)
        if var_req in perfis_ativos:
            var_v2 = var_req
    if var_v2:
        from services import papelaria_imposicao_v2_service as imposicao_v2_svc

        if imposicao_config is not None:
            logger.warning(
                "imposicao_config ignorado: %s/%s usa o perfil v2 aprovado (%s).",
                nro,
                ano,
                var_v2,
            )
        return imposicao_v2_svc.create_imposicao_job_v2(
            ano=ano,
            nro=nro,
            solicitado_por=solicitado_por,
            modelo=modelo,
            produto=produto_job,
            variante=var_v2,
            registro=perfis_ativos[var_v2],
            juntada_os=juntada_os,
            slot_os=slot_os,
        )

    opcoes = produto_imp_svc.resolve_imposicao_opcoes(
        produto=produto_job,
        modelo_imposicao_config_json=modelo.get("imposicao_config_json"),
    )
    disponiveis = list(opcoes.get("variantes_disponiveis") or [])
    if not variante and not disponiveis and len(perfis_ativos) == 1:
        from services import papelaria_imposicao_v2_service as imposicao_v2_svc

        (only_var, only_reg), = perfis_ativos.items()
        return imposicao_v2_svc.create_imposicao_job_v2(
            ano=ano,
            nro=nro,
            solicitado_por=solicitado_por,
            modelo=modelo,
            produto=produto_job,
            variante=only_var,
            registro=only_reg,
            juntada_os=juntada_os,
            slot_os=slot_os,
        )
    if not disponiveis:
        raise ValueError(
            "Nenhuma imposição configurada para este produto/modelo. "
            "Configure Digital e/ou Offset nas Configurações."
        )

    if variante:
        var = produto_imp_svc.normalize_variante(variante)
    elif len(disponiveis) == 1:
        var = disponiveis[0]
    else:
        raise ValueError(
            "Há mais de uma imposição (Digital/Offset). Informe a variante."
        )

    if imposicao_config is not None:
        config = imposicao_cfg_svc.validate_imposicao_config_payload(
            imposicao_config,
            require_marcas_pdf=True,
        )
    else:
        resolved = opcoes.get(var)
        if not isinstance(resolved, dict):
            raise ValueError(
                f"Imposição '{var}' não configurada para este produto/modelo."
            )
        config = imposicao_cfg_svc.validate_imposicao_config_payload(
            resolved,
            require_marcas_pdf=True,
        )

    usar_pre = bool(config.get("usar_pre_impresso")) and juntada_svc.is_pre_impresso_produto(
        produto_job
    )
    # Pré-impresso → Apogee Offset: nunca usar a variante Digital (A4).
    if usar_pre and "offset" in disponiveis and var != "offset":
        var = "offset"
        offset_cfg = opcoes.get("offset")
        if not isinstance(offset_cfg, dict):
            raise ValueError(
                "Imposição Offset obrigatória para pré-impresso Apogee."
            )
        config = imposicao_cfg_svc.validate_imposicao_config_payload(
            offset_cfg,
            require_marcas_pdf=True,
        )
        usar_pre = bool(config.get("usar_pre_impresso")) and (
            juntada_svc.is_pre_impresso_produto(produto_job)
        )

    # arquivo_cdr ignorado no fluxo JDF clássico
    _ = arquivo_cdr

    membros_raw = list(juntada_os or [])
    membros: list[dict[str, Any]] = []
    seen: set[tuple[int, int]] = {(int(ano), int(nro))}
    for item in membros_raw:
        m_ano = int(item.get("ano"))
        m_nro = int(item.get("nro"))
        key = (m_ano, m_nro)
        if key in seen:
            continue
        seen.add(key)
        _validate_os_exists(m_ano, m_nro)
        membros.append({"ano": m_ano, "nro": m_nro})

    if membros and not usar_pre:
        raise ValueError(
            "Juntada de OSs só é permitida com «Usar pré-impresso» "
            "em Timbrado A4 / Pasta Avulso."
        )

    lote = [{"ano": int(ano), "nro": int(nro)}, *membros]
    tiragens: list[int] = []
    slots_info: Optional[dict[str, Any]] = None
    is_pasta = juntada_svc.is_pasta_avulso_familia(produto_job)
    if usar_pre:
        tiragens = [_load_os_tiragem(int(x["ano"]), int(x["nro"])) for x in lote]
        slots_info = juntada_svc.alocar_slots(tiragens, produto=produto_job)
        # Pasta/Timbrado: posições absolutas do PDF de marcas + folha 745×605.
        padrao = juntada_svc.grid_padrao_pre_impresso(produto_job)
        grid = dict(config.get("grid") or {})
        cols = int(padrao.get("colunas") or grid.get("colunas") or 1)
        rows = int(padrao.get("linhas") or grid.get("linhas") or 1)
        capacity = cols * rows
        need = int(slots_info["total_slots"])
        if need > capacity:
            raise ValueError(
                f"Slots da juntada ({need}) excedem a grade "
                f"{cols}×{rows} ({capacity})."
            )
        ocupadas = juntada_svc.placements_pre_impresso(
            produto_job, n_slots=need
        )
        if is_pasta:
            pagina = {
                "origem": "fixixa",
                **juntada_svc.PAGINA_PASTA_MM,
            }
        else:
            pagina = {
                "origem": "fixixa",
                **juntada_svc.PAGINA_TIMBRADO_MM,
            }
        config = {
            **config,
            "folha_mm": dict(juntada_svc.FOLHA_PRE_IMPRESSO_MM),
            "pagina": pagina,
            "grid": {
                **grid,
                "colunas": cols,
                "linhas": rows,
                "ocupadas": ocupadas,
            },
        }

    sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    removed_digital = clear_digital_imposicao_pdfs(sefoc_dir) if not usar_pre else []

    ordem = next_queue_position()
    ancora_label = get_os_folder_basename(ano, nro)
    membros_meta: list[dict[str, Any]] = []
    for m in membros:
        try:
            label = get_os_folder_basename(int(m["ano"]), int(m["nro"]))
        except Exception:
            label = f"{int(m['nro']):05d}"
        membros_meta.append(
            {
                "ano": int(m["ano"]),
                "nro": int(m["nro"]),
                "label": label,
                "tiragem": _load_os_tiragem(int(m["ano"]), int(m["nro"])),
            }
        )

    if usar_pre:
        # Pipeline worker: exporta PreImpresso (sem Brasao), junta PDFs e grava JDF.
        lote_payload = []
        for idx, item in enumerate(lote):
            ia, ir = int(item["ano"]), int(item["nro"])
            cdr_info = select_os_usable_cdr(ia, ir)
            sefoc_m = resolve_os_papelaria_dir(ia, ir, create=True)
            pre_name = build_pre_impresso_pdf_name(ia, ir)
            lote_payload.append(
                {
                    "ano": ia,
                    "nro": ir,
                    "tiragem": tiragens[idx],
                    "slots": int(slots_info["slots"][idx]) if slots_info else 1,
                    "cdr_path": cdr_info["absolute_path"],
                    "pre_pdf_name": pre_name,
                    "pre_pdf_path": os.path.normpath(os.path.join(sefoc_m, pre_name)),
                    "label": get_os_folder_basename(ia, ir),
                }
            )
        gang_name = build_imposicao_gang_pdf_name(ano, nro)
        gang_path = os.path.normpath(os.path.join(sefoc_dir, gang_name))
        comment = juntada_svc.format_juntada_descricao(
            {"ano": ano, "nro": nro, "label": ancora_label},
            membros_meta,
        )
        dados_clean = {
            "imposicao_config": config,
            "imposicao_variante": var,
            "usar_pre_impresso": True,
            "imposicao_destino": "offset",
            "aguardando_apogee": False,
            "pre_impresso_pipeline": True,
            "ancora": {"ano": ano, "nro": nro, "label": ancora_label},
            "juntada_membros": membros_meta,
            "juntada_lote": lote_payload,
            "juntada_slots": slots_info,
            "gang_pdf_name": gang_name,
            "gang_pdf_path": gang_path,
            "jdf_comment": comment,
            "jdf_import_root": juntada_svc.resolve_jdf_import_root(
                config, produto=produto_job
            ),
            "compose_com_template": False,
            # Layout JDF com posições absolutas + PDF de marcas (ContentObject).
            "jdf_sem_imposicao": False,
            "pasta_art_blank_pages": False,
        }
        insert_params = {
            "nro": nro,
            "ano": ano,
            "tipo": TIPO_JOB_IMPOSICAO,
            "produto": produto_job,
            "modelo_id": int(modelo["id"]),
            "arquivo": (modelo.get("arquivo_modelo") or "").strip(),
            "dados": json.dumps(dados_clean, ensure_ascii=False),
            "status": STATUS_PENDING,
            "ordem": ordem,
            "ponto": solicitado_por,
            "job_pai": None,
            "prova_revisao": PROVA_REVISAO_NA,
            "concluido": None,
        }

        def _insert_pending(cursor) -> int:
            cursor.execute(
                """
                INSERT INTO tabPapelariaJobs (
                    NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                    DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao, JobPaiID,
                    ArquivoPdfGerado, ProvaRevisao, ConcluidoEm
                ) VALUES (
                    %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                    %(dados)s, %(status)s, 0, %(ordem)s, %(ponto)s, 1, %(job_pai)s,
                    NULL, %(prova_revisao)s, %(concluido)s
                )
                """,
                insert_params,
            )
            return int(cursor.lastrowid)

        job_id = int(db.execute_transaction([_insert_pending])[0])
        job = get_job(job_id)
        if not job:
            raise RuntimeError("Falha ao recuperar job criado.")
        n_membros = len(membros_meta)
        append_job_log(
            job_id,
            (
                f"Imposição pré-impressa enfileirada "
                f"(âncora {int(nro):05d}"
                + (f" + {n_membros} OS juntada(s)" if n_membros else "")
                + f"; slots={slots_info['slots'] if slots_info else [1]})."
            ),
            "info",
        )
        broadcast_job_update(job)
        return job

    base_pdf_path = resolve_base_sefoc_pdf_path(ano, nro)
    base_pdf_name = os.path.basename(base_pdf_path)

    artifacts = _build_imposicao_jdf_artifacts(
        ano=ano,
        nro=nro,
        produto=produto_job,
        config=config,
        base_pdf_path=base_pdf_path,
    )

    dados_clean = {
        "base_pdf": base_pdf_name,
        "imposicao_config": config,
        "imposicao_variante": var,
        "usar_pre_impresso": False,
        "imposicao_destino": "digital",
        "jdf_path": artifacts["jdf_path"],
        "jdf_dir": artifacts["jdf_dir"],
        "jdf_name": artifacts["jdf_name"],
        "aguardando_apogee": True,
    }
    if removed_digital:
        dados_clean["imposicao_pdfs_removidos"] = removed_digital

    insert_params = {
        "nro": nro,
        "ano": ano,
        "tipo": TIPO_JOB_IMPOSICAO,
        "produto": produto_job,
        "modelo_id": int(modelo["id"]),
        "arquivo": (modelo.get("arquivo_modelo") or "").strip(),
        "dados": json.dumps(dados_clean, ensure_ascii=False),
        "status": STATUS_COMPLETED,
        "ordem": ordem,
        "ponto": solicitado_por,
        "job_pai": None,
        "prova_revisao": PROVA_REVISAO_NA,
    }

    def _insert_job(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabPapelariaJobs (
                NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao, JobPaiID,
                ArquivoPdfGerado, ProvaRevisao, ConcluidoEm
            ) VALUES (
                %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                %(dados)s, %(status)s, 0, %(ordem)s, %(ponto)s, 1, %(job_pai)s,
                NULL, %(prova_revisao)s, NOW()
            )
            """,
            insert_params,
        )
        return int(cursor.lastrowid)

    results = db.execute_transaction([_insert_job])
    job_id = int(results[0])
    job = get_job(job_id)
    if not job:
        raise RuntimeError("Falha ao recuperar job criado.")

    extra = ""
    if removed_digital:
        extra = f" PDF(s) Digital anterior(es) removido(s): {', '.join(removed_digital)}."
    append_job_log(
        job_id,
        (
            f"JDF enviado ao Apogee: {artifacts['jdf_name']} "
            f"({artifacts['jdf_dir']}) a partir de {base_pdf_name}.{extra}"
        ),
        "info",
    )
    broadcast_job_update(job)
    return job


def resend_imposicao_jdf(
    job_id: int,
    *,
    solicitado_por: str = "",
) -> dict[str, Any]:
    """
    Regrava o JDF no hotfolder do Apogee para um job de imposição ainda
    aguardando o PDF (sem criar novo job).
    """
    ensure_papelaria_jobs_tables()
    from services import papelaria_imposicao_config_service as imposicao_cfg_svc

    job = get_job(job_id, include_logs=False)
    if not job:
        raise LookupError("Job não encontrado.")
    if job.get("tipo_job") != TIPO_JOB_IMPOSICAO:
        raise ValueError("Somente jobs de imposição podem reenviar o JDF.")
    if job.get("status") != STATUS_COMPLETED:
        raise ValueError("Job de imposição não está em estado concluído.")

    dados = job.get("dados") if isinstance(job.get("dados"), dict) else {}
    pdf_name = (job.get("arquivo_pdf") or "").strip()
    aguardando = bool(dados.get("aguardando_apogee")) or (
        not pdf_name or pdf_name.lower().endswith(".jdf")
    )
    if not aguardando:
        raise ValueError(
            "Este job já possui PDF de imposição. Não é necessário reenviar o JDF."
        )

    raw_config = dados.get("imposicao_config")
    if not isinstance(raw_config, dict):
        raise ValueError(
            "Configuração de imposição ausente no job. Gere a imposição novamente."
        )
    config = imposicao_cfg_svc.validate_imposicao_config_payload(
        raw_config,
        require_marcas_pdf=True,
    )

    ano = int(job["ano_protocolo"])
    nro = int(job["nro_protocolo"])
    produto = (job.get("produto") or "").strip() or "Papelaria"
    gang_path = str(dados.get("gang_pdf_path") or "").strip()
    usar_pre = bool(dados.get("usar_pre_impresso") or dados.get("pre_impresso_pipeline"))
    # Legado: jobs antigos com passthrough; novos usam Layout + marcas.
    sem_imposicao = bool(dados.get("jdf_sem_imposicao")) and not usar_pre
    if (usar_pre or gang_path) and gang_path and os.path.isfile(gang_path):
        base_pdf_path = gang_path
    else:
        base_pdf_path = resolve_base_sefoc_pdf_path(ano, nro)
    base_pdf_name = os.path.basename(base_pdf_path)

    if isinstance(dados.get("imposicao_v2"), dict) and not usar_pre and not sem_imposicao:
        # Perfil v2: refaz o ajuste ao número de páginas do PDF atual.
        from services import papelaria_imposicao_v2_service as imposicao_v2_svc

        dados = dict(dados)
        readaptada = imposicao_v2_svc.config_para_reenvio(dados, base_pdf_path=base_pdf_path)
        if readaptada is not None:
            config = readaptada

    if usar_pre and not sem_imposicao:
        config, base_pdf_path = _prepare_pre_impresso_jdf_config(
            config=config,
            produto=produto,
            dados=dados,
            ano=ano,
            nro=nro,
            sefoc_dir=os.path.dirname(gang_path or base_pdf_path) or ".",
            gang_pdf_path=gang_path or base_pdf_path,
        )
        base_pdf_name = os.path.basename(base_pdf_path)

    artifacts = _build_imposicao_jdf_artifacts(
        ano=ano,
        nro=nro,
        produto=produto,
        config=config,
        base_pdf_path=base_pdf_path,
        jdf_dir=str(dados.get("jdf_import_root") or "") or None,
        sem_imposicao=sem_imposicao,
        dados=dados,
    )

    dados_next = dict(dados)
    dados_next.update(
        {
            "base_pdf": base_pdf_name,
            "imposicao_config": config,
            "jdf_path": artifacts["jdf_path"],
            "jdf_dir": artifacts["jdf_dir"],
            "jdf_name": artifacts["jdf_name"],
            "aguardando_apogee": True,
        }
    )
    if solicitado_por:
        dados_next["jdf_reenviado_por"] = str(solicitado_por).strip()

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET DadosJson = %(dados)s,
            ArquivoPdfGerado = NULL
        WHERE ID = %(id)s
        """,
        {
            "id": job_id,
            "dados": json.dumps(dados_next, ensure_ascii=False),
        },
    )

    who = f" por {solicitado_por}" if (solicitado_por or "").strip() else ""
    append_job_log(
        job_id,
        (
            f"JDF reenviado ao Apogee{who}: {artifacts['jdf_name']} "
            f"({artifacts['jdf_dir']}) a partir de {base_pdf_name}."
        ),
        "info",
    )
    updated = get_job(job_id, include_logs=True)
    if not updated:
        raise RuntimeError("Falha ao recuperar job após reenvio do JDF.")
    broadcast_job_update(updated)
    return updated


def create_export_existing_cdr_job(
    ano: int,
    nro: int,
    modelo_id: int,
    dados: dict[str, Any],
    solicitado_por: str,
    arquivo_cdr: Optional[str] = None,
) -> dict[str, Any]:
    """Enfileira exportação de PDF a partir de um .cdr existente na pasta da OS."""
    ensure_papelaria_jobs_tables()
    from services import papelaria_models_service as models_svc

    os_row = _validate_os_exists(ano, nro)
    modelo = models_svc.get_modelo_by_id(modelo_id)
    if not modelo:
        raise LookupError("Modelo não encontrado ou inativo.")

    chosen = select_os_usable_cdr(ano, nro, arquivo_cdr)

    _sanitize_dados(dados)
    dados_clean = {INPUT_CDR_DADOS_KEY: chosen["relative_path"]}

    ordem = next_queue_position()
    produto_os = (os_row.get("produto") or modelo["produto"] or "").strip()
    produto_job = modelo["produto"]

    insert_params = {
        "nro": nro,
        "ano": ano,
        "tipo": TIPO_JOB_EXPORT_EXISTING_CDR,
        "produto": produto_job,
        "modelo_id": modelo_id,
        "arquivo": modelo["arquivo_modelo"],
        "dados": json.dumps(dados_clean, ensure_ascii=False),
        "status": STATUS_PENDING,
        "ordem": ordem,
        "ponto": solicitado_por,
        "job_pai": None,
    }

    def _insert_job(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabPapelariaJobs (
                NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao, JobPaiID
            ) VALUES (
                %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                %(dados)s, %(status)s, 0, %(ordem)s, %(ponto)s, 1, %(job_pai)s
            )
            """,
            insert_params,
        )
        return int(cursor.lastrowid)

    results = db.execute_transaction([_insert_job])
    job_id = int(results[0])
    job = get_job(job_id)
    if not job:
        raise RuntimeError("Falha ao recuperar job criado.")

    append_job_log(
        job_id,
        f"Exportação de prova a partir do Corel existente ({chosen['filename']}).",
        "info",
    )
    warning = _product_match_warning(produto_os, produto_job)
    if warning:
        append_job_log(job_id, warning, "warning")
        job["warnings"] = [warning]

    broadcast_job_update(job)
    return job


def create_timbrado_a4_digital_job(
    ano: int,
    nro: int,
    modelo_id: int,
    dados: dict[str, Any],
    solicitado_por: str,
) -> dict[str, Any]:
    """Enfileira geração dos DOCX Timbrado A4 Digital (SVG cabeçalho/rodapé)."""
    ensure_papelaria_jobs_tables()
    from services import papelaria_models_service as models_svc

    os_row = _validate_os_exists(ano, nro)
    produto_os = (os_row.get("produto") or "").strip()
    if not is_timbrado_a4_digital_produto(produto_os):
        raise ValueError(
            "Geração Timbrado A4 Digital disponível apenas para o produto "
            f"'{PRODUTO_TIMBRADO_A4_DIGITAL}'."
        )

    modelo = models_svc.get_modelo_by_id(modelo_id)
    if not modelo:
        raise LookupError("Modelo não encontrado ou inativo.")

    from services.papelaria_prova_pdf_service import tem_modelo_pdf

    if not tem_modelo_pdf(modelo_id):
        raise ValueError(
            "Timbrado A4 Digital exige modelo com Prova PDF configurada "
            "(PDF + campos). Configure o PDF do modelo antes de gerar."
        )

    dados_clean = _sanitize_dados(dados)
    missing = _validate_required_fields(modelo, dados_clean)
    if missing:
        raise ValueError(f"Campos obrigatórios ausentes: {', '.join(missing)}")

    if "gabinete" in dados_clean and dados_clean["gabinete"]:
        dados_clean["gabinete"] = models_svc.normalizar_gabinete(dados_clean["gabinete"])
    if "uf" in dados_clean and dados_clean["uf"]:
        dados_clean["uf"] = dados_clean["uf"].upper()

    ordem = next_queue_position()
    produto_job = modelo["produto"]

    insert_params = {
        "nro": nro,
        "ano": ano,
        "tipo": TIPO_JOB_TIMBRADO_A4_DIGITAL,
        "produto": produto_job,
        "modelo_id": modelo_id,
        "arquivo": modelo["arquivo_modelo"],
        "dados": json.dumps(dados_clean, ensure_ascii=False),
        "status": STATUS_PENDING,
        "ordem": ordem,
        "ponto": solicitado_por,
        "job_pai": None,
    }

    def _insert_job(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabPapelariaJobs (
                NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao, JobPaiID
            ) VALUES (
                %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                %(dados)s, %(status)s, 0, %(ordem)s, %(ponto)s, 1, %(job_pai)s
            )
            """,
            insert_params,
        )
        return int(cursor.lastrowid)

    results = db.execute_transaction([_insert_job])
    job_id = int(results[0])
    job = get_job(job_id)
    if not job:
        raise RuntimeError("Falha ao recuperar job criado.")

    append_job_log(
        job_id,
        "Job Timbrado A4 Digital criado (SVG + DOCX Cor/PB).",
        "info",
    )
    warning = _product_match_warning(produto_os, produto_job)
    if warning:
        append_job_log(job_id, warning, "warning")
        job["warnings"] = [warning]

    broadcast_job_update(job)
    return job


def create_credenciais_depol_job(
    ano: int,
    nro: int,
    dados: dict[str, Any],
    solicitado_por: str,
) -> dict[str, Any]:
    """Enfileira geração multipágina de Credenciais DEPOL (sem modelo Papelaria)."""
    ensure_papelaria_jobs_tables()
    # DEPOL não é serviço de papelaria: aceita qualquer OS existente.
    _validate_os_exists(ano, nro, require_papelaria=False)

    if not isinstance(dados, dict):
        raise ValueError("Campo 'dados' deve ser um objeto JSON.")
    itens = dados.get("itens")
    if not isinstance(itens, list) or not itens:
        raise ValueError("Dados DEPOL sem itens.")
    payload = json.dumps(dados, ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_DADOS_JSON_BYTES * 4:
        raise ValueError("Payload de dados DEPOL excede o limite permitido.")

    ordem = next_queue_position()
    insert_params = {
        "nro": nro,
        "ano": ano,
        "tipo": TIPO_JOB_CREDENCIAIS_DEPOL,
        "produto": "Credenciais DEPOL",
        "modelo_id": None,
        "arquivo": "",
        "dados": payload,
        "status": STATUS_PENDING,
        "ordem": ordem,
        "ponto": solicitado_por,
        "job_pai": None,
    }

    def _insert_job(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabPapelariaJobs (
                NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao, JobPaiID
            ) VALUES (
                %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                %(dados)s, %(status)s, 0, %(ordem)s, %(ponto)s, 1, %(job_pai)s
            )
            """,
            insert_params,
        )
        return int(cursor.lastrowid)

    results = db.execute_transaction([_insert_job])
    job_id = int(results[0])
    job = get_job(job_id)
    if not job:
        raise RuntimeError("Falha ao recuperar job criado.")

    append_job_log(
        job_id,
        f"Job Credenciais DEPOL criado ({len(itens)} credencial(is)).",
        "info",
    )
    broadcast_job_update(job)
    return job


def get_job(
    job_id: int,
    include_logs: bool = False,
    *,
    recover_stale: bool = True,
) -> Optional[dict[str, Any]]:
    ensure_papelaria_jobs_tables()
    if recover_stale:
        maybe_recover_processing_job(job_id)
    rows = db.execute_query(
        "SELECT * FROM tabPapelariaJobs WHERE ID = %(id)s LIMIT 1",
        {"id": job_id},
    )
    if not rows:
        return None
    return _row_to_job(rows[0], include_logs=include_logs)


def list_jobs_for_os(ano: int, nro: int, limit: int = 50) -> list[dict[str, Any]]:
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        """
        SELECT * FROM tabPapelariaJobs
        WHERE AnoProtocolo = %(ano)s AND NroProtocolo = %(nro)s
        ORDER BY SolicitadoEm DESC, ID DESC
        LIMIT %(limit)s
        """,
        {"ano": ano, "nro": nro, "limit": max(1, min(limit, 100))},
    )
    return [_row_to_job(r) for r in rows]


def list_job_logs(job_id: int, limit: int = 50) -> list[dict[str, Any]]:
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        """
        SELECT ID, JobID, Nivel, Mensagem, DetalheJson, CriadoEm
        FROM tabPapelariaJobLog
        WHERE JobID = %(job_id)s
        ORDER BY CriadoEm ASC, ID ASC
        LIMIT %(limit)s
        """,
        {"job_id": job_id, "limit": max(1, min(limit, 200))},
    )
    return [
        {
            "id": r["ID"],
            "nivel": r.get("Nivel") or "info",
            "mensagem": r.get("Mensagem") or "",
            "criado_em": _format_datetime(r.get("CriadoEm")),
        }
        for r in rows
    ]


def _cancel_actor_label(solicitado_por: str) -> str:
    if str(solicitado_por).startswith("admin:"):
        return "administrador"
    return "usuário"


def normalize_pending_queue_orders() -> None:
    """Garante OrdemFila sequencial (1..n) nos jobs pending."""
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        """
        SELECT ID FROM tabPapelariaJobs
        WHERE Status = %(pending)s
        ORDER BY Prioridade DESC, COALESCE(OrdemFila, 999999) ASC, ID ASC
        """,
        {"pending": STATUS_PENDING},
    )
    for i, row in enumerate(rows or [], start=1):
        db.execute_query(
            """
            UPDATE tabPapelariaJobs
            SET OrdemFila = %(ordem)s
            WHERE ID = %(id)s AND Status = %(pending)s
            """,
            {"ordem": i, "id": int(row["ID"]), "pending": STATUS_PENDING},
        )


def move_pending_job(
    job_id: int,
    direction: str,
    solicitado_por: str,
) -> dict[str, Any]:
    """Move job pending uma posição para cima ou para baixo na fila."""
    ensure_papelaria_jobs_tables()
    direction_l = (direction or "").strip().lower()
    if direction_l not in ("up", "down"):
        raise ValueError("direction deve ser 'up' ou 'down'.")

    normalize_pending_queue_orders()
    rows = db.execute_query(
        """
        SELECT ID, OrdemFila FROM tabPapelariaJobs
        WHERE Status = %(pending)s
        ORDER BY OrdemFila ASC, ID ASC
        """,
        {"pending": STATUS_PENDING},
    )
    if not rows:
        raise ValueError("Fila vazia.")

    ids = [int(r["ID"]) for r in rows]
    if job_id not in ids:
        raise ValueError("Somente jobs na fila (pending) podem ser reordenados.")

    idx = ids.index(job_id)
    if direction_l == "up":
        if idx == 0:
            job = get_job(job_id, recover_stale=False)
            if not job:
                raise LookupError("Job não encontrado.")
            return job
        swap_id = ids[idx - 1]
    else:
        if idx >= len(ids) - 1:
            job = get_job(job_id, recover_stale=False)
            if not job:
                raise LookupError("Job não encontrado.")
            return job
        swap_id = ids[idx + 1]

    ordem_job = int(rows[idx].get("OrdemFila") or (idx + 1))
    ordem_swap = int(rows[idx + (1 if direction_l == "down" else -1)].get("OrdemFila") or 0)

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET OrdemFila = %(ordem)s
        WHERE ID = %(id)s AND Status = %(pending)s
        """,
        {"ordem": ordem_swap, "id": job_id, "pending": STATUS_PENDING},
    )
    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET OrdemFila = %(ordem)s
        WHERE ID = %(id)s AND Status = %(pending)s
        """,
        {"ordem": ordem_job, "id": swap_id, "pending": STATUS_PENDING},
    )

    actor = _cancel_actor_label(solicitado_por)
    append_job_log(
        job_id,
        f"Posição na fila alterada ({direction_l}) pelo {actor} {solicitado_por}.",
        "info",
    )
    updated = get_job(job_id, recover_stale=False)
    if not updated:
        raise LookupError("Job não encontrado.")
    broadcast_job_update(updated)
    swap_updated = get_job(swap_id, recover_stale=False)
    if swap_updated:
        broadcast_job_update(swap_updated)
    return updated


def cancel_job(job_id: int, solicitado_por: str) -> dict[str, Any]:
    ensure_papelaria_jobs_tables()
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")

    current_status = job["status"]
    if current_status not in CANCELLABLE_STATUSES:
        raise ValueError(
            f"Job não pode ser cancelado no status '{current_status}'."
        )

    if current_status == STATUS_PENDING:
        db.execute_query(
            """
            UPDATE tabPapelariaJobs
            SET Status = %(status)s, ConcluidoEm = NOW(), Erro = NULL
            WHERE ID = %(id)s AND Status = %(pending)s
            """,
            {
                "id": job_id,
                "status": STATUS_CANCELLED,
                "pending": STATUS_PENDING,
            },
        )
    else:
        db.execute_query(
            """
            UPDATE tabPapelariaJobs
            SET Status = %(status)s,
                ConcluidoEm = NOW(),
                WorkerID = NULL,
                IniciadoEm = NULL,
                Erro = %(erro)s
            WHERE ID = %(id)s AND Status = %(processing)s
            """,
            {
                "id": job_id,
                "status": STATUS_CANCELLED,
                "processing": STATUS_PROCESSING,
                "erro": (
                    f"Cancelado pelo {_cancel_actor_label(solicitado_por)} "
                    "durante processamento."
                ),
            },
        )

    updated = get_job(job_id, recover_stale=False)
    if not updated or updated["status"] != STATUS_CANCELLED:
        raise ValueError("Job não pôde ser cancelado (status alterado).")

    actor = _cancel_actor_label(solicitado_por)
    msg = (
        f"Job cancelado pelo {actor} {solicitado_por} durante processamento."
        if current_status == STATUS_PROCESSING
        else f"Job cancelado pelo {actor} {solicitado_por}."
    )
    append_job_log(job_id, msg, "info")
    broadcast_job_update(updated)
    return updated


def is_job_cancelled(job_id: int) -> bool:
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        "SELECT Status FROM tabPapelariaJobs WHERE ID = %(id)s LIMIT 1",
        {"id": job_id},
    )
    if not rows:
        return False
    return (rows[0].get("Status") or "") == STATUS_CANCELLED


def _worker_heartbeat_stale_seconds() -> int:
    raw = (os.environ.get("SAGRA_PAPELARIA_WORKER_HEARTBEAT_STALE_SEC") or "").strip()
    try:
        return max(30, int(raw))
    except ValueError:
        return _DEFAULT_WORKER_HEARTBEAT_STALE_SEC


def _parse_heartbeat_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    return None


_heartbeat_table_ready = False


def _ensure_worker_heartbeat_table() -> None:
    """DDL uma vez por processo — antes rodava a cada heartbeat (~1/s, 7 mi vezes)."""
    global _heartbeat_table_ready
    if _heartbeat_table_ready:
        return
    db.execute_query(
        """
        CREATE TABLE IF NOT EXISTS tabPapelariaWorkerHeartbeat (
            WorkerID VARCHAR(64) NOT NULL PRIMARY KEY,
            HeartbeatEm DATETIME NOT NULL,
            MetaJson JSON NULL,
            INDEX idx_heartbeat_em (HeartbeatEm)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )
    _heartbeat_table_ready = True


def _persist_worker_heartbeat(
    worker_id: str, heartbeat_at: datetime, meta: dict[str, Any]
) -> None:
    ensure_papelaria_jobs_tables()
    _ensure_worker_heartbeat_table()
    meta_json = json.dumps(meta, ensure_ascii=False) if meta else None
    db.execute_query(
        """
        INSERT INTO tabPapelariaWorkerHeartbeat (WorkerID, HeartbeatEm, MetaJson)
        VALUES (%(wid)s, %(heartbeat_em)s, %(meta)s)
        ON DUPLICATE KEY UPDATE
            HeartbeatEm = VALUES(HeartbeatEm),
            MetaJson = VALUES(MetaJson)
        """,
        {
            "wid": worker_id,
            "heartbeat_em": heartbeat_at,
            "meta": meta_json,
        },
    )


def _worker_registry() -> dict[str, tuple[datetime, dict[str, Any]]]:
    """Estado dos workers: MySQL (persistente) + cache em memória (fallback)."""
    registry: dict[str, tuple[datetime, dict[str, Any]]] = {}
    try:
        ensure_papelaria_jobs_tables()
        rows = db.execute_query(
            """
            SELECT WorkerID, HeartbeatEm, MetaJson
            FROM tabPapelariaWorkerHeartbeat
            ORDER BY WorkerID
            """
        )
        for row in rows or []:
            wid = (row.get("WorkerID") or "").strip()
            ts = _parse_heartbeat_datetime(row.get("HeartbeatEm"))
            if not wid or ts is None:
                continue
            meta = _parse_json_field(row.get("MetaJson")) or {}
            if not isinstance(meta, dict):
                meta = {}
            registry[wid] = (ts, meta)
    except Exception as exc:
        logger.warning("Falha ao ler heartbeats de workers no banco: %s", exc)

    for wid, ts in _worker_heartbeats.items():
        if wid not in registry:
            registry[wid] = (ts, _worker_meta.get(wid) or {})
    return registry


def _processing_max_seconds() -> int:
    raw = (os.environ.get("SAGRA_PAPELARIA_PROCESSING_MAX_SEC") or "").strip()
    try:
        return max(120, int(raw))
    except ValueError:
        return _DEFAULT_PROCESSING_MAX_SEC


def _job_stall_seconds() -> int:
    """Tempo sem resposta do worker antes de redirecionar o job a outro worker."""
    raw = (os.environ.get("SAGRA_PAPELARIA_JOB_STALL_SEC") or "").strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return _DEFAULT_JOB_STALL_SEC


def _job_cancelled_for_worker(job_id: int, worker_id: str) -> tuple[bool, Optional[str]]:
    """True se o job foi cancelado ou deixou de pertencer a este worker."""
    if is_job_cancelled(job_id):
        return True, "Job cancelado pelo usuário."
    job = get_job(job_id, recover_stale=False)
    if not job:
        return True, "Job não encontrado."
    if job["status"] != STATUS_PROCESSING:
        motivo = (job.get("erro") or "").strip()
        if job["status"] == STATUS_PENDING:
            return True, motivo or "Job redirecionado para outro worker."
        if job["status"] == STATUS_CANCELLED:
            return True, motivo or "Job cancelado."
        return True, f"Job não está mais em processamento (status: {job['status']})."
    if (job.get("worker_id") or "").strip() != (worker_id or "").strip():
        return True, "Job redirecionado para outro worker."
    return False, None


def _fleet_load_balance_enabled() -> bool:
    raw = (os.environ.get("SAGRA_PAPELARIA_FLEET_LOAD_BALANCE") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _load_score_margin() -> float:
    raw = (os.environ.get("SAGRA_PAPELARIA_LOAD_SCORE_MARGIN") or "").strip()
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 10.0


def _system_load_from_meta(meta: Optional[dict[str, Any]]) -> Optional[dict[str, float]]:
    if not meta:
        return None
    load = meta.get("system_load")
    if not isinstance(load, dict):
        return None
    try:
        cpu = float(load.get("cpu_percent", -1))
        mem = float(load.get("memory_percent", -1))
    except (TypeError, ValueError):
        return None
    if cpu < 0 or mem < 0 or cpu > 100 or mem > 100:
        return None
    score_raw = load.get("score")
    if score_raw is None:
        score = 0.5 * cpu + 0.5 * mem
    else:
        score = float(score_raw)
    return {
        "cpu_percent": round(cpu, 1),
        "memory_percent": round(mem, 1),
        "score": round(score, 1),
    }


def _worker_eligible_for_claim(worker_id: str) -> bool:
    """Só permite claim se o worker estiver entre os menos carregados da frota."""
    if not _fleet_load_balance_enabled():
        return True
    wid = (worker_id or "").strip()
    my_load = _system_load_from_meta(_worker_registry().get(wid, (None, {}))[1])
    if my_load is None:
        return True

    online_scores: list[float] = []
    for other_id, (_ts, other_meta) in _worker_registry().items():
        if not _is_worker_recently_alive(other_id):
            continue
        load = _system_load_from_meta(other_meta)
        if load is not None:
            online_scores.append(load["score"])

    if not online_scores:
        return True

    min_score = min(online_scores)
    return my_load["score"] <= min_score + _load_score_margin()


def _is_worker_recently_alive(worker_id: str, max_age_sec: Optional[int] = None) -> bool:
    wid = (worker_id or "").strip()
    if not wid:
        return False
    entry = _worker_registry().get(wid)
    if not entry:
        return False
    last = entry[0]
    limit = max_age_sec if max_age_sec is not None else _worker_heartbeat_stale_seconds()
    return (datetime.now() - last).total_seconds() <= limit


def _requeue_processing_job(job_id: int, motivo: str) -> bool:
    ensure_papelaria_jobs_tables()
    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET Status = %(pending)s,
            WorkerID = NULL,
            IniciadoEm = NULL,
            Erro = %(erro)s
        WHERE ID = %(id)s AND Status = %(processing)s
        """,
        {
            "id": job_id,
            "pending": STATUS_PENDING,
            "processing": STATUS_PROCESSING,
            "erro": (motivo or "Reenfileirado.")[:4000],
        },
    )
    rows = db.execute_query(
        "SELECT ID FROM tabPapelariaJobs WHERE ID = %(id)s AND Status = %(pending)s",
        {"id": job_id, "pending": STATUS_PENDING},
    )
    if not rows:
        return False
    append_job_log(job_id, motivo[:4000], "warning")
    updated = get_job(job_id, recover_stale=False)
    if updated:
        broadcast_job_update(updated)
    return True


def requeue_orphaned_jobs_for_worker(
    worker_id: str,
    motivo: str = "Worker reiniciado — job reenfileirado.",
) -> list[int]:
    """Reenfileira jobs em processamento atribuídos ao worker (ex.: após reinício)."""
    ensure_papelaria_jobs_tables()
    wid = (worker_id or "").strip()
    if not wid:
        return []
    rows = db.execute_query(
        """
        SELECT ID FROM tabPapelariaJobs
        WHERE Status = %(processing)s AND WorkerID = %(worker_id)s
        ORDER BY ID ASC
        """,
        {"processing": STATUS_PROCESSING, "worker_id": wid},
    )
    requeued: list[int] = []
    for row in rows or []:
        job_id = int(row["ID"])
        if _requeue_processing_job(job_id, motivo):
            requeued.append(job_id)
    if requeued:
        logger.info(
            "Jobs reenfileirados para worker %s: %s",
            wid,
            requeued,
        )
    return requeued


def maybe_recover_processing_job(job_id: int) -> bool:
    """
    Se o job está em processing sem worker ativo, volta para pending.
    Chamado em consultas da UI e antes do claim.
    """
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        """
        SELECT ID, Status, WorkerID, IniciadoEm
        FROM tabPapelariaJobs
        WHERE ID = %(id)s
        LIMIT 1
        """,
        {"id": job_id},
    )
    if not rows:
        return False
    row = rows[0]
    if (row.get("Status") or "") != STATUS_PROCESSING:
        return False

    iniciado = row.get("IniciadoEm")
    if not isinstance(iniciado, datetime):
        return False

    age_sec = (datetime.now() - iniciado).total_seconds()
    worker_id = (row.get("WorkerID") or "").strip()
    stale_sec = _worker_heartbeat_stale_seconds()
    stall_sec = _job_stall_seconds()
    max_sec = _processing_max_seconds()

    if age_sec >= stall_sec and not _is_worker_recently_alive(
        worker_id, max_age_sec=stall_sec
    ):
        return _requeue_processing_job(
            job_id,
            (
                f"Worker não respondeu em {stall_sec} segundos — "
                "job redirecionado para outro worker."
            ),
        )

    if age_sec >= max_sec:
        return _requeue_processing_job(
            job_id,
            "Tempo máximo de processamento excedido — reenfileirado.",
        )

    if age_sec >= stale_sec and not _is_worker_recently_alive(worker_id):
        return _requeue_processing_job(
            job_id,
            "Worker interrompido — reenfileirado para nova tentativa.",
        )
    return False


def recover_stale_processing_jobs() -> list[int]:
    """Varre todos os jobs em processing e reenfileira os órfãos."""
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        "SELECT ID FROM tabPapelariaJobs WHERE Status = %(processing)s ORDER BY ID ASC",
        {"processing": STATUS_PROCESSING},
    )
    recovered: list[int] = []
    for row in rows or []:
        job_id = int(row["ID"])
        if maybe_recover_processing_job(job_id):
            recovered.append(job_id)
    return recovered


def record_worker_heartbeat(worker_id: str, meta: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    wid = (worker_id or "").strip()
    if not wid:
        raise ValueError("worker_id é obrigatório.")
    now = datetime.now()
    _worker_heartbeats[wid] = now
    meta = meta or {}
    _worker_meta[wid] = meta
    try:
        _persist_worker_heartbeat(wid, now, meta)
    except Exception as exc:
        logger.warning("Falha ao persistir heartbeat do worker %s: %s", wid, exc)
    requeued: list[int] = []
    if meta.get("event") == "startup":
        requeued = requeue_orphaned_jobs_for_worker(wid)
    cancelled_job_id: Optional[int] = None
    cancelled_reason: Optional[str] = None
    processing_job_id = meta.get("processing_job_id")
    if processing_job_id is not None:
        try:
            pid = int(processing_job_id)
        except (TypeError, ValueError):
            pid = 0
        if pid > 0:
            maybe_recover_processing_job(pid)
            cancelado, motivo = _job_cancelled_for_worker(pid, wid)
            if cancelado:
                cancelled_job_id = pid
                cancelled_reason = motivo
    return {
        "worker_id": wid,
        "status": "ok",
        "heartbeat_em": now.isoformat(sep=" ", timespec="seconds"),
        "meta": meta,
        "requeued_jobs": requeued,
        "cancelled_job_id": cancelled_job_id,
        "cancelled_reason": cancelled_reason,
    }


def list_worker_heartbeats() -> list[dict[str, Any]]:
    now = datetime.now()
    stale_sec = _worker_heartbeat_stale_seconds()
    workers: list[dict[str, Any]] = []
    for wid, (ts, meta) in sorted(_worker_registry().items()):
        age = (now - ts).total_seconds()
        load = _system_load_from_meta(meta)
        entry: dict[str, Any] = {
            "worker_id": wid,
            "heartbeat_em": ts.isoformat(sep=" ", timespec="seconds"),
            "online": age <= stale_sec,
            "seconds_since_heartbeat": int(age),
        }
        if load is not None:
            entry["cpu_percent"] = load["cpu_percent"]
            entry["memory_percent"] = load["memory_percent"]
            entry["load_score"] = load["score"]
        workers.append(entry)
    return workers


def get_admin_worker_queue_snapshot(
    *,
    fila_limit: int = 80,
    recentes_limit: int = 25,
) -> dict[str, Any]:
    """Painel admin: fila ativa, workers e totais por status."""
    ensure_papelaria_jobs_tables()
    recover_stale_processing_jobs()

    count_rows = db.execute_query(
        """
        SELECT Status, COUNT(*) AS total
        FROM tabPapelariaJobs
        GROUP BY Status
        """
    )
    totais = {status: 0 for status in (
        STATUS_PENDING,
        STATUS_PROCESSING,
        STATUS_COMPLETED,
        STATUS_FAILED,
        STATUS_CANCELLED,
    )}
    for row in count_rows or []:
        status = row.get("Status") or ""
        if status in totais:
            totais[status] = int(row.get("total") or 0)

    fila_rows = db.execute_query(
        """
        SELECT * FROM tabPapelariaJobs
        WHERE Status IN (%(pending)s, %(processing)s)
        ORDER BY
          CASE Status WHEN %(processing)s THEN 0 ELSE 1 END,
          COALESCE(OrdemFila, 999999),
          Prioridade DESC,
          ID ASC
        LIMIT %(limit)s
        """,
        {
            "pending": STATUS_PENDING,
            "processing": STATUS_PROCESSING,
            "limit": max(1, min(fila_limit, 200)),
        },
    )

    recent_rows = db.execute_query(
        """
        SELECT * FROM tabPapelariaJobs
        WHERE Status IN (%(completed)s, %(failed)s, %(cancelled)s)
        ORDER BY COALESCE(ConcluidoEm, SolicitadoEm) DESC, ID DESC
        LIMIT %(limit)s
        """,
        {
            "completed": STATUS_COMPLETED,
            "failed": STATUS_FAILED,
            "cancelled": STATUS_CANCELLED,
            "limit": max(1, min(recentes_limit, 100)),
        },
    )

    workers = list_worker_heartbeats()
    now = datetime.now()
    return {
        "atualizado_em": now.isoformat(sep=" ", timespec="seconds"),
        "totais": totais,
        "workers": workers,
        "workers_online": sum(1 for w in workers if w.get("online")),
        "fila": [_row_to_job(row) for row in fila_rows or []],
        "recentes": [_row_to_job(row) for row in recent_rows or []],
    }


def resolve_os_papelaria_dir(ano: int, nro: int, create: bool = True) -> str:
    """Retorna caminho absoluto de {pasta_os}/Sefoc (artefatos Corel/PDF)."""
    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(ano, nro)
    if not os_path:
        raise LookupError("Pasta da OS não encontrada na rede.")

    sefoc_dir = os.path.normpath(os.path.join(os_path, "Sefoc"))
    if create:
        os.makedirs(sefoc_dir, exist_ok=True)
    return sefoc_dir


def resolve_os_timbrado_digital_dir(ano: int, nro: int, create: bool = True) -> str:
    """DOCX Timbrado A4 Digital: {pasta_os}/Sefoc/Digital."""
    sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=create)
    digital_dir = os.path.normpath(os.path.join(sefoc_dir, "Digital"))
    if create:
        os.makedirs(digital_dir, exist_ok=True)
    return digital_dir


def normalize_os_artifact_prefix(basename: str, nro: int) -> str:
    """
    Prefixo de artefato a partir do nome da pasta da OS.
    Colapsa Nr OS repetido no início, com ou sem zero à esquerda
    (ex.: 06227-06227-Nome / 6227-Nome → 06227-Nome).
    """
    from services import papelaria_jdf_service as jdf_svc

    return jdf_svc.ensure_os_prefixed_name(basename, nro)


def get_os_folder_basename(ano: int, nro: int) -> str:
    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(ano, nro)
    if not os_path:
        raise LookupError("Pasta da OS não encontrada na rede.")
    raw = os.path.basename(os.path.normpath(os_path))
    return normalize_os_artifact_prefix(raw, nro)


def _sanitize_relative_filename(name: str) -> str:
    text = (name or "").strip().replace("\\", "/")
    if not text or ".." in text or text.startswith("/"):
        raise ValueError("Nome de arquivo inválido.")
    base = os.path.basename(text)
    if not base or _UNSAFE_FILENAME.search(base):
        raise ValueError("Nome de arquivo inválido.")
    return base


def _max_prova_sefoc_version(sefoc_dir: str, prefix: str, nro: int) -> int:
    """Maior versão de prova já existente (ProvaSefoc, ProvaN_SEFOC ou *-ProvaN)."""
    num_os = f"{int(nro):05d}"
    patterns = (
        re.compile(
            rf"^{re.escape(prefix)}-ProvaSefoc (\d+)\.pdf$",
            re.IGNORECASE,
        ),
        re.compile(
            rf"^{num_os}.*-Prova(\d+)_SEFOC\.pdf$",
            re.IGNORECASE,
        ),
        # Access / prova web: {prefix}-Prova1.pdf
        re.compile(
            rf"^{re.escape(prefix)}-Prova(\d+)\.pdf$",
            re.IGNORECASE,
        ),
    )
    max_ver = 0
    if not os.path.isdir(sefoc_dir):
        return max_ver
    from services.proof_files_service import (
        extract_prova_version_from_filename as _extract_any,
        is_prova_filename,
    )

    for fname in os.listdir(sefoc_dir):
        matched = False
        for pattern in patterns:
            match = pattern.match(fname)
            if match:
                max_ver = max(max_ver, int(match.group(1)))
                matched = True
                break
        if not matched and is_prova_filename(fname):
            # Qualquer outro PDF «Prova N» na pasta conta para a numeração
            # (mesma regra da lista de SPs e da visualização de prova).
            ver = _extract_any(fname)
            if ver is not None:
                max_ver = max(max_ver, ver)
    return max_ver


def extract_prova_version_from_filename(filename: str) -> Optional[int]:
    """Extrai o número x de *-ProvaSefoc {x}.pdf ou legado Prova{x}_SEFOC."""
    from services.proof_files_service import (
        extract_prova_version_from_filename as _extract,
    )

    return _extract(filename)


def build_output_filenames(ano: int, nro: int) -> tuple[str, str]:
    """
    Artefatos Corel (CREATE / formato final):
    - CDR: {NUMOS-NomePastaOS}-BaseSefoc.cdr (substitui)
    - PDF: {NUMOS-NomePastaOS}-BaseSefoc.pdf (substitui)
    """
    prefix = get_os_folder_basename(ano, nro)
    cdr_name = f"{prefix}-BaseSefoc.cdr"
    pdf_name = f"{prefix}-BaseSefoc.pdf"
    return cdr_name, pdf_name


def build_prova_email_pdf_name(ano: int, nro: int) -> str:
    """PDF A4 carimbado (modo e-mail): {prefix}-ProvaSefoc {x}.pdf."""
    prefix = get_os_folder_basename(ano, nro)
    sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    next_ver = _max_prova_sefoc_version(sefoc_dir, prefix, nro) + 1
    return f"{prefix}-ProvaSefoc {next_ver}.pdf"


def build_prova_web_pdf_name(ano: int, nro: int) -> str:
    """Cópia arquivada da prova web: {prefix}-Prova{N}.pdf (espelho do BaseSefoc)."""
    prefix = get_os_folder_basename(ano, nro)
    sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    next_ver = _max_prova_sefoc_version(sefoc_dir, prefix, nro) + 1
    return f"{prefix}-Prova{next_ver}.pdf"


def build_base_sefoc_pdf_name(ano: int, nro: int) -> str:
    prefix = get_os_folder_basename(ano, nro)
    return f"{prefix}-BaseSefoc.pdf"


def resolve_base_sefoc_pdf_path(ano: int, nro: int) -> str:
    """Caminho absoluto do PDF BaseSefoc na pasta Sefoc da OS."""
    sefoc = resolve_os_papelaria_dir(ano, nro, create=False)
    path = os.path.normpath(os.path.join(sefoc, build_base_sefoc_pdf_name(ano, nro)))
    # Prova no padrão antigo (folha A4 com molduras): monta o PDF no formato
    # do produto a partir da última prova, como na repetição de SP.
    try:
        from services.papelaria_repeticao_service import pdf_base_para_imposicao

        no_formato = pdf_base_para_imposicao(ano, nro, path if os.path.isfile(path) else None)
        if no_formato:
            return os.path.normpath(no_formato)
    except Exception as exc:  # noqa: BLE001 — sem conseguir montar, segue como antes
        logger.warning("BaseSefoc no formato do produto indisponível (%s/%s): %s", nro, ano, exc)
    if not os.path.isfile(path):
        raise FileNotFoundError(
            f"PDF BaseSefoc não encontrado: {os.path.basename(path)}. "
            "Gere o arquivo Corel antes da imposição."
        )
    return path


def resolve_imposicao_output_dir(
    ano: int,
    nro: int,
    *,
    modelo_id: Optional[int] = None,
    create: bool = True,
) -> str:
    """Pasta do PDF de imposição: PastaImposicao do modelo ou Sefoc da OS."""
    if modelo_id:
        from services import papelaria_models_service as models_svc

        modelo = models_svc.get_modelo_by_id(int(modelo_id))
        if modelo:
            pasta = (modelo.get("pasta_imposicao") or "").strip()
            if pasta:
                out = os.path.normpath(pasta)
                if create:
                    os.makedirs(out, exist_ok=True)
                return out
    return resolve_os_papelaria_dir(ano, nro, create=create)


def build_timbrado_a4_digital_artifact_names(ano: int, nro: int) -> dict[str, str]:
    """Nomes relativos dos artefatos Timbrado A4 Digital na pasta Sefoc."""
    prefix = get_os_folder_basename(ano, nro)
    return {
        "cabecalho_svg": TIMBRADO_A4_DIGITAL_SVG_CABECALHO,
        "rodape_svg": TIMBRADO_A4_DIGITAL_SVG_RODAPE,
        "docx_cor": f"{prefix}-TimbradoA4Digital-Cor.docx",
        "docx_pb": f"{prefix}-TimbradoA4Digital-PB.docx",
    }


def build_worker_job_payload(job_id: int) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")

    output_dir = resolve_os_papelaria_dir(
        job["ano_protocolo"],
        job["nro_protocolo"],
        create=True,
    )
    cdr_name, pdf_name = build_output_filenames(
        job["ano_protocolo"],
        job["nro_protocolo"],
    )

    if job["tipo_job"] == TIPO_JOB_CREDENCIAIS_DEPOL:
        return {
            "job_id": job["id"],
            "ano": job["ano_protocolo"],
            "nro": job["nro_protocolo"],
            "tipo_job": job["tipo_job"],
            "produto": job["produto"],
            "modelo_id": None,
            "arquivo_modelo": "",
            "campos": {},
            "dados": dict(job.get("dados") or {}),
            "campos_dinamicos_layout": {},
            "exclusoes": [],
            "preview_config": None,
            "frente_versao": None,
            "cores": None,
            "output_dir": output_dir,
            "output_cdr_name": cdr_name,
            "output_pdf_name": pdf_name,
            "tentativas": job.get("tentativas") or 0,
        }

    if job["tipo_job"] == TIPO_JOB_IMPOSICAO:
        from services import papelaria_jdf_service as jdf_svc
        from services.papelaria_imposicao_juntada_service import resolve_jdf_import_root

        dados_imp = dict(job.get("dados") or {})
        config = dados_imp.get("imposicao_config")
        if not isinstance(config, dict):
            raise ValueError("Job de imposição sem ImposicaoConfigJson.")

        ano_imp = int(job["ano_protocolo"])
        nro_imp = int(job["nro_protocolo"])
        sefoc_dir = resolve_os_papelaria_dir(ano_imp, nro_imp, create=False)
        prefix = get_os_folder_basename(ano_imp, nro_imp)
        label = jdf_svc.strip_leading_os_number(prefix, nro_imp) or prefix

        # Pipeline pré-impresso: worker exporta Brasao-off + junta PDFs; JDF depois.
        if dados_imp.get("pre_impresso_pipeline"):
            return {
                "job_id": job["id"],
                "ano": ano_imp,
                "nro": nro_imp,
                "tipo_job": job["tipo_job"],
                "produto": job["produto"],
                "modelo_id": job.get("modelo_id"),
                "arquivo_modelo": (job.get("arquivo_modelo") or "").strip(),
                "campos": {},
                "dados": dados_imp,
                "campos_dinamicos_layout": {},
                "exclusoes": [],
                "preview_config": None,
                "frente_versao": None,
                "cores": None,
                "output_dir": sefoc_dir,
                "output_cdr_name": "",
                "output_pdf_name": str(dados_imp.get("gang_pdf_name") or ""),
                "tentativas": job.get("tentativas") or 0,
                "pre_impresso_pipeline": True,
                "juntada_lote": dados_imp.get("juntada_lote") or [],
                "gang_pdf_path": dados_imp.get("gang_pdf_path") or "",
                "imposicao_config": config,
                "jdf_comment": dados_imp.get("jdf_comment") or "",
                "jdf_import_root": resolve_jdf_import_root(
                    config, produto=str(job.get("produto") or "")
                ),
                "pasta_art_blank_pages": bool(
                    dados_imp.get("pasta_art_blank_pages")
                ),
                "compose_com_template": False,
            }

        base_pdf_path = resolve_base_sefoc_pdf_path(ano_imp, nro_imp)
        pagina = config.get("pagina") or {}
        if pagina.get("origem") == "fixixa":
            page_w_mm = float(pagina["largura_mm"])
            page_h_mm = float(pagina["altura_mm"])
        else:
            page_w_mm, page_h_mm = jdf_svc.read_pdf_page_size_mm(base_pdf_path)

        grid = config.get("grid") or {}
        cols = int(grid.get("colunas") or 1)
        rows = int(grid.get("linhas") or 1)
        jdf_name = jdf_svc.build_jdf_filename(
            ano=ano_imp,
            nro=nro_imp,
            folder_basename=f"{label}_{cols}x{rows}",
        )
        export_pdf_name = f"{label}.pdf"
        jdf_xml = jdf_svc.build_apogee_jdf_xml(
            ano=ano_imp,
            nro=nro_imp,
            descriptive_name=label,
            comment=(
                f"imposição {cols}x{rows} "
                f"({job.get('produto') or 'Papelaria'})"
            ),
            export_folder=sefoc_dir,
            export_filename=export_pdf_name,
            base_pdf_path=base_pdf_path,
            base_pdf_user_name=os.path.splitext(os.path.basename(base_pdf_path))[0],
            config=config,
            page_w_mm=page_w_mm,
            page_h_mm=page_h_mm,
        )
        jdf_dir = jdf_svc.get_jdf_import_root(
            str(config.get("jdf_import_root") or "") or None,
            produto=str(job.get("produto") or ""),
        )
        return {
            "job_id": job["id"],
            "ano": ano_imp,
            "nro": nro_imp,
            "tipo_job": job["tipo_job"],
            "produto": job["produto"],
            "modelo_id": job.get("modelo_id"),
            "arquivo_modelo": (job.get("arquivo_modelo") or "").strip(),
            "campos": {},
            "dados": {},
            "campos_dinamicos_layout": {},
            "exclusoes": [],
            "preview_config": None,
            "frente_versao": None,
            "cores": None,
            "output_dir": jdf_dir,
            "output_cdr_name": "",
            "output_pdf_name": jdf_name,
            "tentativas": job.get("tentativas") or 0,
            "base_pdf_path": base_pdf_path,
            "jdf_xml": jdf_xml,
            "jdf_filename": jdf_name,
            "jdf_output_dir": jdf_dir,
        }

    from services import papelaria_models_service as models_svc

    modelo = models_svc.get_modelo_by_id(job["modelo_id"] or 0)
    if not modelo:
        raise LookupError("Modelo do job não encontrado ou inativo.")

    dados = dict(job.get("dados") or {})
    campos_dinamicos_layout: dict[str, Any] = {}
    layout_raw = dados.pop("__campos_dinamicos_layout", None)
    if layout_raw:
        try:
            parsed_layout = json.loads(layout_raw) if isinstance(layout_raw, str) else layout_raw
            if isinstance(parsed_layout, dict):
                campos_dinamicos_layout = parsed_layout
        except json.JSONDecodeError:
            logger.warning("Job %s: layout campos dinâmicos inválido — ignorado.", job_id)

    exclusoes: list[str] = []
    exclusoes_raw = dados.pop("__exclusoes", None)
    if exclusoes_raw:
        try:
            parsed_exclusoes = json.loads(exclusoes_raw) if isinstance(exclusoes_raw, str) else exclusoes_raw
            if isinstance(parsed_exclusoes, list):
                exclusoes = [str(item) for item in parsed_exclusoes]
        except json.JSONDecodeError:
            logger.warning("Job %s: exclusões inválidas — ignorado.", job_id)

    input_cdr_rel = dados.pop(INPUT_CDR_DADOS_KEY, None)
    base_cdr_rel = dados.pop(BASE_CDR_DADOS_KEY, None)
    manter_dados_corel = str(dados.pop(MANTER_DADOS_COREL_KEY, "") or "") == "1"
    pdf_fonte_corel_nome = str(dados.pop(PDF_FONTE_COREL_DADOS_KEY, "") or "").strip()
    from services.papelaria_campos_produto import (
        CHAVE_CAMPOS_PRODUTO,
        campos_modelo_sem_objetos,
        validar_campos_produto,
    )

    try:
        campos_produto = validar_campos_produto(dados.pop(CHAVE_CAMPOS_PRODUTO, None))
    except ValueError:
        campos_produto = None

    preview_config: dict[str, Any] | None = None
    preview_raw = modelo.get("preview_config_json")
    if preview_raw:
        try:
            from services import papelaria_live_preview_service as preview_svc

            preview_config = preview_svc.parse_preview_config_json(preview_raw)
        except ValueError:
            preview_config = None

    from services.papelaria_live_preview_service import overlay_campos_com_templates_preview

    if job["tipo_job"] == TIPO_JOB_EXPORT_EXISTING_CDR:
        input_cdr_path = resolve_export_input_cdr_path(
            job["ano_protocolo"],
            job["nro_protocolo"],
            input_cdr_rel,
        )
        export_cdr_name, export_pdf_name = build_output_filenames(
            job["ano_protocolo"],
            job["nro_protocolo"],
        )
        payload = {
            "job_id": job["id"],
            "ano": job["ano_protocolo"],
            "nro": job["nro_protocolo"],
            "tipo_job": job["tipo_job"],
            "produto": job["produto"],
            "modelo_id": job["modelo_id"],
            "arquivo_modelo": job["arquivo_modelo"],
            "campos": {},
            "dados": {},
            "campos_dinamicos_layout": {},
            "exclusoes": [],
            "preview_config": None,
            "frente_versao": modelo.get("frente_versao"),
            "cores": modelo.get("cores"),
            "output_dir": output_dir,
            # Destino do CDR normalizado se o worker detectar BordaF/BordaV.
            "output_cdr_name": export_cdr_name,
            "output_pdf_name": export_pdf_name,
            "tentativas": job.get("tentativas") or 0,
            "input_cdr_path": input_cdr_path,
        }
    else:
        payload = {
            "job_id": job["id"],
            "ano": job["ano_protocolo"],
            "nro": job["nro_protocolo"],
            "tipo_job": job["tipo_job"],
            "produto": job["produto"],
            "modelo_id": job["modelo_id"],
            "arquivo_modelo": job["arquivo_modelo"],
            # Objetos que viraram campos do produto saem dos templates do modelo:
            # o worker aplica o texto de cada ocorrência (campos_produto_objetos).
            "campos": campos_modelo_sem_objetos(
                overlay_campos_com_templates_preview(
                    modelo.get("campos") or {},
                    preview_config,
                ),
                campos_produto,
            ),
            "dados": dados,
            "campos_dinamicos_layout": campos_dinamicos_layout,
            "exclusoes": exclusoes,
            "preview_config": preview_config,
            "frente_versao": modelo.get("frente_versao"),
            "cores": modelo.get("cores"),
            "output_dir": output_dir,
            "output_cdr_name": cdr_name,
            "output_pdf_name": pdf_name,
            "tentativas": job.get("tentativas") or 0,
        }
        if campos_produto:
            payload["campos_produto_objetos"] = campos_produto["objetos"]
        if job["tipo_job"] == TIPO_JOB_CREATE and pdf_fonte_corel_nome:
            # .cdr a partir do PDF final gravado pelo servidor na pasta da OS.
            payload["source_pdf_path"] = os.path.join(
                output_dir, os.path.basename(pdf_fonte_corel_nome)
            )
        elif job["tipo_job"] == TIPO_JOB_CREATE and base_cdr_rel:
            try:
                payload["base_cdr_path"] = resolve_os_relative_cdr_path(
                    job["ano_protocolo"],
                    job["nro_protocolo"],
                    str(base_cdr_rel),
                )
                if manter_dados_corel:
                    payload["manter_dados_corel"] = True
            except (LookupError, FileNotFoundError, ValueError) as exc:
                append_job_log(
                    job_id,
                    f"Corel da pasta indisponível ({exc}) — usando o modelo.",
                    "warning",
                )

    if job["tipo_job"] == TIPO_JOB_TIMBRADO_A4_DIGITAL:
        payload["output_dir"] = resolve_os_timbrado_digital_dir(
            job["ano_protocolo"],
            job["nro_protocolo"],
            create=True,
        )
        artifacts = build_timbrado_a4_digital_artifact_names(
            job["ano_protocolo"],
            job["nro_protocolo"],
        )
        payload["output_cabecalho_svg"] = artifacts["cabecalho_svg"]
        payload["output_rodape_svg"] = artifacts["rodape_svg"]
        payload["output_docx_cor"] = artifacts["docx_cor"]
        payload["output_docx_pb"] = artifacts["docx_pb"]
        payload["output_cdr_name"] = ""
        payload["output_pdf_name"] = ""
        # Imagens cab/rod a partir do PDF preenchido (sem Corel no worker).
        from services.papelaria_timbrado_digital_service import (
            TimbradoDigitalPdfError,
            exportar_imagens_timbrado_digital,
        )

        modelo_id_digital = job.get("modelo_id")
        if not modelo_id_digital:
            raise ValueError("Job Timbrado A4 Digital sem modelo_id.")
        try:
            imgs = exportar_imagens_timbrado_digital(
                int(modelo_id_digital),
                job.get("dados") if isinstance(job.get("dados"), dict) else {},
                payload["output_dir"],
            )
        except TimbradoDigitalPdfError:
            raise
        except Exception as exc:
            raise TimbradoDigitalPdfError(
                f"Falha ao gerar imagens do Timbrado Digital via PDF: {exc}"
            ) from exc
        payload["cabecalho_img"] = imgs["cabecalho"]
        payload["rodape_img"] = imgs["rodape"]
        payload["fonte_imagens"] = "prova_pdf"

    from services.papelaria_prova_modo import (
        MODO_PROVA_EMAIL,
        MODO_PROVA_PDF,
        MODO_PROVA_WEB,
        get_modo,
    )

    modo = get_modo()
    if modo == MODO_PROVA_PDF:
        # Job que caiu no worker (modelo sem PDF): mesmo fluxo da Prova WEB.
        modo = MODO_PROVA_WEB
    payload["prova_modo"] = modo
    prova_job_types = (TIPO_JOB_CREATE, TIPO_JOB_EXPORT_EXISTING_CDR)
    if job["tipo_job"] in prova_job_types and modo == MODO_PROVA_EMAIL:
        prova_email_pdf = build_prova_email_pdf_name(
            job["ano_protocolo"],
            job["nro_protocolo"],
        )
        prova_numero = extract_prova_version_from_filename(prova_email_pdf)
        if prova_numero is None:
            raise ValueError(
                "Não foi possível determinar o número da prova para o carimbo."
            )
        payload["prova_email_pdf_name"] = prova_email_pdf
        payload["prova_numero"] = prova_numero
        template_abs = models_svc.resolve_prova_email_template_abs(
            modelo.get("prova_email_template_pdf")
        )
        if template_abs:
            payload["prova_email_template_pdf"] = template_abs
    elif job["tipo_job"] in prova_job_types and modo == MODO_PROVA_WEB:
        prova_web_pdf = build_prova_web_pdf_name(
            job["ano_protocolo"],
            job["nro_protocolo"],
        )
        prova_numero = extract_prova_version_from_filename(prova_web_pdf)
        if prova_numero is None:
            raise ValueError(
                "Não foi possível determinar o número da prova web (ProvaN)."
            )
        payload["prova_web_pdf_name"] = prova_web_pdf
        payload["prova_numero"] = prova_numero
        # Persiste no job para OK/descarte (ArquivoPdfGerado continua BaseSefoc).
        dados_job = dict(job.get("dados") or {})
        dados_job["prova_web_pdf_name"] = prova_web_pdf
        dados_job["prova_numero"] = prova_numero
        db.execute_query(
            """
            UPDATE tabPapelariaJobs
            SET DadosJson = %(dados)s,
                Versao = %(versao)s
            WHERE ID = %(id)s
            """,
            {
                "dados": json.dumps(dados_job, ensure_ascii=False),
                "versao": prova_numero,
                "id": int(job["id"]),
            },
        )

    return payload


def claim_next_job(worker_id: str) -> Optional[dict[str, Any]]:
    ensure_papelaria_jobs_tables()
    wid = (worker_id or "").strip()
    if not wid:
        raise ValueError("worker_id é obrigatório.")

    recover_stale_processing_jobs()

    if not _worker_eligible_for_claim(wid):
        return None

    def _claim(cursor) -> Optional[int]:
        cursor.execute(
            """
            SELECT ID FROM tabPapelariaJobs
            WHERE Status = %(pending)s
            ORDER BY Prioridade DESC, OrdemFila ASC, ID ASC
            LIMIT 1
            FOR UPDATE
            """,
            {"pending": STATUS_PENDING},
        )
        row = cursor.fetchone()
        if not row:
            return None
        job_id = int(row["ID"])
        cursor.execute(
            """
            UPDATE tabPapelariaJobs
            SET Status = %(processing)s,
                WorkerID = %(worker_id)s,
                IniciadoEm = NOW(),
                Tentativas = Tentativas + 1
            WHERE ID = %(id)s AND Status = %(pending)s
            """,
            {
                "id": job_id,
                "processing": STATUS_PROCESSING,
                "worker_id": wid,
                "pending": STATUS_PENDING,
            },
        )
        if cursor.rowcount == 0:
            return None
        return job_id

    results = db.execute_transaction([_claim])
    job_id = results[0] if results else None
    if not job_id:
        return None

    append_job_log(job_id, f"Job reivindicado pelo worker {wid}.", "info")
    try:
        payload = build_worker_job_payload(job_id)
    except (LookupError, ValueError) as exc:
        # Job já está processing; sem fail o front fica em "Processando" e o worker
        # não consegue chamar /fail (não recebeu job_id).
        fail_job(job_id, wid, str(exc), retryable=False)
        raise
    job = get_job(job_id)
    if job:
        broadcast_job_update(job)
    return payload


def _assert_worker_owns_processing_job(job_id: int, worker_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")
    if job["status"] != STATUS_PROCESSING:
        raise ValueError(f"Job não está em processamento (status: {job['status']}).")
    if (job.get("worker_id") or "").strip() != (worker_id or "").strip():
        raise ValueError("Job está sendo processado por outro worker.")
    return job


def complete_job(
    job_id: int,
    worker_id: str,
    arquivo_cdr: str,
    arquivo_pdf: str,
    log_resumo: Optional[str] = None,
    artefatos: Optional[list[str]] = None,
) -> dict[str, Any]:
    ensure_papelaria_jobs_tables()
    if is_job_cancelled(job_id):
        raise ValueError("Job foi cancelado pelo usuário.")
    job = _assert_worker_owns_processing_job(job_id, worker_id)

    if job.get("tipo_job") == TIPO_JOB_TIMBRADO_A4_DIGITAL:
        return _complete_timbrado_a4_digital_job(
            job,
            worker_id=worker_id,
            artefatos=artefatos,
            log_resumo=log_resumo,
        )

    dados_complete = dict(job.get("dados") or {})
    tipo_job = job.get("tipo_job")
    if tipo_job == TIPO_JOB_IMPOSICAO and dados_complete.get("pre_impresso_pipeline"):
        # Worker terminou export/junta: grava JDF a partir do PDF ganged.
        return _complete_pre_impresso_imposicao_job(
            job,
            worker_id=worker_id,
            log_resumo=log_resumo or "",
        )

    cdr_rel = _sanitize_relative_filename(arquivo_cdr) if arquivo_cdr else ""
    pdf_rel = _sanitize_relative_filename(arquivo_pdf)

    output_dir = resolve_os_papelaria_dir(
        job["ano_protocolo"],
        job["nro_protocolo"],
        create=False,
    )
    pdf_abs = os.path.normpath(os.path.join(output_dir, pdf_rel))
    if tipo_job == TIPO_JOB_IMPOSICAO:
        from services import papelaria_jdf_service as jdf_svc

        jdf_dir = (
            str(dados_complete.get("jdf_dir") or "").strip()
            or jdf_svc.get_jdf_import_root(
                str((dados_complete.get("imposicao_config") or {}).get("jdf_import_root") or "")
                or None,
                produto=str(job.get("produto") or ""),
            )
        )
        jdf_abs = os.path.normpath(os.path.join(jdf_dir, pdf_rel))
        if not pdf_rel.lower().endswith(".jdf"):
            raise ValueError("Imposição JDF exige arquivo .jdf.")
        if not os.path.isfile(jdf_abs):
            raise FileNotFoundError(
                f"JDF não encontrado no hotfolder Apogee: {pdf_rel}"
            )
        cdr_rel = ""
        paths_to_check: tuple[str, ...] = ()
    elif tipo_job == TIPO_JOB_EXPORT_EXISTING_CDR:
        dados_job = job.get("dados") or {}
        input_cdr_abs = resolve_export_input_cdr_path(
            job["ano_protocolo"],
            job["nro_protocolo"],
            dados_job.get(INPUT_CDR_DADOS_KEY) if isinstance(dados_job, dict) else None,
        )
        # Preferir BaseSefoc.cdr gerado na conversão BordaF quando o worker enviou
        # e o arquivo existe; senão manter o CDR de origem.
        generated_cdr_abs = (
            os.path.normpath(os.path.join(output_dir, cdr_rel)) if cdr_rel else ""
        )
        if (
            cdr_rel
            and generated_cdr_abs
            and os.path.isfile(generated_cdr_abs)
            and os.path.realpath(generated_cdr_abs) != os.path.realpath(input_cdr_abs)
        ):
            cdr_abs = generated_cdr_abs
            paths_to_check = (generated_cdr_abs, pdf_abs)
        else:
            cdr_abs = input_cdr_abs
            cdr_rel = os.path.basename(cdr_abs)
            paths_to_check = (pdf_abs,)
    else:
        cdr_abs = os.path.normpath(os.path.join(output_dir, cdr_rel))
        paths_to_check = (cdr_abs, pdf_abs)

    for path in paths_to_check:
        real_file = os.path.realpath(path)
        real_base = os.path.realpath(output_dir)
        if not real_base.endswith(os.sep):
            real_base = real_base + os.sep
        if not real_file.startswith(real_base):
            raise ValueError("Caminho de arquivo inválido.")
        if not os.path.isfile(path):
            raise FileNotFoundError(f"Arquivo não encontrado no destino: {os.path.basename(path)}")

    prova_revisao = (
        PROVA_REVISAO_NA
        if tipo_job == TIPO_JOB_IMPOSICAO
        else PROVA_REVISAO_PENDING
    )
    default_msg = (
        "JDF enviado ao Apogee."
        if tipo_job == TIPO_JOB_IMPOSICAO
        else "Geração concluída com sucesso. Aguardando aprovação do técnico."
    )

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET Status = %(status)s,
            ArquivoCdrGerado = %(cdr)s,
            ArquivoPdfGerado = %(pdf)s,
            ProvaRevisao = %(prova_revisao)s,
            ConcluidoEm = NOW(),
            Erro = NULL
        WHERE ID = %(id)s AND Status = %(processing)s AND WorkerID = %(worker_id)s
        """,
        {
            "id": job_id,
            "status": STATUS_COMPLETED,
            "cdr": cdr_rel,
            "pdf": pdf_rel,
            "prova_revisao": prova_revisao,
            "processing": STATUS_PROCESSING,
            "worker_id": worker_id.strip(),
        },
    )

    updated = get_job(job_id)
    if not updated or updated["status"] != STATUS_COMPLETED:
        raise ValueError("Job não pôde ser concluído (status alterado).")

    msg = log_resumo or default_msg
    append_job_log(job_id, msg[:4000], "info")
    broadcast_job_update(updated)
    if updated.get("tipo_job") == TIPO_JOB_CREDENCIAIS_DEPOL:
        try:
            from services import credenciais_depol_service as depol_svc

            depol_svc.on_job_completed(updated)
        except Exception as exc:
            logger.warning("Hook Credenciais DEPOL complete falhou (job %s): %s", job_id, exc)
    return updated


def _complete_timbrado_a4_digital_job(
    job: dict[str, Any],
    *,
    worker_id: str,
    artefatos: Optional[list[str]],
    log_resumo: Optional[str],
) -> dict[str, Any]:
    job_id = int(job["id"])
    expected = build_timbrado_a4_digital_artifact_names(
        job["ano_protocolo"],
        job["nro_protocolo"],
    )
    # Essencial: apenas os 2 DOCX. SVG é opcional (auditoria).
    required_names = [
        expected["docx_cor"],
        expected["docx_pb"],
    ]
    optional_names = [
        expected["cabecalho_svg"],
        expected["rodape_svg"],
    ]
    provided = [
        _sanitize_relative_filename(str(name))
        for name in (artefatos or [])
        if str(name).strip()
    ]
    if not provided:
        provided = list(required_names)

    missing_required = [name for name in required_names if name not in provided]
    if missing_required:
        raise ValueError(
            "Artefatos Timbrado A4 Digital incompletos: "
            + ", ".join(missing_required)
        )

    output_dir = resolve_os_timbrado_digital_dir(
        job["ano_protocolo"],
        job["nro_protocolo"],
        create=False,
    )
    real_base = os.path.realpath(output_dir)
    if not real_base.endswith(os.sep):
        real_base = real_base + os.sep

    for name in required_names:
        path = os.path.normpath(os.path.join(output_dir, name))
        real_file = os.path.realpath(path)
        if not real_file.startswith(real_base):
            raise ValueError("Caminho de arquivo inválido.")
        if not os.path.isfile(path):
            raise FileNotFoundError(
                f"Arquivo não encontrado no destino: {os.path.basename(path)}"
            )

    stored_artefatos = list(required_names)
    for name in optional_names:
        path = os.path.normpath(os.path.join(output_dir, name))
        real_file = os.path.realpath(path)
        if real_file.startswith(real_base) and os.path.isfile(path):
            if name not in stored_artefatos:
                stored_artefatos.insert(0, name)

    # Mantém ordem informada pelo worker quando válida (DOCX + SVG opcionais).
    if provided:
        ordered = [n for n in provided if n in stored_artefatos or n in required_names]
        for name in stored_artefatos:
            if name not in ordered:
                ordered.append(name)
        stored_artefatos = ordered

    dados = dict(job.get("dados") or {})
    dados[ARTEFATOS_DADOS_KEY] = stored_artefatos
    dados_json = json.dumps(dados, ensure_ascii=False)

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET Status = %(status)s,
            ArquivoCdrGerado = NULL,
            ArquivoPdfGerado = NULL,
            DadosJson = %(dados)s,
            ProvaRevisao = %(prova_revisao)s,
            ConcluidoEm = NOW(),
            Erro = NULL
        WHERE ID = %(id)s AND Status = %(processing)s AND WorkerID = %(worker_id)s
        """,
        {
            "id": job_id,
            "status": STATUS_COMPLETED,
            "dados": dados_json,
            "prova_revisao": PROVA_REVISAO_NA,
            "processing": STATUS_PROCESSING,
            "worker_id": worker_id.strip(),
        },
    )

    updated = get_job(job_id)
    if not updated or updated["status"] != STATUS_COMPLETED:
        raise ValueError("Job não pôde ser concluído (status alterado).")

    ponto = (str(job.get("solicitado_por") or "")).strip() or "0"
    try:
        from routers.analise_routes import add_movement_internal

        def _encam_tx(cursor):
            return add_movement_internal(
                cursor,
                int(job["nro_protocolo"]),
                int(job["ano_protocolo"]),
                SITUACAO_ENCAM_DOCUM,
                SETOR_SEFOC,
                ponto,
                OBS_ENVIAR_TIMBRADO_DIGITAL,
            )

        db.execute_transaction([_encam_tx])
        append_job_log(
            job_id,
            f"Andamento {SITUACAO_ENCAM_DOCUM} — {OBS_ENVIAR_TIMBRADO_DIGITAL}.",
            "info",
        )
    except Exception as exc:
        logger.warning(
            "Job %s: falha ao lançar andamento Timbrado Digital: %s",
            job_id,
            exc,
        )
        append_job_log(
            job_id,
            f"Aviso: andamento Encam. de Docum. não registrado ({exc}).",
            "warning",
        )

    msg = log_resumo or "Timbrado A4 Digital concluído (DOCX Cor/PB)."
    append_job_log(job_id, msg[:4000], "info")
    broadcast_job_update(updated)
    return updated


def fail_job(
    job_id: int,
    worker_id: str,
    erro: str,
    log_resumo: Optional[str] = None,
    retryable: bool = False,
) -> dict[str, Any]:
    ensure_papelaria_jobs_tables()
    if is_job_cancelled(job_id):
        raise ValueError("Job foi cancelado pelo usuário.")
    job = _assert_worker_owns_processing_job(job_id, worker_id)
    tentativas = int(job.get("tentativas") or 0)
    erro_msg = (erro or "Falha desconhecida.")[:4000]

    if retryable and tentativas < MAX_WORKER_RETRIES:
        db.execute_query(
            """
            UPDATE tabPapelariaJobs
            SET Status = %(pending)s,
                WorkerID = NULL,
                IniciadoEm = NULL,
                Erro = %(erro)s
            WHERE ID = %(id)s AND Status = %(processing)s AND WorkerID = %(worker_id)s
            """,
            {
                "id": job_id,
                "pending": STATUS_PENDING,
                "erro": erro_msg,
                "processing": STATUS_PROCESSING,
                "worker_id": worker_id.strip(),
            },
        )
        updated = get_job(job_id)
        if not updated:
            raise RuntimeError("Falha ao reenfileirar job.")
        append_job_log(
            job_id,
            f"Falha retryable — reenfileirado (tentativa {tentativas}/{MAX_WORKER_RETRIES}).",
            "warning",
            {"erro": erro_msg},
        )
        if log_resumo:
            append_job_log(job_id, log_resumo[:4000], "error")
        broadcast_job_update(updated)
        return updated

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET Status = %(status)s,
            Erro = %(erro)s,
            ConcluidoEm = NOW()
        WHERE ID = %(id)s AND Status = %(processing)s AND WorkerID = %(worker_id)s
        """,
        {
            "id": job_id,
            "status": STATUS_FAILED,
            "erro": erro_msg,
            "processing": STATUS_PROCESSING,
            "worker_id": worker_id.strip(),
        },
    )

    updated = get_job(job_id)
    if not updated or updated["status"] != STATUS_FAILED:
        raise ValueError("Job não pôde ser marcado como falha.")

    append_job_log(job_id, erro_msg, "error")
    if log_resumo and log_resumo != erro_msg:
        append_job_log(job_id, log_resumo[:4000], "error")
    broadcast_job_update(updated)
    if updated.get("tipo_job") == TIPO_JOB_CREDENCIAIS_DEPOL:
        try:
            from services import credenciais_depol_service as depol_svc

            depol_svc.on_job_failed(updated)
        except Exception as exc:
            logger.warning("Hook Credenciais DEPOL fail falhou (job %s): %s", job_id, exc)
    return updated


def worker_append_log(
    job_id: int,
    worker_id: str,
    mensagem: str,
    nivel: str = "info",
    detalhe: Optional[dict[str, Any]] = None,
) -> None:
    _assert_worker_owns_processing_job(job_id, worker_id)
    append_job_log(job_id, mensagem, nivel, detalhe)


def _waiting_apogee_message() -> str:
    return "Aguardando processamento pelo Apogee."


def _waiting_corel_message() -> str:
    return "Arquivo ainda não disponível. Aguardando processamento pelo worker CorelDRAW."


def format_folha_impressao_label(folha_mm: dict[str, Any]) -> str:
    """LarguraxAltura numérico (mm) para o nome do PDF de imposição."""
    w = float(folha_mm.get("largura") or 0)
    h = float(folha_mm.get("altura") or 0)
    w_s = f"{w:.0f}" if abs(w - round(w)) < 0.05 else f"{w:g}"
    h_s = f"{h:.0f}" if abs(h - round(h)) < 0.05 else f"{h:g}"
    return f"{w_s}x{h_s}"


def build_imposicao_digital_pdf_name(
    *,
    ano: int,
    nro: int,
    config: dict[str, Any],
) -> str:
    """
    {NUMOS-NomePasta}_Digit_{N}Up[_CC]_{Largura}x{Altura}.pdf
    N = colunas × linhas (repetições na folha).
    CC = marcas de corte ativas no config.
    """
    prefix = get_os_folder_basename(ano, nro)
    grid = config.get("grid") or {}
    from services.papelaria_imposicao_config_service import resolve_grid_ocupadas

    n_up = max(1, len(resolve_grid_ocupadas(grid if isinstance(grid, dict) else {})))
    folha = format_folha_impressao_label(config.get("folha_mm") or {})
    safe_folha = re.sub(r"[^\w.\-]+", "-", folha).strip("-") or "Folha"
    cc = "CC_" if bool(config.get("marcas_corte")) else ""
    return f"{prefix}_Digit_{n_up}Up_{cc}{safe_folha}.pdf"


# Resultado do Apogee: a palavra «Apogee» em qualquer posição do nome
# (ex.: X_Apogee.pdf, Apogee_X.pdf, X-Apogee-2Up.pdf). Só esses PDFs são movidos.
_APOGEE_IMPOSICAO_EXPORT_RE = re.compile(r"apogee", re.IGNORECASE)
_DIGIT_IMPOSICAO_RE = re.compile(r"_Digit_\d+Up_", re.IGNORECASE)
_EXCLUDE_SEFOC_PDF_RE = re.compile(
    r"(ProvaSefoc|BaseSefoc|Prova\d+_SEFOC|ImposicaoGang|PreImpresso|"
    r"BaseSefoc-PreImpresso)",
    re.IGNORECASE,
)


def _list_pdfs_with_mtime(directory: str) -> list[tuple[float, str]]:
    """Lista (mtime, path) de PDFs diretos em um diretório."""
    if not os.path.isdir(directory):
        return []
    matches: list[tuple[float, str]] = []
    try:
        names = os.listdir(directory)
    except OSError:
        return []
    for fname in names:
        if not fname.lower().endswith(".pdf"):
            continue
        path = os.path.normpath(os.path.join(directory, fname))
        if not os.path.isfile(path):
            continue
        try:
            matches.append((os.path.getmtime(path), path))
        except OSError:
            continue
    matches.sort(key=lambda item: item[0], reverse=True)
    return matches


def _imposicao_export_stem(ano: int, nro: int) -> str:
    """Stem do PDF exportado pelo Apogee (label humano sem Nr OS)."""
    from services import papelaria_jdf_service as jdf_svc

    prefix = get_os_folder_basename(ano, nro)
    label = jdf_svc.strip_leading_os_number(prefix, nro) or prefix
    return os.path.splitext(label)[0]


def is_apogee_export_pdf(filename: str) -> bool:
    """PDF exportado pelo Apogee: «Apogee» em qualquer lugar do nome."""
    name = os.path.basename(filename or "")
    return name.lower().endswith(".pdf") and bool(_APOGEE_IMPOSICAO_EXPORT_RE.search(name))


def find_imposicao_pdf_in_sefoc(
    sefoc_dir: str,
    *,
    expected_stem: Optional[str] = None,
) -> Optional[str]:
    """
    PDF de imposição do Apogee na raiz de Sefoc: o mais recente cujo nome
    contém «Apogee» (em qualquer posição). Prefere o que também contém o
    stem do JDF. PDFs sem «Apogee» nunca são movidos.
    """
    pdfs = _list_pdfs_with_mtime(sefoc_dir)
    marked = [
        path
        for _mtime, path in pdfs
        if is_apogee_export_pdf(path)
        and not _EXCLUDE_SEFOC_PDF_RE.search(os.path.basename(path))
    ]
    if not marked:
        return None

    stem = (expected_stem or "").strip().lower()
    if stem:
        for path in marked:
            if stem in os.path.basename(path).lower():
                return path
    return marked[0]


def find_imposicao_pdf_in_digital(
    digital_dir: str,
    *,
    preferred_name: Optional[str] = None,
) -> Optional[str]:
    """
    PDF já presente em Sefoc/Digital.

    Preferência: nome Digit_NUp esperado → qualquer *_Digit_*Up_ (já
    finalizados) → PDF mais recente com «Apogee» no nome.
    """
    pdfs = _list_pdfs_with_mtime(digital_dir)
    if not pdfs:
        return None

    preferred = (preferred_name or "").strip()
    if preferred:
        for _mtime, path in pdfs:
            if os.path.basename(path).lower() == preferred.lower():
                return path

    digit_matches = [
        path
        for _mtime, path in pdfs
        if _DIGIT_IMPOSICAO_RE.search(os.path.basename(path))
    ]
    if digit_matches:
        return digit_matches[0]

    for _mtime, path in pdfs:
        if is_apogee_export_pdf(path):
            return path
    return None


def clear_digital_imposicao_pdfs(sefoc_dir: str) -> list[str]:
    """Remove PDFs da pasta Digital (permite regenerar imposição)."""
    digital_dir = os.path.normpath(os.path.join(sefoc_dir, "Digital"))
    removed: list[str] = []
    for _mtime, path in _list_pdfs_with_mtime(digital_dir):
        try:
            os.remove(path)
            removed.append(os.path.basename(path))
        except OSError as exc:
            logger.warning("Falha ao remover PDF Digital %s: %s", path, exc)
    return removed


def _complete_pre_impresso_imposicao_job(
    job: dict[str, Any],
    *,
    worker_id: str,
    log_resumo: str = "",
) -> dict[str, Any]:
    """Após worker gerar PreImpresso+gang: grava JDF e marca aguardando Apogee."""
    job_id = int(job["id"])
    dados = dict(job.get("dados") or {})
    config = dados.get("imposicao_config")
    if not isinstance(config, dict):
        raise ValueError("Job pré-impresso sem imposicao_config.")
    gang_path = str(dados.get("gang_pdf_path") or "").strip()
    if not gang_path or not os.path.isfile(gang_path):
        raise FileNotFoundError(
            "PDF ganged da imposição pré-impressa não encontrado."
        )
    ano = int(job["ano_protocolo"])
    nro = int(job["nro_protocolo"])
    produto = str(job.get("produto") or "Papelaria")
    comment = str(dados.get("jdf_comment") or "").strip() or None
    config, baked_pdf = _prepare_pre_impresso_jdf_config(
        config=config,
        produto=produto,
        dados=dados,
        ano=ano,
        nro=nro,
        sefoc_dir=os.path.dirname(gang_path) or ".",
        gang_pdf_path=gang_path,
    )
    artifacts = _build_imposicao_jdf_artifacts(
        ano=ano,
        nro=nro,
        produto=produto,
        config=config,
        base_pdf_path=baked_pdf,
        comment=comment,
        descriptive_name=str((dados.get("ancora") or {}).get("label") or "") or None,
        jdf_dir=str(dados.get("jdf_import_root") or "") or None,
        sem_imposicao=False,
    )
    dados.update(
        {
            "jdf_path": artifacts["jdf_path"],
            "jdf_dir": artifacts["jdf_dir"],
            "jdf_name": artifacts["jdf_name"],
            "base_pdf": os.path.basename(baked_pdf),
            "gang_pdf_rotated": baked_pdf,
            "marcas_pdf_op": (config.get("marcas_pdf_path") or ""),
            "aguardando_apogee": True,
            "pre_impresso_pipeline": False,
            "jdf_sem_imposicao": False,
            "imposicao_config": config,
        }
    )
    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET Status = %(status)s,
            DadosJson = %(dados)s,
            ArquivoCdrGerado = NULL,
            ArquivoPdfGerado = NULL,
            ProvaRevisao = %(prova_revisao)s,
            ConcluidoEm = NOW(),
            Erro = NULL
        WHERE ID = %(id)s AND Status = %(processing)s AND WorkerID = %(worker_id)s
        """,
        {
            "status": STATUS_COMPLETED,
            "dados": json.dumps(dados, ensure_ascii=False),
            "prova_revisao": PROVA_REVISAO_NA,
            "id": job_id,
            "processing": STATUS_PROCESSING,
            "worker_id": (worker_id or "").strip(),
        },
    )
    updated = get_job(job_id)
    if not updated or updated["status"] != STATUS_COMPLETED:
        raise ValueError("Job pré-impresso não pôde ser concluído (status alterado).")
    msg = (log_resumo or "").strip() or (
        f"JDF pré-impresso enviado: {artifacts['jdf_name']} "
        f"({artifacts['jdf_dir']}) a partir de {os.path.basename(gang_path)}."
    )
    append_job_log(job_id, msg[:4000], "info")
    broadcast_job_update(updated)
    return updated


# Sufixos dos PDFs auxiliares que o SAGRA grava na pasta Sefoc só para o
# Apogee montar a imposição. BaseSefoc.pdf (arte/prova) nunca entra aqui.
_IMPOSICAO_AUX_SUFIXOS = (
    "-Marcas.pdf",
    "-Marcas-OP.pdf",
    "-ImposicaoGang.pdf",
    "-ImposicaoGang-Rotated.pdf",
    "-BaseSefoc-PreImpresso.pdf",
)


def _lote_os_do_job(job: dict[str, Any], dados: dict[str, Any]) -> list[tuple[int, int]]:
    """Âncora + OSs juntadas (sem repetição)."""
    out: list[tuple[int, int]] = [(int(job["ano_protocolo"]), int(job["nro_protocolo"]))]
    for key in ("juntada_lote", "juntada_membros"):
        for item in dados.get(key) or []:
            if not isinstance(item, dict):
                continue
            try:
                par = (int(item.get("ano")), int(item.get("nro")))
            except (TypeError, ValueError):
                continue
            if par not in out:
                out.append(par)
    return out


def cleanup_imposicao_intermediate_pdfs(
    job: dict[str, Any],
    dados: dict[str, Any],
) -> list[str]:
    """
    Apaga da pasta Sefoc de cada OS do lote os PDFs auxiliares da imposição
    (marcas, gang, gang rotacionado, pré-impresso) depois que o PDF do Apogee
    foi movido para Digital/Offset. Só remove arquivos com os nomes gerados
    pelo sistema (``{prefixo}{sufixo}``) diretamente na pasta Sefoc.
    """
    removidos: list[str] = []
    for ano, nro in _lote_os_do_job(job, dados):
        try:
            sefoc = resolve_os_papelaria_dir(ano, nro, create=False)
            prefix = get_os_folder_basename(ano, nro)
        except Exception as exc:
            logger.warning("Limpeza imposição: pasta da OS %s/%s indisponível: %s", nro, ano, exc)
            continue
        if not sefoc or not os.path.isdir(sefoc):
            continue
        for sufixo in _IMPOSICAO_AUX_SUFIXOS:
            path = os.path.normpath(os.path.join(sefoc, f"{prefix}{sufixo}"))
            if not os.path.isfile(path):
                continue
            try:
                os.remove(path)
                removidos.append(f"{int(nro):05d}/{os.path.basename(path)}")
            except OSError as exc:
                logger.warning("Limpeza imposição: não removeu %s: %s", path, exc)
    return removidos


def _registrar_limpeza_imposicao(job_id: int, job: dict[str, Any], dados: dict[str, Any]) -> None:
    """Best effort: falha na limpeza nunca impede o PDF pronto."""
    try:
        removidos = cleanup_imposicao_intermediate_pdfs(job, dados)
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning("Limpeza dos PDFs de imposição do job %s falhou: %s", job_id, exc)
        return
    if removidos:
        dados["imposicao_intermediarios_removidos"] = removidos
        append_job_log(
            job_id,
            "PDFs auxiliares da imposição removidos da pasta da OS: " + ", ".join(removidos),
            "info",
        )


def _finalize_imposicao_digital_pdf(
    *,
    job_id: int,
    job: dict[str, Any],
    src_path: str,
    dest_abs: str,
    dest_name: str,
) -> dict[str, Any]:
    """Move/renomeia o PDF para Digital/{dest_name} e marca o job como pronto."""
    dados = dict(job.get("dados") or {})
    os.makedirs(os.path.dirname(dest_abs), exist_ok=True)
    src_norm = os.path.normpath(src_path)
    dest_norm = os.path.normpath(dest_abs)
    if src_norm != dest_norm:
        if os.path.isfile(dest_norm):
            os.remove(dest_norm)
        shutil.move(src_norm, dest_norm)
    rel_pdf = f"Digital/{dest_name}"
    origem_name = os.path.basename(src_norm)

    dados["aguardando_apogee"] = False
    dados["imposicao_pdf_origem"] = origem_name
    dados["imposicao_pdf_digital"] = rel_pdf
    _registrar_limpeza_imposicao(job_id, job, dados)

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET ArquivoPdfGerado = %(pdf)s,
            DadosJson = %(dados)s
        WHERE ID = %(id)s
        """,
        {
            "pdf": rel_pdf,
            "dados": json.dumps(dados, ensure_ascii=False),
            "id": job_id,
        },
    )
    updated = get_job(job_id)
    if not updated:
        raise RuntimeError("Falha ao recuperar job após mover PDF de imposição.")
    if src_norm == dest_norm:
        log_msg = f"PDF Apogee já em Digital: {dest_name}"
    else:
        log_msg = f"PDF Apogee movido para Digital: {dest_name}"
    append_job_log(job_id, log_msg, "info")
    broadcast_job_update(updated)
    return {
        "status": "ready",
        "message": "PDF de imposição pronto.",
        "job": updated,
    }


def _finalize_imposicao_offset_pdf(
    *,
    job_id: int,
    job: dict[str, Any],
    src_path: str,
    dest_abs: str,
    dest_name: str,
) -> dict[str, Any]:
    """Move PDF para Offset da âncora e copia para Offset das OSs juntadas."""
    dados = dict(job.get("dados") or {})
    os.makedirs(os.path.dirname(dest_abs), exist_ok=True)
    src_norm = os.path.normpath(src_path)
    dest_norm = os.path.normpath(dest_abs)
    if src_norm != dest_norm:
        if os.path.isfile(dest_norm):
            os.remove(dest_norm)
        shutil.move(src_norm, dest_norm)
    rel_pdf = f"Offset/{dest_name}"
    origem_name = os.path.basename(src_norm)
    config = dados.get("imposicao_config") if isinstance(dados.get("imposicao_config"), dict) else {}

    membros = list(dados.get("juntada_membros") or [])
    copias: list[str] = []
    for m in membros:
        try:
            m_ano = int(m.get("ano"))
            m_nro = int(m.get("nro"))
        except (TypeError, ValueError):
            continue
        try:
            m_sefoc = resolve_os_papelaria_dir(m_ano, m_nro, create=True)
            m_offset = os.path.normpath(os.path.join(m_sefoc, "Offset"))
            os.makedirs(m_offset, exist_ok=True)
            m_name = build_imposicao_offset_pdf_name(
                ano=m_ano, nro=m_nro, config=config
            )
            m_dest = os.path.normpath(os.path.join(m_offset, m_name))
            if os.path.isfile(m_dest):
                os.remove(m_dest)
            shutil.copy2(dest_norm, m_dest)
            copias.append(f"{m_nro:05d}/{m_name}")
        except Exception as exc:
            logger.warning(
                "Falha ao copiar PDF Offset para OS %s/%s: %s",
                m.get("nro"),
                m.get("ano"),
                exc,
            )

    dados["aguardando_apogee"] = False
    dados["imposicao_pdf_origem"] = origem_name
    dados["imposicao_pdf_offset"] = rel_pdf
    if copias:
        dados["imposicao_pdf_offset_copias"] = copias
    _registrar_limpeza_imposicao(job_id, job, dados)

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET ArquivoPdfGerado = %(pdf)s,
            DadosJson = %(dados)s
        WHERE ID = %(id)s
        """,
        {
            "pdf": rel_pdf,
            "dados": json.dumps(dados, ensure_ascii=False),
            "id": job_id,
        },
    )
    updated = get_job(job_id)
    if not updated:
        raise RuntimeError("Falha ao recuperar job após mover PDF Offset.")
    log_msg = f"PDF Apogee movido para Offset: {dest_name}"
    if copias:
        log_msg += f" (cópias: {', '.join(copias)})"
    append_job_log(job_id, log_msg, "info")
    broadcast_job_update(updated)
    return {
        "status": "ready",
        "message": "PDF de imposição (Offset) pronto.",
        "job": updated,
    }


def _is_absolute_output_path(path: str) -> bool:
    text = (path or "").strip()
    return bool(
        text.startswith("\\\\")
        or text.startswith("//")
        or re.match(r"^[A-Za-z]:[\\/]", text)
    )


def _path_is_under(path: str, root: str) -> bool:
    try:
        real_file = os.path.normcase(os.path.realpath(path))
        real_base = os.path.normcase(os.path.realpath(root))
    except OSError:
        return False
    if real_file == real_base:
        return True
    prefix = real_base if real_base.endswith(os.sep) else real_base + os.sep
    return real_file.startswith(prefix)


def _pasta_saida_do_job(dados: dict[str, Any]) -> Optional[str]:
    """
    Pasta absoluta configurada no perfil para receber o PDF do Apogee.

    Vazio = pasta Digital ou Offset da OS. Caminho inválido vira erro,
    para não gravar o PDF no lugar errado.
    """
    raw = dados.get("imposicao_pasta_saida")
    if raw is None or str(raw).strip() == "":
        v2 = dados.get("imposicao_v2")
        if isinstance(v2, dict):
            perfil = v2.get("perfil")
            saida = perfil.get("saida") if isinstance(perfil, dict) else None
            if isinstance(saida, dict):
                raw = saida.get("pasta_pdf")
    if raw is None or str(raw).strip() == "":
        return None
    from services.papelaria_models_service import normalize_pasta_imposicao

    try:
        return normalize_pasta_imposicao(raw)
    except ValueError as exc:
        raise ValueError(
            str(exc).replace("Pasta de imposição", "Pasta de saída do PDF")
        ) from exc


def _pdf_sob_pasta_saida(job: dict[str, Any], candidate: str) -> Optional[str]:
    """Arquivo absoluto somente se estiver dentro da pasta de saída do job."""
    dados = job.get("dados") if isinstance(job.get("dados"), dict) else {}
    pasta = _pasta_saida_do_job(dados)
    full = os.path.normpath((candidate or "").strip())
    if not pasta or not full or not _path_is_under(full, pasta):
        return None
    if os.path.isfile(full):
        return full
    return None


def _coluna_pdf_gerado(dest_abs: str, dest_name: str) -> str:
    """ArquivoPdfGerado cabe em VARCHAR(512); senão guarda só o nome."""
    norm = os.path.normpath(dest_abs)
    if len(norm) <= 512:
        return norm
    return dest_name


def _finalize_imposicao_pasta_pdf(
    *,
    job_id: int,
    job: dict[str, Any],
    src_path: str,
    dest_abs: str,
    dest_name: str,
    pasta: str,
) -> dict[str, Any]:
    """Move o PDF do Apogee para a pasta de saída configurada no perfil."""
    dados = dict(job.get("dados") or {})
    try:
        os.makedirs(os.path.dirname(dest_abs) or pasta, exist_ok=True)
    except OSError as exc:
        raise ValueError(
            f"Não foi possível criar a pasta de saída do PDF: {pasta}"
        ) from exc
    src_norm = os.path.normpath(src_path)
    dest_norm = os.path.normpath(dest_abs)
    if src_norm != dest_norm:
        if os.path.isfile(dest_norm):
            os.remove(dest_norm)
        shutil.move(src_norm, dest_norm)
    origem_name = os.path.basename(src_norm)
    coluna = _coluna_pdf_gerado(dest_norm, dest_name)

    dados["aguardando_apogee"] = False
    dados["imposicao_pdf_origem"] = origem_name
    dados["imposicao_pasta_saida"] = pasta
    dados["imposicao_pdf_saida"] = dest_name
    dados["imposicao_pdf_abs"] = dest_norm
    _registrar_limpeza_imposicao(job_id, job, dados)

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET ArquivoPdfGerado = %(pdf)s,
            DadosJson = %(dados)s
        WHERE ID = %(id)s
        """,
        {
            "pdf": coluna,
            "dados": json.dumps(dados, ensure_ascii=False),
            "id": job_id,
        },
    )
    updated = get_job(job_id)
    if not updated:
        raise RuntimeError("Falha ao recuperar job após mover PDF de imposição.")
    if src_norm == dest_norm:
        log_msg = f"PDF Apogee já na pasta de saída: {dest_name} ({pasta})"
    else:
        log_msg = f"PDF Apogee movido para a pasta de saída: {dest_name} ({pasta})"
    append_job_log(job_id, log_msg, "info")
    broadcast_job_update(updated)
    return {
        "status": "ready",
        "message": "PDF de imposição pronto.",
        "job": updated,
    }


def poll_imposicao_apogee_result(job_id: int) -> dict[str, Any]:
    """
    Verifica a pasta da OS por PDF do Apogee e move para a pasta de saída
    do perfil, ou para Digital/Offset da OS quando essa pasta não foi definida.
    """
    ensure_papelaria_jobs_tables()
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")
    if job.get("tipo_job") != TIPO_JOB_IMPOSICAO:
        raise ValueError("Job não é de imposição.")
    if job.get("status") != STATUS_COMPLETED:
        raise ValueError("Job de imposição ainda não está concluído.")

    arquivo_atual = (job.get("arquivo_pdf") or "").strip()
    if arquivo_atual and not arquivo_atual.lower().endswith(".jdf"):
        try:
            resolve_job_file_path(job_id, "pdf")
            dados_ready = dict(job.get("dados") or {})
            if dados_ready.get("aguardando_apogee") is True:
                dados_ready["aguardando_apogee"] = False
                db.execute_query(
                    """
                    UPDATE tabPapelariaJobs
                    SET DadosJson = %(dados)s
                    WHERE ID = %(id)s
                    """,
                    {
                        "dados": json.dumps(dados_ready, ensure_ascii=False),
                        "id": job_id,
                    },
                )
                job = get_job(job_id) or job
            return {
                "status": "ready",
                "message": "PDF de imposição pronto.",
                "job": job,
            }
        except FileNotFoundError:
            pass

    dados = dict(job.get("dados") or {})
    config = dados.get("imposicao_config")
    if not isinstance(config, dict):
        raise ValueError("Job de imposição sem ImposicaoConfigJson.")

    ano = int(job["ano_protocolo"])
    nro = int(job["nro_protocolo"])
    sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    if isinstance(dados.get("imposicao_v2"), dict):
        # Perfil v2: o destino do PDF é configurado no perfil.
        destino_offset = str(dados.get("imposicao_destino") or "").strip().lower() == "offset"
    else:
        destino_offset = (
            str(dados.get("imposicao_destino") or "").strip().lower() == "offset"
            or bool(dados.get("usar_pre_impresso"))
        )

    pasta_saida = _pasta_saida_do_job(dados)
    if pasta_saida:
        dest_name = (
            build_imposicao_offset_pdf_name(ano=ano, nro=nro, config=config)
            if destino_offset
            else build_imposicao_digital_pdf_name(ano=ano, nro=nro, config=config)
        )
        dest_abs = os.path.normpath(os.path.join(pasta_saida, dest_name))
        found = dest_abs if os.path.isfile(dest_abs) else None
        if not found:
            expected_stem = _imposicao_export_stem(ano, nro)
            found = find_imposicao_pdf_in_sefoc(
                sefoc_dir,
                expected_stem=expected_stem,
            )
        if not found and not destino_offset:
            digital_dir = os.path.normpath(os.path.join(sefoc_dir, "Digital"))
            found = find_imposicao_pdf_in_digital(
                digital_dir,
                preferred_name=dest_name,
            )
        if not found:
            return {
                "status": "waiting_apogee",
                "message": _waiting_apogee_message(),
                "job": job,
            }
        return _finalize_imposicao_pasta_pdf(
            job_id=job_id,
            job=job,
            src_path=found,
            dest_abs=dest_abs,
            dest_name=dest_name,
            pasta=pasta_saida,
        )

    if destino_offset:
        dest_name = build_imposicao_offset_pdf_name(ano=ano, nro=nro, config=config)
        offset_dir = os.path.normpath(os.path.join(sefoc_dir, "Offset"))
        dest_abs = os.path.normpath(os.path.join(offset_dir, dest_name))
        found = None
        # Idempotência: só o nome Offset canônico já finalizado.
        if os.path.isfile(dest_abs):
            found = dest_abs
        if not found:
            expected_stem = _imposicao_export_stem(ano, nro)
            found = find_imposicao_pdf_in_sefoc(
                sefoc_dir,
                expected_stem=expected_stem,
            )
        if not found:
            return {
                "status": "waiting_apogee",
                "message": _waiting_apogee_message(),
                "job": job,
            }
        return _finalize_imposicao_offset_pdf(
            job_id=job_id,
            job=job,
            src_path=found,
            dest_abs=dest_abs,
            dest_name=dest_name,
        )

    dest_name = build_imposicao_digital_pdf_name(ano=ano, nro=nro, config=config)
    digital_dir = os.path.normpath(os.path.join(sefoc_dir, "Digital"))
    dest_abs = os.path.normpath(os.path.join(digital_dir, dest_name))

    found = find_imposicao_pdf_in_digital(
        digital_dir,
        preferred_name=dest_name,
    )
    if not found:
        expected_stem = _imposicao_export_stem(ano, nro)
        found = find_imposicao_pdf_in_sefoc(
            sefoc_dir,
            expected_stem=expected_stem,
        )
    if not found:
        return {
            "status": "waiting_apogee",
            "message": _waiting_apogee_message(),
            "job": job,
        }

    return _finalize_imposicao_digital_pdf(
        job_id=job_id,
        job=job,
        src_path=found,
        dest_abs=dest_abs,
        dest_name=dest_name,
    )


def resolve_job_file_path(job_id: int, tipo: str) -> tuple[str, str]:
    """Retorna (caminho_absoluto, nome_download) — apenas backend."""
    ensure_papelaria_jobs_tables()
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")

    is_imposicao = job.get("tipo_job") == TIPO_JOB_IMPOSICAO
    waiting_msg = (
        _waiting_apogee_message() if is_imposicao else _waiting_corel_message()
    )

    if job["status"] != STATUS_COMPLETED:
        raise FileNotFoundError(waiting_msg)

    col_map = {"pdf": "ArquivoPdfGerado", "cdr": "ArquivoCdrGerado"}
    tipo_l = (tipo or "").strip().lower()
    if tipo_l not in col_map:
        raise ValueError("Tipo de arquivo inválido. Use 'pdf' ou 'cdr'.")

    rows = db.execute_query(
        f"SELECT {col_map[tipo_l]} AS path, NroProtocolo, AnoProtocolo "
        f"FROM tabPapelariaJobs WHERE ID = %(id)s",
        {"id": job_id},
    )
    rel_path = (rows[0].get("path") or "").strip() if rows else ""
    if not rel_path or (tipo_l == "pdf" and rel_path.lower().endswith(".jdf")):
        raise FileNotFoundError(waiting_msg)

    if tipo_l == "pdf" and _is_absolute_output_path(rel_path):
        externo = _pdf_sob_pasta_saida(job, rel_path)
        if not externo:
            raise FileNotFoundError(waiting_msg)
        return externo, os.path.basename(externo)

    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(job["ano_protocolo"], job["nro_protocolo"])
    if not os_path:
        raise FileNotFoundError("Pasta da OS não encontrada.")

    sefoc_base = os.path.normpath(os.path.join(os_path, "Sefoc"))
    rel_norm = rel_path.replace("\\", "/").lstrip("/")
    candidates = [
        os.path.normpath(os.path.join(sefoc_base, *rel_norm.split("/"))),
        os.path.normpath(os.path.join(sefoc_base, "Papelaria", os.path.basename(rel_norm))),
        os.path.normpath(os.path.join(sefoc_base, "Digital", os.path.basename(rel_norm))),
    ]
    full_path = candidates[0]
    for candidate in candidates:
        if os.path.isfile(candidate):
            full_path = candidate
            break

    try:
        real_file = os.path.realpath(full_path)
        real_base = os.path.realpath(sefoc_base)
        if not real_base.endswith(os.sep):
            real_base = real_base + os.sep
        if not real_file.startswith(real_base):
            raise ValueError("Caminho de arquivo inválido.")
    except OSError as exc:
        raise FileNotFoundError("Arquivo não encontrado.") from exc

    if not os.path.isfile(full_path) and tipo_l == "pdf":
        dados_job = job.get("dados") if isinstance(job.get("dados"), dict) else {}
        abs_saved = str(dados_job.get("imposicao_pdf_abs") or "").strip()
        if abs_saved and os.path.basename(abs_saved) == os.path.basename(rel_path):
            externo = _pdf_sob_pasta_saida(job, abs_saved)
            if externo:
                return externo, os.path.basename(externo)

    if not os.path.isfile(full_path):
        raise FileNotFoundError(waiting_msg)

    return full_path, os.path.basename(full_path)


def _assert_job_pending_prova_review(job: dict[str, Any]) -> None:
    if job.get("status") != STATUS_COMPLETED:
        raise ValueError("Job não está concluído.")
    revisao = job.get("prova_revisao")
    if revisao == PROVA_REVISAO_APPROVED:
        raise ValueError("Prova já foi aprovada.")
    if revisao == PROVA_REVISAO_DISCARDED:
        raise ValueError("Prova já foi descartada.")
    if revisao and revisao != PROVA_REVISAO_PENDING:
        raise ValueError("Prova não está aguardando revisão.")
    if not job.get("arquivo_pdf"):
        raise ValueError("Job não possui PDF de prova gerado.")


def _cleanup_job_preview_cache(job: dict[str, Any]) -> None:
    try:
        from services.papelaria_preview_service import _preview_dir_for_job

        sefoc_base = resolve_os_papelaria_dir(
            job["ano_protocolo"],
            job["nro_protocolo"],
            create=False,
        )
        cache_dir = _preview_dir_for_job(sefoc_base, int(job["id"]))
        if os.path.isdir(cache_dir):
            shutil.rmtree(cache_dir, ignore_errors=True)
    except Exception as exc:
        logger.warning(
            "Falha ao limpar cache de prévia do job %s: %s", job.get("id"), exc
        )


def _resolve_prova_version_and_arquivo(job: dict[str, Any]) -> tuple[int, str]:
    """
    Versão da prova + nome do PDF para token/andamento.

    Em prova web o job aponta para BaseSefoc.pdf (sem N); a versão vem de
    DadosJson (prova_numero / prova_web_pdf_name), Versao do job ou pasta.
    """
    pdf_name = str(job.get("arquivo_pdf") or "").strip()
    dados = job.get("dados") if isinstance(job.get("dados"), dict) else {}
    ano = int(job["ano_protocolo"])
    nro = int(job["nro_protocolo"])

    candidates: list[str] = []
    if pdf_name:
        candidates.append(pdf_name)
    for key in ("prova_web_pdf_name", "prova_email_pdf_name"):
        name = str(dados.get(key) or "").strip()
        if name:
            candidates.append(name)

    prova_ver: Optional[int] = None
    arquivo_from_name: Optional[str] = None
    for name in candidates:
        ver = extract_prova_version_from_filename(name)
        if ver is not None:
            prova_ver = ver
            arquivo_from_name = os.path.basename(name)
            break

    if prova_ver is None:
        raw_num = dados.get("prova_numero")
        try:
            if raw_num is not None and int(raw_num) > 0:
                prova_ver = int(raw_num)
        except (TypeError, ValueError):
            pass

    if prova_ver is None:
        try:
            sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
            prefix = get_os_folder_basename(ano, nro)
            max_ver = _max_prova_sefoc_version(sefoc_dir, prefix, nro)
            if max_ver > 0:
                prova_ver = max_ver
        except Exception:
            pass

    if prova_ver is None:
        raw_ver = job.get("versao")
        try:
            if raw_ver is not None and int(raw_ver) > 0:
                prova_ver = int(raw_ver)
        except (TypeError, ValueError):
            pass

    if prova_ver is None:
        raise ValueError("Não foi possível identificar a versão da prova no arquivo.")

    # Preferir PDF versionado na pasta (ProvaN / ProvaSefoc) para o token.
    arquivo = pdf_name or arquivo_from_name or ""
    try:
        sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
        prefix = get_os_folder_basename(ano, nro)
        preferred = [
            str(dados.get("prova_web_pdf_name") or "").strip(),
            str(dados.get("prova_email_pdf_name") or "").strip(),
            f"{prefix}-Prova{prova_ver}.pdf",
            f"{prefix}-ProvaSefoc {prova_ver}.pdf",
            arquivo_from_name or "",
            pdf_name,
        ]
        for name in preferred:
            if not name:
                continue
            path = os.path.normpath(os.path.join(sefoc_dir, os.path.basename(name)))
            if os.path.isfile(path):
                arquivo = os.path.basename(name)
                break
    except Exception:
        if arquivo_from_name:
            arquivo = arquivo_from_name

    if not arquivo:
        raise ValueError("Não foi possível identificar a versão da prova no arquivo.")
    return prova_ver, arquivo


def approve_job_prova(job_id: int, aprovado_por: str) -> dict[str, Any]:
    """Aprova PDF gerado: andamento SEFOC + token de prova para envio por e-mail."""
    ensure_papelaria_jobs_tables()
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")
    _assert_job_pending_prova_review(job)

    prova_ver, pdf_name = _resolve_prova_version_and_arquivo(job)

    ano = int(job["ano_protocolo"])
    nro = int(job["nro_protocolo"])
    ponto = (aprovado_por or "").strip()
    obs = f"Enviar Prova {prova_ver}"

    def _approve_tx(cursor):
        from routers.analise_routes import add_movement_internal

        cod = add_movement_internal(
            cursor, nro, ano, "Encam. de Docum.", "SEFOC", ponto, obs
        )
        cursor.execute(
            """
            UPDATE tabPapelariaJobs
            SET ProvaRevisao = %(revisao)s
            WHERE ID = %(id)s AND Status = %(completed)s
              AND (
                ProvaRevisao = %(pending)s
                OR ProvaRevisao IS NULL
                OR TRIM(ProvaRevisao) = ''
              )
            """,
            {
                "revisao": PROVA_REVISAO_APPROVED,
                "id": job_id,
                "completed": STATUS_COMPLETED,
                "pending": PROVA_REVISAO_PENDING,
            },
        )
        if cursor.rowcount != 1:
            raise ValueError("Prova não pôde ser aprovada (status alterado).")
        return cod

    cod_status = db.execute_transaction([_approve_tx])[0]

    from routers.proof_portal_routes import ensure_proof_token

    proof_token = ensure_proof_token(
        nro,
        ano,
        str(prova_ver),
        pdf_name,
        ponto_envio=ponto,
    )

    try:
        pdf_path, _ = resolve_job_file_path(job_id, "pdf")
        rows = db.execute_query(
            """
            SELECT ID FROM tabProofTokens
            WHERE Token = %s AND NroProtocolo = %s AND AnoProtocolo = %s
            LIMIT 1
            """,
            (proof_token, nro, ano),
        )
        if rows:
            from services import papelaria_preview_service as preview_svc

            preview_svc.ensure_proof_preview_pages(
                ano, nro, int(rows[0]["ID"]), pdf_path
            )
    except Exception as exc:
        logger.warning(
            "Prévia portal não pré-gerada para job %s (OS %s/%s): %s",
            job_id,
            nro,
            ano,
            exc,
        )

    append_job_log(
        job_id,
        f"Prova v{prova_ver} aprovada por {ponto}. Andamento Encam. de Docum. registrado.",
        "info",
    )

    from routers.realtime import broadcast_os_system_update

    broadcast_os_system_update(
        nro,
        ano,
        "papelaria_aprovar_prova",
        setor="SEFOC",
        origem="papelaria",
    )

    if cod_status:
        from routers.mdb_writer import push_andamento_to_mdb_after_mysql

        push_andamento_to_mdb_after_mysql(
            cod_status,
            nro,
            ano,
            operation="insert",
            task_name="papelaria_aprovar_prova",
        )

    try:
        from services.email_auto_send_service import schedule_auto_send_after_encam

        schedule_auto_send_after_encam(
            os_num=nro,
            ano=ano,
            situacao="Encam. de Docum.",
            setor="SEFOC",
            observacao=obs,
            cod_status=str(cod_status or "") or None,
        )
    except Exception as auto_exc:
        logger.warning(
            "auto_send schedule falhou após aprovar prova OS %s/%s: %s",
            nro,
            ano,
            auto_exc,
        )

    updated = get_job(job_id)
    if updated:
        broadcast_job_update(updated)
    return {
        "job": updated,
        "cod_status": cod_status,
        "prova_versao": prova_ver,
        "proof_token": proof_token,
    }


def discard_job_prova(job_id: int, descartado_por: str) -> dict[str, Any]:
    """Descarta PDF gerado e reverte para a versão anterior de prova na pasta Sefoc."""
    ensure_papelaria_jobs_tables()
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")
    _assert_job_pending_prova_review(job)

    pdf_name = str(job["arquivo_pdf"])
    prova_ver = extract_prova_version_from_filename(pdf_name)
    output_dir = resolve_os_papelaria_dir(
        job["ano_protocolo"],
        job["nro_protocolo"],
        create=False,
    )
    pdf_abs = os.path.normpath(os.path.join(output_dir, pdf_name))
    real_file = os.path.realpath(pdf_abs)
    real_base = os.path.realpath(output_dir)
    if not real_base.endswith(os.sep):
        real_base = real_base + os.sep
    if real_file.startswith(real_base) and os.path.isfile(pdf_abs):
        os.remove(pdf_abs)

    # Prova web / e-mail: o worker grava também {prefix}-ProvaN.pdf (ou
    # ProvaSefoc N). Sem remover essa cópia, a contagem de provas da pasta
    # ficaria inflada pela prova descartada.
    dados_job = job.get("dados") if isinstance(job.get("dados"), dict) else {}
    for key in ("prova_web_pdf_name", "prova_email_pdf_name"):
        extra_name = os.path.basename(str(dados_job.get(key) or "").strip())
        if not extra_name or extra_name == os.path.basename(pdf_name):
            continue
        extra_abs = os.path.normpath(os.path.join(output_dir, extra_name))
        try:
            if os.path.realpath(extra_abs).startswith(real_base) and os.path.isfile(
                extra_abs
            ):
                os.remove(extra_abs)
        except OSError as exc:
            logger.warning(
                "Não foi possível remover %s ao descartar job %s: %s",
                extra_name,
                job_id,
                exc,
            )

    _cleanup_job_preview_cache(job)

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET ArquivoPdfGerado = NULL,
            ProvaRevisao = %(revisao)s
        WHERE ID = %(id)s AND Status = %(completed)s
          AND (
            ProvaRevisao = %(pending)s
            OR ProvaRevisao IS NULL
            OR TRIM(ProvaRevisao) = ''
          )
        """,
        {
            "revisao": PROVA_REVISAO_DISCARDED,
            "id": job_id,
            "completed": STATUS_COMPLETED,
            "pending": PROVA_REVISAO_PENDING,
        },
    )

    updated = get_job(job_id)
    if not updated or updated.get("prova_revisao") != PROVA_REVISAO_DISCARDED:
        raise ValueError("Prova não pôde ser descartada (status alterado).")

    actor = (descartado_por or "").strip()
    ver_label = prova_ver if prova_ver is not None else "?"
    append_job_log(
        job_id,
        f"Prova v{ver_label} descartada por {actor}. PDF removido da pasta Sefoc.",
        "info",
    )
    broadcast_job_update(updated)
    return updated


def register_preparando_prova_andamento(ano: int, nro: int, ponto: str) -> str:
    """Registra andamento Em Execução / Preparando Prova (SEFOC)."""
    ensure_papelaria_jobs_tables()
    _validate_os_exists(ano, nro)
    ponto_clean = (ponto or "").strip()
    if not ponto_clean:
        raise ValueError("Ponto do usuário é obrigatório.")

    def _tx(cursor):
        from routers.analise_routes import add_movement_internal

        return add_movement_internal(
            cursor, nro, ano, "Em Execução", "SEFOC", ponto_clean, "Preparando Prova"
        )

    cod_status = db.execute_transaction([_tx])[0]

    from routers.realtime import broadcast_os_system_update

    broadcast_os_system_update(nro, ano, "papelaria_preparando_prova", setor="SEFOC", origem="papelaria")

    if cod_status:
        from routers.mdb_writer import push_andamento_to_mdb_after_mysql

        push_andamento_to_mdb_after_mysql(
            cod_status,
            nro,
            ano,
            operation="insert",
            task_name="papelaria_preparando_prova",
        )

    return cod_status


def _is_backup_cdr_filename(filename: str) -> bool:
    """Cópia de segurança do CorelDRAW (pt: «Cópia_de_segurança_de_…», en: «Backup_of_…»)."""
    import unicodedata

    lower = (filename or "").lower()
    if CDR_BACKUP_NAME_FRAGMENT in lower:
        return True
    plain = "".join(
        ch
        for ch in unicodedata.normalize("NFKD", lower)
        if not unicodedata.combining(ch)
    )
    plain = re.sub(r"[\s_\-]+", " ", plain)
    return "copia de seguranca" in plain or plain.startswith("backup of ")


def find_os_base_cdr(ano: int, nro: int) -> Optional[dict[str, Any]]:
    """Corel utilizável da pasta da OS para «Criar prova» (BaseSefoc primeiro, depois o mais recente)."""
    try:
        files = list_os_usable_cdrs(ano, nro)
    except Exception as exc:
        logger.debug("Sem Corel na pasta da OS %s/%s: %s", nro, ano, exc)
        return None
    return files[0] if files else None


def _is_usable_os_cdr_filename(filename: str) -> bool:
    if not (filename or "").lower().endswith(".cdr"):
        return False
    return not _is_backup_cdr_filename(filename)


def _normalize_os_relative_cdr(value: str) -> str:
    text = (value or "").strip().replace("\\", "/")
    if not text or text.startswith("/") or text.startswith("./"):
        raise ValueError("Nome de arquivo Corel inválido.")
    parts = [p for p in text.split("/") if p]
    if not parts or any(p in (".", "..") for p in parts) or ":" in text:
        raise ValueError("Nome de arquivo Corel inválido.")
    return "/".join(parts)


def _assert_file_under_os_root(path: str, os_root: str) -> str:
    real_file = os.path.realpath(path)
    real_base = os.path.realpath(os_root)
    if not real_base.endswith(os.sep):
        real_base = real_base + os.sep
    if not real_file.startswith(real_base):
        raise ValueError("Caminho de arquivo inválido.")
    return real_file


def _relative_cdr_from_os_root(os_root: str, abs_path: str) -> str:
    rel = os.path.relpath(abs_path, os_root).replace("\\", "/")
    return _normalize_os_relative_cdr(rel)


def list_os_usable_cdrs(ano: int, nro: int) -> list[dict[str, Any]]:
    """
    Lista .cdr utilizáveis na pasta da OS (Sefoc, Sefoc/Papelaria e raiz).
    Ignora arquivos cujo nome contém 'Cópia_de_segurança'.
    Ordena preferindo {prefix}-BaseSefoc.cdr e, em seguida, o mais recente.
    """
    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(ano, nro)
    if not os_path:
        raise LookupError("Pasta da OS não encontrada na rede.")

    os_root = os.path.normpath(os_path)
    sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    prefix = get_os_folder_basename(ano, nro)
    standard_name = f"{prefix}-BaseSefoc.cdr"
    ranked: list[tuple[int, float, str]] = []
    seen: set[str] = set()

    def _scan(directory: str, *, priority_offset: int) -> None:
        if not os.path.isdir(directory):
            return
        for fname in os.listdir(directory):
            if not _is_usable_os_cdr_filename(fname):
                continue
            path = os.path.normpath(os.path.join(directory, fname))
            if not os.path.isfile(path):
                continue
            try:
                real = _assert_file_under_os_root(path, os_root)
            except ValueError:
                continue
            if real in seen:
                continue
            seen.add(real)
            priority = priority_offset + (0 if fname == standard_name else 1)
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                mtime = 0.0
            ranked.append((priority, mtime, real))

    _scan(sefoc_dir, priority_offset=0)
    _scan(os.path.join(sefoc_dir, "Papelaria"), priority_offset=10)
    _scan(os_root, priority_offset=20)

    ranked.sort(key=lambda item: (item[0], -item[1]))
    result: list[dict[str, Any]] = []
    for _priority, mtime, abs_path in ranked:
        result.append(
            {
                "filename": os.path.basename(abs_path),
                "relative_path": _relative_cdr_from_os_root(os_root, abs_path),
                "absolute_path": abs_path,
                "mtime": mtime,
            }
        )
    return result


def select_os_usable_cdr(
    ano: int,
    nro: int,
    arquivo_cdr: Optional[str] = None,
) -> dict[str, Any]:
    """Escolhe um CDR da pasta da OS; exige arquivo_cdr se houver mais de um."""
    files = list_os_usable_cdrs(ano, nro)
    if not files:
        raise FileNotFoundError(
            "Nenhum arquivo Corel (.cdr) utilizável encontrado na pasta da OS. "
            "Arquivos de cópia de segurança são ignorados."
        )

    requested = (arquivo_cdr or "").strip()
    if requested:
        needle = _normalize_os_relative_cdr(requested)
        matches = [item for item in files if item["relative_path"] == needle]
        if not matches:
            basename = os.path.basename(needle).lower()
            by_name = [
                item for item in files if item["filename"].lower() == basename
            ]
            if len(by_name) == 1:
                matches = by_name
        if not matches:
            raise ValueError(
                "O arquivo Corel informado não foi encontrado na pasta da OS."
            )
        return matches[0]

    if len(files) > 1:
        raise ValueError(
            "Há mais de um arquivo Corel na pasta da OS. Informe qual deve ser usado."
        )
    return files[0]


def resolve_os_relative_cdr_path(ano: int, nro: int, relative_path: str) -> str:
    """Resolve um caminho relativo à pasta da OS para um .cdr existente."""
    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(ano, nro)
    if not os_path:
        raise LookupError("Pasta da OS não encontrada na rede.")
    os_root = os.path.normpath(os_path)
    rel = _normalize_os_relative_cdr(relative_path)
    abs_path = os.path.normpath(os.path.join(os_root, rel.replace("/", os.sep)))
    real = _assert_file_under_os_root(abs_path, os_root)
    if not os.path.isfile(real):
        raise FileNotFoundError(
            f"Corel da OS não encontrado: {os.path.basename(real)}"
        )
    if not _is_usable_os_cdr_filename(os.path.basename(real)):
        raise ValueError("Arquivo Corel inválido.")
    return real


def resolve_export_input_cdr_path(
    ano: int,
    nro: int,
    relative_path: Optional[str],
) -> str:
    """Caminho absoluto do CDR persistido no job; rediscovery só para jobs antigos."""
    if relative_path and str(relative_path).strip():
        return resolve_os_relative_cdr_path(ano, nro, str(relative_path))
    return discover_os_cdr_absolute_path(ano, nro)


def discover_os_cdr_absolute_path(ano: int, nro: int) -> str:
    """
    Localiza um .cdr utilizável na pasta da OS (Sefoc e raiz da OS).
    Ignora arquivos cujo nome contém 'Cópia_de_segurança'.
    Prefere {prefix}-BaseSefoc.cdr; senão, o mais recente na pasta.
    """
    files = list_os_usable_cdrs(ano, nro)
    if not files:
        raise FileNotFoundError(
            "Nenhum arquivo Corel (.cdr) utilizável encontrado na pasta da OS. "
            "Arquivos de cópia de segurança são ignorados."
        )
    return files[0]["absolute_path"]


def resolve_os_cdr_absolute_path(ano: int, nro: int) -> str:
    """Caminho absoluto de um .cdr utilizável na pasta Sefoc da OS."""
    return discover_os_cdr_absolute_path(ano, nro)


def list_os_cdr_path_payload(ano: int, nro: int) -> dict[str, Any]:
    files = list_os_usable_cdrs(ano, nro)
    if not files:
        raise FileNotFoundError(
            "Nenhum arquivo Corel (.cdr) utilizável encontrado na pasta da OS. "
            "Arquivos de cópia de segurança são ignorados."
        )
    chosen = files[0]
    return {
        "path": chosen["absolute_path"],
        "filename": chosen["filename"],
        "files": [
            {
                "filename": item["filename"],
                "relative_path": item["relative_path"],
                "mtime": item["mtime"],
            }
            for item in files
        ],
    }


def _resolve_prova_pdf_by_version(sefoc_dir: str, prefix: str, nro: int, version: int) -> tuple[str, str]:
    """Retorna (abs_path, basename) para a versão informada."""
    num_os = f"{int(nro):05d}"
    names = [f"{prefix}-ProvaSefoc {version}.pdf"]
    if os.path.isdir(sefoc_dir):
        for fname in os.listdir(sefoc_dir):
            if re.match(rf"^{num_os}.*-Prova{version}_SEFOC\.pdf$", fname, re.IGNORECASE):
                names.append(fname)
    for name in names:
        path = os.path.normpath(os.path.join(sefoc_dir, name))
        if os.path.isfile(path):
            return path, os.path.basename(path)
    raise FileNotFoundError(f"PDF de prova v{version} não encontrado na pasta Sefoc.")


def _job_for_pdf(ano: int, nro: int, pdf_basename: str) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT ID FROM tabPapelariaJobs
        WHERE AnoProtocolo = %(ano)s AND NroProtocolo = %(nro)s
          AND Status = %(completed)s
          AND ArquivoPdfGerado = %(pdf)s
        ORDER BY ID DESC
        LIMIT 1
        """,
        {
            "ano": ano,
            "nro": nro,
            "completed": STATUS_COMPLETED,
            "pdf": pdf_basename,
        },
    )
    if not rows:
        return None
    return get_job(int(rows[0]["ID"]))


def finalize_manual_corel_job(
    ano: int,
    nro: int,
    modelo_id: int,
    dados: dict[str, Any],
    solicitado_por: str,
) -> dict[str, Any]:
    """Registra job concluído após edição manual no CorelDRAW (PDF exportado na pasta Sefoc)."""
    ensure_papelaria_jobs_tables()
    from services import papelaria_models_service as models_svc

    os_row = _validate_os_exists(ano, nro)
    modelo = models_svc.get_modelo_by_id(modelo_id)
    if not modelo:
        raise LookupError("Modelo não encontrado ou inativo.")

    dados_clean = _sanitize_dados(dados)
    missing = _validate_required_fields(modelo, dados_clean)
    if missing:
        raise ValueError(f"Campos obrigatórios ausentes: {', '.join(missing)}")

    sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    prefix = get_os_folder_basename(ano, nro)
    max_ver = _max_prova_sefoc_version(sefoc_dir, prefix, nro)
    if max_ver < 1:
        raise FileNotFoundError(
            "Nenhum PDF de prova encontrado. Exporte a prova no CorelDRAW antes de finalizar."
        )

    _pdf_abs, pdf_name = _resolve_prova_pdf_by_version(sefoc_dir, prefix, nro, max_ver)
    cdr_path = discover_os_cdr_absolute_path(ano, nro)
    cdr_name = os.path.basename(cdr_path)

    existing = _job_for_pdf(ano, nro, pdf_name)
    if existing:
        revisao = existing.get("prova_revisao")
        if revisao == PROVA_REVISAO_PENDING or revisao is None or str(revisao).strip() == "":
            return existing
        if revisao == PROVA_REVISAO_APPROVED:
            raise ValueError(
                f"A prova v{max_ver} já foi aprovada. Exporte uma nova versão do PDF no CorelDRAW."
            )

    produto_os = (os_row.get("produto") or modelo["produto"] or "").strip()
    produto_job = modelo["produto"]
    ponto = (solicitado_por or "").strip()

    insert_params = {
        "nro": nro,
        "ano": ano,
        "tipo": "manual_corel",
        "produto": produto_job,
        "modelo_id": modelo_id,
        "arquivo": modelo["arquivo_modelo"],
        "dados": json.dumps(dados_clean, ensure_ascii=False),
        "status": STATUS_COMPLETED,
        "ponto": ponto,
        "cdr": cdr_name,
        "pdf": pdf_name,
        "prova_revisao": PROVA_REVISAO_PENDING,
    }

    def _insert(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabPapelariaJobs (
                NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao,
                ArquivoCdrGerado, ArquivoPdfGerado, ProvaRevisao, ConcluidoEm
            ) VALUES (
                %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                %(dados)s, %(status)s, 0, NULL, %(ponto)s, 1,
                %(cdr)s, %(pdf)s, %(prova_revisao)s, NOW()
            )
            """,
            insert_params,
        )
        return int(cursor.lastrowid)

    job_id = int(db.execute_transaction([_insert])[0])
    job = get_job(job_id)
    if not job:
        raise RuntimeError("Falha ao recuperar job criado.")

    append_job_log(
        job_id,
        f"Prova v{max_ver} registrada após edição manual no CorelDRAW ({pdf_name}).",
        "info",
    )
    warning = _product_match_warning(produto_os, produto_job)
    if warning:
        append_job_log(job_id, warning, "warning")
        job["warnings"] = [warning]

    broadcast_job_update(job)
    return job
