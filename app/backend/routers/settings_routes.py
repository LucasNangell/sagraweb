from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import json
from database import db
import logging

from security.session_auth import SessionData, require_session
from routers.setor_painel_routes import fetch_setor_painel_default, fetch_user_setor

router = APIRouter()
logger = logging.getLogger(__name__)

VALID_PREFERENCE_KEYS = frozenset({
    "painel_global",
    "painel_setor",
    "os_filter_toggles",
    "painel_theme",
})


def _session_ponto_str(session: SessionData) -> str:
    return str(session.ponto)


def _assert_ponto_matches(session: SessionData, ponto: str) -> str:
    normalized = str(ponto).strip()
    if normalized != _session_ponto_str(session):
        raise HTTPException(status_code=403, detail="Ponto não corresponde à sessão.")
    return normalized


class PreferenceBody(BaseModel):
    payload: Any

# --- Models ---
VALID_FILTER_CONTEXTS = frozenset({"os", "cotas_graf"})


def _normalize_filter_context(context: str | None) -> str:
    normalized = (context or "os").strip().lower()
    if normalized not in VALID_FILTER_CONTEXTS:
        raise HTTPException(status_code=400, detail="Contexto de filtro inválido.")
    return normalized


class SavedFilterCriterios(BaseModel):
    """Critérios extras além de situacoes/setores (compatível: omitidos = vazio)."""

    nr_os: Optional[int] = None
    anos: List[int] = Field(default_factory=list)
    processo: str = ""
    categorias: List[str] = Field(default_factory=list)
    solicitantes: List[str] = Field(default_factory=list)
    titulo: str = ""
    produtos: List[str] = Field(default_factory=list)
    maquinas: List[str] = Field(default_factory=list)
    prioridade: List[str] = Field(default_factory=list)


def _empty_criterios() -> Dict[str, Any]:
    return SavedFilterCriterios().model_dump()


def _parse_json_list(raw: Any) -> List[Any]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        if not raw.strip():
            return []
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    return []


def _parse_criterios(raw: Any) -> Dict[str, Any]:
    base = _empty_criterios()
    if raw is None:
        return base
    data = raw
    if isinstance(raw, str):
        if not raw.strip():
            return base
        try:
            data = json.loads(raw)
        except Exception:
            return base
    if not isinstance(data, dict):
        return base
    try:
        return SavedFilterCriterios.model_validate(data).model_dump()
    except Exception:
        return base


def _serialize_criterios(criterios: Optional[SavedFilterCriterios]) -> str:
    payload = criterios.model_dump() if criterios is not None else _empty_criterios()
    return json.dumps(payload, ensure_ascii=False)


class SaveFilterRequest(BaseModel):
    usuario: str
    ponto: str
    nome: str
    situacoes: List[str]
    setores: List[str]
    context: str = "os"
    criterios: Optional[SavedFilterCriterios] = None


class SetDefaultRequest(BaseModel):
    ponto: str
    filter_id: int
    context: str = "os"


class UpdateFilterRequest(BaseModel):
    nome: str
    situacoes: List[str]
    setores: List[str]
    criterios: Optional[SavedFilterCriterios] = None


# Legacy support
class Content(BaseModel):
    usuario: str
    ponto: str
    situacoes: List[str]
    setores: List[str]


# --- Preferências de UI por usuário ---

def _ensure_user_preferences_table() -> None:
    from user_preferences_schema import ensure_user_preferences_schema

    ensure_user_preferences_schema()


@router.get("/settings/preferences/{key}")
def get_user_preference(
    key: str,
    session: SessionData = Depends(require_session),
):
    if key not in VALID_PREFERENCE_KEYS:
        raise HTTPException(status_code=400, detail="Chave de preferência inválida.")
    try:
        _ensure_user_preferences_table()
        query = """
            SELECT Payload FROM tabUserPreferences
            WHERE Ponto = %s AND PreferenceKey = %s
            LIMIT 1
        """
        rows = db.execute_query(query, (_session_ponto_str(session), key))
        if not rows:
            if key == "painel_setor":
                user_setor = fetch_user_setor(session.ponto)
                if user_setor:
                    sector_default = fetch_setor_painel_default(user_setor)
                    if sector_default is not None:
                        if isinstance(sector_default, dict):
                            sector_default = {**sector_default, "sector": user_setor}
                        return {"payload": sector_default}
            return {"payload": None}
        raw = rows[0]["Payload"]
        if isinstance(raw, str):
            payload = json.loads(raw)
        elif isinstance(raw, dict):
            payload = raw
        else:
            payload = raw
        return {"payload": payload}
    except Exception as e:
        logger.error(f"Erro ao buscar preferência {key}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/settings/preferences/{key}")
def put_user_preference(
    key: str,
    body: PreferenceBody,
    session: SessionData = Depends(require_session),
):
    if key not in VALID_PREFERENCE_KEYS:
        raise HTTPException(status_code=400, detail="Chave de preferência inválida.")
    try:
        _ensure_user_preferences_table()
        sql = """
            INSERT INTO tabUserPreferences (Ponto, PreferenceKey, Payload, DataAtualizacao)
            VALUES (%s, %s, %s, NOW())
            ON DUPLICATE KEY UPDATE
                Payload = VALUES(Payload),
                DataAtualizacao = NOW()
        """
        db.execute_query(
            sql,
            (_session_ponto_str(session), key, json.dumps(body.payload)),
        )
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Erro ao salvar preferência {key}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- Rotas CRUD Filtros Salvos ---

@router.get("/settings/filters/saved/{ponto}")
def list_saved_filters(
    ponto: str,
    context: str = Query("os"),
    session: SessionData = Depends(require_session),
):
    _assert_ponto_matches(session, ponto)
    filter_context = _normalize_filter_context(context)
    try:
        query = """
            SELECT ID, Nome, Situacoes, Setores, IsDefault, Criterios
            FROM tabUserSavedFilters 
            WHERE Ponto = %s AND FilterContext = %s
            ORDER BY IsDefault DESC, Nome ASC
        """
        rows = db.execute_query(query, (ponto, filter_context))
        
        results = []
        for row in rows:
            try:
                results.append({
                    "id": row['ID'],
                    "nome": row['Nome'],
                    "situacoes": _parse_json_list(row.get('Situacoes')),
                    "setores": _parse_json_list(row.get('Setores')),
                    "criterios": _parse_criterios(row.get('Criterios')),
                    "is_default": bool(row['IsDefault'])
                })
            except Exception as parse_err:
                logger.error(f"Error parsing filter row {row.get('ID')}: {parse_err}")
                continue
                
        return results
    except Exception as e:
        logger.error(f"Error listing saved filters: {e}")
        return []

@router.post("/settings/filters/saved")
def create_saved_filter(
    req: SaveFilterRequest,
    session: SessionData = Depends(require_session),
):
    _assert_ponto_matches(session, req.ponto)
    filter_context = _normalize_filter_context(req.context)
    try:
        # Check if it's the first filter for this user/context
        check_query = """
            SELECT COUNT(*) as count
            FROM tabUserSavedFilters
            WHERE Ponto = %s AND FilterContext = %s
        """
        count_res = db.execute_query(check_query, (req.ponto, filter_context))
        is_first = (count_res[0]['count'] == 0) if count_res else True
        is_default = 1 if is_first else 0

        sql = """
            INSERT INTO tabUserSavedFilters
                (Ponto, Nome, Situacoes, Setores, IsDefault, FilterContext, Criterios)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """
        params = (
            req.ponto, 
            req.nome, 
            json.dumps(req.situacoes), 
            json.dumps(req.setores), 
            is_default,
            filter_context,
            _serialize_criterios(req.criterios),
        )
        
        db.execute_query(sql, params)
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error creating saved filter: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/settings/filters/saved/default")
def set_default_filter(
    req: SetDefaultRequest,
    session: SessionData = Depends(require_session),
):
    _assert_ponto_matches(session, req.ponto)
    filter_context = _normalize_filter_context(req.context)
    def transaction(cursor):
        # 1. Set all to 0 for this user/context
        cursor.execute(
            "UPDATE tabUserSavedFilters SET IsDefault = 0 WHERE Ponto = %s AND FilterContext = %s",
            (req.ponto, filter_context),
        )
        # 2. Set target to 1
        cursor.execute(
            """
            UPDATE tabUserSavedFilters
            SET IsDefault = 1
            WHERE Ponto = %s AND ID = %s AND FilterContext = %s
            """,
            (req.ponto, req.filter_id, filter_context),
        )
        return {"status": "success"}

    try:
        return db.execute_transaction([transaction])[0]
    except Exception as e:
        logger.error(f"Error setting default filter: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/settings/filters/saved/{filter_id}")
def update_saved_filter(
    filter_id: int,
    req: UpdateFilterRequest,
    session: SessionData = Depends(require_session),
):
    nome = (req.nome or "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Digite um nome para o filtro.")
    try:
        rows = db.execute_query(
            "SELECT Ponto FROM tabUserSavedFilters WHERE ID = %s",
            (filter_id,),
        )
        if not rows or str(rows[0]["Ponto"]) != _session_ponto_str(session):
            raise HTTPException(status_code=404, detail="Filtro não encontrado.")
        if req.criterios is not None:
            db.execute_query(
                """
                UPDATE tabUserSavedFilters
                SET Nome = %s, Situacoes = %s, Setores = %s, Criterios = %s
                WHERE ID = %s
                """,
                (
                    nome,
                    json.dumps(req.situacoes),
                    json.dumps(req.setores),
                    _serialize_criterios(req.criterios),
                    filter_id,
                ),
            )
        else:
            db.execute_query(
                """
                UPDATE tabUserSavedFilters
                SET Nome = %s, Situacoes = %s, Setores = %s
                WHERE ID = %s
                """,
                (nome, json.dumps(req.situacoes), json.dumps(req.setores), filter_id),
            )
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating saved filter: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/settings/filters/saved/{filter_id}")
@router.post("/settings/filters/saved/{filter_id}/delete")
def delete_saved_filter(
    filter_id: int,
    session: SessionData = Depends(require_session),
):
    try:
        rows = db.execute_query(
            "SELECT Ponto FROM tabUserSavedFilters WHERE ID = %s",
            (filter_id,),
        )
        if not rows or str(rows[0]["Ponto"]) != _session_ponto_str(session):
            raise HTTPException(status_code=404, detail="Filtro não encontrado.")
        db.execute_query("DELETE FROM tabUserSavedFilters WHERE ID = %s", (filter_id,))
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting saved filter: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- Compatibilidade / Rotas Existentes ---

@router.post("/settings/filtros/salvar")
def save_user_filters_legacy(
    req: Content,
    session: SessionData = Depends(require_session),
):
    _assert_ponto_matches(session, req.ponto)
    """
    Mantém compatibilidade. Salva/Atualiza um filtro chamado "Padrão" 
    e o define como default na nova tabela.
    Também atualiza a tabela antiga por segurança.
    """
    try:
        # 1. Update Legacy Table
        def transaction(cursor):
            sit_json = json.dumps(req.situacoes)
            set_json = json.dumps(req.setores)
            
            # Legacy Table Upsert
            sql_legacy = """
            INSERT INTO tabUserFilterSettings (Usuario, Ponto, Situacoes, Setores, DataAtualizacao)
            VALUES (%s, %s, %s, %s, NOW())
            ON DUPLICATE KEY UPDATE
                Usuario = VALUES(Usuario),
                Situacoes = VALUES(Situacoes),
                Setores = VALUES(Setores),
                DataAtualizacao = NOW()
            """
            cursor.execute(sql_legacy, (req.usuario, req.ponto, sit_json, set_json))

            # 2. Update New Table logic (Sync "Padrão" filter)
            # Check if there is already a default filter. 
            # If user explicitly called "Save Preferences" (legacy), we might want to update the CURRENT default, 
            # Or creating a "Geral" filter if none exists.
            # Strategy: Upsert a filter named "Geral" and set as default.
            
            # Check if "Geral" exists
            cursor.execute("SELECT ID FROM tabUserSavedFilters WHERE Ponto = %s AND Nome = 'Geral' AND FilterContext = 'os'", (req.ponto,))
            row = cursor.fetchone()
            
            if row:
                # Update existing "Geral"
                cursor.execute("""
                    UPDATE tabUserSavedFilters 
                    SET Situacoes = %s, Setores = %s, IsDefault = 1, DataCriacao = NOW()
                    WHERE ID = %s
                """, (sit_json, set_json, row[0]))
                
                # Unset others
                cursor.execute("UPDATE tabUserSavedFilters SET IsDefault = 0 WHERE Ponto = %s AND FilterContext = 'os' AND ID != %s", (req.ponto, row[0]))
            else:
                 # Insert new "Geral"
                cursor.execute("UPDATE tabUserSavedFilters SET IsDefault = 0 WHERE Ponto = %s AND FilterContext = 'os'", (req.ponto,))
                cursor.execute("""
                    INSERT INTO tabUserSavedFilters (Ponto, Nome, Situacoes, Setores, IsDefault, FilterContext)
                    VALUES (%s, 'Geral', %s, %s, 1, 'os')
                """, (req.ponto, sit_json, set_json))

            return {"status": "success"}

        return db.execute_transaction([transaction])[0]
        
    except Exception as e:
        logger.error(f"Erro ao salvar filtros (legacy): {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/settings/filtros/ponto/{identifier}")
def get_user_filters(
    identifier: str,
    context: str = Query("os"),
    session: SessionData = Depends(require_session),
):
    _assert_ponto_matches(session, identifier)
    filter_context = _normalize_filter_context(context)
    """
    Retorna as preferências. Prioriza o filtro Default da nova tabela.
    Se não houver, tenta a tabela antiga.
    """
    try:
        # 1. Try New Table (Default Filter)
        query_new = """
            SELECT Situacoes, Setores, Nome, Criterios
            FROM tabUserSavedFilters
            WHERE Ponto = %s AND IsDefault = 1 AND FilterContext = %s
            LIMIT 1
        """
        res_new = db.execute_query(query_new, (identifier, filter_context))
        
        if res_new:
            row = res_new[0]
            return {
                "usuario": "Usuario", # Placeholder
                "ponto": identifier,
                "situacoes": _parse_json_list(row.get('Situacoes')),
                "setores": _parse_json_list(row.get('Setores')),
                "criterios": _parse_criterios(row.get('Criterios')),
                "nome_filtro": row['Nome']
            }

        # 2. Fallback to specific filter from Legacy Table (somente página inicial)
        if filter_context == "os":
            query = "SELECT Usuario, Ponto, Situacoes, Setores FROM tabUserFilterSettings WHERE Ponto = %s"
            res = db.execute_query(query, (identifier,))
            
            if res:
                row = res[0]
                try:
                    situacoes = json.loads(row['Situacoes']) if row['Situacoes'] else []
                except Exception:
                    situacoes = []
                
                try:
                    setores = json.loads(row['Setores']) if row['Setores'] else []
                except Exception:
                    setores = []
                    
                return {
                    "usuario": row['Usuario'],
                    "ponto": row['Ponto'],
                    "situacoes": situacoes,
                    "setores": setores,
                    "criterios": _empty_criterios(),
                    "nome_filtro": "Legado"
                }
        
        # 3. Empty default
        return {
            "usuario": "Desconhecido",
            "ponto": identifier,
            "situacoes": [],
            "setores": [],
            "criterios": _empty_criterios(),
        }
    except Exception as e:
        logger.error(f"Erro ao buscar filtros: {e}")
        raise HTTPException(status_code=500, detail=str(e))
