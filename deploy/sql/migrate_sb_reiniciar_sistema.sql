-- Permissão exclusiva: botão Reiniciar sistema no header.
-- A API também aplica via ip_permissions_schema / user_auth_schema no startup.
-- Ignore "Duplicate column" se a coluna já existir.

USE sagrafulldb;

ALTER TABLE ip_permissions
  ADD COLUMN sb_reiniciar_sistema TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE user_permissions
  ADD COLUMN sb_reiniciar_sistema TINYINT(1) DEFAULT 0;
