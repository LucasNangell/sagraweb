-- Acesso total para estação de desenvolvimento / admin
-- Execute: mysql -h 10.1.1.73 -u usr_sagraweb -p sagrafulldb < deploy/sql/seed_ip_full_access.sql

USE sagrafulldb;

INSERT INTO ip_permissions (
    ip, descricao, grupo, ativo,
    ctx_nova_os, ctx_duplicar_os, ctx_editar_os, ctx_vincular_os,
    ctx_abrir_pasta, ctx_imprimir_ficha, ctx_detalhes_os,
    sb_inicio, sb_gerencia, sb_email, sb_analise, sb_papelaria,
    sb_usuario, sb_configuracoes, sb_relatorio, sb_dashboard_setor,
    sb_admin_ips, sb_pcp, sb_usuarios, sb_active_computers, sb_gravacao
) VALUES
(
    '10.120.1.14', 'Estação dev — acesso total', 'Administradores', 1,
    1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1
),
(
    '127.0.0.1', 'Localhost Vite proxy', 'Administradores', 1,
    1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1
)
ON DUPLICATE KEY UPDATE
    ativo = 1,
    ctx_nova_os = 1, ctx_duplicar_os = 1, ctx_editar_os = 1, ctx_vincular_os = 1,
    ctx_abrir_pasta = 1, ctx_imprimir_ficha = 1, ctx_detalhes_os = 1,
    sb_inicio = 1, sb_gerencia = 1, sb_email = 1, sb_analise = 1, sb_papelaria = 1,
    sb_usuario = 1, sb_configuracoes = 1, sb_relatorio = 1, sb_dashboard_setor = 1,
    sb_admin_ips = 1, sb_pcp = 1, sb_usuarios = 1, sb_active_computers = 1, sb_gravacao = 1;
