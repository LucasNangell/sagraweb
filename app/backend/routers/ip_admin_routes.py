"""
Rotas para administração de permissões por IP
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Request
from pydantic import BaseModel
from typing import Optional
from database import db
import logging

from painel_permissions import enrich_permissions, parse_painel_setores_raw
from schemas.permissions import ClientPermissionsResponse, PainelScopeResponse
from security.api_auth import require_master_ip, resolve_client_ip
from security.session_auth import SessionData, require_session

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
    ctx_mover_pastas: bool = True
    ctx_imprimir_ficha: bool = True
    ctx_detalhes_os: bool = True
    ctx_orcamento: bool = False
    
    # Sidebar
    sb_inicio: bool = True
    sb_gerencia: bool = True
    sb_email: bool = True
    sb_analise: bool = True
    sb_papelaria: bool = True
    sb_usuario: bool = True
    sb_configuracoes: bool = True
    sb_relatorio: bool = True
    sb_dashboard_setor: bool = True
    sb_dashboard_global: bool = True
    painel_setores: list[str] = []
    sb_admin_ips: bool = False
    
    # New Permissions
    sb_pcp: bool = False
    sb_usuarios: bool = False
    sb_active_computers: bool = False
    sb_gravacao: bool = False
    sb_cotas_graf: bool = False
    sb_gravacao_externa: bool = False
    sb_gravacao_pendente: bool = False
    sb_gravacao_externa_operador: bool = False
    sb_gravacao_pendente_excluir: bool = False
    sb_gravacao_externa_entrega: bool = False
    sb_gravacao_externa_lancar: bool = False
    sb_estoque: bool = False
    sb_estoque_gerente: bool = False
    sb_lombada: bool = False
    sb_credenciais_depol: bool = False

class AccessRequest(BaseModel):
    ip: str
    nome: str
    ponto: int
    secao: str

class AccessRequestDelete(BaseModel):
    id: int

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
    ctx_mover_pastas: Optional[bool] = None
    ctx_imprimir_ficha: Optional[bool] = None
    ctx_detalhes_os: Optional[bool] = None
    ctx_orcamento: Optional[bool] = None
    
    # Sidebar
    sb_inicio: Optional[bool] = None
    sb_gerencia: Optional[bool] = None
    sb_email: Optional[bool] = None
    sb_analise: Optional[bool] = None
    sb_papelaria: Optional[bool] = None
    sb_usuario: Optional[bool] = None
    sb_configuracoes: Optional[bool] = None
    sb_relatorio: Optional[bool] = None
    sb_dashboard_setor: Optional[bool] = None
    sb_dashboard_global: Optional[bool] = None
    painel_setores: Optional[list[str]] = None
    sb_admin_ips: Optional[bool] = None
    
    # New Permissions
    sb_pcp: Optional[bool] = None
    sb_usuarios: Optional[bool] = None
    sb_active_computers: Optional[bool] = None
    sb_gravacao: Optional[bool] = None
    sb_cotas_graf: Optional[bool] = None
    sb_gravacao_externa: Optional[bool] = None
    sb_gravacao_pendente: Optional[bool] = None
    sb_gravacao_externa_operador: Optional[bool] = None
    sb_gravacao_pendente_excluir: Optional[bool] = None
    sb_gravacao_externa_entrega: Optional[bool] = None
    sb_gravacao_externa_lancar: Optional[bool] = None
    sb_estoque: Optional[bool] = None
    sb_estoque_gerente: Optional[bool] = None
    sb_lombada: Optional[bool] = None
    sb_credenciais_depol: Optional[bool] = None

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


def _full_access_permissions(client_ip: str) -> dict:
    """Permissões máximas para MASTER / servidor local (sem consulta ao banco)."""
    return {
        "ctx_nova_os": True,
        "ctx_duplicar_os": True,
        "ctx_editar_os": True,
        "ctx_vincular_os": True,
        "ctx_abrir_pasta": True,
        "ctx_mover_pastas": True,
        "ctx_imprimir_ficha": True,
        "ctx_detalhes_os": True,
        "ctx_prova_web": True,
        "ctx_orcamento": True,
        "sb_inicio": True,
        "sb_gerencia": True,
        "sb_email": True,
        "sb_analise": True,
        "sb_papelaria": True,
        "sb_usuario": True,
        "sb_configuracoes": True,
        "sb_relatorio": True,
        "sb_dashboard_setor": True,
        "sb_dashboard_global": True,
        "sb_dashboard_tablet": True,
        "painel_setores": [],
        "painel_setores_legacy_all": True,
        "sb_admin_ips": True,
        "sb_pcp": True,
        "sb_usuarios": True,
        "sb_active_computers": True,
        "sb_gravacao": True,
        "sb_cotas_graf": True,
        "sb_gravacao_externa": True,
        "sb_gravacao_pendente": True,
        "sb_gravacao_externa_operador": True,
        "sb_gravacao_pendente_excluir": True,
        "sb_gravacao_externa_entrega": True,
        "sb_gravacao_externa_lancar": True,
        "sb_estoque": True,
        "sb_estoque_gerente": True,
        "sb_lombada": True,
        "sb_credenciais_depol": True,
        "ip": client_ip,
    }


def get_client_permissions(client_ip: str) -> dict:
    """
    Busca as permissões do IP do cliente no banco
    PRIORIDADE: IP específico > IP wildcard > Backward compatibility (tudo TRUE)
    """
    from security.api_auth import is_privileged_ip
    import time

    if is_privileged_ip(client_ip):
        logger.info("Acesso privilegiado (MASTER/servidor): %s", client_ip)
        return _full_access_permissions(client_ip)

    cache = getattr(get_client_permissions, "_cache", None)
    if cache is None:
        cache = {}
        get_client_permissions._cache = cache  # type: ignore[attr-defined]
    ttl = 30.0
    now = time.monotonic()
    cached = cache.get(client_ip)
    if cached and (now - cached[0]) < ttl:
        return cached[1]

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
                result = {
                    'ctx_nova_os': bool(exact_match.get('ctx_nova_os', True)),
                    'ctx_duplicar_os': bool(exact_match.get('ctx_duplicar_os', True)),
                    'ctx_editar_os': bool(exact_match.get('ctx_editar_os', True)),
                    'ctx_vincular_os': bool(exact_match.get('ctx_vincular_os', True)),
                    'ctx_abrir_pasta': bool(exact_match.get('ctx_abrir_pasta', True)),
                    'ctx_mover_pastas': bool(exact_match.get('ctx_mover_pastas', True)),
                    'ctx_imprimir_ficha': bool(exact_match.get('ctx_imprimir_ficha', True)),
                    'ctx_detalhes_os': bool(exact_match.get('ctx_detalhes_os', True)),
                    'ctx_orcamento': bool(exact_match.get('ctx_orcamento', False)),
                    'sb_inicio': bool(exact_match.get('sb_inicio', True)),
                    'sb_gerencia': bool(exact_match.get('sb_gerencia', True)),
                    'sb_email': bool(exact_match.get('sb_email', True)),
                    'sb_analise': bool(exact_match.get('sb_analise', True)),
                    'sb_papelaria': bool(exact_match.get('sb_papelaria', True)),
                    'sb_usuario': bool(exact_match.get('sb_usuario', True)),
                    'sb_configuracoes': bool(exact_match.get('sb_configuracoes', True)),
                    'sb_relatorio': bool(exact_match.get('sb_relatorio', True)),
                    'sb_dashboard_setor': bool(exact_match.get('sb_dashboard_setor', True)),
                    'sb_dashboard_global': bool(exact_match.get('sb_dashboard_global', False)),
                    'painel_setores': parse_painel_setores_raw(exact_match.get('painel_setores')),
                    'sb_admin_ips': bool(exact_match.get('sb_admin_ips', False)),
                    'sb_pcp': bool(exact_match.get('sb_pcp', False)),
                    'sb_usuarios': bool(exact_match.get('sb_usuarios', False)),
                    'sb_active_computers': bool(exact_match.get('sb_active_computers', False)),
                    'sb_gravacao': bool(exact_match.get('sb_gravacao', False)),
                    'sb_cotas_graf': bool(exact_match.get('sb_cotas_graf', False)),
                    'sb_gravacao_externa': bool(exact_match.get('sb_gravacao_externa', False)),
                    'sb_gravacao_pendente': bool(exact_match.get('sb_gravacao_pendente', False)),
                    'sb_gravacao_externa_operador': bool(exact_match.get('sb_gravacao_externa_operador', False)),
                    'sb_gravacao_pendente_excluir': bool(exact_match.get('sb_gravacao_pendente_excluir', False)),
                    'sb_gravacao_externa_entrega': bool(exact_match.get('sb_gravacao_externa_entrega', False)),
                    'sb_gravacao_externa_lancar': bool(exact_match.get('sb_gravacao_externa_lancar', False)),
                    'sb_estoque': bool(exact_match.get('sb_estoque', False)),
                    'sb_estoque_gerente': bool(exact_match.get('sb_estoque_gerente', False)),
                    'sb_lombada': bool(exact_match.get('sb_lombada', False)),
                    'sb_credenciais_depol': bool(exact_match.get('sb_credenciais_depol', False)),
                    'ip': client_ip  # Retorna o IP do cliente
                }
                cache[client_ip] = (now, result)
                return result
            
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
                    result = {
                        'ctx_nova_os': bool(ip_data.get('ctx_nova_os', True)),
                        'ctx_duplicar_os': bool(ip_data.get('ctx_duplicar_os', True)),
                        'ctx_editar_os': bool(ip_data.get('ctx_editar_os', True)),
                        'ctx_vincular_os': bool(ip_data.get('ctx_vincular_os', True)),
                        'ctx_abrir_pasta': bool(ip_data.get('ctx_abrir_pasta', True)),
                        'ctx_mover_pastas': bool(ip_data.get('ctx_mover_pastas', True)),
                        'ctx_imprimir_ficha': bool(ip_data.get('ctx_imprimir_ficha', True)),
                        'ctx_detalhes_os': bool(ip_data.get('ctx_detalhes_os', True)),
                        'ctx_orcamento': bool(ip_data.get('ctx_orcamento', False)),
                        'sb_inicio': bool(ip_data.get('sb_inicio', True)),
                        'sb_gerencia': bool(ip_data.get('sb_gerencia', True)),
                        'sb_email': bool(ip_data.get('sb_email', True)),
                        'sb_analise': bool(ip_data.get('sb_analise', True)),
                        'sb_papelaria': bool(ip_data.get('sb_papelaria', True)),
                        'sb_usuario': bool(ip_data.get('sb_usuario', True)),
                        'sb_configuracoes': bool(ip_data.get('sb_configuracoes', True)),
                        'sb_relatorio': bool(ip_data.get('sb_relatorio', True)),
                        'sb_dashboard_setor': bool(ip_data.get('sb_dashboard_setor', True)),
                        'sb_dashboard_global': bool(ip_data.get('sb_dashboard_global', False)),
                        'painel_setores': parse_painel_setores_raw(ip_data.get('painel_setores')),
                        'sb_admin_ips': bool(ip_data.get('sb_admin_ips', False)),
                        'sb_pcp': bool(ip_data.get('sb_pcp', False)),
                        'sb_usuarios': bool(ip_data.get('sb_usuarios', False)),
                        'sb_active_computers': bool(ip_data.get('sb_active_computers', False)),
                        'sb_gravacao': bool(ip_data.get('sb_gravacao', False)),
                        'sb_cotas_graf': bool(ip_data.get('sb_cotas_graf', False)),
                        'sb_gravacao_externa': bool(ip_data.get('sb_gravacao_externa', False)),
                        'sb_gravacao_pendente': bool(ip_data.get('sb_gravacao_pendente', False)),
                        'sb_gravacao_externa_operador': bool(ip_data.get('sb_gravacao_externa_operador', False)),
                        'sb_gravacao_pendente_excluir': bool(ip_data.get('sb_gravacao_pendente_excluir', False)),
                        'sb_gravacao_externa_entrega': bool(ip_data.get('sb_gravacao_externa_entrega', False)),
                        'sb_gravacao_externa_lancar': bool(ip_data.get('sb_gravacao_externa_lancar', False)),
                        'sb_estoque': bool(ip_data.get('sb_estoque', False)),
                        'sb_estoque_gerente': bool(ip_data.get('sb_estoque_gerente', False)),
                        'sb_lombada': bool(ip_data.get('sb_lombada', False)),
                        'sb_credenciais_depol': bool(ip_data.get('sb_credenciais_depol', False)),
                        'ip': client_ip  # Retorna o IP do cliente
                    }
                    cache[client_ip] = (now, result)
                    return result
            
            # 3. NÃO ENCONTROU: Retorna None (acesso negado)
            logger.warning(f"⚠ IP {client_ip} não encontrado ou inativo.")
            return None
            
    except Exception as e:
        logger.error(f"Erro ao buscar permissões para IP {client_ip}: {e}")
        return None


def _to_permissions_response(
    perms: dict,
    *,
    ponto: int | None = None,
) -> ClientPermissionsResponse:
    perms = enrich_permissions(dict(perms))
    return ClientPermissionsResponse(
        ip=str(perms.get("ip", "")),
        ctx_nova_os=bool(perms.get("ctx_nova_os", True)),
        ctx_duplicar_os=bool(perms.get("ctx_duplicar_os", True)),
        ctx_editar_os=bool(perms.get("ctx_editar_os", True)),
        ctx_vincular_os=bool(perms.get("ctx_vincular_os", True)),
        ctx_abrir_pasta=bool(perms.get("ctx_abrir_pasta", True)),
        ctx_mover_pastas=bool(perms.get("ctx_mover_pastas", True)),
        ctx_imprimir_ficha=bool(perms.get("ctx_imprimir_ficha", True)),
        ctx_detalhes_os=bool(perms.get("ctx_detalhes_os", True)),
        ctx_prova_web=bool(perms.get("ctx_prova_web", False)),
        ctx_orcamento=bool(perms.get("ctx_orcamento", False)),
        sb_inicio=bool(perms.get("sb_inicio", True)),
        sb_gerencia=bool(perms.get("sb_gerencia", True)),
        sb_email=bool(perms.get("sb_email", True)),
        sb_analise=bool(perms.get("sb_analise", True)),
        sb_papelaria=bool(perms.get("sb_papelaria", True)),
        sb_usuario=bool(perms.get("sb_usuario", True)),
        sb_configuracoes=bool(perms.get("sb_configuracoes", True)),
        sb_relatorio=bool(perms.get("sb_relatorio", True)),
        sb_dashboard_setor=bool(perms.get("sb_dashboard_setor", False)),
        sb_dashboard_global=bool(perms.get("sb_dashboard_global", False)),
        sb_dashboard_tablet=bool(perms.get("sb_dashboard_tablet", False)),
        painel_setores=list(perms.get("painel_setores") or []),
        painel_setores_legacy_all=bool(perms.get("painel_setores_legacy_all", False)),
        sb_admin_ips=bool(perms.get("sb_admin_ips", False)),
        sb_pcp=bool(perms.get("sb_pcp", False)),
        sb_usuarios=bool(perms.get("sb_usuarios", False)),
        sb_active_computers=bool(perms.get("sb_active_computers", False)),
        sb_gravacao=bool(perms.get("sb_gravacao", False)),
        sb_cotas_graf=bool(perms.get("sb_cotas_graf", False)),
        sb_gravacao_externa=bool(perms.get("sb_gravacao_externa", False)),
        sb_gravacao_pendente=bool(perms.get("sb_gravacao_pendente", False)),
        sb_gravacao_externa_operador=bool(perms.get("sb_gravacao_externa_operador", False)),
        sb_gravacao_pendente_excluir=bool(perms.get("sb_gravacao_pendente_excluir", False)),
        sb_gravacao_externa_entrega=bool(perms.get("sb_gravacao_externa_entrega", False)),
        sb_gravacao_externa_lancar=bool(perms.get("sb_gravacao_externa_lancar", False)),
        sb_estoque=bool(perms.get("sb_estoque", False)),
        sb_estoque_gerente=bool(perms.get("sb_estoque_gerente", False)),
        sb_lombada=bool(perms.get("sb_lombada", False)),
        sb_credenciais_depol=bool(perms.get("sb_credenciais_depol", False)),
        ponto=ponto,
    )


@router.get(
    "/api/permissions/painel-scope",
    response_model=PainelScopeResponse,
    summary="Escopo dos painéis para o IP do cliente (sem sessão)",
)
async def get_painel_scope_permissions(request: Request) -> PainelScopeResponse:
    from security.painel_access import has_any_painel_access

    client_ip = resolve_client_ip(request)
    perms = get_client_permissions(client_ip)
    if perms is None or not has_any_painel_access(perms):
        raise HTTPException(
            status_code=403,
            detail="IP não autorizado para painéis. Cadastre o IP em Admin IPs.",
        )
    return PainelScopeResponse(
        ip=client_ip,
        sb_dashboard_setor=bool(perms.get("sb_dashboard_setor", False)),
        sb_dashboard_global=bool(perms.get("sb_dashboard_global", False)),
        painel_setores=list(perms.get("painel_setores") or []),
        painel_setores_legacy_all=bool(perms.get("painel_setores_legacy_all", False)),
    )


@router.get(
    "/api/permissions",
    response_model=ClientPermissionsResponse,
    summary="Permissões do IP da sessão (sem fail-open)",
)
async def get_permissions(
    request: Request,
    session: SessionData = Depends(require_session),
) -> ClientPermissionsResponse:
    """
    Exige sessão válida (POST /api/auth/session ou /api/auth/login).
    Base: IP cadastrado. Overlay do cadastro em Usuários prevalece.
    """
    from security.user_permissions import resolve_effective_permissions

    permissions = resolve_effective_permissions(
        request,
        session,
        get_client_permissions=get_client_permissions,
    )
    if permissions is None:
        from security.public_access import should_use_user_permissions

        if should_use_user_permissions(request, session):
            raise HTTPException(
                status_code=403,
                detail="Usuário não autorizado ou conta inativa.",
            )
        raise HTTPException(
            status_code=403,
            detail="IP da sessão não autorizado. Cadastre o IP em Admin ou solicite acesso.",
        )
    permissions["ip"] = session.ip
    return _to_permissions_response(permissions, ponto=session.ponto)


@router.get("/api/admin/ip/list", dependencies=[Depends(require_master_ip)])
async def list_ips():
    """Lista todos os IPs cadastrados"""
    with db.cursor() as cursor:
        cursor.execute("""
            SELECT * FROM ip_permissions
            ORDER BY grupo ASC, ativo DESC, ip ASC
        """)
        
        ips = cursor.fetchall()
        return ips


@router.get("/api/admin/ip/groups", dependencies=[Depends(require_master_ip)])
async def list_groups():
    """Lista todos os grupos distintos"""
    with db.cursor() as cursor:
        cursor.execute("""
            SELECT DISTINCT grupo 
            FROM ip_permissions 
            WHERE grupo IS NOT NULL
            ORDER BY grupo ASC
        """)
        
        groups = cursor.fetchall()
        return [g['grupo'] for g in groups]


@router.post("/api/admin/ip/add", dependencies=[Depends(require_master_ip)])
async def add_ip(data: IPPermission, ponto: Optional[int] = None, nome_usuario: Optional[str] = None):
    """Adiciona novo IP com permissões e opcionalmente cadastra usuário"""
    with db.cursor() as cursor:
        try:
            # 1. Verificar se IP já existe
            cursor.execute("SELECT id FROM ip_permissions WHERE ip = %s", (data.ip,))
            existing = cursor.fetchone()

            if existing:
                # Update (Upsert behavior)
                ip_id = existing['id']
                cursor.execute("""
                    UPDATE ip_permissions SET
                        descricao=%s, grupo=%s, ativo=%s,
                        ctx_nova_os=%s, ctx_duplicar_os=%s, ctx_editar_os=%s, ctx_vincular_os=%s,
                        ctx_abrir_pasta=%s, ctx_mover_pastas=%s, ctx_imprimir_ficha=%s, ctx_detalhes_os=%s, ctx_orcamento=%s,
                        sb_inicio=%s, sb_gerencia=%s, sb_email=%s, sb_analise=%s,
                        sb_papelaria=%s, sb_usuario=%s, sb_configuracoes=%s,
                        sb_relatorio=%s, sb_dashboard_setor=%s, sb_admin_ips=%s,
                        sb_pcp=%s, sb_usuarios=%s, sb_active_computers=%s, sb_gravacao=%s, sb_cotas_graf=%s, sb_gravacao_externa=%s, sb_gravacao_pendente=%s, sb_gravacao_externa_operador=%s, sb_gravacao_pendente_excluir=%s, sb_gravacao_externa_entrega=%s, sb_gravacao_externa_lancar=%s, sb_estoque=%s, sb_estoque_gerente=%s, sb_lombada=%s, sb_credenciais_depol=%s
                    WHERE id=%s
                """, (
                    data.descricao, data.grupo, data.ativo,
                    data.ctx_nova_os, data.ctx_duplicar_os, data.ctx_editar_os,
                    data.ctx_vincular_os, data.ctx_abrir_pasta, data.ctx_mover_pastas, data.ctx_imprimir_ficha, data.ctx_detalhes_os, data.ctx_orcamento,
                    data.sb_inicio, data.sb_gerencia, data.sb_email, data.sb_analise,
                    data.sb_papelaria, data.sb_usuario, data.sb_configuracoes,
                    data.sb_relatorio, data.sb_dashboard_setor, data.sb_admin_ips,
                    data.sb_pcp, data.sb_usuarios, data.sb_active_computers, data.sb_gravacao, data.sb_cotas_graf, data.sb_gravacao_externa, data.sb_gravacao_pendente, data.sb_gravacao_externa_operador, data.sb_gravacao_pendente_excluir, data.sb_gravacao_externa_entrega, data.sb_gravacao_externa_lancar, data.sb_estoque, data.sb_estoque_gerente, data.sb_lombada, data.sb_credenciais_depol,
                    ip_id
                ))
            else:
                # Insert
                cursor.execute("""
                    INSERT INTO ip_permissions (
                        ip, descricao, grupo, ativo,
                        ctx_nova_os, ctx_duplicar_os, ctx_editar_os, ctx_vincular_os,
                        ctx_abrir_pasta, ctx_mover_pastas, ctx_imprimir_ficha, ctx_detalhes_os, ctx_orcamento,
                        sb_inicio, sb_gerencia, sb_email, sb_analise,
                        sb_papelaria, sb_usuario, sb_configuracoes,
                        sb_relatorio, sb_dashboard_setor, sb_admin_ips,
                        sb_pcp, sb_usuarios, sb_active_computers, sb_gravacao, sb_cotas_graf, sb_gravacao_externa, sb_gravacao_pendente, sb_gravacao_externa_operador, sb_gravacao_pendente_excluir, sb_gravacao_externa_entrega, sb_gravacao_externa_lancar, sb_estoque, sb_estoque_gerente, sb_lombada, sb_credenciais_depol
                    ) VALUES (
                        %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    )
                """, (
                    data.ip, data.descricao, data.grupo, data.ativo,
                    data.ctx_nova_os, data.ctx_duplicar_os, data.ctx_editar_os,
                    data.ctx_vincular_os, data.ctx_abrir_pasta, data.ctx_mover_pastas, data.ctx_imprimir_ficha, data.ctx_detalhes_os, data.ctx_orcamento,
                    data.sb_inicio, data.sb_gerencia, data.sb_email, data.sb_analise,
                    data.sb_papelaria, data.sb_usuario, data.sb_configuracoes,
                    data.sb_relatorio, data.sb_dashboard_setor, data.sb_admin_ips,
                    data.sb_pcp, data.sb_usuarios, data.sb_active_computers, data.sb_gravacao, data.sb_cotas_graf, data.sb_gravacao_externa, data.sb_gravacao_pendente, data.sb_gravacao_externa_operador, data.sb_gravacao_pendente_excluir, data.sb_gravacao_externa_entrega, data.sb_gravacao_externa_lancar, data.sb_estoque, data.sb_estoque_gerente, data.sb_lombada, data.sb_credenciais_depol
                ))

            # 2. Se fornecido Ponto e Nome, cadastrar/atualizar na tabUsuarios
            if ponto and nome_usuario:
                try:
                    cursor.execute("""
                        INSERT INTO tabUsuarios (Ponto, Nome) 
                        VALUES (%s, %s)
                        ON DUPLICATE KEY UPDATE Nome = VALUES(Nome)
                    """, (ponto, nome_usuario))
                    logger.info(f"Usuário {nome_usuario} ({ponto}) atualizado na tabUsuarios")
                except Exception as ue:
                    logger.error(f"Erro ao atualizar tabUsuarios: {ue}")
                    # Não falhar o request todo se o IP foi processado, só logar erro
            
            return {"success": True, "message": "IP salvo com sucesso"}
            
        except Exception as e:
            logger.error(f"Erro ao adicionar/atualizar IP: {e}")
            raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/admin/ip/update", dependencies=[Depends(require_master_ip)])
async def update_ip(data: IPPermissionUpdate):
    """Atualiza um IP existente"""
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


@router.post("/api/admin/ip/delete", dependencies=[Depends(require_master_ip)])
async def delete_ip(data: IPDelete):
    """Remove um IP"""
    with db.cursor() as cursor:
        try:
            cursor.execute("DELETE FROM ip_permissions WHERE id = %s", (data.id,))
            return {"success": True, "message": "IP removido com sucesso"}
            
        except Exception as e:
            logger.error(f"Erro ao remover IP: {e}")
            raise HTTPException(status_code=400, detail=str(e))

# --- Access Request Endpoints ---

@router.on_event("startup")
def ensure_request_table():
    from ip_permissions_schema import ensure_ip_permissions_schema
    from saved_filters_schema import ensure_saved_filters_schema

    try:
        ensure_ip_permissions_schema()
        ensure_saved_filters_schema()
    except Exception as e:
        logger.error("Erro ao migrar ip_permissions: %s", e)

    try:
        with db.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS tabSolicitacoesAcesso (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    ip VARCHAR(45) NOT NULL,
                    nome VARCHAR(255) NOT NULL,
                    ponto INT NOT NULL,
                    secao VARCHAR(255) NOT NULL,
                    data_solicitacao DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)
    except Exception as e:
        logger.error(f"Erro ao criar tabSolicitacoesAcesso: {e}")

@router.post("/api/access-request")
async def create_access_request(request: Request, data: AccessRequest):
    """Registra uma nova solicitação de acesso"""
    # Determinar IP real
    client_ip = request.client.host
    ip_to_use = data.ip
    
    # Se o IP vier vazio ou genérico, usa o da conexão
    if not ip_to_use or ip_to_use in ['Desconhecido', '']:
        ip_to_use = client_ip
        
    with db.cursor() as cursor:
        try:
            # Check for duplicates from same IP to avoid spam? 
            # Letting it slide for now or simple check
            cursor.execute("SELECT id FROM tabSolicitacoesAcesso WHERE ip = %s", (ip_to_use,))
            if cursor.fetchone():
                 cursor.execute("""
                    UPDATE tabSolicitacoesAcesso 
                    SET nome=%s, ponto=%s, secao=%s, data_solicitacao=NOW()
                    WHERE ip=%s
                 """, (data.nome, data.ponto, data.secao, ip_to_use))
                 return {"success": True, "message": "Solicitação atualizada"}
            else:
                cursor.execute("""
                    INSERT INTO tabSolicitacoesAcesso (ip, nome, ponto, secao)
                    VALUES (%s, %s, %s, %s)
                """, (ip_to_use, data.nome, data.ponto, data.secao))
                return {"success": True, "message": "Solicitação enviada"}
        except Exception as e:
            logger.error(f"Erro ao criar solicitação: {e}")
            raise HTTPException(status_code=500, detail="Erro interno ao processar solicitação")

@router.get("/api/admin/access-requests", dependencies=[Depends(require_master_ip)])
async def list_access_requests():
    """Lista solicitações pendentes"""
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM tabSolicitacoesAcesso ORDER BY data_solicitacao DESC")
        return cursor.fetchall()

@router.post("/api/admin/access-request/delete", dependencies=[Depends(require_master_ip)])
async def delete_access_request(data: AccessRequestDelete):
    """Remove uma solicitação"""
    with db.cursor() as cursor:
        try:
            cursor.execute("DELETE FROM tabSolicitacoesAcesso WHERE id = %s", (data.id,))
            return {"success": True}
        except Exception as e:
             logger.error(f"Erro ao deletar solicitação: {e}")
             raise HTTPException(status_code=500, detail=str(e))
