from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from pydantic import BaseModel
from database import db
import logging
import os
import glob

router = APIRouter()
logger = logging.getLogger(__name__)

class HistoryItem(BaseModel):
    situacao: str
    setor: str
    obs: str
    usuario: str

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