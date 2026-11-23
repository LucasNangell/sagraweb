-- Catálogo universal de redes sociais da Papelaria (logos em Modelos/papelaria/redes).
-- O bloco de redes de cada modelo fica no config.json do Prova PDF (chave "redes").
-- (A API também cria a tabela e o cadastro inicial — TikTok, X, Kwai, Instagram,
--  Facebook, WhatsApp — copiando os logos de app/backend/assets/papelaria_redes.)
CREATE TABLE IF NOT EXISTS tabPapelariaRedesSociais (
    Chave VARCHAR(40) NOT NULL PRIMARY KEY,
    Nome VARCHAR(60) NOT NULL,
    Exemplo VARCHAR(120) NULL,
    LogoArquivo VARCHAR(120) NULL,
    Ativo TINYINT(1) NOT NULL DEFAULT 1,
    Ordem INT NOT NULL DEFAULT 0,
    AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 0.90.0: até 4 logos por rede, um por estilo (quadrado_policromia, quadrado_pb,
-- policromia, pb): {"<estilo>": "<arquivo>"}. LogoArquivo antigo vale como
-- quadrado_policromia. Os logos padrão vêm de app/backend/assets/papelaria_redes
-- (<rede>__<estilo>.pdf) e são importados uma vez, sem sobrescrever os enviados.
ALTER TABLE tabPapelariaRedesSociais
    ADD COLUMN IF NOT EXISTS LogosJson JSON NULL AFTER LogoArquivo;
