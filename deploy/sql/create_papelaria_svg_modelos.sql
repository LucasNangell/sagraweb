-- Modelos SVG de papelaria (cartão de visita etc.) — sincronizados com a pasta Modelos/
CREATE TABLE IF NOT EXISTS tabPapelariaSvgModelos (
    Codigo VARCHAR(120) NOT NULL PRIMARY KEY,
    NomeExibicao VARCHAR(255) NOT NULL,
    ArquivoSvg VARCHAR(255) NOT NULL,
    Categoria VARCHAR(64) NOT NULL DEFAULT 'cartao_visita',
    Face VARCHAR(16) NOT NULL DEFAULT 'frente',
    ConfigCampos JSON NULL,
    Ativo TINYINT(1) NOT NULL DEFAULT 1,
    Ordem INT NOT NULL DEFAULT 0,
    AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
