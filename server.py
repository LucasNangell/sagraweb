from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
from database import db
import logging
import os
import datetime
import json
# Imports para E-mail
import imaplib
import email
from email.header import decode_header
from report_service import report_service
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi import Request
from starlette.responses import HTMLResponse
import socket
import tempfile
from routers.andamento_helpers import format_andamento_obs, format_ponto
import glob
import io
from fpdf import FPDF


# --- WebSocket Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket Client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket Client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        # Filter disconnected clients
        to_remove = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting to client: {e}")
                to_remove.append(connection)
        
        for conn in to_remove:
            self.disconnect(conn)

manager = ConnectionManager()


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


# --- IP Authorization Middleware & Startup setup ---
def _get_host_primary_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _is_client_path(path: str) -> bool:
    p = path.lower()
    
    if p.startswith("/client"):
        return True
    if "client_pt" in p or "client_proof" in p:
        return True
    return False
    if p.startswith("/client"):
        return True
    if "client_pt" in p or "client_proof" in p:
        return True
    return False


def _get_request_ip(request: Request) -> str:
    # Use the direct peer address. Do NOT trust X-Forwarded-For headers
    # unless you explicitly configure a trusted proxy list (to avoid header spoofing).
    try:
        return request.client.host
    except Exception:
        return "0.0.0.0"


@app.middleware("http")
async def check_ip_authorization(request: Request, call_next):
    # Allow client pages and routes without checking
    if _is_client_path(request.url.path):
        return await call_next(request)
    client_ip = _get_request_ip(request)

    # If request comes from localhost (127.0.0.1 or ::1) treat it as host IP
    # so the admin UI opened on the same machine is allowed when the host
    # IP (e.g. 10.120.1.12) is in the whitelist. This does not affect remote clients.
    if client_ip in ("127.0.0.1", "::1"):
        try:
            host_ip = _get_host_primary_ip()
            logger.info(f"Local request mapped: loopback {client_ip} -> host_ip {host_ip}")
            client_ip = host_ip
        except Exception:
            pass

    # Log for debugging authorization issues
    try:
        xff = request.headers.get("x-forwarded-for", "")
        logger.info(f"IP auth check — client_ip={client_ip}, x-forwarded-for={xff}, path={request.url.path}")

        # Query table for IP
        rows = db.execute_query("SELECT id, ativo FROM tabIpPermitidos WHERE ip = %s LIMIT 1", (client_ip,))
        if rows and len(rows) > 0 and rows[0].get("ativo"):
            logger.info(f"IP {client_ip} autorizado — acesso liberado para {request.url.path}")
            return await call_next(request)
        else:
            logger.warning(f"IP {client_ip} NAO autorizado — negando acesso a {request.url.path}")
            html = "<h2>Acesso negado</h2><p>Seu IP não está autorizado a acessar o sistema SAGRA.</p>"
            return HTMLResponse(content=html, status_code=403)
    except Exception as e:
        # In case of DB error, block access conservatively
        logger.error(f"Erro verificando IP autorizado: {e}")
        html = "<h2>Acesso negado</h2><p>Seu IP não está autorizado a acessar o sistema SAGRA.</p>"
        return HTMLResponse(content=html, status_code=403)


@app.on_event("startup")
def ensure_ip_table():
    try:
        # Create table if not exists (MySQL)
        db.execute_query(
            """
            CREATE TABLE IF NOT EXISTS tabIpPermitidos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ip VARCHAR(45) NOT NULL,
                descricao VARCHAR(255) DEFAULT NULL,
                ativo TINYINT(1) DEFAULT 1,
                UNIQUE KEY (ip)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """
        )

        host_ip = _get_host_primary_ip()
        # Insert current host IP if missing
        existing = db.execute_query("SELECT id FROM tabIpPermitidos WHERE ip = %s", (host_ip,))
        if not existing:
            try:
                db.execute_query("INSERT INTO tabIpPermitidos (ip, descricao, ativo) VALUES (%s, %s, %s)", (host_ip, "auto-inserted host", 1))
                logger.info(f"Inserted host IP into tabIpPermitidos: {host_ip}")
            except Exception as ie:
                logger.error(f"Erro inserindo IP inicial: {ie}")
    except Exception as e:
        logger.error(f"Erro durante criação/verificação de tabela tabIpPermitidos: {e}")


# --- Models ---

class HistoryItem(BaseModel):
    situacao: str
    setor: str
    obs: str
    usuario: str

# --- CONFIGURAÇÃO DO WEBSOCKET ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive and listen for any client messages (ping/pong)
            data = await websocket.receive_text()
            # Optional: handle client messages if needed
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

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

@app.get("/api/download/folder-opener")
async def download_folder_opener():
    """
    Endpoint para download do executável SAGRA Folder Opener
    
    Permite que usuários baixem o serviço local que possibilita
    a abertura automática de pastas do Windows Explorer.
    
    Returns:
        FileResponse: Executável .exe
    """
    try:
        exe_path = os.path.join("local_services", "dist", "SAGRA-FolderOpener.exe")
        
        if not os.path.exists(exe_path):
            logger.warning(f"Executável não encontrado: {exe_path}")
            raise HTTPException(
                status_code=404,
                detail="Executável não disponível. Entre em contato com o suporte."
            )
        
        # Caminho sugerido para instalação automática no startup
        suggested_filename = "SAGRA-FolderOpener.exe"
        
        logger.info(f"Download do folder opener iniciado")
        
        return FileResponse(
            path=exe_path,
            media_type="application/octet-stream",
            filename=suggested_filename,
            headers={
                "Content-Disposition": f'attachment; filename="{suggested_filename}"',
                "X-Suggested-Path": "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao servir executável: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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


@app.get("/api/os/{ano}/{id}/path")
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


# --- Settings: persistência de filtros do usuário ---


class Content(BaseModel):
    usuario: str
    ponto: str
    situacoes: list
    setores: list


@app.post("/api/settings/filtros/salvar")
def save_user_filters(req: Content):
    def transaction(cursor):
        # Serializar
        sit_json = json.dumps(req.situacoes)
        set_json = json.dumps(req.setores)
        
        # Upsert (Insert on Duplicate Key Update)
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


@app.get("/api/settings/filtros/ponto/{identifier}")
def get_user_filters(identifier: str):
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
            "usuario": "Desconhecido",
            "ponto": identifier,
            "situacoes": [],
            "setores": []
        }
    except Exception as e:
        logger.error(f"Erro ao buscar filtros: {e}")
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


@app.get("/api/analise/client/{ano}/{os_id}")
def validate_client_token_api(ano: int, os_id: int, token: str = Query(...)):
    try:
        token_rec = db.execute_query("SELECT ID_Analise, DataExpiracao FROM tabClientTokens WHERE NroProtocolo=%s AND AnoProtocolo=%s AND Token=%s", (os_id, ano, token))
        if not token_rec:
            raise HTTPException(status_code=403, detail="Acesso negado. Token inválido ou expirado.")

        if token_rec[0].get('DataExpiracao'):
            raise HTTPException(status_code=403, detail="Acesso negado. Link expirado (arquivos já enviados).")

        id_analise = token_rec[0]['ID_Analise']

        header = db.execute_query("SELECT ID, Versao, Componente FROM tabAnalises WHERE ID=%s", (id_analise,))
        if not header:
            raise HTTPException(status_code=404, detail="Análise não encontrada.")

        items = db.execute_query("""
            SELECT i.ID as uniqueId, i.ID_ProblemaPadrao as originalId, i.Obs as obs, i.HTML_Snapshot as html, 
                   i.Componente as componenteOrigem, p.TituloPT as titulo, i.Desconsiderado as desconsiderado,
                   i.Resolver as resolver
            FROM tabAnaliseItens i LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID WHERE i.ID_Analise = %s
        """, (id_analise,))

        return {
            "exists": True,
            "items": items,
            "componente": header[0].get('Componente'),
            "titulo": f"OS {os_id}/{ano}"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error validating client token: {e}")
        raise HTTPException(status_code=500, detail=str(e))


    @app.get("/api/client/report/{ano}/{os_id}")
    def generate_client_report_pdf(ano: int, os_id: int, request: Request, token: str = Query(...)):
        try:
            token_rec = db.execute_query("SELECT ID_Analise, DataExpiracao FROM tabClientTokens WHERE NroProtocolo=%s AND AnoProtocolo=%s AND Token=%s", (os_id, ano, token))
            if not token_rec:
                raise HTTPException(status_code=403, detail="Acesso negado. Token inválido ou expirado.")

            if token_rec[0].get('DataExpiracao'):
                raise HTTPException(status_code=403, detail="Acesso negado. Link expirado (arquivos já enviados).")

            id_analise = token_rec[0]['ID_Analise']

            header = db.execute_query("SELECT ID, Versao, Componente FROM tabAnalises WHERE ID=%s", (id_analise,))
            if not header:
                raise HTTPException(status_code=404, detail="Análise não encontrada.")

            items = db.execute_query("""
                SELECT i.ID as uniqueId, i.ID_ProblemaPadrao as originalId, i.Obs as obs, i.HTML_Snapshot as html, 
                       i.Componente as componenteOrigem, p.TituloPT as titulo, i.Desconsiderado as desconsiderado,
                       i.Resolver as resolver
                FROM tabAnaliseItens i LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID WHERE i.ID_Analise = %s
            """, (id_analise,))

            pdf = FPDF()
            pdf.set_auto_page_break(auto=True, margin=15)
            pdf.add_page()
            pdf.set_font("Arial", "B", 16)
            pdf.cell(0, 10, f"Relatório Técnico - OS {os_id}/{ano}", ln=True, align="C")
            pdf.set_font("Arial", "", 12)
            pdf.cell(0, 10, f"OS {os_id}/{ano}", ln=True, align="C")
            pdf.line(10, 30, 200, 30)
            pdf.ln(10)

            import re
            for idx, item in enumerate(items, start=1):
                pdf.set_font("Arial", "B", 14)
                status_txt = ""
                if item.get('desconsiderado'):
                    pdf.set_text_color(192, 57, 43)
                    status_txt = " (DESCONSIDERADO)"
                elif item.get('resolver'):
                    pdf.set_text_color(39, 174, 96)
                    status_txt = " (RESOLVIDO)"
                else:
                    pdf.set_text_color(0, 0, 0)

                pdf.cell(0, 10, f"{idx}. {item.get('titulo')}{status_txt}", ln=True)
                pdf.set_text_color(0, 0, 0)
                pdf.set_font("Arial", "I", 10)
                pdf.set_text_color(100, 100, 100)
                pdf.cell(0, 8, f"Componente: {item.get('componenteOrigem') or 'Geral'}", ln=True)
                pdf.set_text_color(0, 0, 0)

                if item.get('html') and len(item['html'].strip()) > 0:
                    clean_text = re.sub('<[^<]+?>', '', item['html'])
                    pdf.set_font("Courier", "", 9)
                    pdf.multi_cell(0, 5, f"Evidencia (Texto):\n{clean_text[:2000]}")
                else:
                    pdf.set_font("Arial", "I", 10)
                    pdf.cell(0, 10, "(Sem evidência visual)", ln=True)

                pdf.ln(5)
                pdf.set_font("Arial", "B", 10)
                pdf.cell(0, 6, "Observação Técnica:", ln=True)
                pdf.set_font("Arial", "", 10)
                pdf.multi_cell(0, 5, item.get('obs') or "(Sem observações)")
                pdf.ln(5)
                pdf.set_draw_color(200, 200, 200)
                pdf.line(10, pdf.get_y(), 200, pdf.get_y())
                pdf.set_draw_color(0, 0, 0)
                pdf.ln(5)

            buffer = io.BytesIO()
            pdf.output(buffer)
            buffer.seek(0)

            return StreamingResponse(
                buffer,
                media_type="application/pdf",
                headers={"Content-Disposition": f"attachment; filename=Relatorio_OS_{os_id}_{ano}.pdf"}
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Erro gerando PDF (FPDF): {e}")
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
        p.EntregData AS data_entrega,
        a.Data AS last_update
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


# Models for OS save/duplicate (copied from routers/os_routes.py)
class DuplicateRequest(BaseModel):
    usuario: str

class SaveOSRequest(BaseModel):
    NroProtocolo: Optional[int] = None
    AnoProtocolo: Optional[int] = None
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
    MaterialFornecido: Optional[bool] = False
    Fotolito: Optional[bool] = False
    ModeloDobra: Optional[bool] = False
    ProvaImpressa: Optional[bool] = False
    InsumosFornecidos: Optional[str] = None
    ElemGrafBrasao: Optional[bool] = False
    ElemGrafTimbre: Optional[bool] = False
    ElemGrafArteGab: Optional[bool] = False
    ElemGrafAssinatura: Optional[bool] = False
    PontoUsuario: Optional[str] = None


@app.post("/api/os/save")
async def save_os(data: SaveOSRequest):
    # Sanitize empty strings to None
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

        current_year = data.AnoProtocolo if data.AnoProtocolo else datetime.datetime.now().year

        new_id = data.NroProtocolo
        if not is_update:
            cursor.execute("SELECT MAX(NroProtocolo) as max_id FROM tabProtocolos WHERE AnoProtocolo = %s AND NroProtocolo < 5000", (current_year,))
            res = cursor.fetchone()
            max_id = res['max_id'] if res and res.get('max_id') else 0
            new_id = max_id + 1

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
                    OrgInteressado
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(query_proto, (
                new_id, current_year,
                data.CodigoRequisicao, data.CategoriaLink, data.NomeUsuario, data.Titular, data.SiglaOrgao,
                data.GabSalaUsuario, data.Andar, data.Localizacao, data.RamalUsuario,
                data.DataEntrada, data.ProcessoSolicit, data.CSnro,
                data.EntregPrazoLink, data.EntregData, data.ContatoTrab, 'Câmara dos Deputados'
            ))

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
                data.TiragemSolicitada, data.TiragemFinal,
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
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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

        return {"status": "ok", "id": new_id, "ano": current_year, "message": "OS salva com sucesso", "action": "update" if is_update else "create"}

    try:
        result = db.execute_transaction([transaction_logic])
        # Broadcast Update
        res_data = result[0]
        await manager.broadcast({
            "type": "system_update",
            "entity": "os",
            "action": res_data.get("action", "update"),
            "id": res_data['id'],
            "ano": res_data['ano'],
            "timestamp": datetime.datetime.now().isoformat()
        })
        return res_data
    except Exception as e:
        logger.error(f"Save OS error: {e}")
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
async def add_os_history(ano: int, id: int, item: HistoryItem):
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
        if res and res.get('max_cod'):
            try:
                existing_suffix = res['max_cod'].split('-')[-1]
                next_seq = int(existing_suffix) + 1
            except Exception:
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
        result = db.execute_transaction([transaction_logic])
        # Broadcast
        await manager.broadcast({
            "type": "system_update",
            "entity": "os",
            "action": "history_add",
            "id": id,
            "ano": ano,
            "timestamp": datetime.datetime.now().isoformat()
        })
        return result[0]
    except Exception as e:
        logger.error(f"Transaction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class HistoryUpdateItem(HistoryItem):
    cod_status: str


@app.put("/api/os/{ano}/{id}/history")
async def update_os_history(ano: int, id: int, item: HistoryUpdateItem):
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
        # Broadcast
        await manager.broadcast({
            "type": "system_update",
            "entity": "os",
            "action": "history_update",
            "id": id,
            "ano": ano,
            "timestamp": datetime.datetime.now().isoformat()
        })
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Update history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/os/{ano}/{id}/history/{cod_status}")
async def delete_os_history(ano: int, id: int, cod_status: str):
    def transaction_logic(cursor):
        # 1. Delete the specific item
        cursor.execute("DELETE FROM tabAndamento WHERE CodStatus = %s AND NroProtocoloLink = %s AND AnoProtocoloLink = %s", (cod_status, id, ano))

        # 2. Fix UltimoStatus
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
        # Broadcast
        await manager.broadcast({
            "type": "system_update",
            "entity": "os",
            "action": "history_delete",
            "id": id,
            "ano": ano,
            "timestamp": datetime.datetime.now().isoformat()
        })
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Delete history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/os/{ano}/{id}/vinculos")
def list_os_vinculos(ano: int, id: int):
    try:
        query = """
            SELECT os_principal_numero as principal_num, os_principal_ano as principal_ano,
                   os_vinculada_numero as vinc_num, os_vinculada_ano as vinc_ano, data_vinculo
            FROM tabOSVinculadas
            WHERE (os_principal_numero = %s AND os_principal_ano = %s)
               OR (os_vinculada_numero = %s AND os_vinculada_ano = %s)
        """
        rows = db.execute_query(query, (id, ano, id, ano))
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


@app.post("/api/os/{ano}/{id}/vincular")
def create_vinculo(ano: int, id: int, req: VinculoRequest):
    try:
        if req.numero == id and req.ano == ano:
            raise HTTPException(status_code=400, detail="Não é possível vincular uma OS a ela mesma.")
        p = db.execute_query("SELECT 1 FROM tabProtocolos WHERE NroProtocolo=%s AND AnoProtocolo=%s", (id, ano))
        q = db.execute_query("SELECT 1 FROM tabProtocolos WHERE NroProtocolo=%s AND AnoProtocolo=%s", (req.numero, req.ano))
        if not p or not q:
            raise HTTPException(status_code=404, detail="Uma das OSs não existe.")
        dup = db.execute_query("SELECT 1 FROM tabOSVinculadas WHERE (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s) OR (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s)",
                               (id, ano, req.numero, req.ano, req.numero, req.ano, id, ano))
        if dup:
            raise HTTPException(status_code=409, detail="Vínculo já existe.")
        db.execute_query("INSERT INTO tabOSVinculadas (os_principal_numero, os_principal_ano, os_vinculada_numero, os_vinculada_ano) VALUES (%s,%s,%s,%s)",
                         (id, ano, req.numero, req.ano))
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating vinculo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/os/{ano}/{id}/vinculo/{v_num}/{v_ano}")
def delete_vinculo(ano: int, id: int, v_num: int, v_ano: int):
    try:
        db.execute_query("DELETE FROM tabOSVinculadas WHERE (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s) OR (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s)",
                         (id, ano, v_num, v_ano, v_num, v_ano, id, ano))
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error deleting vinculo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/os/{ano}/{id}/history/replicate")
def replicate_history(ano: int, id: int, item: HistoryItem):
    def transaction_logic(cursor):
        cursor.execute("SELECT os_principal_numero as principal_num, os_principal_ano as principal_ano, os_vinculada_numero as vinc_num, os_vinculada_ano as vinc_ano FROM tabOSVinculadas WHERE (os_principal_numero = %s AND os_principal_ano = %s) OR (os_vinculada_numero = %s AND os_vinculada_ano = %s)", (id, ano, id, ano))
        rows = cursor.fetchall()
        targets = set()
        targets.add((id, ano))
        for r in rows:
            if r['principal_num'] == id and r['principal_ano'] == ano:
                targets.add((r['vinc_num'], r['vinc_ano']))
            else:
                targets.add((r['principal_num'], r['principal_ano']))
        for (t_num, t_ano) in targets:
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


@app.post("/api/os/{ano}/{id}/vinculo/excecao")
def create_vinculo_excecao(ano: int, id: int, body: dict):
    try:
        obs = body.get('observacao') if body else None
        db.execute_query("INSERT INTO tabOSVinculoExcecoes (NroProtocolo, AnoProtocolo, Observacao) VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE Observacao = VALUES(Observacao)", (id, ano, obs))
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error creating vinculo excecao: {e}")
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


# --- Admin endpoints for IP management (protected by IP middleware) ---
@app.get("/api/admin/ip/list")
def admin_list_ips():
    try:
        return db.execute_query("SELECT id, ip, descricao, ativo FROM tabIpPermitidos ORDER BY id DESC")
    except Exception as e:
        logger.error(f"Erro listando IPs: {e}")
        raise HTTPException(status_code=500, detail="Erro listando IPs")


@app.post("/api/admin/ip/add")
def admin_add_ip(item: dict):
    ip = item.get('ip')
    descricao = item.get('descricao') or None
    ativo = 1 if item.get('ativo', True) else 0
    if not ip:
        raise HTTPException(status_code=400, detail="Campo 'ip' é obrigatório")
    try:
        db.execute_query("INSERT INTO tabIpPermitidos (ip, descricao, ativo) VALUES (%s, %s, %s)", (ip, descricao, ativo))
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Erro adicionando IP: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/ip/update")
def admin_update_ip(item: dict):
    _id = item.get('id')
    if not _id:
        raise HTTPException(status_code=400, detail="Campo 'id' é obrigatório")
    fields = []
    params = []
    if 'ip' in item:
        fields.append('ip = %s')
        params.append(item.get('ip'))
    if 'descricao' in item:
        fields.append('descricao = %s')
        params.append(item.get('descricao'))
    if 'ativo' in item:
        fields.append('ativo = %s')
        params.append(1 if item.get('ativo') else 0)
    if not fields:
        return {"status": "nochange"}
    params.append(_id)
    try:
        q = f"UPDATE tabIpPermitidos SET {', '.join(fields)} WHERE id = %s"
        db.execute_query(q, tuple(params))
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Erro atualizando IP: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/ip/delete")
def admin_delete_ip(item: dict):
    _id = item.get('id')
    if not _id:
        raise HTTPException(status_code=400, detail="Campo 'id' é obrigatório")
    try:
        db.execute_query("DELETE FROM tabIpPermitidos WHERE id = %s", (_id,))
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Erro deletando IP: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/aux/setores")
def get_setores():
    """Retorna lista de setores disponíveis do banco de dados"""
    try:
        query = "SELECT DISTINCT Setor FROM tabSetor ORDER BY Setor ASC"
        result = db.execute_query(query)
        setores = [{"Setor": row.get("Setor")} for row in result if row.get("Setor")]
        if not any(s.get("Setor") == "Gravação" for s in setores):
            setores.append({"Setor": "Gravação"})
        return setores
    except Exception as e:
        logger.error(f"Error fetching setores: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/aux/andamentos")
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

# Serve static files from the project root regardless of the working directory
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)