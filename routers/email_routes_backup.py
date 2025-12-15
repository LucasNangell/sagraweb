from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
import logging
import pythoncom
import win32com.client
import os
import tempfile
from database import db

router = APIRouter(prefix="/email")
logger = logging.getLogger(__name__)

# Modelos Pydantic para requisições
class AndamentoRequest(BaseModel):
    os: int
    ano: int
    situacao: str
    setor: str
    observacao: str
    ponto: str

class EmailSendRequest(BaseModel):
    to: List[str]
    subject: str
    html: str

# Copiar aqui a função fetch_outlook_emails do seu arquivo original (ela é grande e não mudou)
# Vou colocar uma versão resumida aqui para não estourar o limite, 
# mas você deve COPIAR E COLAR a função `fetch_outlook_emails` que estava no seu server.py antigo.

# --- SERVICE DE E-MAIL (Integração Local Outlook) ---

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

@router.get("/inbox")
def get_email_inbox():
    try:
        return fetch_outlook_emails()
    except Exception as e:
        logger.error(f"Error fetching emails: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/download")
def download_attachment(entry_id: str, att_index: int):
    try:
        pythoncom.CoInitialize()
        outlook = win32com.client.Dispatch("Outlook.Application")
        namespace = outlook.GetNamespace("MAPI")
        item = namespace.GetItemFromID(entry_id)
        att = item.Attachments.Item(att_index)
        filename = att.FileName
        tmp_path = os.path.join(tempfile.gettempdir(), filename)
        att.SaveAsFile(tmp_path)
        return FileResponse(path=tmp_path, filename=filename, media_type='application/octet-stream')
    except Exception as e:
        logger.error(f"Download Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        pythoncom.CoUninitialize()