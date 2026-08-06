-- Modelos Credenciais DEPOL (layout SVG por quantidade de linhas)
CREATE TABLE IF NOT EXISTS tabCredenciaisDepolModelos (
    ID BIGINT AUTO_INCREMENT PRIMARY KEY,
    ArquivoJpg VARCHAR(255) NOT NULL,
    NomeExibicao VARCHAR(200) NULL,
    Ativo TINYINT(1) NOT NULL DEFAULT 1,
    Ordem INT NOT NULL DEFAULT 0,
    LayoutJson JSON NOT NULL,
    AtualizadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cred_depol_modelo_jpg (ArquivoJpg),
    INDEX idx_cred_depol_modelo_ativo (Ativo, Ordem)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
