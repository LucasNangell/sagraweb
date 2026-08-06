from fastapi import APIRouter, HTTPException, Query
from database import db
import logging
from pydantic import BaseModel
from typing import Optional

router = APIRouter()
logger = logging.getLogger(__name__)

class NotificationRead(BaseModel):
    ponto: str

@router.get("/notifications")
def get_notifications(ponto: str = Query(...)):
    """
    Retorna notificações NÃO LIDAS para um usuário específico.
    """
    try:
        # Limpar formatação do ponto (deixar apenas números)
        clean_ponto = ''.join(filter(str.isdigit, ponto))
        
        # O ponto no banco pode estar formatado ou não. 
        # Idealmente o sync script grava formatado se pegar do tabAndamento?
        # Vamos tentar buscar com LIKE ou igualdade flexível se necessário.
        # Mas o sync script pega direto do banco, provavelmente vem como string "91.871-3" ou "918713".
        # Vamos assumir que o frontend manda limpo ou formatado e tentamos os dois.
        
        # Buscamos por match exato ou match limpo
        # Buscamos por match robusto: comparamos o Ponto limpo do banco com o Ponto limpo da entrada
        # REPLACE(REPLACE(Ponto, '.', ''), '-', '') remove formatação do campo do banco
        query = """
            SELECT Id, NroProtocolo, AnoProtocolo, Mensagem, DetalhesJson, DataCriacao
            FROM tabNotificacoes
            WHERE (
                Ponto = %s 
                OR REPLACE(REPLACE(Ponto, '.', ''), '-', '') = %s
            )
              AND Lida = 0
            ORDER BY DataCriacao DESC
        """
        # Passa o ponto original e o limpo. Se o banco guardou '918713' (limpo), e vem '91.871-3', 
        # o segundo termo (clean_ponto) vai casar com o Ponto do banco se assumirmos que o ponto do banco ja é limpo?
        # NÃO. Se o banco tem '918713', REPLACE nele dá '918713'. clean_ponto é '918713'. Match!
        
        # Se o banco tem '91.871-3', REPLACE dá '918713'. Match!
        
        results = db.execute_query(query, (ponto, clean_ponto))
        return results
    except Exception as e:
        logger.error(f"Error fetching notifications: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/notifications/{id}/read")
def mark_notification_read(id: int):
    """
    Marca uma notificação como lida.
    """
    try:
        query = "UPDATE tabNotificacoes SET Lida = 1 WHERE Id = %s"
        db.execute_query(query, (id,))
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error marking notification read: {e}")
        raise HTTPException(status_code=500, detail=str(e))
