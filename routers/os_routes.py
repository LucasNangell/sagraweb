from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from pydantic import BaseModel
from database import db
import logging
import os
import glob
from datetime import datetime

router = APIRouter()
logger = logging.getLogger(__name__)

# Modelo para receber o usuário na duplicação
class DuplicateRequest(BaseModel):
    usuario: str

class HistoryItem(BaseModel):
    situacao: str
    setor: str
    obs: str
    usuario: str

# --- ADICIONE ESTE NOVO ENDPOINT ---
@router.post("/os/{ano}/{id}/duplicate")
def duplicate_os(ano: int, id: int, req: DuplicateRequest):
    """
    Duplica uma OS existente gerando um novo número sequencial
    baseado no tipo (Normal < 5000 ou Papelaria >= 5000).
    """
    
    def transaction_logic(cursor):
        # 1. Determinar range de numeração (Normal ou Papelaria)
        is_papelaria = id >= 5000
        current_year = datetime.now().year
        
        # 2. Encontrar o próximo ID disponível no ano CORRENTE
        if is_papelaria:
            cursor.execute("""
                SELECT MAX(NroProtocolo) as max_id 
                FROM tabProtocolos 
                WHERE AnoProtocolo = %s AND NroProtocolo >= 5000
            """, (current_year,))
        else:
            cursor.execute("""
                SELECT MAX(NroProtocolo) as max_id 
                FROM tabProtocolos 
                WHERE AnoProtocolo = %s AND NroProtocolo < 5000
            """, (current_year,))
            
        result = cursor.fetchone()
        max_id = result['max_id']
        
        if max_id:
            new_id = max_id + 1
        else:
            new_id = 5000 if is_papelaria else 1

        # 3. Copiar tabProtocolos
        # Selecionamos as colunas explicitamente para evitar erros de estrutura, 
        # mas injetamos o NEW_ID e NEW_YEAR
        cols_protocolo = """
            CodigoRequisic, CategoriaLink, NomeUsuario, Titular, SiglaOrgao, 
            GabSalaUsuario, Andar, Localizacao, RamalUsuario, OrgInteressado, CodUsuarioLink,
            DataEntrada, ProcessoSolicit, CSnro, CotaRepro, CotaCartao, 
            EntregPrazoLink, EntregData, ContatoTrab
        """
        
        query_proto = f"""
            INSERT INTO tabProtocolos (NroProtocolo, AnoProtocolo, {cols_protocolo})
            SELECT %s, %s, {cols_protocolo}
            FROM tabProtocolos 
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
        """
        cursor.execute(query_proto, (new_id, current_year, id, ano))

        # 4. Copiar tabDetalhesServico
        cols_detalhes = """
            TiragemSolicitada, Tiragem, CotaTotal, Titulo, TipoPublicacaoLink, 
            MaquinaLink, Pags, FrenteVerso, ModelosArq, PapelLink, PapelDescricao, 
            Cores, CoresDescricao, DescAcabamento, Observ, MaterialFornecido, 
            Fotolito, ModeloDobra, ProvaImpressa, InsumosFornecidos, 
            ElemGrafBrasao, ElemGrafTimbre, ElemGrafArteGab, ElemGrafAssinatura
        """
        
        # Nota: NroProtocoloLinkDet e AnoProtocoloLinkDet são as chaves estrangeiras/primárias aqui
        query_det = f"""
            INSERT INTO tabDetalhesServico (NroProtocoloLinkDet, AnoProtocoloLinkDet, {cols_detalhes})
            SELECT %s, %s, {cols_detalhes}
            FROM tabDetalhesServico 
            WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s
        """
        cursor.execute(query_det, (new_id, current_year, id, ano))

        # 5. Inserir Andamento Inicial
        # CodStatus geralmente é composto: IDANO-01 (ex: 001232025-01)
        new_cod_status = f"{new_id:05d}{current_year}-01"
        
        query_hist = """
            INSERT INTO tabAndamento 
            (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto)
            VALUES (%s, %s, %s, 'Entrada Inicial', 'SEFOC', NOW(), 1, 'Duplicado da OS ' || %s || '/' || %s, %s)
        """
        cursor.execute(query_hist, (new_cod_status, new_id, current_year, id, ano, req.usuario))

        return {"new_id": new_id, "new_year": current_year}

    try:
        # Executa tudo atomicamente
        result = db.execute_transaction([transaction_logic])
        return result[0]
    except Exception as e:
        logger.error(f"Duplicate error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        
@router.get("/os/search")
def search_os(
    nr_os: Optional[int] = None,
    ano: Optional[int] = None,
    produto: Optional[str] = None,
    titulo: Optional[str] = None,
    solicitante: Optional[str] = None,
    situacao: Optional[List[str]] = Query(None),
    setor: Optional[List[str]] = Query(None),
    include_finished: bool = False,
    page: int = 1,
    limit: int = 16
):
    filters = " WHERE a.UltimoStatus = 1"
    params = {}
    
    if not include_finished:
        filters += " AND a.SituacaoLink NOT IN ('Entregue', 'Cancelada', 'Cancelado')"
    
    if nr_os:
        filters += " AND p.NroProtocolo = %(nr_os)s"
        params['nr_os'] = nr_os
    if ano:
        filters += " AND p.AnoProtocolo = %(ano)s"
        params['ano'] = ano
    if produto:
        filters += " AND d.TipoPublicacaoLink LIKE %(produto)s"
        params['produto'] = f"%{produto}%"
    if titulo:
        filters += " AND d.Titulo LIKE %(titulo)s"
        params['titulo'] = f"%{titulo}%"
    if solicitante:
        filters += " AND p.NomeUsuario LIKE %(solicitante)s"
        params['solicitante'] = f"%{solicitante}%"
    
    if situacao:
        clean_situacao = [s.strip() for s in situacao if s and s.strip()]
        if clean_situacao:
            placeholders = ', '.join([f'%(situacao_{i})s' for i in range(len(clean_situacao))])
            filters += f" AND a.SituacaoLink IN ({placeholders})"
            for i, s in enumerate(clean_situacao):
                params[f'situacao_{i}'] = s

    if setor:
        clean_setor = [s.strip() for s in setor if s and s.strip()]
        if clean_setor:
            placeholders = ', '.join([f'%(setor_{i})s' for i in range(len(clean_setor))])
            filters += f" AND a.SetorLink IN ({placeholders})"
            for i, s in enumerate(clean_setor):
                params[f'setor_{i}'] = s

    count_query = f"""
    SELECT COUNT(*) as total
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d ON (p.NroProtocolo = d.NroProtocoloLinkDet) AND (p.AnoProtocolo = d.AnoProtocoloLinkDet)
    LEFT JOIN tabAndamento AS a ON (p.NroProtocolo = a.NroProtocoloLink) AND (p.AnoProtocolo = a.AnoProtocoloLink)
    {filters}
    """
    
    offset = (page - 1) * limit
    data_query = f"""
    SELECT 
        p.NroProtocolo AS nr_os, 
        p.AnoProtocolo AS ano, 
        d.Titulo AS titulo, 
        p.NomeUsuario AS solicitante,
        a.SituacaoLink AS situacao, 
        p.EntregPrazoLink AS prioridade,
        d.TipoPublicacaoLink AS produto,
        a.SetorLink AS setor,
        p.EntregData AS data_entrega
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d ON (p.NroProtocolo = d.NroProtocoloLinkDet) AND (p.AnoProtocolo = d.AnoProtocoloLinkDet)
    LEFT JOIN tabAndamento AS a ON (p.NroProtocolo = a.NroProtocoloLink) AND (p.AnoProtocolo = a.AnoProtocoloLink)
    {filters}
    ORDER BY 
        CASE 
            WHEN p.EntregPrazoLink LIKE '%%Prometido p/%%' THEN 0 
            WHEN p.EntregPrazoLink LIKE '%%Solicitado p/%%' THEN 1 
            ELSE 2 
        END ASC,
        p.EntregData ASC,
        p.AnoProtocolo DESC, 
        p.NroProtocolo DESC
    LIMIT %(limit)s OFFSET %(offset)s
    """
    
    params['limit'] = limit
    params['offset'] = offset

    try:
        count_result = db.execute_query(count_query, params)
        total_records = count_result[0]['total'] if count_result else 0
        total_pages = (total_records + limit - 1) // limit
        data_results = db.execute_query(data_query, params)
        
        return {
            "data": data_results,
            "meta": {"page": page, "limit": limit, "total_records": total_records, "total_pages": total_pages}
        }
    except Exception as e:
        logger.error(f"Error in search_os: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/os/{ano}/{id}/details")
def get_os_details(ano: int, id: int):
    query = """
    SELECT 
        p.CodigoRequisic AS CodigoRequisicao, p.CategoriaLink, p.NomeUsuario, p.Titular, p.SiglaOrgao, 
        p.GabSalaUsuario, p.Andar, p.Localizacao, p.RamalUsuario, p.OrgInteressado, p.CodUsuarioLink,
        p.NroProtocolo, p.AnoProtocolo, p.DataEntrada, p.ProcessoSolicit, p.CSnro,
        d.TiragemSolicitada, d.Tiragem AS TiragemFinal, p.CotaRepro, p.CotaCartao, d.CotaTotal,
        d.Titulo, d.TipoPublicacaoLink, d.MaquinaLink, d.Tiragem, d.Pags, d.FrenteVerso, d.ModelosArq,
        p.EntregPrazoLink, p.EntregData, d.PapelLink, d.PapelDescricao, d.Cores, d.CoresDescricao, 
        d.DescAcabamento, d.Observ, p.ContatoTrab, d.MaterialFornecido, d.Fotolito, d.ModeloDobra,
        d.ProvaImpressa, d.InsumosFornecidos, md.MidiaDigitalLink, md.MidiaDigitDescricao,
        d.ElemGrafBrasao, d.ElemGrafTimbre, d.ElemGrafArteGab, d.ElemGrafAssinatura
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d ON (p.NroProtocolo = d.NroProtocoloLinkDet) AND (p.AnoProtocolo = d.AnoProtocoloLinkDet)
    LEFT JOIN tabMidiaDigital AS md ON (p.NroProtocolo = md.NroProtocoloLinkMidia) AND (p.AnoProtocolo = md.AnoProtocoloLinkMidia)
    WHERE p.NroProtocolo = %(id)s AND p.AnoProtocolo = %(ano)s
    """
    try:
        results = db.execute_query(query, {'id': id, 'ano': ano})
        if not results: raise HTTPException(status_code=404, detail="OS not found")
        return results[0]
    except Exception as e:
        logger.error(f"Error fetching details: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/os/{ano}/{id}/history")
def get_os_history(ano: int, id: int):
    query = "SELECT CodStatus, SituacaoLink, SetorLink, Data, Ponto, Observaçao FROM tabAndamento WHERE NroProtocoloLink = %(id)s AND AnoProtocoloLink = %(ano)s ORDER BY CodStatus"
    try:
        return db.execute_query(query, {'id': id, 'ano': ano})
    except Exception as e:
        logger.error(f"Error fetching history: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/os/{ano}/{id}/history")
def add_os_history(ano: int, id: int, item: HistoryItem):
    def transaction_logic(cursor):
        cursor.execute("UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %(id)s AND AnoProtocoloLink = %(ano)s", {'id': id, 'ano': ano})
        cursor.execute("SELECT COUNT(*) as count FROM tabAndamento WHERE NroProtocoloLink = %(id)s AND AnoProtocoloLink = %(ano)s", {'id': id, 'ano': ano})
        result = cursor.fetchone()
        count = result['count'] if result else 0
        new_cod = f"{id:05d}{ano}-{count + 1:02d}"
        cursor.execute(
            "INSERT INTO tabAndamento (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto) VALUES (%(cod)s, %(id)s, %(ano)s, %(situacao)s, %(setor)s, NOW(), 1, %(obs)s, %(usuario)s)",
            {'cod': new_cod, 'id': id, 'ano': ano, 'situacao': item.situacao, 'setor': item.setor, 'obs': item.obs, 'usuario': item.usuario}
        )
        return {"new_id": new_cod}
    try:
        return db.execute_transaction([transaction_logic])[0]
    except Exception as e:
        logger.error(f"Transaction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/os/{ano}/{id}/history/{cod_status}")
def delete_os_history(ano: int, id: int, cod_status: str):
    def transaction_logic(cursor):
        # 1. Delete the specific item
        cursor.execute("DELETE FROM tabAndamento WHERE CodStatus = %s AND NroProtocoloLink = %s AND AnoProtocoloLink = %s", (cod_status, id, ano))
        
        # 2. Fix UltimoStatus
        # Reset all to 0
        cursor.execute("UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s", (id, ano))
        
        # Set latest to 1
        cursor.execute("""
            UPDATE tabAndamento 
            SET UltimoStatus = 1 
            WHERE CodStatus = (
                SELECT sub.CodStatus FROM (
                    SELECT CodStatus FROM tabAndamento 
                    WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s 
                    ORDER BY Data DESC, CodStatus DESC LIMIT 1
                ) as sub
            )
        """, (id, ano))
        
        return {"status": "deleted"}

    try:
        db.execute_transaction([transaction_logic])
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Delete history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/os/{ano}/{id}/versions")
def get_os_versions(ano: int, id: int):
    try:
        base_path = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_{ano}"
        os_pattern = os.path.join(base_path, f"{id:05d}*")
        found_os_folders = glob.glob(os_pattern)
        versions = []
        if found_os_folders:
            os_folder = found_os_folders[0]
            if os.path.exists(os_folder):
                subitems = os.listdir(os_folder)
                original_folders = sorted([i for i in subitems if os.path.isdir(os.path.join(os_folder, i)) and "original" in i.lower()])
                for idx, folder_name in enumerate(original_folders):
                    versions.append({"version": idx + 1, "label": f"v{idx + 1} ({folder_name})", "path": os.path.join(os_folder, folder_name)})
        
        if not versions:
            local_test_path = os.path.abspath("storage_test")
            os.makedirs(local_test_path, exist_ok=True)
            versions.append({"version": 1, "label": "v1 (Simulação Local)", "path": local_test_path})
            
        return {"versions": versions}
    except Exception as e:
        logger.error(f"Erro buscando versoes: {e}")
        return {"versions": []}

@router.get("/os/panel")
def get_panel_data(setor: Optional[str] = Query(None)):
    query = """
    SELECT p.NroProtocolo AS nr_os, p.AnoProtocolo AS ano, d.Titulo AS titulo, p.NomeUsuario AS solicitante,
    a.SituacaoLink AS situacao, p.EntregPrazoLink AS prioridade, d.TipoPublicacaoLink AS produto,
    a.SetorLink AS setor, p.EntregData AS data_entrega, d.Tiragem
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d ON (p.NroProtocolo = d.NroProtocoloLinkDet) AND (p.AnoProtocolo = d.AnoProtocoloLinkDet)
    LEFT JOIN tabAndamento AS a ON (p.NroProtocolo = a.NroProtocoloLink) AND (p.AnoProtocolo = a.AnoProtocoloLink)
    WHERE a.UltimoStatus = 1 AND (a.SituacaoLink LIKE 'Saída p/%%' OR a.SituacaoLink = 'Em Execução' OR a.SituacaoLink = 'Recebido' OR a.SituacaoLink LIKE 'Tramit. de Prova p/%%')
    """
    params = {}
    if setor:
        query += " AND a.SetorLink = %(setor)s"
        params['setor'] = setor
    query += " ORDER BY p.EntregData ASC"
    try:
        return db.execute_query(query, params)
    except Exception as e:
        logger.error(f"Error fetching panel data: {e}")
        raise HTTPException(status_code=500, detail=str(e))