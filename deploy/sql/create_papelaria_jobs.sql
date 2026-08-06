-- Fila de jobs de geração Corel/PDF — Papelaria
CREATE TABLE IF NOT EXISTS tabPapelariaJobs (
    ID BIGINT AUTO_INCREMENT PRIMARY KEY,
    NroProtocolo INT NOT NULL,
    AnoProtocolo INT NOT NULL,
    TipoJob VARCHAR(32) NOT NULL DEFAULT 'create',
    Produto VARCHAR(120) NOT NULL,
    ModeloID INT NULL,
    ArquivoModelo VARCHAR(255) NOT NULL,
    DadosJson JSON NOT NULL,
    Status VARCHAR(20) NOT NULL DEFAULT 'pending',
    Prioridade INT NOT NULL DEFAULT 0,
    OrdemFila BIGINT NOT NULL,
    SolicitadoPor VARCHAR(32) NOT NULL,
    SolicitadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    IniciadoEm DATETIME NULL,
    ConcluidoEm DATETIME NULL,
    WorkerID VARCHAR(64) NULL,
    ArquivoCdrGerado VARCHAR(512) NULL,
    ArquivoPdfGerado VARCHAR(512) NULL,
    Erro TEXT NULL,
    Tentativas INT NOT NULL DEFAULT 0,
    Versao INT NOT NULL DEFAULT 1,
    JobPaiID BIGINT NULL,
    INDEX idx_status_ordem (Status, OrdemFila),
    INDEX idx_os (AnoProtocolo, NroProtocolo),
    INDEX idx_solicitado (SolicitadoEm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tabPapelariaJobLog (
    ID BIGINT AUTO_INCREMENT PRIMARY KEY,
    JobID BIGINT NOT NULL,
    Nivel VARCHAR(16) NOT NULL DEFAULT 'info',
    Mensagem TEXT NOT NULL,
    DetalheJson JSON NULL,
    CriadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_job (JobID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tabPapelariaWorkerHeartbeat (
    WorkerID VARCHAR(64) NOT NULL PRIMARY KEY,
    HeartbeatEm DATETIME NOT NULL,
    MetaJson JSON NULL,
    INDEX idx_heartbeat_em (HeartbeatEm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
