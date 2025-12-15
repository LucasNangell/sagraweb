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
    email_entry_id: Optional[str] = None

class EmailSendRequest(BaseModel):
    to: List[str]
    subject: str
    html: str

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


@router.get("/pendencias")
def get_pendencias_os(setor: str = "SEFOC"):
    """
    Retorna lista de OSs cujo andamento atual (UltimoStatus=1) seja 'Encam. de Docum.'
    """
    try:
        query = """
            SELECT 
                p.NroProtocolo as os,
                p.AnoProtocolo as ano,
                a.SituacaoLink as situacao,
                a.SetorLink as setor,
                a.Data as data
            FROM tabProtocolos p
            INNER JOIN tabAndamento a ON 
                p.NroProtocolo = a.NroProtocoloLink 
                AND p.AnoProtocolo = a.AnoProtocoloLink
            WHERE a.UltimoStatus = 1
                AND a.SituacaoLink = 'Encam. de Docum.'
                AND a.SetorLink = %(setor)s
            ORDER BY a.Data DESC
        """
        result = db.execute_query(query, {'setor': setor})
        return result
    except Exception as e:
        logger.error(f"Error fetching pendencias: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/notification_status")
def get_notification_status(setor: str = "SEFOC"):
    """
    Retorna status de notificações: quantidade de emails e pendências
    """
    try:
        # Count de emails processáveis (usa mesma lógica do inbox)
        inbox_count = 0
        try:
            emails = fetch_outlook_emails()
            inbox_count = len(emails) if emails else 0
        except Exception as e:
            logger.error(f"Error counting inbox emails: {e}")
            inbox_count = 0
        
        # Count de pendências
        query = """
            SELECT COUNT(*) as total
            FROM tabProtocolos p
            INNER JOIN tabAndamento a ON 
                p.NroProtocolo = a.NroProtocoloLink 
                AND p.AnoProtocolo = a.AnoProtocoloLink
            WHERE a.UltimoStatus = 1
                AND a.SituacaoLink = 'Encam. de Docum.'
                AND a.SetorLink = %(setor)s
        """
        result = db.execute_query(query, {'setor': setor})
        pendencias_count = result[0]['total'] if result else 0
        
        has_notification = inbox_count > 0 or pendencias_count > 0
        
        return {
            "inbox_count": inbox_count,
            "pendencias_count": pendencias_count,
            "has_notification": has_notification
        }
    except Exception as e:
        logger.error(f"Error getting notification status: {e}")
        # Em caso de erro, retornar sem notificação
        return {
            "inbox_count": 0,
            "pendencias_count": 0,
            "has_notification": False
        }


@router.post("/andamento")
def create_andamento(request: AndamentoRequest):
    """
    Cria um novo andamento para uma OS específica
    """
    logger.info(f"Creating andamento for OS {request.os}/{request.ano}")
    
    def transaction_logic(cursor):
        # 1. Zerar UltimoStatus dos registros anteriores
        cursor.execute(
            "UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %(os)s AND AnoProtocoloLink = %(ano)s",
            {'os': request.os, 'ano': request.ano}
        )
        
        # 2. Calcular próximo CodStatus
        base_prefix = f"{request.os:05d}{request.ano}-"
        cursor.execute(
            f"SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE '{base_prefix}%'"
        )
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
        obs_formatada = format_andamento_obs(request.observacao or "")
        # Formatar ponto no padrão #.#00
        ponto_formatado = format_ponto(request.ponto)
        
        # 3. Inserir novo andamento
        cursor.execute(
            """INSERT INTO tabAndamento 
               (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, `Data`, UltimoStatus, `Observaçao`, Ponto) 
               VALUES (%(cod)s, %(os)s, %(ano)s, %(situacao)s, %(setor)s, NOW(), 1, %(obs)s, %(ponto)s)""",
            {
                'cod': new_cod, 
                'os': request.os, 
                'ano': request.ano, 
                'situacao': request.situacao, 
                'setor': request.setor, 
                'obs': obs_formatada, 
                'ponto': ponto_formatado
            }
        )
        return {"success": True, "cod_status": new_cod}
    
    try:
        result = db.execute_transaction([transaction_logic])[0]
        logger.info(f"Andamento created successfully: {result}")
        
        # Marcar email como lido e categorizar no Outlook
        outlook_success = True
        outlook_error = None
        
        if request.email_entry_id:
            pythoncom.CoInitialize()
            try:
                outlook = win32com.client.Dispatch("Outlook.Application")
                namespace = outlook.GetNamespace("MAPI")
                
                try:
                    # Localizar o email pelo EntryID
                    mail = namespace.GetItemFromID(request.email_entry_id)
                    
                    # Marcar como lido
                    mail.UnRead = False
                    
                    # Adicionar categoria
                    category_text = "Pedido atendido (lido e proc.)"
                    existing_categories = mail.Categories if mail.Categories else ""
                    
                    if category_text not in existing_categories:
                        if existing_categories:
                            mail.Categories = f"{existing_categories}; {category_text}"
                        else:
                            mail.Categories = category_text
                    
                    # Salvar alterações
                    mail.Save()
                    logger.info(f"Email {request.email_entry_id} marcado como lido e categorizado")
                    
                except Exception as outlook_ex:
                    outlook_success = False
                    outlook_error = str(outlook_ex)
                    logger.error(f"Error updating Outlook email: {outlook_ex}")
                    
            finally:
                pythoncom.CoUninitialize()
        
        # Adicionar informação sobre o Outlook na resposta
        result['outlook_updated'] = outlook_success
        if not outlook_success and outlook_error:
            result['outlook_error'] = outlook_error
            
        return result
        
    except Exception as e:
        logger.error(f"Error creating andamento: {e}")
        if "Duplicate entry" in str(e):
            raise HTTPException(status_code=409, detail="Erro de concorrência. Tente novamente.")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/send")
def send_email(request: EmailSendRequest):
    """
    Envia e-mail via Outlook COM
    """
    try:
        pythoncom.CoInitialize()
        outlook = win32com.client.Dispatch("Outlook.Application")
        mail = outlook.CreateItem(0)  # 0 = MailItem
        
        # Destinatários
        mail.To = "; ".join(request.to)
        
        # Assunto
        mail.Subject = request.subject
        
        # Corpo HTML
        mail.HTMLBody = request.html
        
        # Enviar
        mail.Send()
        
        logger.info(f"Email sent successfully to {request.to}")
        return {"success": True, "message": "E-mail enviado com sucesso"}
        
    except Exception as e:
        logger.error(f"Error sending email: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        pythoncom.CoUninitialize()


class EmailPTRequest(BaseModel):
    os: int
    ano: int
    versao: str
    to: List[str]
    ponto: str

@router.post("/send-pt")
def send_pt_email(request: EmailPTRequest):
    """
    Envia e-mail de Problemas Técnicos usando HTML salvo no banco de dados
    """
    try:
        # 1. Buscar HTML salvo no banco de dados
        query = """
            SELECT 
                p.email_pt_html,
                p.email_pt_versao,
                d.TipoPublicacaoLink as produto,
                d.Titulo as titulo
            FROM tabProtocolos p
            LEFT JOIN tabDetalhesServico d ON 
                p.NroProtocolo = d.NroProtocoloLinkDet AND 
                p.AnoProtocolo = d.AnoProtocoloLinkDet
            WHERE p.NroProtocolo = %(os)s AND p.AnoProtocolo = %(ano)s
        """
        result = db.execute_query(query, {'os': request.os, 'ano': request.ano})
        
        if not result or not result[0].get('email_pt_html'):
            raise HTTPException(
                status_code=404, 
                detail="HTML do e-mail não encontrado. Por favor, conclua a análise primeiro."
            )
        
        email_html = result[0]['email_pt_html']
        produto = result[0].get('produto') or 'Produto'
        titulo = result[0].get('titulo') or 'Título'
        
        # 2. Montar assunto padronizado
        # Formato: CGraf: Problemas Técnicos, arq. vx OS 0000/00 - Produto - Título
        ano_curto = str(request.ano)[-2:]  # Últimos 2 dígitos do ano
        assunto = f"CGraf: Problemas Técnicos, arq. v{request.versao} OS {request.os:04d}/{ano_curto} - {produto} - {titulo}"
        
        # 3. Enviar e-mail via Outlook
        pythoncom.CoInitialize()
        try:
            outlook = win32com.client.Dispatch("Outlook.Application")
            mail = outlook.CreateItem(0)  # 0 = MailItem
            
            # Destinatários
            mail.To = "; ".join(request.to)
            
            # Assunto
            mail.Subject = assunto
            
            # Corpo HTML (usar HTML salvo no banco)
            mail.HTMLBody = email_html
            
            # Enviar
            mail.Send()
            
            logger.info(f"PT Email sent successfully to {request.to} for OS {request.os}/{request.ano}")
            
        finally:
            pythoncom.CoUninitialize()
        
        # 4. Registrar andamento
        def transaction_andamento(cursor):
            # Zerar UltimoStatus dos registros anteriores
            cursor.execute(
                "UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %(os)s AND AnoProtocoloLink = %(ano)s",
                {'os': request.os, 'ano': request.ano}
            )
            
            # Calcular próximo CodStatus
            base_prefix = f"{request.os:05d}{request.ano}-"
            cursor.execute(
                f"SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE '{base_prefix}%'"
            )
            res = cursor.fetchone()
            
            next_seq = 1
            if res and res['max_cod']:
                try:
                    existing_suffix = res['max_cod'].split('-')[-1]
                    next_seq = int(existing_suffix) + 1
                except ValueError:
                    next_seq = 1
                    
            new_cod = f"{base_prefix}{next_seq:02d}"
            
            # Inserir novo andamento com hora formatada
            obs = f"PTV{request.versao} enviado"
            obs_formatada = format_andamento_obs(obs)
            ponto_formatado = format_ponto(request.ponto)
            
            cursor.execute(
                """INSERT INTO tabAndamento 
                   (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, `Data`, UltimoStatus, `Observaçao`, Ponto) 
                   VALUES (%(cod)s, %(os)s, %(ano)s, %(situacao)s, %(setor)s, NOW(), 1, %(obs)s, %(ponto)s)""",
                {
                    'cod': new_cod, 
                    'os': request.os, 
                    'ano': request.ano, 
                    'situacao': 'Pendência Usuário',
                    'setor': 'SEFOC', 
                    'obs': obs_formatada, 
                    'ponto': ponto_formatado
                }
            )
            return {"success": True, "cod_status": new_cod}
        
        try:
            andamento_result = db.execute_transaction([transaction_andamento])[0]
            logger.info(f"Andamento created for PT email: {andamento_result}")
        except Exception as e:
            logger.error(f"Error creating andamento after email send: {e}")
            # Não falhar o envio se o andamento falhar
        
        return {
            "success": True, 
            "message": "E-mail enviado com sucesso",
            "subject": assunto
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sending PT email: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/pt-html/{ano}/{os}")
def get_pt_html(ano: int, os: int):
    """
    Busca HTML de e-mail PT salvo no banco para prévia
    """
    try:
        query = """
            SELECT email_pt_html, email_pt_versao, email_pt_data
            FROM tabProtocolos 
            WHERE NroProtocolo = %(os)s AND AnoProtocolo = %(ano)s
        """
        result = db.execute_query(query, {'os': os, 'ano': ano})
        
        if not result or not result[0].get('email_pt_html'):
            raise HTTPException(
                status_code=404, 
                detail="HTML não encontrado. Conclua a análise primeiro para gerar o e-mail."
            )
        
        return {
            "html": result[0]['email_pt_html'],
            "versao": result[0].get('email_pt_versao'),
            "data": result[0].get('email_pt_data')
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching PT HTML: {e}")
        raise HTTPException(status_code=500, detail=str(e))
