-- Pedidos de Credenciais DEPOL (independentes de OS até o vínculo)
CREATE TABLE IF NOT EXISTS tabCredenciaisDepolPedidos (
    ID BIGINT AUTO_INCREMENT PRIMARY KEY,
    Titulo VARCHAR(200) NULL,
    Observacao TEXT NULL,
    Status VARCHAR(32) NOT NULL DEFAULT 'aberto',
    CriadoPor VARCHAR(32) NOT NULL,
    CriadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    AnoProtocolo INT NULL,
    NroProtocolo INT NULL,
    VinculadoPor VARCHAR(32) NULL,
    VinculadoEm DATETIME NULL,
    JobID BIGINT NULL,
    INDEX idx_cred_depol_status (Status),
    INDEX idx_cred_depol_os (AnoProtocolo, NroProtocolo),
    INDEX idx_cred_depol_criado (CriadoEm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tabCredenciaisDepolItens (
    ID BIGINT AUTO_INCREMENT PRIMARY KEY,
    PedidoID BIGINT NOT NULL,
    Ordem INT NOT NULL DEFAULT 1,
    ModeloArquivo VARCHAR(255) NOT NULL,
    Linha1 VARCHAR(255) NOT NULL,
    Linha2 VARCHAR(255) NULL,
    Linha3 VARCHAR(255) NULL,
    INDEX idx_cred_depol_itens_pedido (PedidoID),
    CONSTRAINT fk_cred_depol_itens_pedido
        FOREIGN KEY (PedidoID) REFERENCES tabCredenciaisDepolPedidos(ID)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
