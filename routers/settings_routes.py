from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import json
from database import db
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

class Content(BaseModel):
    usuario: str
    ponto: str
    situacoes: List[str]
    setores: List[str]


@router.post("/settings/filtros/salvar")
def save_user_filters(req: Content):
    def transaction(cursor):
        # Serializar
        sit_json = json.dumps(req.situacoes)
        set_json = json.dumps(req.setores)
        
        # Upsert (Insert on Duplicate Key Update)
        # Chave única é Ponto
        sql = """
        INSERT INTO tabUserFilterSettings (Usuario, Ponto, Situacoes, Setores, DataAtualizacao)
        VALUES (%s, %s, %s, %s, NOW())
        ON DUPLICATE KEY UPDATE
            Usuario = VALUES(Usuario),
            Situacoes = VALUES(Situacoes),
            Setores = VALUES(Setores),
            DataAtualizacao = NOW()
        """
        cursor.execute(sql, (req.usuario, req.ponto, sit_json, set_json))
        return {"status": "success"}

    try:
        return db.execute_transaction([transaction])[0]
    except Exception as e:
        logger.error(f"Erro ao salvar filtros: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/settings/filtros/ponto/{identifier}")
def get_user_filters(identifier: str):
    """
    Retorna as preferências de filtro.
    Identifier interpretado como 'Ponto' (rota agora em /settings/filtros/ponto/{identifier}).
    """
    try:
        query = "SELECT Usuario, Ponto, Situacoes, Setores FROM tabUserFilterSettings WHERE Ponto = %s"
        res = db.execute_query(query, (identifier,))
        
        if res:
            row = res[0]
            try:
                situacoes = json.loads(row['Situacoes']) if row['Situacoes'] else []
            except:
                situacoes = []
            
            try:
                setores = json.loads(row['Setores']) if row['Setores'] else []
            except:
                setores = []
                
            return {
                "usuario": row['Usuario'],
                "ponto": row['Ponto'],
                "situacoes": situacoes,
                "setores": setores
            }
        
        # Padrão Vazio se não encontrar
        return {
            "usuario": "Desconhecido", # Frontend vai ignorar ou usar o que tem
            "ponto": identifier,
            "situacoes": [],
            "setores": []
        }
    except Exception as e:
        logger.error(f"Erro ao buscar filtros: {e}")
        raise HTTPException(status_code=500, detail=str(e))
