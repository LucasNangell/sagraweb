-- Inspeção de .cdr via worker CorelDRAW (objetos nomeados)
CREATE TABLE IF NOT EXISTS tabPapelariaCdrInspect (
    ID BIGINT AUTO_INCREMENT PRIMARY KEY,
    Token VARCHAR(36) NOT NULL UNIQUE,
    NomeArquivo VARCHAR(255) NOT NULL,
    CaminhoCdr VARCHAR(512) NOT NULL,
    Status VARCHAR(20) NOT NULL DEFAULT 'pending',
    CamposJson JSON NULL,
    VariaveisJson JSON NULL,
    LayoutJson JSON NULL,
    Erro TEXT NULL,
    WorkerID VARCHAR(64) NULL,
    CriadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ConcluidoEm DATETIME NULL,
    INDEX idx_status_criado (Status, CriadoEm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
