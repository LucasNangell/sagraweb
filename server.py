from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
from database import db
import logging
import os
import datetime
# Imports para E-mail
import imaplib
import email
from email.header import decode_header
from report_service import report_service
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import tempfile
import glob


class ProblemaItem(BaseModel):
    id_padrao: int
    obs: Optional[str] = ""
    html_snapshot: Optional[str] = None # HTML Editado
    componente: Optional[str] = None # Componente de Origem (Capa, Miolo, etc)

class AnaliseRequest(BaseModel):
    nro_os: int
    ano_os: int
    versao: str
    componente: str
    usuario: str
    problemas: List[ProblemaItem]
# Configurar logger para debug
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SAGRA API", version="6.9")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Models ---

class HistoryItem(BaseModel):
    situacao: str
    setor: str
    obs: str
    usuario: str

# --- SERVICE DE E-MAIL (Integração Local Outlook) ---
import pythoncom
import win32com.client

def fetch_outlook_emails():
    """
    Conecta à instância local do Outlook (via COM) e busca e-mails NÃO LIDOS.
    Não requer senha, aproveita o login do Windows/Outlook aberto.
    """
    
    # Mapeamento: "Nome Da Conta/Mailbox" -> ["Lista", "De", "Pastas"]
    TARGETS = {
        "sepim.deapa@camara.leg.br": ["Entrada de Provas", "Entrada de Prob. Tec."],
        "papelaria.deapa@camara.leg.br": ["Entrada de Provas", "Entrada de Prob. Tec."]
    }
    
    emails_list = []
    
    try:
        # Inicializa o COM para esta thread
        pythoncom.CoInitialize()
        
        # Conecta ao Outlook
        outlook = win32com.client.Dispatch("Outlook.Application")
        namespace = outlook.GetNamespace("MAPI")
        
        # Itera sobre as contas (Stores/Folders no nível raiz)
        for store in namespace.Folders:
            acc_name = store.Name
            
            # Verifica se essa conta está na nossa lista de alvos
            matched_key = None
            for key in TARGETS.keys():
                if key.lower() in acc_name.lower():
                    matched_key = key
                    break
            
            if not matched_key:
                continue
                
            logger.info(f"Conta encontrada: {acc_name}")
            target_folders = TARGETS[matched_key]
            
            # Tenta encontrar a Caixa de Entrada nesta conta
            inbox_folder = None
            try:
                inbox_folder = store.Folders("Caixa de entrada")
            except:
                try:
                    inbox_folder = store.Folders("Inbox")
                except:
                    pass
            
            if not inbox_folder:
                logger.warning(f"  Caixa de entrada não encontrada em {acc_name}")
                continue

            # Itera sobre as pastas DESEJADAS dentro da Caixa de Entrada
            for folder_name in target_folders:
                try:
                    folder = None
                    try:
                        folder = inbox_folder.Folders(folder_name)
                    except:
                        # Fallback case-insensitive
                        for f in inbox_folder.Folders:
                            if f.Name.lower() == folder_name.lower():
                                folder = f
                                break
                    
                    if not folder:
                        logger.warning(f"  Subpasta '{folder_name}' não encontrada dentro da Caixa de Entrada de '{acc_name}'")
                        continue
                        
                    # Filtra Itens Não Lidos
                    items = folder.Items
                    items.Sort("[ReceivedTime]", True) # Descending
                    restricted_items = items.Restrict("[UnRead] = True")
                    
                    # Processa os itens (limite de 20 por pasta para segurança)
                    count = 0
                    for mail in restricted_items:
                        if count >= 20: break
                        
                        try:
                            # Apenas MailItem (Class 43)
                            if mail.Class != 43: continue
                            
                            # Processar Anexos
                            attachments_list = []
                            if mail.Attachments.Count > 0:
                                for i in range(1, mail.Attachments.Count + 1):
                                    try:
                                        att = mail.Attachments.Item(i)
                                        attachments_list.append({"name": att.FileName})
                                    except:
                                        pass
                            
                            has_attachment = len(attachments_list) > 0
                            
                            emails_list.append({
                                "id": int(mail.EntryID[-8:], 16), # ID fictício curto para UI
                                "real_id": mail.EntryID,          # ID real para download
                                "sender": mail.SenderName,
                                "email": mail.SenderEmailAddress,
                                "subject": mail.Subject,
                                "preview": mail.Body[:100] + "..." if mail.Body else "",
                                "body": mail.Body,
                                "date": str(mail.ReceivedTime),
                                "read": False,
                                "hasAttachment": has_attachment,
                                "attachments": attachments_list,
                                "account": acc_name,
                                "folder": folder.Name
                            })
                            count += 1
                        except Exception as item_err:
                            logger.error(f"  Erro lendo item: {item_err}")
                            
                except Exception as folder_err:
                    logger.error(f"  Erro acessando pasta {folder_name}: {folder_err}")

    except Exception as e:
        logger.error(f"Erro no Outlook COM: {e}")
    finally:
        pythoncom.CoUninitialize()
            
    return emails_list

@app.get("/api/analise/problemas-padrao")
def get_problemas_padrao():
    return db.execute_query("SELECT ID, TituloPT, ProbTecHTML, Categoria FROM tabProblemasPadrao ORDER BY Categoria, TituloPT")

@app.get("/api/files/list")
def list_files(path: str = Query(..., description="Caminho absoluto da pasta")):
    try:
        if not os.path.exists(path):
            return {"files": []}
            
        valid_extensions = ('.pdf', '.jpg', '.jpeg', '.png')
        files = []
        
        for item in os.listdir(path):
            full_path = os.path.join(path, item)
            if os.path.isfile(full_path) and item.lower().endswith(valid_extensions):
                files.append({
                    "name": item,
                    "path": full_path,
                    "type": "PDF" if item.lower().endswith('.pdf') else "IMAGE"
                })
        
        # Ordenar por nome
        files.sort(key=lambda x: x['name'])
        return {"files": files}
    except Exception as e:
        logger.error(f"Erro listando arquivos: {e}")
        return {"files": []}

@app.get("/api/files/serve")
def serve_file(filepath: str = Query(..., description="Caminho do arquivo")):
    try:
        if not os.path.exists(filepath):
            raise HTTPException(status_code=404, detail="Arquivo não encontrado")
            
        # Determinar media type
        media_type = "application/pdf"
        if filepath.lower().endswith(('.jpg', '.jpeg')):
            media_type = "image/jpeg"
        elif filepath.lower().endswith('.png'):
            media_type = "image/png"
            
        return FileResponse(
            filepath, 
            media_type=media_type, 
            filename=os.path.basename(filepath),
            headers={"Content-Disposition": "inline"} # Importante para exibir no browser/pdf.js
        )
            
    except Exception as e:
        logger.error(f"Erro servindo arquivo: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/debug/log")
async def log_debug(item: dict):
    try:
        msg = item.get("message", "No message")
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open("server_debug.log", "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] CLIENT_LOG: {msg}\n")
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Erro no log debug: {e}")
        return {"status": "error"}

@app.get("/api/os/{ano}/{id}/versions")
def get_os_versions(ano: int, id: int):
    try:
        # Caminho base da rede
        base_path = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_{ano}"
        
        # Procura pasta da OS (5 digitos + qualquer sufixo)
        os_pattern = os.path.join(base_path, f"{id:05d}*")
        found_os_folders = glob.glob(os_pattern)
        
        versions = []
        
        # Lógica Principal: Rede
        if found_os_folders:
            os_folder = found_os_folders[0]
            if os.path.exists(os_folder):
                subitems = os.listdir(os_folder)
                original_folders = []
                for item in subitems:
                    full_path = os.path.join(os_folder, item)
                    if os.path.isdir(full_path) and "original" in item.lower():
                        original_folders.append(item)
                original_folders.sort()
                for idx, folder_name in enumerate(original_folders):
                    versions.append({
                        "version": idx + 1,
                        "label": f"v{idx + 1} ({folder_name})",
                        "path": os.path.join(os_folder, folder_name)
                    })

        # FALLBACK: Se não achou na rede, usa storage_test local para não travar o teste
        if not versions:
            logger.warning(f"OS não encontrada na rede. Usando storage_test local.")
            local_test_path = os.path.abspath("storage_test")
            if not os.path.exists(local_test_path):
                os.makedirs(local_test_path, exist_ok=True)
            
            versions.append({
                "version": 1,
                "label": "v1 (Simulação Local)",
                "path": local_test_path
            })

        return {"versions": versions}
    except Exception as e:
        logger.error(f"Erro buscando versoes: {e}")
        return {"versions": []}

@app.post("/api/analise/save")
def save_analise(req: AnaliseRequest):
    try:
        problemas_dicts = [p.dict() for p in req.problemas]
        
        result = report_service.save_analysis(
            req.nro_os, 
            req.ano_os, 
            req.versao, 
            req.componente, 
            req.usuario, 
            problemas_dicts
        )
        return {"status": "success", "analise_id": result['id']}
    except Exception as e:
        logger.error(f"Erro salvando analise: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- REAL-TIME PERSISTENCE MODELS ---

class AnalysisEnsureRequest(BaseModel):
    nro_os: int
    ano_os: int
    usuario: str

class AnaliseItemAddRequest(BaseModel):
    id_analise: int
    id_padrao: int
    componente: Optional[str] = None
    obs: Optional[str] = ""
    html_snapshot: Optional[str] = None

class AnaliseItemUpdateRequest(BaseModel):
    id_item: int
    obs: Optional[str] = None
    html_snapshot: Optional[str] = None

# --- REAL-TIME PERSISTENCE ENDPOINTS ---

@app.post("/api/analise/ensure")
def ensure_analise(req: AnalysisEnsureRequest):
    try:
        existing = db.execute_query(
            "SELECT ID FROM tabAnalises WHERE NroProtocolo = %s AND AnoProtocolo = %s", 
            (req.nro_os, req.ano_os)
        )
        if existing:
            return {"id": existing[0]['ID'], "new": False}
        
        # Create new
        db.execute_query(
            "INSERT INTO tabAnalises (NroProtocolo, AnoProtocolo, Usuario, Versao, Componente) VALUES (%s, %s, %s, '', '')",
            (req.nro_os, req.ano_os, req.usuario)
        )
        new_rec = db.execute_query("SELECT ID FROM tabAnalises WHERE NroProtocolo = %s AND AnoProtocolo = %s", (req.nro_os, req.ano_os))
        return {"id": new_rec[0]['ID'], "new": True}
    except Exception as e:
        logger.error(f"Error ensuring analysis: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/analise/{ano}/{os_id}/full")
def get_full_analysis(ano: int, os_id: int):
    try:
        header = db.execute_query("SELECT ID, Versao, Componente FROM tabAnalises WHERE NroProtocolo = %s AND AnoProtocolo = %s", (os_id, ano))
        if not header:
            return {"exists": False}
        
        anl_id = header[0]['ID']
        
        # Join with problem definition to get title/html
        items = db.execute_query("""
            SELECT i.ID, i.ID_ProblemaPadrao as originalId, i.Obs as obs, i.HTML_Snapshot as html, i.Componente as componenteOrigem,
                   p.TituloPT as titulo
            FROM tabAnaliseItens i
            LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID
            WHERE i.ID_Analise = %s
        """, (anl_id,))
        
        # Convert keys to match frontend expectation
        formatted_items = []
        for it in items:
            formatted_items.append({
                "uniqueId": it['ID'], # Use Real Database ID as uniqueId
                "originalId": it['originalId'],
                "titulo": it['titulo'],
                "html": it['html'],
                "obs": it['obs'],
                "componenteOrigem": it['componenteOrigem']
            })

        return {
            "exists": True,
            "id": anl_id,
            "versao": header[0]['Versao'],
            "componente": header[0]['Componente'],
            "items": formatted_items
        }
    except Exception as e:
        logger.error(f"Error fetching full analysis: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analise/item/add")
def add_analise_item(req: AnaliseItemAddRequest):
    try:
        db.execute_query(
            """INSERT INTO tabAnaliseItens (ID_Analise, ID_ProblemaPadrao, Componente, Obs, HTML_Snapshot) 
               VALUES (%s, %s, %s, %s, %s)""",
            (req.id_analise, req.id_padrao, req.componente, req.obs, req.html_snapshot)
        )
        last = db.execute_query("SELECT MAX(ID) as ID FROM tabAnaliseItens WHERE ID_Analise=%s", (req.id_analise,))
        return {"id": last[0]['ID']}
    except Exception as e:
        logger.error(f"Error adding item: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analise/item/update")
def update_analise_item(req: AnaliseItemUpdateRequest):
    try:
        if req.html_snapshot is not None:
             db.execute_query(
                "UPDATE tabAnaliseItens SET Obs=%s, HTML_Snapshot=%s WHERE ID=%s",
                (req.obs or "", req.html_snapshot, req.id_item)
            )
        else:
             db.execute_query(
                "UPDATE tabAnaliseItens SET Obs=%s WHERE ID=%s",
                (req.obs or "", req.id_item)
            )
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error updating item: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/analise/item/{item_id}")
def delete_analise_item(item_id: int):
    try:
        db.execute_query("DELETE FROM tabAnaliseItens WHERE ID=%s", (item_id,))
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error deleting item: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analise/preview")
def preview_analise(req: AnaliseRequest):
    try:
        problemas_dicts = [p.dict() for p in req.problemas]
        
        final_html = report_service.generate_final_html(
            req.nro_os, 
            req.ano_os, 
            req.versao, 
            req.componente, 
            req.usuario, 
            problemas_dicts
        )
        return {"html": final_html}
    except Exception as e:
        logger.error(f"Erro gerando preview: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        
@app.get("/api/email/inbox")
def get_email_inbox():
    try:
        return fetch_outlook_emails()
    except Exception as e:
        logger.error(f"Error fetching emails: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/email/download")
def download_attachment(entry_id: str, att_index: int):
    """
    Baixa um anexo específico de um e-mail usando o EntryID e o índice do anexo.
    """
    tmp_path = None
    filename = "download"
    
    try:
        pythoncom.CoInitialize()
        outlook = win32com.client.Dispatch("Outlook.Application")
        namespace = outlook.GetNamespace("MAPI")
        
        try:
            item = namespace.GetItemFromID(entry_id)
        except Exception as e:
            raise HTTPException(status_code=404, detail="Email não encontrado ou movido.")
            
        if item.Attachments.Count < att_index:
            raise HTTPException(status_code=404, detail="Anexo não encontrado.")
            
        att = item.Attachments.Item(att_index)
        filename = att.FileName
        
        temp_dir = tempfile.gettempdir()
        tmp_path = os.path.join(temp_dir, filename)
        
        att.SaveAsFile(tmp_path)
        
        return FileResponse(path=tmp_path, filename=filename, media_type='application/octet-stream')
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro download anexo: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        pythoncom.CoUninitialize()

# --- ROTA DO PAINEL DE MONITORAMENTO ---

@app.get("/api/os/panel")
def get_panel_data(setor: Optional[str] = Query(None)):
    """
    Retorna OSs com status críticos para o painel.
    Filtra opcionalmente por SETOR se fornecido.
    """
    
    # Query Base - ATENÇÃO: Os % foram duplicados para %% para evitar erro de formatação Python
    query = """
    SELECT 
        p.NroProtocolo AS nr_os, 
        p.AnoProtocolo AS ano, 
        d.Titulo AS titulo, 
        p.NomeUsuario AS solicitante,
        a.SituacaoLink AS situacao, 
        p.EntregPrazoLink AS prioridade,
        d.TipoPublicacaoLink AS produto,
        a.SetorLink AS setor,
        p.EntregData AS data_entrega,
        d.Tiragem
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d ON (p.NroProtocolo = d.NroProtocoloLinkDet) AND (p.AnoProtocolo = d.AnoProtocoloLinkDet)
    LEFT JOIN tabAndamento AS a ON (p.NroProtocolo = a.NroProtocoloLink) AND (p.AnoProtocolo = a.AnoProtocoloLink)
    WHERE a.UltimoStatus = 1
    AND (
        a.SituacaoLink LIKE 'Saída p/%%' OR
        a.SituacaoLink LIKE 'Saída parcial p/%%' OR
        a.SituacaoLink = 'Em Execução' OR
        a.SituacaoLink = 'Recebido' OR
        a.SituacaoLink = 'Problemas Técnicos' OR
        a.SituacaoLink = 'Encam. de Docum.' OR
        a.SituacaoLink LIKE 'Tramit. de Prova p/%%' OR
        a.SituacaoLink LIKE 'Tramit. de Prévia p/%%'
    )
    """
    
    params = {}
    
    # Filtro Dinâmico de Setor
    if setor:
        query += " AND a.SetorLink = %(setor)s"
        params['setor'] = setor
        
    query += """
    ORDER BY 
        CASE 
            WHEN p.EntregPrazoLink LIKE '%%Prometido p/%%' THEN 0 
            WHEN p.EntregPrazoLink LIKE '%%Solicitado p/%%' THEN 1 
            ELSE 2 
        END ASC,
        p.EntregData ASC, 
        p.AnoProtocolo DESC, 
        p.NroProtocolo DESC
    """
    
    try:
        results = db.execute_query(query, params)
        return results
    except Exception as e:
        logger.error(f"Error fetching panel data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- Endpoints Existentes ---

@app.get("/api/os/search")
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
    # Base query filters
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
            "meta": {
                "page": page,
                "limit": limit,
                "total_records": total_records,
                "total_pages": total_pages
            }
        }
    except Exception as e:
        logger.error(f"Error in search_os: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/os/{ano}/{id}/details")
def get_os_details(ano: int, id: int):
    query = """
    SELECT 
        p.CodigoRequisic AS CodigoRequisicao, 
        p.CategoriaLink,
        p.NomeUsuario, 
        p.Titular, 
        p.SiglaOrgao, 
        p.GabSalaUsuario, 
        p.Andar, 
        p.Localizacao, 
        p.RamalUsuario, 
        p.OrgInteressado,
        p.CodUsuarioLink,
        p.NroProtocolo,
        p.AnoProtocolo,
        p.DataEntrada,
        p.ProcessoSolicit,
        p.CSnro,
        d.TiragemSolicitada,
        d.Tiragem AS TiragemFinal, 
        p.CotaRepro,
        p.CotaCartao,
        d.CotaTotal,
        d.Titulo,
        d.TipoPublicacaoLink,
        d.MaquinaLink,
        d.Tiragem, 
        d.Pags,
        d.FrenteVerso,
        d.ModelosArq,
        p.EntregPrazoLink,
        p.EntregData,
        d.PapelLink,
        d.PapelDescricao, 
        d.Cores,
        d.CoresDescricao, 
        d.DescAcabamento,
        d.Observ,
        p.ContatoTrab,
        d.MaterialFornecido, 
        d.Fotolito,
        d.ModeloDobra,
        d.ProvaImpressa,
        d.InsumosFornecidos,
        md.MidiaDigitalLink, 
        md.MidiaDigitDescricao,
        d.ElemGrafBrasao,
        d.ElemGrafTimbre,
        d.ElemGrafArteGab,
        d.ElemGrafAssinatura
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d 
        ON (p.NroProtocolo = d.NroProtocoloLinkDet) 
        AND (p.AnoProtocolo = d.AnoProtocoloLinkDet)
    LEFT JOIN tabMidiaDigital AS md 
        ON (p.NroProtocolo = md.NroProtocoloLinkMidia) 
        AND (p.AnoProtocolo = md.AnoProtocoloLinkMidia)
    WHERE p.NroProtocolo = %(id)s AND p.AnoProtocolo = %(ano)s
    """
    try:
        results = db.execute_query(query, {'id': id, 'ano': ano})
        if not results:
            raise HTTPException(status_code=404, detail="OS not found")
        return results[0]
    except Exception as e:
        logger.error(f"Error fetching details: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/os/{ano}/{id}/history")
def get_os_history(ano: int, id: int):
    query = """
    SELECT CodStatus, SituacaoLink, SetorLink, Data, Ponto, Observaçao
    FROM tabAndamento
    WHERE NroProtocoloLink = %(id)s AND AnoProtocoloLink = %(ano)s
    ORDER BY CodStatus
    """
    try:
        results = db.execute_query(query, {'id': id, 'ano': ano})
        return results
    except Exception as e:
        logger.error(f"Error fetching history: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/os/{ano}/{id}/history")
def add_os_history(ano: int, id: int, item: HistoryItem):
    def transaction_logic(cursor):
        update_query = "UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %(id)s AND AnoProtocoloLink = %(ano)s"
        cursor.execute(update_query, {'id': id, 'ano': ano})
        count_query = "SELECT COUNT(*) as count FROM tabAndamento WHERE NroProtocoloLink = %(id)s AND AnoProtocoloLink = %(ano)s"
        cursor.execute(count_query, {'id': id, 'ano': ano})
        result = cursor.fetchone()
        count = result['count'] if result else 0
        next_num = count + 1
        formatted_id = f"{id:05d}"
        new_cod_status = f"{formatted_id}{ano}-{next_num:02d}"
        insert_query = """
        INSERT INTO tabAndamento (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto)
        VALUES (%(cod)s, %(id)s, %(ano)s, %(situacao)s, %(setor)s, NOW(), 1, %(obs)s, %(usuario)s)
        """
        cursor.execute(insert_query, {
            'cod': new_cod_status, 'id': id, 'ano': ano, 'situacao': item.situacao,
            'setor': item.setor, 'obs': item.obs, 'usuario': item.usuario
        })
        return {"new_id": new_cod_status}
    try:
        result = db.execute_transaction([transaction_logic])
        return result[0]
    except Exception as e:
        logger.error(f"Transaction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- Aux Endpoints ---
@app.get("/api/aux/categorias")
def get_categorias():
    return db.execute_query("SELECT DISTINCT Categoria FROM tabcategorias ORDER BY Categoria")

@app.get("/api/aux/situacoes")
def get_situacoes():
    return db.execute_query("SELECT DISTINCT SituacaoLink as Situacao FROM tabAndamento WHERE SituacaoLink IS NOT NULL ORDER BY SituacaoLink")

@app.get("/api/aux/setores")
def get_setores():
    return db.execute_query("SELECT DISTINCT SetorLink as Setor FROM tabAndamento WHERE SetorLink IS NOT NULL ORDER BY SetorLink")

@app.get("/api/aux/maquinas")
def get_maquinas():
    return db.execute_query("SELECT DISTINCT MaquinaLink FROM tabDetalhesServico ORDER BY MaquinaLink")

@app.get("/api/aux/produtos")
def get_produtos():
    return db.execute_query("SELECT DISTINCT TipoPublicacaoLink as Produto FROM tabDetalhesServico ORDER BY TipoPublicacaoLink")

@app.get("/api/aux/papeis")
def get_papeis():
    return db.execute_query("SELECT DISTINCT Papel FROM tabPapel ORDER BY Papel")

@app.get("/api/aux/cores")
def get_cores():
    return db.execute_query("SELECT DISTINCT Cor FROM tabCores ORDER BY Cor")

app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)