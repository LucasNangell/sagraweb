-- Baseline do Gantt de fluxo de produção por OS (MySQL-only).
CREATE TABLE IF NOT EXISTS tab_os_fluxo_baseline (
    nro_protocolo INT NOT NULL,
    ano_protocolo INT NOT NULL,
    versao INT NOT NULL DEFAULT 1,
    inicio_producao_em DATETIME NULL,
    etapas_json JSON NOT NULL,
    produto VARCHAR(255) NULL,
    tiragem INT NULL,
    pags INT NULL,
    tecnologia VARCHAR(16) NULL,
    hash_entrada CHAR(64) NOT NULL,
    modelo_versao VARCHAR(32) NOT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (nro_protocolo, ano_protocolo),
    KEY idx_fluxo_baseline_atualizado (atualizado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
