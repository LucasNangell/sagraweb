-- Mockup 3D por produto: variação «frente» (só frente) e «frente_verso».
-- O MockupConfigJson de tabPapelariaModelos vira só reserva (produto sem configuração).
-- (A API também cria a tabela automaticamente.)
CREATE TABLE IF NOT EXISTS tabPapelariaProdutoMockup (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    Produto VARCHAR(120) NOT NULL,
    Variante VARCHAR(16) NOT NULL,
    MockupConfigJson JSON NOT NULL,
    AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_papelaria_produto_mockup (Produto, Variante)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
