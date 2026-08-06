-- Modelos Corel de papelaria — importados da planilha papelaria_variacoes_unicas.xlsx
CREATE TABLE IF NOT EXISTS tabPapelariaModelos (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    Produto VARCHAR(120) NULL,
    FrenteVerso VARCHAR(32) NULL,
    Cores VARCHAR(64) NULL,
    ArquivoModelo VARCHAR(255) NULL,
    CamposJson JSON NULL,
    VariaveisJson JSON NULL,
    MockupConfigJson JSON NULL,
    PreviewConfigJson JSON NULL,
    Ativo TINYINT(1) NOT NULL DEFAULT 1,
    Ordem INT NOT NULL DEFAULT 0,
    AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_produto (Produto),
    INDEX idx_ativo_ordem (Ativo, Ordem)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
