-- Perfil de imposição v2 por produto × variante (Digital | Offset).
-- Tabela separada da configuração antiga (tabPapelariaProdutoImposicaoConfigs),
-- que continua valendo enquanto o perfil não for aprovado (AtivoV2 = 0).
CREATE TABLE IF NOT EXISTS tabPapelariaImposicaoPerfis (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    Produto VARCHAR(120) NOT NULL,
    Variante VARCHAR(16) NOT NULL,
    PerfilJson JSON NOT NULL,
    AtivoV2 TINYINT(1) NOT NULL DEFAULT 0,
    AprovadoEm DATETIME NULL,
    AprovadoPor VARCHAR(32) NULL,
    AtualizadoPor VARCHAR(32) NULL,
    AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_papelaria_imposicao_perfil (Produto, Variante),
    CONSTRAINT chk_papelaria_imposicao_perfil_variante
        CHECK (Variante IN ('digital', 'offset'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Modelos de perfil salvos pelo usuário (ponto de partida para novos produtos).
CREATE TABLE IF NOT EXISTS tabPapelariaImposicaoPerfilModelos (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    Nome VARCHAR(120) NOT NULL,
    PerfilJson JSON NOT NULL,
    AtualizadoPor VARCHAR(32) NULL,
    AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_papelaria_imposicao_perfil_modelo (Nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
