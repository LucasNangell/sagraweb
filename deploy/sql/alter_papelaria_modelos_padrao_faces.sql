-- Frente/verso independentes: modelo padrão de cada face por produto + cores.
-- (A API também cria as colunas automaticamente em ensure_papelaria_modelos_table.)
ALTER TABLE tabPapelariaModelos
    ADD COLUMN IF NOT EXISTS PadraoFrente TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS PadraoVerso TINYINT(1) NOT NULL DEFAULT 0;

-- Face removida de um modelo antigo de 2 páginas (o outro lado continua).
ALTER TABLE tabPapelariaModelos
    ADD COLUMN IF NOT EXISTS OcultarFrente TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS OcultarVerso TINYINT(1) NOT NULL DEFAULT 0;
