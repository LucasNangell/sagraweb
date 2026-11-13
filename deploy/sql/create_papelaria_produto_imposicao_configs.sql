-- Padrão de imposição por produto × variante (Digital | Offset).
-- Override opcional continua em tabPapelariaModelos.ImposicaoConfigJson.
CREATE TABLE IF NOT EXISTS tabPapelariaProdutoImposicaoConfigs (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    Produto VARCHAR(120) NOT NULL,
    Variante VARCHAR(16) NOT NULL,
    ImposicaoConfigJson JSON NOT NULL,
    PastaImposicao VARCHAR(512) NULL,
    AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_papelaria_produto_imposicao_variante (Produto, Variante),
    CONSTRAINT chk_papelaria_imposicao_variante
        CHECK (Variante IN ('digital', 'offset'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
