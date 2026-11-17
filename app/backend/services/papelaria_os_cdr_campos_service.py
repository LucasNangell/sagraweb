"""
Retrato dos textos do .cdr da OS (Papelaria).

O worker CorelDRAW lê os objetos de texto do arquivo da OS (nomeados ou não)
e a API guarda o resultado em ``tabPapelariaOsCdrCampos``. A página Papelaria e
o portal de aprovação usam esse retrato sem abrir o Corel; uma nova leitura só
é pedida quando o arquivo muda (mtime/tamanho) ou quando o técnico força.

Identidade dos objetos: ``StaticID`` do Corel (estável no documento) + página.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from typing import Any, Optional

from config_manager import PROJECT_ROOT
from database import db

logger = logging.getLogger(__name__)

TABLE = "tabPapelariaOsCdrCampos"

STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_READY = "ready"
STATUS_FAILED = "failed"

# Situações sem retrato possível (não persistidas).
SITUACAO_SEM_PASTA = "sem_pasta"
SITUACAO_SEM_CDR = "sem_cdr"

CDR_FIELD_PREFIX = "cdr:"
CDR_UNNAMED_PREFIX = "cdr#"

MAX_OBJETOS = 400
MAX_TEXTO_CHARS = 4000
MAX_NOME_CHARS = 40
MAX_OBJETOS_JSON_BYTES = 768 * 1024
MTIME_TOLERANCE_SEC = 1.0
PROCESSING_STALE_SEC = 10 * 60
FAILED_RETRY_SEC = 5 * 60
MAX_AUTO_RETRIES = 3
LIST_CACHE_TTL_SEC = 10.0

# Objetos de sistema (carimbo da prova, bordas de imposição) — nunca editáveis.
NOMES_SISTEMA = frozenset(
    n.lower()
    for n in (
        "TipoOSint",
        "OSint",
        "DataInt",
        "ProvaNroInt",
        "ProdutoNome",
        "BordaF",
        "BordaV",
    )
)
CAMADAS_SISTEMA = frozenset({"provasefoc"})

_NOME_VALIDO = re.compile(r"^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 _.\-]*$")
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

_table_ready = False
_table_lock = threading.Lock()
_list_cache: dict[tuple[int, int], tuple[float, list[dict[str, Any]]]] = {}
_last_stale_sweep = 0.0


# --------------------------------------------------------------------------- #
# Tabela
# --------------------------------------------------------------------------- #


def ensure_os_cdr_campos_table() -> None:
    global _table_ready
    if _table_ready:
        return
    with _table_lock:
        if _table_ready:
            return
        sql_path = PROJECT_ROOT / "deploy" / "sql" / "create_papelaria_os_cdr_campos.sql"
        if sql_path.is_file():
            raw = sql_path.read_text(encoding="utf-8")
            # Remove comentários de linha antes de dividir por ';'.
            body = "\n".join(
                line for line in raw.splitlines() if not line.strip().startswith("--")
            )
            for stmt in body.split(";"):
                s = stmt.strip()
                if s:
                    db.execute_query(s)
        _table_ready = True
        logger.info("Tabela %s verificada/criada", TABLE)


# --------------------------------------------------------------------------- #
# Normalização
# --------------------------------------------------------------------------- #


def normalizar_nome_objeto(nome: str) -> str:
    """Mesma regra do worker (``_normalizar_nome_shape``): ignora caixa/espaços."""
    return re.sub(r"\s+", "", (nome or "").strip().lower())


def _limpar_texto(value: Any, limit: int = MAX_TEXTO_CHARS) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL_CHARS.sub("", text)
    return text[:limit]


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_objetos(raw: Any) -> list[dict[str, Any]]:
    """Valida a lista enviada pelo worker; descarta itens malformados."""
    if not isinstance(raw, list):
        raise ValueError("Lista de objetos inválida.")
    out: list[dict[str, Any]] = []
    seen: set[tuple[int, int]] = set()
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        static_id = _as_int(item.get("static_id"))
        pagina = _as_int(item.get("pagina"), 1)
        if static_id <= 0 or pagina <= 0:
            continue
        ident = (pagina, static_id)
        if ident in seen:
            continue
        seen.add(ident)
        out.append(
            {
                "static_id": static_id,
                "pagina": pagina,
                "nome": _limpar_texto(item.get("nome"), 128).strip(),
                "texto": _limpar_texto(item.get("texto")),
                "camada": _limpar_texto(item.get("camada"), 128).strip(),
                "tipo": _limpar_texto(item.get("tipo"), 24).strip(),
                "ordem": _as_int(item.get("ordem"), idx),
            }
        )
        if len(out) >= MAX_OBJETOS:
            break
    out.sort(key=lambda o: (o["pagina"], o["ordem"]))
    return out


def _objeto_sistema(obj: dict[str, Any]) -> bool:
    if normalizar_nome_objeto(obj.get("camada") or "") in CAMADAS_SISTEMA:
        return True
    nome = (obj.get("nome") or "").strip().lower()
    return bool(nome) and nome.replace(" ", "") in NOMES_SISTEMA


def humanizar_nome(nome: str) -> str:
    base = (nome or "").strip().replace("_", " ")
    base = re.sub(r"(?<=[a-zà-ÿ0-9])(?=[A-ZÀ-Þ])", " ", base)
    base = re.sub(r"\s+", " ", base).strip()
    return base[:1].upper() + base[1:] if base else nome


def _multiline(texto: str) -> bool:
    return "\n" in texto or len(texto) > 60


def build_campos_cdr(objetos: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Agrupa objetos por nome. Mesmo nome com o mesmo texto em várias páginas vira
    um campo só (``cdr:Nome``); textos divergentes viram um campo por página
    (``cdr:Nome@2``). Textos sem nome ficam em ``sem_nome`` para serem nomeados.
    """
    grupos: dict[str, list[dict[str, Any]]] = {}
    ordem_grupos: list[str] = []
    sem_nome: list[dict[str, Any]] = []

    for obj in objetos:
        if _objeto_sistema(obj):
            continue
        nome = (obj.get("nome") or "").strip()
        if not nome:
            if not (obj.get("texto") or "").strip():
                continue
            sem_nome.append(
                {
                    "key": f"{CDR_UNNAMED_PREFIX}{obj['pagina']}:{obj['static_id']}",
                    "static_id": obj["static_id"],
                    "pagina": obj["pagina"],
                    "texto": obj.get("texto") or "",
                    "camada": obj.get("camada") or "",
                    "multiline": _multiline(obj.get("texto") or ""),
                }
            )
            continue
        norm = normalizar_nome_objeto(nome)
        if norm not in grupos:
            grupos[norm] = []
            ordem_grupos.append(norm)
        grupos[norm].append(obj)

    campos: list[dict[str, Any]] = []
    for norm in ordem_grupos:
        occs = grupos[norm]
        nome = occs[0]["nome"].strip()
        textos = {(o.get("texto") or "") for o in occs}
        if len(textos) == 1:
            texto = next(iter(textos))
            campos.append(
                {
                    "key": f"{CDR_FIELD_PREFIX}{nome}",
                    "nome": nome,
                    "label": humanizar_nome(nome),
                    "pagina": None,
                    "texto": texto,
                    "multiline": _multiline(texto),
                    "alvos": [
                        {"static_id": o["static_id"], "pagina": o["pagina"]} for o in occs
                    ],
                }
            )
            continue
        por_pagina: dict[int, list[dict[str, Any]]] = {}
        for o in occs:
            por_pagina.setdefault(int(o["pagina"]), []).append(o)
        for pagina in sorted(por_pagina):
            itens = por_pagina[pagina]
            texto = itens[0].get("texto") or ""
            rotulo_pag = "Frente" if pagina == 1 else ("Verso" if pagina == 2 else f"Pág. {pagina}")
            campos.append(
                {
                    "key": f"{CDR_FIELD_PREFIX}{nome}@{pagina}",
                    "nome": nome,
                    "label": f"{humanizar_nome(nome)} ({rotulo_pag})",
                    "pagina": pagina,
                    "texto": texto,
                    "multiline": _multiline(texto),
                    "alvos": [
                        {"static_id": o["static_id"], "pagina": o["pagina"]} for o in itens
                    ],
                }
            )

    return {"campos": campos, "sem_nome": sem_nome}


def sanitize_cdr_textos(raw: Any) -> dict[str, str]:
    """Valores de campos ``cdr:`` (portal / página): só limita tamanho e controle."""
    if not isinstance(raw, dict):
        raise ValueError("Textos do Corel inválidos.")
    out: dict[str, str] = {}
    for key, value in raw.items():
        k = str(key or "").strip()
        if not k.startswith(CDR_FIELD_PREFIX) or len(k) > 200:
            continue
        out[k] = _limpar_texto(value, 2000)
    return out


def validar_nome_novo(nome: str) -> str:
    limpo = re.sub(r"\s+", " ", (nome or "").strip())
    if not limpo:
        raise ValueError("Informe um nome para o objeto.")
    if len(limpo) > MAX_NOME_CHARS:
        raise ValueError(f"Nome '{limpo[:20]}…' excede {MAX_NOME_CHARS} caracteres.")
    if not _NOME_VALIDO.match(limpo):
        raise ValueError(
            f"Nome inválido: '{limpo}'. Use letras, números, espaço, '_', '-' ou '.' "
            "(começando por letra)."
        )
    if normalizar_nome_objeto(limpo) in NOMES_SISTEMA:
        raise ValueError(f"'{limpo}' é um nome reservado do sistema.")
    return limpo


# --------------------------------------------------------------------------- #
# Arquivos da OS
# --------------------------------------------------------------------------- #


def _list_os_cdrs_cached(ano: int, nro: int, *, bypass_cache: bool = False) -> list[dict[str, Any]]:
    from services.papelaria_jobs_service import list_os_usable_cdrs

    key = (int(ano), int(nro))
    now = time.monotonic()
    if not bypass_cache:
        cached = _list_cache.get(key)
        if cached and now - cached[0] < LIST_CACHE_TTL_SEC:
            return cached[1]
    files = list_os_usable_cdrs(ano, nro)
    for item in files:
        try:
            item["size"] = int(os.path.getsize(item["absolute_path"]))
        except OSError:
            item["size"] = None
    _list_cache[key] = (now, files)
    if len(_list_cache) > 512:
        for k, (ts, _f) in list(_list_cache.items()):
            if now - ts > LIST_CACHE_TTL_SEC:
                _list_cache.pop(k, None)
    return files


def invalidate_os_cache(ano: int, nro: int) -> None:
    _list_cache.pop((int(ano), int(nro)), None)


def _pick_file(files: list[dict[str, Any]], arquivo: Optional[str]) -> Optional[dict[str, Any]]:
    if not files:
        return None
    wanted = (arquivo or "").strip().replace("\\", "/")
    if wanted:
        for item in files:
            if item["relative_path"] == wanted:
                return item
        low = os.path.basename(wanted).lower()
        for item in files:
            if item["filename"].lower() == low:
                return item
    return files[0]


def _files_public(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "filename": f["filename"],
            "relative_path": f["relative_path"],
            "mtime": f.get("mtime") or 0,
        }
        for f in files
    ]


# --------------------------------------------------------------------------- #
# Linhas
# --------------------------------------------------------------------------- #


def _parse_objetos(raw: Any) -> Optional[list[dict[str, Any]]]:
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    return raw if isinstance(raw, list) else None


def _fmt_dt(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        return value.isoformat()
    except AttributeError:
        return str(value)


def _get_row(ano: int, nro: int, rel: str) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        f"""
        SELECT ID, CaminhoRelativo, ArquivoMtime, ArquivoTamanho, Status, ObjetosJson,
               ObjetosMtime, ObjetosTamanho, Erro, Tentativas, SolicitadoEm,
               IniciadoEm, ExtraidoEm, AtualizadoEm
        FROM {TABLE}
        WHERE AnoProtocolo = %(ano)s AND NroProtocolo = %(nro)s
          AND CaminhoRelativo = %(rel)s
        LIMIT 1
        """,
        {"ano": int(ano), "nro": int(nro), "rel": rel},
    )
    return rows[0] if rows else None


def _mesmo_arquivo(
    mtime_a: Any, size_a: Any, mtime_b: Any, size_b: Any
) -> bool:
    if mtime_a is None or mtime_b is None:
        return False
    try:
        if abs(float(mtime_a) - float(mtime_b)) > MTIME_TOLERANCE_SEC:
            return False
    except (TypeError, ValueError):
        return False
    if size_a is not None and size_b is not None:
        try:
            return int(size_a) == int(size_b)
        except (TypeError, ValueError):
            return False
    return True


def _segundos_desde(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        from datetime import datetime

        return (datetime.now() - value).total_seconds()
    except Exception:
        return None


def _solicitar_leitura(
    ano: int,
    nro: int,
    rel: str,
    mtime: Optional[float],
    size: Optional[int],
    row: Optional[dict[str, Any]],
    *,
    force: bool,
) -> Optional[str]:
    """Enfileira leitura no worker se necessário. Retorna o novo status (ou None)."""
    params = {
        "ano": int(ano),
        "nro": int(nro),
        "rel": rel,
        "mtime": mtime,
        "size": size,
        "pending": STATUS_PENDING,
    }
    if row is None:
        db.execute_query(
            f"""
            INSERT INTO {TABLE}
                (AnoProtocolo, NroProtocolo, CaminhoRelativo, ArquivoMtime,
                 ArquivoTamanho, Status, SolicitadoEm)
            VALUES (%(ano)s, %(nro)s, %(rel)s, %(mtime)s, %(size)s, %(pending)s, NOW())
            ON DUPLICATE KEY UPDATE
                ArquivoMtime = VALUES(ArquivoMtime),
                ArquivoTamanho = VALUES(ArquivoTamanho),
                SolicitadoEm = IF(Status = 'processing', SolicitadoEm, NOW()),
                Status = IF(Status = 'processing', Status, VALUES(Status))
            """,
            params,
        )
        return STATUS_PENDING

    status = row.get("Status") or ""
    arquivo_mudou = not _mesmo_arquivo(
        row.get("ArquivoMtime"), row.get("ArquivoTamanho"), mtime, size
    )

    if status == STATUS_PENDING:
        if arquivo_mudou:
            db.execute_query(
                f"""
                UPDATE {TABLE} SET ArquivoMtime = %(mtime)s, ArquivoTamanho = %(size)s
                WHERE ID = %(id)s
                """,
                {**params, "id": row["ID"]},
            )
        return STATUS_PENDING

    if status == STATUS_PROCESSING:
        idade = _segundos_desde(row.get("IniciadoEm"))
        if idade is None or idade < PROCESSING_STALE_SEC:
            return STATUS_PROCESSING
        # Worker sumiu durante a leitura — volta para a fila.

    if status == STATUS_FAILED and not force and not arquivo_mudou:
        idade = _segundos_desde(row.get("AtualizadoEm"))
        tentativas = _as_int(row.get("Tentativas"))
        if tentativas >= MAX_AUTO_RETRIES or (idade is not None and idade < FAILED_RETRY_SEC):
            return None

    reset_tentativas = arquivo_mudou or force
    db.execute_query(
        f"""
        UPDATE {TABLE}
        SET Status = %(pending)s,
            ArquivoMtime = %(mtime)s,
            ArquivoTamanho = %(size)s,
            SolicitadoEm = NOW(),
            WorkerID = NULL,
            Tentativas = {"0" if reset_tentativas else "Tentativas"}
        WHERE ID = %(id)s
        """,
        {**params, "id": row["ID"]},
    )
    return STATUS_PENDING


def _payload_from_row(
    row: Optional[dict[str, Any]],
    *,
    status: str,
    arquivo: Optional[dict[str, Any]],
    files: list[dict[str, Any]],
    atualizado: bool,
) -> dict[str, Any]:
    objetos = _parse_objetos(row.get("ObjetosJson")) if row else None
    campos = build_campos_cdr(objetos or []) if objetos is not None else {"campos": [], "sem_nome": []}
    return {
        "status": status,
        "atualizado": atualizado,
        "tem_retrato": objetos is not None,
        "arquivo": (
            {
                "filename": arquivo["filename"],
                "relative_path": arquivo["relative_path"],
                "mtime": arquivo.get("mtime") or 0,
                "size": arquivo.get("size"),
            }
            if arquivo
            else None
        ),
        "files": _files_public(files),
        "campos": campos["campos"],
        "sem_nome": campos["sem_nome"],
        "total_objetos": len(objetos or []),
        "erro": (row.get("Erro") if row and status == STATUS_FAILED else None),
        "extraido_em": _fmt_dt(row.get("ExtraidoEm")) if row else None,
        "solicitado_em": _fmt_dt(row.get("SolicitadoEm")) if row else None,
    }


# --------------------------------------------------------------------------- #
# API pública (página Papelaria / portal)
# --------------------------------------------------------------------------- #


def get_os_cdr_campos(
    ano: int,
    nro: int,
    arquivo: Optional[str] = None,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """
    Retorna o retrato dos textos do .cdr da OS. Se o arquivo mudou (ou nunca foi
    lido), enfileira leitura no worker e devolve o último retrato conhecido.
    """
    ensure_os_cdr_campos_table()
    try:
        files = _list_os_cdrs_cached(ano, nro, bypass_cache=force_refresh)
    except LookupError:
        return _payload_from_row(
            None, status=SITUACAO_SEM_PASTA, arquivo=None, files=[], atualizado=False
        )
    chosen = _pick_file(files, arquivo)
    if not chosen:
        return _payload_from_row(None, status=SITUACAO_SEM_CDR, arquivo=None, files=[], atualizado=False)

    rel = chosen["relative_path"]
    mtime = chosen.get("mtime")
    size = chosen.get("size")
    row = _get_row(ano, nro, rel)

    fresh = bool(
        row
        and row.get("ObjetosJson") is not None
        and _mesmo_arquivo(row.get("ObjetosMtime"), row.get("ObjetosTamanho"), mtime, size)
    )
    status = STATUS_READY if fresh else (row.get("Status") if row else STATUS_PENDING)

    if not fresh or force_refresh:
        novo = _solicitar_leitura(ano, nro, rel, mtime, size, row, force=force_refresh)
        if novo:
            status = novo
            row = _get_row(ano, nro, rel) or row
        elif row and row.get("Status") == STATUS_FAILED:
            status = STATUS_FAILED

    if fresh and not force_refresh:
        status = STATUS_READY

    return _payload_from_row(
        row,
        status=status,
        arquivo=chosen,
        files=files,
        atualizado=fresh and status == STATUS_READY,
    )


def get_latest_snapshot_for_portal(ano: int, nro: int) -> Optional[dict[str, Any]]:
    """Último retrato pronto da OS (só banco — sem acesso à rede)."""
    ensure_os_cdr_campos_table()
    rows = db.execute_query(
        f"""
        SELECT ID, CaminhoRelativo, ObjetosJson, ExtraidoEm
        FROM {TABLE}
        WHERE AnoProtocolo = %(ano)s AND NroProtocolo = %(nro)s
          AND ObjetosJson IS NOT NULL
        ORDER BY ExtraidoEm DESC, ID DESC
        LIMIT 1
        """,
        {"ano": int(ano), "nro": int(nro)},
    )
    if not rows:
        return None
    objetos = _parse_objetos(rows[0].get("ObjetosJson"))
    if objetos is None:
        return None
    campos = build_campos_cdr(objetos)
    return {
        "relative_path": rows[0].get("CaminhoRelativo") or "",
        "campos": campos["campos"],
        "sem_nome": campos["sem_nome"],
    }


def resolver_alteracoes(
    objetos: list[dict[str, Any]],
    *,
    textos: Optional[dict[str, Any]] = None,
    sem_nome: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """
    Converte pedidos da UI/portal em edições por objeto para o worker:
    ``[{static_id, pagina, nome_atual, texto?, novo_nome?}]``.
    Só inclui o que realmente muda.
    """
    por_id = {(int(o["pagina"]), int(o["static_id"])): o for o in objetos}
    campos = build_campos_cdr(objetos)
    campos_por_key = {c["key"]: c for c in campos["campos"]}
    nomes_existentes = {
        normalizar_nome_objeto(o.get("nome") or "")
        for o in objetos
        if (o.get("nome") or "").strip()
    }

    edits: dict[tuple[int, int], dict[str, Any]] = {}

    def _edit_for(obj: dict[str, Any]) -> dict[str, Any]:
        ident = (int(obj["pagina"]), int(obj["static_id"]))
        if ident not in edits:
            edits[ident] = {
                "static_id": int(obj["static_id"]),
                "pagina": int(obj["pagina"]),
                "nome_atual": obj.get("nome") or "",
            }
        return edits[ident]

    for key, value in (textos or {}).items():
        campo = campos_por_key.get(str(key))
        if not campo:
            raise ValueError(f"Campo do Corel não encontrado: {key}")
        novo = _limpar_texto(value, 2000)
        for alvo in campo["alvos"]:
            obj = por_id.get((int(alvo["pagina"]), int(alvo["static_id"])))
            if obj is None:
                continue
            if (obj.get("texto") or "") != novo:
                _edit_for(obj)["texto"] = novo

    novos_nomes: set[str] = set()
    for item in sem_nome or []:
        if not isinstance(item, dict):
            continue
        ident = (_as_int(item.get("pagina")), _as_int(item.get("static_id")))
        obj = por_id.get(ident)
        if obj is None:
            raise ValueError("Texto do Corel não encontrado (o arquivo mudou?). Atualize os campos.")
        if (obj.get("nome") or "").strip():
            raise ValueError(f"O objeto já tem nome: {obj.get('nome')}.")
        texto = item.get("texto")
        if texto is not None:
            novo = _limpar_texto(texto, 2000)
            if (obj.get("texto") or "") != novo:
                _edit_for(obj)["texto"] = novo
        nome = item.get("nome")
        if nome is not None and str(nome).strip():
            limpo = validar_nome_novo(str(nome))
            norm = normalizar_nome_objeto(limpo)
            if norm in nomes_existentes:
                raise ValueError(f"Já existe um objeto chamado '{limpo}' neste arquivo.")
            if norm in novos_nomes:
                raise ValueError(f"Nome repetido: '{limpo}'.")
            novos_nomes.add(norm)
            _edit_for(obj)["novo_nome"] = limpo

    return [e for e in edits.values() if "texto" in e or "novo_nome" in e]


def preparar_edicoes_para_job(
    ano: int,
    nro: int,
    arquivo_cdr: Optional[str],
    *,
    textos: Optional[dict[str, Any]] = None,
    sem_nome: Optional[list[dict[str, Any]]] = None,
) -> tuple[str, list[dict[str, Any]]]:
    """
    Valida que o retrato está atualizado para o arquivo escolhido e devolve
    (caminho_relativo, edições). Erros de arquivo desatualizado viram
    ``StaleCdrSnapshotError`` (HTTP 409 na rota).
    """
    ensure_os_cdr_campos_table()
    files = _list_os_cdrs_cached(ano, nro, bypass_cache=True)
    chosen = _pick_file(files, arquivo_cdr)
    if not chosen:
        raise FileNotFoundError("Nenhum arquivo Corel (.cdr) utilizável na pasta da OS.")
    row = _get_row(ano, nro, chosen["relative_path"])
    objetos = _parse_objetos(row.get("ObjetosJson")) if row else None
    if objetos is None or not _mesmo_arquivo(
        row.get("ObjetosMtime"), row.get("ObjetosTamanho"), chosen.get("mtime"), chosen.get("size")
    ):
        _solicitar_leitura(
            ano, nro, chosen["relative_path"], chosen.get("mtime"), chosen.get("size"), row, force=True
        )
        raise StaleCdrSnapshotError(
            "O arquivo Corel mudou desde a última leitura. Aguarde a atualização dos campos "
            "e confira os textos antes de aplicar."
        )
    edits = resolver_alteracoes(objetos, textos=textos, sem_nome=sem_nome)
    return chosen["relative_path"], edits


class StaleCdrSnapshotError(RuntimeError):
    """Retrato não corresponde ao arquivo atual."""


# --------------------------------------------------------------------------- #
# Worker
# --------------------------------------------------------------------------- #


def _broadcast_update(ano: int, nro: int, status: str) -> None:
    try:
        from routers.realtime import schedule_broadcast

        schedule_broadcast(
            {
                "type": "papelaria_cdr_campos_update",
                "ano": int(ano),
                "nro": int(nro),
                "status": status,
            }
        )
    except Exception as exc:
        logger.debug("Broadcast papelaria_cdr_campos_update falhou: %s", exc)


def _sweep_stale_processing() -> None:
    global _last_stale_sweep
    now = time.monotonic()
    if now - _last_stale_sweep < 60:
        return
    _last_stale_sweep = now
    try:
        db.execute_query(
            f"""
            UPDATE {TABLE}
            SET Status = %(pending)s, WorkerID = NULL, SolicitadoEm = NOW()
            WHERE Status = %(processing)s
              AND IniciadoEm < (NOW() - INTERVAL {int(PROCESSING_STALE_SEC)} SECOND)
            """,
            {"pending": STATUS_PENDING, "processing": STATUS_PROCESSING},
        )
    except Exception as exc:
        logger.warning("Varredura de leituras CDR presas falhou: %s", exc)


def claim_scan_for_worker(worker_id: str) -> Optional[dict[str, Any]]:
    ensure_os_cdr_campos_table()
    wid = (worker_id or "").strip()
    if not wid:
        raise ValueError("worker_id é obrigatório.")
    _sweep_stale_processing()

    # Consulta barata sem lock: a maioria das chamadas não encontra nada.
    probe = db.execute_query(
        f"SELECT ID FROM {TABLE} WHERE Status = %(pending)s LIMIT 1",
        {"pending": STATUS_PENDING},
    )
    if not probe:
        return None

    def _claim(cursor) -> Optional[dict[str, Any]]:
        cursor.execute(
            f"""
            SELECT ID, AnoProtocolo, NroProtocolo, CaminhoRelativo
            FROM {TABLE}
            WHERE Status = %(pending)s
            ORDER BY SolicitadoEm ASC, ID ASC
            LIMIT 1
            FOR UPDATE
            """,
            {"pending": STATUS_PENDING},
        )
        row = cursor.fetchone()
        if not row:
            return None
        cursor.execute(
            f"""
            UPDATE {TABLE}
            SET Status = %(processing)s, WorkerID = %(wid)s, IniciadoEm = NOW(),
                Tentativas = Tentativas + 1
            WHERE ID = %(id)s AND Status = %(pending)s
            """,
            {"processing": STATUS_PROCESSING, "wid": wid, "id": row["ID"], "pending": STATUS_PENDING},
        )
        if cursor.rowcount == 0:
            return None
        return row

    results = db.execute_transaction([_claim])
    row = results[0] if results else None
    if not row:
        return None

    from services.papelaria_jobs_service import resolve_os_relative_cdr_path

    ano = int(row["AnoProtocolo"])
    nro = int(row["NroProtocolo"])
    rel = row["CaminhoRelativo"]
    try:
        abs_path = resolve_os_relative_cdr_path(ano, nro, rel)
    except (LookupError, FileNotFoundError, ValueError) as exc:
        _mark_failed(int(row["ID"]), wid, str(exc))
        return None
    return {
        "scan_id": int(row["ID"]),
        "ano": ano,
        "nro": nro,
        "relative_path": rel,
        "cdr_path": abs_path,
    }


def _row_by_id(scan_id: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        f"""
        SELECT ID, AnoProtocolo, NroProtocolo, CaminhoRelativo, Status, WorkerID
        FROM {TABLE} WHERE ID = %(id)s LIMIT 1
        """,
        {"id": int(scan_id)},
    )
    return rows[0] if rows else None


def _mark_failed(scan_id: int, worker_id: str, erro: str) -> None:
    db.execute_query(
        f"""
        UPDATE {TABLE}
        SET Status = %(failed)s, Erro = %(erro)s
        WHERE ID = %(id)s AND Status = %(processing)s AND WorkerID = %(wid)s
        """,
        {
            "failed": STATUS_FAILED,
            "erro": (erro or "Falha desconhecida.")[:4000],
            "id": int(scan_id),
            "processing": STATUS_PROCESSING,
            "wid": (worker_id or "").strip(),
        },
    )


def _objetos_json(objetos: list[dict[str, Any]]) -> str:
    payload = json.dumps(objetos, ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_OBJETOS_JSON_BYTES:
        raise ValueError("Retrato do Corel excede o tamanho máximo permitido.")
    return payload


def complete_scan(
    scan_id: int,
    worker_id: str,
    objetos: Any,
    mtime: Optional[float],
    size: Optional[int],
) -> dict[str, Any]:
    ensure_os_cdr_campos_table()
    row = _row_by_id(scan_id)
    if not row:
        raise LookupError("Leitura não encontrada.")
    if row.get("Status") != STATUS_PROCESSING or (row.get("WorkerID") or "") != worker_id.strip():
        raise ValueError("Leitura não está em processamento por este worker.")
    normalized = normalize_objetos(objetos)
    db.execute_query(
        f"""
        UPDATE {TABLE}
        SET Status = %(ready)s, ObjetosJson = %(obj)s, ObjetosMtime = %(mtime)s,
            ObjetosTamanho = %(size)s, Erro = NULL, ExtraidoEm = NOW(), Tentativas = 0
        WHERE ID = %(id)s
        """,
        {
            "ready": STATUS_READY,
            "obj": _objetos_json(normalized),
            "mtime": mtime,
            "size": size,
            "id": int(scan_id),
        },
    )
    ano, nro = int(row["AnoProtocolo"]), int(row["NroProtocolo"])
    invalidate_os_cache(ano, nro)
    _broadcast_update(ano, nro, STATUS_READY)
    return {"ok": True, "total_objetos": len(normalized)}


def fail_scan(scan_id: int, worker_id: str, erro: str) -> dict[str, Any]:
    ensure_os_cdr_campos_table()
    row = _row_by_id(scan_id)
    if not row:
        raise LookupError("Leitura não encontrada.")
    _mark_failed(int(scan_id), worker_id, erro)
    _broadcast_update(int(row["AnoProtocolo"]), int(row["NroProtocolo"]), STATUS_FAILED)
    return {"ok": True}


def push_snapshot_from_worker(
    ano: int,
    nro: int,
    cdr_path: str,
    objetos: Any,
    mtime: Optional[float],
    size: Optional[int],
) -> dict[str, Any]:
    """
    Worker acabou de gravar o .cdr (geração/edição) e já conhece os objetos:
    registra o retrato sem nova leitura no Corel.
    """
    ensure_os_cdr_campos_table()
    from routers.os_routes import _get_os_folder_path
    from services.papelaria_jobs_service import (
        _assert_file_under_os_root,
        _is_usable_os_cdr_filename,
        _relative_cdr_from_os_root,
    )

    os_path = _get_os_folder_path(int(ano), int(nro))
    if not os_path:
        raise LookupError("Pasta da OS não encontrada na rede.")
    os_root = os.path.normpath(os_path)
    real = _assert_file_under_os_root(os.path.normpath(cdr_path), os_root)
    if not _is_usable_os_cdr_filename(os.path.basename(real)):
        raise ValueError("Arquivo Corel inválido.")
    rel = _relative_cdr_from_os_root(os_root, real)
    normalized = normalize_objetos(objetos)
    db.execute_query(
        f"""
        INSERT INTO {TABLE}
            (AnoProtocolo, NroProtocolo, CaminhoRelativo, ArquivoMtime, ArquivoTamanho,
             Status, ObjetosJson, ObjetosMtime, ObjetosTamanho, ExtraidoEm, SolicitadoEm)
        VALUES (%(ano)s, %(nro)s, %(rel)s, %(mtime)s, %(size)s, %(ready)s, %(obj)s,
                %(mtime)s, %(size)s, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
            ArquivoMtime = VALUES(ArquivoMtime),
            ArquivoTamanho = VALUES(ArquivoTamanho),
            Status = VALUES(Status),
            ObjetosJson = VALUES(ObjetosJson),
            ObjetosMtime = VALUES(ObjetosMtime),
            ObjetosTamanho = VALUES(ObjetosTamanho),
            ExtraidoEm = NOW(),
            Erro = NULL,
            WorkerID = NULL,
            Tentativas = 0
        """,
        {
            "ano": int(ano),
            "nro": int(nro),
            "rel": rel,
            "mtime": mtime,
            "size": size,
            "ready": STATUS_READY,
            "obj": _objetos_json(normalized),
        },
    )
    invalidate_os_cache(ano, nro)
    _broadcast_update(int(ano), int(nro), STATUS_READY)
    return {"ok": True, "relative_path": rel, "total_objetos": len(normalized)}
