from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from pydantic import BaseModel
from database import db
import logging
import os
import glob
from datetime import datetime
from .andamento_helpers import format_andamento_obs, format_ponto
import hashlib

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

class SaveOSRequest(BaseModel):
    # Identificação para Update (opcionais para Insert)
    NroProtocolo: Optional[int] = None
    AnoProtocolo: Optional[int] = None
    
    # Dados Principais
    CodigoRequisicao: Optional[str] = None
    CategoriaLink: Optional[str] = None
    NomeUsuario: Optional[str] = None
    Titular: Optional[str] = None
    SiglaOrgao: Optional[str] = None
    GabSalaUsuario: Optional[str] = None
    Andar: Optional[str] = None
    Localizacao: Optional[str] = None
    RamalUsuario: Optional[str] = None
    
    DataEntrada: Optional[str] = None
    ProcessoSolicit: Optional[str] = None
    CSnro: Optional[str] = None
    TiragemSolicitada: Optional[str] = None
    TiragemFinal: Optional[str] = None
    
    # Detalhes
    Titulo: Optional[str] = None
    TipoPublicacaoLink: Optional[str] = None
    MaquinaLink: Optional[str] = None
    Tiragem: Optional[str] = None
    Pags: Optional[str] = None
    FrenteVerso: Optional[bool] = False
    ModelosArq: Optional[str] = None
    
    EntregPrazoLink: Optional[str] = None
    EntregData: Optional[str] = None
    
    PapelLink: Optional[str] = None
    PapelDescricao: Optional[str] = None
    Cores: Optional[str] = None
    CoresDescricao: Optional[str] = None
    
    DescAcabamento: Optional[str] = None
    Observ: Optional[str] = None
    ContatoTrab: Optional[str] = None
    
    # Material / Elementos
    MaterialFornecido: Optional[bool] = False
    Fotolito: Optional[bool] = False
    ModeloDobra: Optional[bool] = False
    ProvaImpressa: Optional[bool] = False
    InsumosFornecidos: Optional[str] = None
    
    ElemGrafBrasao: Optional[bool] = False
    ElemGrafTimbre: Optional[bool] = False
    ElemGrafArteGab: Optional[bool] = False
    ElemGrafAssinatura: Optional[bool] = False
    
    # Usuário que está salvando (pela sessão)
    PontoUsuario: Optional[str] = None


@router.get("/os/{ano}/{id}/path")
def get_os_path(ano: int, id: int):
    logger.info(f"DEBUG ENDPOINT: Request path for OS {id}/{ano}")
    try:
        path = _get_os_folder_path(ano, id)
        
        if path:
            return {"path": path}
            
        # Fallback Local
        local_path = os.path.abspath(f"storage_test/{ano}/{id}")
        if os.path.exists(local_path):
             return {"path": local_path}
             
        return {"path": "Pasta não encontrada na rede."}
    except Exception as e:
        logger.error(f"Error getting path: {e}")
        return {"path": f"Erro: {str(e)}"}

def _get_os_folder_path(ano: int, id: int) -> Optional[str]:
    """Helper para localizar a pasta da OS na rede."""
    base_path = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_{ano}"
    os_pattern = os.path.join(base_path, f"{id:05d}*")
    
    logger.info(f"DEBUG PATH: Searching for OS {id}/{ano} in {base_path}")
    logger.info(f"DEBUG PATH: Pattern used: {os_pattern}")
    
    found = glob.glob(os_pattern)
    if found:
        logger.info(f"DEBUG PATH: Found: {found[0]}")
        return found[0]
        
    logger.info("DEBUG PATH: Not found in network.")
    return None

@router.post("/os/save")
def save_os(data: SaveOSRequest):
    """
    Salva uma OS (Insert ou Update).
    Se NroProtocolo e AnoProtocolo forem fornecidos e existirem -> UPDATE.
    Caso contrário -> INSERT (Gera novo ID).
    """
    # Sanitize empty strings to None to avoid DB errors or bad data
    if data.EntregData == "": data.EntregData = None
    if data.DataEntrada == "": data.DataEntrada = None
    if data.NroProtocolo == 0: data.NroProtocolo = None
    if data.AnoProtocolo == 0: data.AnoProtocolo = None

    def transaction_logic(cursor):
        is_update = False
        if data.NroProtocolo and data.AnoProtocolo:
            cursor.execute("SELECT 1 FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s", (data.NroProtocolo, data.AnoProtocolo))
            if cursor.fetchone():
                is_update = True
        
        current_year = data.AnoProtocolo if data.AnoProtocolo else datetime.now().year
        
        # --- Lógica de ID para INSERT ---
        new_id = data.NroProtocolo
        if not is_update:
            # Determina se é Papelaria (> 5000) ou Normal (< 5000)
            cursor.execute("SELECT MAX(NroProtocolo) as max_id FROM tabProtocolos WHERE AnoProtocolo = %s AND NroProtocolo < 5000", (current_year,))
            res = cursor.fetchone()
            max_id = res['max_id'] if res and res['max_id'] else 0
            new_id = max_id + 1
        
        # --- CAMPOS TAB PROTOCOLOS ---
        # Mapeamento Campo Pydantic -> Coluna DB
        
        # UPDATE tabProtocolos
        if is_update:
            query_proto = """
                UPDATE tabProtocolos SET
                    CodigoRequisic=%s, CategoriaLink=%s, NomeUsuario=%s, Titular=%s, SiglaOrgao=%s,
                    GabSalaUsuario=%s, Andar=%s, Localizacao=%s, RamalUsuario=%s,
                    DataEntrada=%s, ProcessoSolicit=%s, CSnro=%s,
                    EntregPrazoLink=%s, EntregData=%s, ContatoTrab=%s
                WHERE NroProtocolo=%s AND AnoProtocolo=%s
            """
            cursor.execute(query_proto, (
                data.CodigoRequisicao, data.CategoriaLink, data.NomeUsuario, data.Titular, data.SiglaOrgao,
                data.GabSalaUsuario, data.Andar, data.Localizacao, data.RamalUsuario,
                data.DataEntrada, data.ProcessoSolicit, data.CSnro,
                data.EntregPrazoLink, data.EntregData, data.ContatoTrab,
                data.NroProtocolo, data.AnoProtocolo
            ))
        else:
            query_proto = """
                INSERT INTO tabProtocolos (
                    NroProtocolo, AnoProtocolo,
                    CodigoRequisic, CategoriaLink, NomeUsuario, Titular, SiglaOrgao,
                    GabSalaUsuario, Andar, Localizacao, RamalUsuario,
                    DataEntrada, ProcessoSolicit, CSnro,
                    EntregPrazoLink, EntregData, ContatoTrab,
                    OrgInteressado  -- Default 'Câmara dos Deputados'
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'Câmara dos Deputados')
            """
            cursor.execute(query_proto, (
                new_id, current_year,
                data.CodigoRequisicao, data.CategoriaLink, data.NomeUsuario, data.Titular, data.SiglaOrgao,
                data.GabSalaUsuario, data.Andar, data.Localizacao, data.RamalUsuario,
                data.DataEntrada, data.ProcessoSolicit, data.CSnro,
                data.EntregPrazoLink, data.EntregData, data.ContatoTrab
            ))

        # --- CAMPOS TAB DETALHES ---
        # UPDATE tabDetalhesServico
        # Check if details exist (sometimes they might not if data integrity issues, so Upsert logic is safer)
        
        # Check existence first
        cursor.execute("SELECT 1 FROM tabDetalhesServico WHERE NroProtocoloLinkDet=%s AND AnoProtocoloLinkDet=%s", (new_id, current_year))
        details_exist = cursor.fetchone()
        
        if details_exist:
            query_det = """
                UPDATE tabDetalhesServico SET
                    Titulo=%s, TipoPublicacaoLink=%s, MaquinaLink=%s, Tiragem=%s, Pags=%s, FrenteVerso=%s, ModelosArq=%s,
                    PapelLink=%s, PapelDescricao=%s, Cores=%s, CoresDescricao=%s,
                    DescAcabamento=%s, Observ=%s,
                    TiragemSolicitada=%s, CotaTotal=%s,
                    MaterialFornecido=%s, Fotolito=%s, ModeloDobra=%s, ProvaImpressa=%s, InsumosFornecidos=%s,
                    ElemGrafBrasao=%s, ElemGrafTimbre=%s, ElemGrafArteGab=%s, ElemGrafAssinatura=%s
                WHERE NroProtocoloLinkDet=%s AND AnoProtocoloLinkDet=%s
            """
            cursor.execute(query_det, (
                data.Titulo, data.TipoPublicacaoLink, data.MaquinaLink, data.Tiragem, data.Pags, data.FrenteVerso, data.ModelosArq,
                data.PapelLink, data.PapelDescricao, data.Cores, data.CoresDescricao,
                data.DescAcabamento, data.Observ,
                data.TiragemSolicitada, data.TiragemFinal, # Mapeando TiragemFinal -> CotaTotal (conforme load) ou TiragemSolicitada
                data.MaterialFornecido, data.Fotolito, data.ModeloDobra, data.ProvaImpressa, data.InsumosFornecidos,
                data.ElemGrafBrasao, data.ElemGrafTimbre, data.ElemGrafArteGab, data.ElemGrafAssinatura,
                new_id, current_year
            ))
        else:
            query_det = """
                INSERT INTO tabDetalhesServico (
                    NroProtocoloLinkDet, AnoProtocoloLinkDet,
                    Titulo, TipoPublicacaoLink, MaquinaLink, Tiragem, Pags, FrenteVerso, ModelosArq,
                    PapelLink, PapelDescricao, Cores, CoresDescricao,
                    DescAcabamento, Observ,
                    TiragemSolicitada, CotaTotal,
                    MaterialFornecido, Fotolito, ModeloDobra, ProvaImpressa, InsumosFornecidos,
                    ElemGrafBrasao, ElemGrafTimbre, ElemGrafArteGab, ElemGrafAssinatura
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(query_det, (
                new_id, current_year,
                data.Titulo, data.TipoPublicacaoLink, data.MaquinaLink, data.Tiragem, data.Pags, data.FrenteVerso, data.ModelosArq,
                data.PapelLink, data.PapelDescricao, data.Cores, data.CoresDescricao,
                data.DescAcabamento, data.Observ,
                data.TiragemSolicitada, data.TiragemFinal,
                data.MaterialFornecido, data.Fotolito, data.ModeloDobra, data.ProvaImpressa, data.InsumosFornecidos,
                data.ElemGrafBrasao, data.ElemGrafTimbre, data.ElemGrafArteGab, data.ElemGrafAssinatura
            ))
            
        # --- HISTÓRICO INICIAL (SE NOVO) ---
        if not is_update:
            new_cod_status = f"{new_id:05d}{current_year}-01"
            obs_criacao = format_andamento_obs("OS Criada via Web")
            ponto_formatado = format_ponto(data.PontoUsuario)
            query_hist = """
                INSERT INTO tabAndamento 
                (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto)
                VALUES (%s, %s, %s, 'Entrada Inicial', 'SEFOC', NOW(), 1, %s, %s)
            """
            cursor.execute(query_hist, (new_cod_status, new_id, current_year, obs_criacao, ponto_formatado))
            
        return {"status": "ok", "id": new_id, "ano": current_year, "message": "OS salva com sucesso"}

    try:
        result = db.execute_transaction([transaction_logic])
        return result[0]
    except Exception as e:
        logger.error(f"Save OS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
        max_id = result['max_id'] if result and result.get('max_id') else None

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
        obs_duplicacao = format_andamento_obs(f"Duplicado da OS {id}/{ano}")
        ponto_formatado = format_ponto(req.usuario)
        
        query_hist = """
            INSERT INTO tabAndamento 
            (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto)
            VALUES (%s, %s, %s, 'Entrada Inicial', 'SEFOC', NOW(), 1, %s, %s)
        """
        cursor.execute(query_hist, (new_cod_status, new_id, current_year, obs_duplicacao, ponto_formatado))

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
        p.EntregPrazoLink, p.EntregData, p.EntregPeriodo, p.EntregaFormaLink, p.ResponsavelGrafLink,
        d.PapelLink, d.PapelDescricao, d.Cores, d.CoresDescricao, d.FormatoLink,
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
    logger.info(f"DEBUG: POST History Payload: {item}")
    def transaction_logic(cursor):
        # Sanitize Ponto (Remove dots/formatting)
        clean_user = ''.join(filter(str.isdigit, item.usuario)) if item.usuario else ''

        # 1. Reset UltimoStatus
        cursor.execute("UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %(id)s AND AnoProtocoloLink = %(ano)s", {'id': id, 'ano': ano})
        
        # 2. Generate Safest New ID (Max + 1)
        base_prefix = f"{id:05d}{ano}-"
        cursor.execute(f"SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE '{base_prefix}%'")
        res = cursor.fetchone()
        
        next_seq = 1
        if res and res['max_cod']:
            try:
                existing_suffix = res['max_cod'].split('-')[-1]
                next_seq = int(existing_suffix) + 1
            except ValueError:
                next_seq = 1
                
        new_cod = f"{base_prefix}{next_seq:02d}"
        
        # Formatar observação com hora e preservar quebras de linha
        obs_formatada = format_andamento_obs(item.obs)
        # Formatar ponto no padrão #.#00
        ponto_formatado = format_ponto(clean_user)
        
        # Using backticks for special column names to be safe
        cursor.execute(
            "INSERT INTO tabAndamento (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, `Data`, UltimoStatus, `Observaçao`, Ponto) VALUES (%(cod)s, %(id)s, %(ano)s, %(situacao)s, %(setor)s, NOW(), 1, %(obs)s, %(usuario)s)",
            {'cod': new_cod, 'id': id, 'ano': ano, 'situacao': item.situacao, 'setor': item.setor, 'obs': obs_formatada, 'usuario': ponto_formatado}
        )
        return {"new_id": new_cod}

    try:
        return db.execute_transaction([transaction_logic])[0]
    except Exception as e:
        logger.error(f"Add history error: {e}")
        if "Duplicate entry" in str(e):
             raise HTTPException(status_code=409, detail="Erro de concorrência. Tente novamente.")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/os/{ano}/{id}/vinculos")
def list_os_vinculos(ano: int, id: int):
    """Retorna lista de OSs vinculadas à OS fornecida (bidirecional)."""
    try:
        query = """
            SELECT os_principal_numero as principal_num, os_principal_ano as principal_ano,
                   os_vinculada_numero as vinc_num, os_vinculada_ano as vinc_ano, data_vinculo
            FROM tabOSVinculadas
            WHERE (os_principal_numero = %s AND os_principal_ano = %s)
               OR (os_vinculada_numero = %s AND os_vinculada_ano = %s)
        """
        rows = db.execute_query(query, (id, ano, id, ano))

        # Normalize to return the other OS in each relation
        result = []
        for r in rows:
            if r['principal_num'] == id and r['principal_ano'] == ano:
                result.append({ 'numero': r['vinc_num'], 'ano': r['vinc_ano'], 'data_vinculo': r['data_vinculo'] })
            else:
                result.append({ 'numero': r['principal_num'], 'ano': r['principal_ano'], 'data_vinculo': r['data_vinculo'] })

        return result
    except Exception as e:
        logger.error(f"Error listing vinculos: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class VinculoRequest(BaseModel):
    numero: int
    ano: int


@router.post("/os/{ano}/{id}/vincular")
def create_vinculo(ano: int, id: int, req: VinculoRequest):
    """Cria vínculo entre a OS (id, ano) e (req.numero, req.ano)."""
    try:
        # Validations
        if req.numero == id and req.ano == ano:
            raise HTTPException(status_code=400, detail="Não é possível vincular uma OS a ela mesma.")

        # Check existence of both OSs
        p = db.execute_query("SELECT 1 FROM tabProtocolos WHERE NroProtocolo=%s AND AnoProtocolo=%s", (id, ano))
        q = db.execute_query("SELECT 1 FROM tabProtocolos WHERE NroProtocolo=%s AND AnoProtocolo=%s", (req.numero, req.ano))
        if not p or not q:
            raise HTTPException(status_code=404, detail="Uma das OSs não existe.")

        # Check duplicate in either direction
        dup = db.execute_query("SELECT 1 FROM tabOSVinculadas WHERE (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s) OR (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s)",
                               (id, ano, req.numero, req.ano, req.numero, req.ano, id, ano))
        if dup:
            raise HTTPException(status_code=409, detail="Vínculo já existe.")

        # Insert canonical direction as provided
        db.execute_query("INSERT INTO tabOSVinculadas (os_principal_numero, os_principal_ano, os_vinculada_numero, os_vinculada_ano) VALUES (%s,%s,%s,%s)",
                         (id, ano, req.numero, req.ano))
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating vinculo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/os/{ano}/{id}/vinculo/{v_num}/{v_ano}")
def delete_vinculo(ano: int, id: int, v_num: int, v_ano: int):
    try:
        # Delete any matching pair in either direction
        db.execute_query("DELETE FROM tabOSVinculadas WHERE (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s) OR (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s)",
                         (id, ano, v_num, v_ano, v_num, v_ano, id, ano))
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error deleting vinculo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/os/{ano}/{id}/history/replicate")
def replicate_history(ano: int, id: int, item: HistoryItem):
    """Replicar andamento para todas OSs vinculadas (incluindo a atual)."""
    def transaction_logic(cursor):
        # Find linked OSs
        cursor.execute("SELECT os_principal_numero as principal_num, os_principal_ano as principal_ano, os_vinculada_numero as vinc_num, os_vinculada_ano as vinc_ano FROM tabOSVinculadas WHERE (os_principal_numero = %s AND os_principal_ano = %s) OR (os_vinculada_numero = %s AND os_vinculada_ano = %s)", (id, ano, id, ano))
        rows = cursor.fetchall()

        targets = set()
        targets.add((id, ano))
        for r in rows:
            if r['principal_num'] == id and r['principal_ano'] == ano:
                targets.add((r['vinc_num'], r['vinc_ano']))
            else:
                targets.add((r['principal_num'], r['principal_ano']))

        # For each target, insert history similar to add_os_history
        for (t_num, t_ano) in targets:
            # Reset UltimoStatus
            cursor.execute("UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s", (t_num, t_ano))

            base_prefix = f"{t_num:05d}{t_ano}-"
            cursor.execute(f"SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE '{base_prefix}%'")
            res = cursor.fetchone()
            next_seq = 1
            if res and res.get('max_cod'):
                try:
                    existing_suffix = res['max_cod'].split('-')[-1]
                    next_seq = int(existing_suffix) + 1
                except Exception:
                    next_seq = 1

            new_cod = f"{base_prefix}{next_seq:02d}"
            clean_user = ''.join(filter(str.isdigit, item.usuario)) if item.usuario else ''
            
            # Formatar observação com hora e preservar quebras de linha
            obs_formatada = format_andamento_obs(item.obs)
            # Formatar ponto no padrão #.#00
            ponto_formatado = format_ponto(clean_user)

            cursor.execute(
                "INSERT INTO tabAndamento (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, `Data`, UltimoStatus, `Observaçao`, Ponto) VALUES (%s, %s, %s, %s, %s, NOW(), 1, %s, %s)",
                (new_cod, t_num, t_ano, item.situacao, item.setor, obs_formatada, ponto_formatado)
            )

        return {"status": "ok", "replicated_to": len(targets)}

    try:
        return db.execute_transaction([transaction_logic])[0]
    except Exception as e:
        logger.error(f"Error replicating history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/os/{ano}/{id}/vinculo/excecao")
def create_vinculo_excecao(ano: int, id: int, body: dict):
    """Marca exceção/divergência para uma OS vinculada (quando andamento só aplicado nela)."""
    try:
        obs = body.get('observacao') if body else None
        db.execute_query("INSERT INTO tabOSVinculoExcecoes (NroProtocolo, AnoProtocolo, Observacao) VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE Observacao = VALUES(Observacao)", (id, ano, obs))
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error creating vinculo excecao: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class HistoryUpdateItem(HistoryItem):
    cod_status: str

@router.put("/os/{ano}/{id}/history")
def update_os_history(ano: int, id: int, item: HistoryUpdateItem):
    logger.info(f"DEBUG: PUT History Payload: {item}")
    def transaction_logic(cursor):
        # Sanitize Ponto
        clean_user = ''.join(filter(str.isdigit, item.usuario)) if item.usuario else ''
        
        cursor.execute(
            """
            UPDATE tabAndamento 
            SET SituacaoLink=%(situacao)s, SetorLink=%(setor)s, `Observaçao`=%(obs)s, Ponto=%(usuario)s
            WHERE CodStatus=%(cod)s AND NroProtocoloLink=%(id)s AND AnoProtocoloLink=%(ano)s
            """,
            {'situacao': item.situacao, 'setor': item.setor, 'obs': item.obs, 'usuario': clean_user, 'cod': item.cod_status, 'id': id, 'ano': ano}
        )
        return {"status": "updated"}

    try:
        db.execute_transaction([transaction_logic])
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Update history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/os/{ano}/{id}/history/{cod_status}")
def delete_os_history(ano: int, id: int, cod_status: str):
    # Executar TUDO dentro de uma única transação
    def transaction_logic(cursor):
        # 1. Buscar andamento ANTES de excluir
        cursor.execute("""
            SELECT SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto
            FROM tabAndamento 
            WHERE CodStatus = %s
        """, (cod_status,))
        
        andamento = cursor.fetchone()
        
        # 2. Registrar hash em deleted_andamentos
        if andamento:
            # DictCursor retorna dict, não tupla
            content_fields = [
                str(andamento.get('SituacaoLink') or ''),
                str(andamento.get('SetorLink') or ''),
                str(andamento.get('Data') or ''),
                str(andamento.get('UltimoStatus') or ''),
                str(andamento.get('Observaçao') or ''),
                str(andamento.get('Ponto') or '')
            ]
            content_str = '|'.join(content_fields)
            content_hash = hashlib.sha256(content_str.encode('utf-8')).hexdigest()
            
            cursor.execute("""
                INSERT INTO deleted_andamentos (codstatus, nro, ano, content_hash, deleted_at, motivo, origem)
                VALUES (%s, %s, %s, %s, NOW(), 'Exclusão via Frontend', 'API')
                ON DUPLICATE KEY UPDATE deleted_at = NOW(), content_hash = VALUES(content_hash)
            """, (cod_status, id, ano, content_hash))
            
            logger.info(f"[DELETE] {cod_status} registrado em deleted_andamentos (hash: {content_hash[:8]})")
        
        # 3. Excluir do tabAndamento
        cursor.execute("DELETE FROM tabAndamento WHERE CodStatus = %s", (cod_status,))
        
        # 4. Fix UltimoStatus
        cursor.execute("UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s", (id, ano))
        
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
        logger.error(f"Erro ao excluir {cod_status}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/os/{ano}/{id}/versions")
def get_os_versions(ano: int, id: int):
    try:
        os_folder = _get_os_folder_path(ano, id)
        versions = []
        if os_folder and os.path.exists(os_folder):
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


@router.get("/aux/setores")
def get_setores():
    """Retorna lista de setores disponíveis do banco de dados"""
    try:
        query = "SELECT DISTINCT Setor FROM tabSetor ORDER BY Setor ASC"
        result = db.execute_query(query)
        setores = [{"Setor": row.get("Setor")} for row in result if row.get("Setor")]
        return setores
    except Exception as e:
        logger.error(f"Error fetching setores: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/aux/andamentos")
def get_andamentos():
    """Retorna lista de andamentos (situações) disponíveis"""
    try:
        query = """
        SELECT DISTINCT SituacaoLink 
        FROM tabAndamento 
        WHERE SituacaoLink IS NOT NULL AND SituacaoLink != ''
        ORDER BY SituacaoLink ASC
        """
        result = db.execute_query(query)
        andamentos = [{"Situacao": row.get("SituacaoLink")} for row in result if row.get("SituacaoLink")]
        return andamentos
    except Exception as e:
        logger.error(f"Error fetching andamentos: {e}")
        raise HTTPException(status_code=500, detail=str(e))