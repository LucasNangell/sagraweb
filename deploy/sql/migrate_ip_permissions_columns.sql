-- Colunas RBAC ausentes em restores antigos (schema_sagrafulldb.sql).
-- A API também aplica isso automaticamente no startup (ip_permissions_schema.py).
-- Execute manualmente se preferir, uma vez por banco:

USE sagrafulldb;

ALTER TABLE ip_permissions ADD COLUMN sb_admin_ips TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ip_permissions ADD COLUMN sb_pcp TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ip_permissions ADD COLUMN sb_usuarios TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ip_permissions ADD COLUMN sb_active_computers TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ip_permissions ADD COLUMN sb_gravacao TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ip_permissions ADD COLUMN ctx_orcamento TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ip_permissions ADD COLUMN ctx_imprimir_separador TINYINT(1) NOT NULL DEFAULT 0;
