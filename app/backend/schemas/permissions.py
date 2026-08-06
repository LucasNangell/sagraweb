from __future__ import annotations

from pydantic import BaseModel, Field


class PainelScopeResponse(BaseModel):
    """Escopo mínimo para guard dos painéis TV (sem sessão)."""

    ip: str
    sb_dashboard_setor: bool = False
    sb_dashboard_global: bool = False
    painel_setores: list[str] = Field(default_factory=list)
    painel_setores_legacy_all: bool = False


class ClientPermissionsResponse(BaseModel):
    """Permissões RBAC do cliente (IP + sessão Fase B)."""

    ip: str
    ctx_nova_os: bool = True
    ctx_duplicar_os: bool = True
    ctx_editar_os: bool = True
    ctx_vincular_os: bool = True
    ctx_abrir_pasta: bool = True
    ctx_mover_pastas: bool = True
    ctx_imprimir_ficha: bool = True
    ctx_detalhes_os: bool = True
    ctx_prova_web: bool = False
    sb_inicio: bool = True
    sb_gerencia: bool = True
    sb_email: bool = True
    sb_analise: bool = True
    sb_papelaria: bool = True
    sb_usuario: bool = True
    sb_configuracoes: bool = True
    sb_relatorio: bool = True
    sb_dashboard_setor: bool = False
    sb_dashboard_global: bool = False
    sb_dashboard_tablet: bool = False
    painel_setores: list[str] = Field(default_factory=list)
    painel_setores_legacy_all: bool = False
    sb_admin_ips: bool = False
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
    ponto: int | None = Field(None, description="Ponto autenticado na sessão (Fase B)")
