-- Retrato dos textos do .cdr da OS (lido pelo worker CorelDRAW).
-- Evita abrir o Corel a cada seleção na página Papelaria: a API só pede
-- nova leitura quando ArquivoMtime/ArquivoTamanho divergem do retrato.
CREATE TABLE IF NOT EXISTS tabPapelariaOsCdrCampos (
    ID BIGINT AUTO_INCREMENT PRIMARY KEY,
    AnoProtocolo INT NOT NULL,
    NroProtocolo INT NOT NULL,
    CaminhoRelativo VARCHAR(255) NOT NULL,
    ArquivoMtime DOUBLE NULL,
    ArquivoTamanho BIGINT NULL,
    Status VARCHAR(20) NOT NULL DEFAULT 'pending',
    ObjetosJson JSON NULL,
    ObjetosMtime DOUBLE NULL,
    ObjetosTamanho BIGINT NULL,
    Erro TEXT NULL,
    WorkerID VARCHAR(64) NULL,
    Tentativas INT NOT NULL DEFAULT 0,
    SolicitadoEm DATETIME NULL,
    IniciadoEm DATETIME NULL,
    ExtraidoEm DATETIME NULL,
    AtualizadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_os_cdr (AnoProtocolo, NroProtocolo, CaminhoRelativo),
    INDEX idx_status_solicitado (Status, SolicitadoEm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
