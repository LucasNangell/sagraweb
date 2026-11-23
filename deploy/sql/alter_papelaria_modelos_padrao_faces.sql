-- Frente/verso independentes: modelo padrão de cada face por produto + cores.
-- (A API também cria as colunas automaticamente em ensure_papelaria_modelos_table.)
ALTER TABLE tabPapelariaModelos
    ADD COLUMN IF NOT EXISTS PadraoFrente TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS PadraoVerso TINYINT(1) NOT NULL DEFAULT 0;
