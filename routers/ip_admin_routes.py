"""
Rotas para administração de permissões por IP
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from database import Database
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

class IPPermission(BaseModel):
    ip: str
    descricao: Optional[str] = ""
    grupo: Optional[str] = "Sem Grupo"
    ativo: bool = True
    
    # Menu de Contexto
    ctx_nova_os: bool = True
    ctx_duplicar_os: bool = True
    ctx_editar_os: bool = True
    ctx_vincular_os: bool = True
    ctx_abrir_pasta: bool = True
    ctx_imprimir_ficha: bool = True
    ctx_detalhes_os: bool = True
    
    # Sidebar
    sb_inicio: bool = True
    sb_gerencia: bool = True
    sb_email: bool = True
    sb_analise: bool = True
    sb_papelaria: bool = True
    sb_usuario: bool = True
    sb_configuracoes: bool = True

class IPPermissionUpdate(BaseModel):
    id: int
    ip: Optional[str] = None
    descricao: Optional[str] = None
    grupo: Optional[str] = None
    ativo: Optional[bool] = None
    
    # Menu de Contexto
    ctx_nova_os: Optional[bool] = None
    ctx_duplicar_os: Optional[bool] = None
    ctx_editar_os: Optional[bool] = None
    ctx_vincular_os: Optional[bool] = None
    ctx_abrir_pasta: Optional[bool] = None
    ctx_imprimir_ficha: Optional[bool] = None
    ctx_detalhes_os: Optional[bool] = None
    
    # Sidebar
    sb_inicio: Optional[bool] = None
    sb_gerencia: Optional[bool] = None
    sb_email: Optional[bool] = None
    sb_analise: Optional[bool] = None
    sb_papelaria: Optional[bool] = None
    sb_usuario: Optional[bool] = None
    sb_configuracoes: Optional[bool] = None

class IPDelete(BaseModel):
    id: int


def check_ip_permission(client_ip: str, ip_pattern: str) -> bool:
    """
    Verifica se o IP do cliente corresponde ao padrão
    Suporta wildcards com %
    """
    if '%' not in ip_pattern:
        return client_ip == ip_pattern
    
    # Converte pattern SQL para regex
    import re
    pattern = ip_pattern.replace('.', r'\.').replace('%', r'.*')
    return bool(re.match(f"^{pattern}$", client_ip))


def get_client_permissions(client_ip: str) -> dict:
    """
    Busca as permissões do IP do cliente no banco
    PRIORIDADE: IP específico > IP wildcard > Backward compatibility (tudo TRUE)
    """
    db = Database()
    
    try:
        with db.cursor() as cursor:
            # 1. PRIMEIRA TENTATIVA: Buscar match EXATO (prioridade máxima)
            cursor.execute("""
                SELECT * FROM ip_permissions 
                WHERE ativo = TRUE AND ip = %s
                LIMIT 1
            """, (client_ip,))
            
            exact_match = cursor.fetchone()
            if exact_match:
                logger.info(f"✓ Permissões encontradas para IP EXATO: {client_ip}")
                return {
                    'ctx_nova_os': bool(exact_match.get('ctx_nova_os', True)),
                    'ctx_duplicar_os': bool(exact_match.get('ctx_duplicar_os', True)),
                    'ctx_editar_os': bool(exact_match.get('ctx_editar_os', True)),
                    'ctx_vincular_os': bool(exact_match.get('ctx_vincular_os', True)),
                    'ctx_abrir_pasta': bool(exact_match.get('ctx_abrir_pasta', True)),
                    'ctx_imprimir_ficha': bool(exact_match.get('ctx_imprimir_ficha', True)),
                    'ctx_detalhes_os': bool(exact_match.get('ctx_detalhes_os', True)),
                    'sb_inicio': bool(exact_match.get('sb_inicio', True)),
                    'sb_gerencia': bool(exact_match.get('sb_gerencia', True)),
                    'sb_email': bool(exact_match.get('sb_email', True)),
                    'sb_analise': bool(exact_match.get('sb_analise', True)),
                    'sb_papelaria': bool(exact_match.get('sb_papelaria', True)),
                    'sb_usuario': bool(exact_match.get('sb_usuario', True)),
                    'sb_configuracoes': bool(exact_match.get('sb_configuracoes', True)),
                }
            
            # 2. SEGUNDA TENTATIVA: Buscar wildcards (apenas se não encontrou exato)
            cursor.execute("""
                SELECT * FROM ip_permissions 
                WHERE ativo = TRUE AND ip LIKE '%\%%' 
                ORDER BY LENGTH(ip) DESC, ip DESC
            """)
            
            wildcard_ips = cursor.fetchall()
            
            # Verificar wildcards do mais específico para o menos específico
            for ip_data in wildcard_ips:
                if check_ip_permission(client_ip, ip_data['ip']):
                    logger.info(f"✓ Permissões encontradas para IP WILDCARD: {client_ip} (padrão: {ip_data['ip']})")
                    return {
                        'ctx_nova_os': bool(ip_data.get('ctx_nova_os', True)),
                        'ctx_duplicar_os': bool(ip_data.get('ctx_duplicar_os', True)),
                        'ctx_editar_os': bool(ip_data.get('ctx_editar_os', True)),
                        'ctx_vincular_os': bool(ip_data.get('ctx_vincular_os', True)),
                        'ctx_abrir_pasta': bool(ip_data.get('ctx_abrir_pasta', True)),
                        'ctx_imprimir_ficha': bool(ip_data.get('ctx_imprimir_ficha', True)),
                        'ctx_detalhes_os': bool(ip_data.get('ctx_detalhes_os', True)),
                        'sb_inicio': bool(ip_data.get('sb_inicio', True)),
                        'sb_gerencia': bool(ip_data.get('sb_gerencia', True)),
                        'sb_email': bool(ip_data.get('sb_email', True)),
                        'sb_analise': bool(ip_data.get('sb_analise', True)),
                        'sb_papelaria': bool(ip_data.get('sb_papelaria', True)),
                        'sb_usuario': bool(ip_data.get('sb_usuario', True)),
                        'sb_configuracoes': bool(ip_data.get('sb_configuracoes', True)),
                    }
            
            # 3. NÃO ENCONTROU: Retorna todas permissões TRUE (backward compatibility)
            logger.warning(f"⚠ IP {client_ip} não encontrado. Permitindo tudo (modo compatibilidade).")
            return {
                'ctx_nova_os': True,
                'ctx_duplicar_os': True,
                'ctx_editar_os': True,
                'ctx_vincular_os': True,
                'ctx_abrir_pasta': True,
                'ctx_imprimir_ficha': True,
                'ctx_detalhes_os': True,
                'sb_inicio': True,
                'sb_gerencia': True,
                'sb_email': True,
                'sb_analise': True,
                'sb_papelaria': True,
                'sb_usuario': True,
                'sb_configuracoes': True,
            }
            
    except Exception as e:
        logger.error(f"Erro ao buscar permissões para IP {client_ip}: {e}")
        # Em caso de erro, retorna tudo TRUE para não quebrar o sistema
        return {k: True for k in [
            'ctx_nova_os', 'ctx_duplicar_os', 'ctx_editar_os', 'ctx_vincular_os',
            'ctx_abrir_pasta', 'ctx_imprimir_ficha', 'ctx_detalhes_os', 'sb_inicio', 'sb_gerencia',
            'sb_email', 'sb_analise', 'sb_papelaria', 'sb_usuario', 'sb_configuracoes'
        ]}


@router.get("/api/permissions")
async def get_permissions(request: Request):
    """
    Retorna as permissões do IP do cliente
    Usado pelo frontend para ocultar elementos
    """
    client_ip = request.client.host
    permissions = get_client_permissions(client_ip)
    return permissions


@router.get("/api/admin/ip/list")
async def list_ips():
    """Lista todos os IPs cadastrados"""
    db = Database()
    
    with db.cursor() as cursor:
        cursor.execute("""
            SELECT * FROM ip_permissions
            ORDER BY grupo ASC, ativo DESC, ip ASC
        """)
        
        ips = cursor.fetchall()
        return ips


@router.get("/api/admin/ip/groups")
async def list_groups():
    """Lista todos os grupos distintos"""
    db = Database()
    
    with db.cursor() as cursor:
        cursor.execute("""
            SELECT DISTINCT grupo 
            FROM ip_permissions 
            WHERE grupo IS NOT NULL
            ORDER BY grupo ASC
        """)
        
        groups = cursor.fetchall()
        return [g['grupo'] for g in groups]


@router.post("/api/admin/ip/add")
async def add_ip(data: IPPermission):
    """Adiciona novo IP com permissões"""
    db = Database()
    
    with db.cursor() as cursor:
        try:
            cursor.execute("""
                INSERT INTO ip_permissions (
                    ip, descricao, grupo, ativo,
                    ctx_nova_os, ctx_duplicar_os, ctx_editar_os, ctx_vincular_os,
                    ctx_abrir_pasta, ctx_imprimir_ficha, ctx_detalhes_os,
                    sb_inicio, sb_gerencia, sb_email, sb_analise,
                    sb_papelaria, sb_usuario, sb_configuracoes
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s
                )
            """, (
                data.ip, data.descricao, data.grupo, data.ativo,
                data.ctx_nova_os, data.ctx_duplicar_os, data.ctx_editar_os,
                data.ctx_vincular_os, data.ctx_abrir_pasta, data.ctx_imprimir_ficha, data.ctx_detalhes_os,
                data.sb_inicio, data.sb_gerencia, data.sb_email, data.sb_analise,
                data.sb_papelaria, data.sb_usuario, data.sb_configuracoes
            ))
            
            return {"success": True, "message": "IP adicionado com sucesso"}
            
        except Exception as e:
            logger.error(f"Erro ao adicionar IP: {e}")
            raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/admin/ip/update")
async def update_ip(data: IPPermissionUpdate):
    """Atualiza um IP existente"""
    db = Database()
    
    # Construir SQL dinâmico baseado nos campos fornecidos
    updates = []
    values = []
    
    for field, value in data.dict(exclude={'id'}, exclude_none=True).items():
        updates.append(f"{field} = %s")
        values.append(value)
    
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar")
    
    values.append(data.id)
    
    with db.cursor() as cursor:
        try:
            sql = f"UPDATE ip_permissions SET {', '.join(updates)} WHERE id = %s"
            cursor.execute(sql, values)
            
            return {"success": True, "message": "IP atualizado com sucesso"}
            
        except Exception as e:
            logger.error(f"Erro ao atualizar IP: {e}")
            raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/admin/ip/delete")
async def delete_ip(data: IPDelete):
    """Remove um IP"""
    db = Database()
    
    with db.cursor() as cursor:
        try:
            cursor.execute("DELETE FROM ip_permissions WHERE id = %s", (data.id,))
            return {"success": True, "message": "IP removido com sucesso"}
            
        except Exception as e:
            logger.error(f"Erro ao remover IP: {e}")
            raise HTTPException(status_code=400, detail=str(e))
