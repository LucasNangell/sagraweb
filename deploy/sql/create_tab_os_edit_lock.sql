-- Lock pessimista de edição de OS (andamento e formulário compartilham a mesma trava).
-- Somente MySQL web — não dual-write Access MDB.
CREATE TABLE IF NOT EXISTS tab_os_edit_lock (
    nro_protocolo INT NOT NULL,
    ano_protocolo INT NOT NULL,
    ponto INT NOT NULL,
    nome VARCHAR(120) NOT NULL DEFAULT '',
    origem VARCHAR(32) NOT NULL DEFAULT 'os_edit',
    token CHAR(36) NOT NULL,
    acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    heartbeat_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (nro_protocolo, ano_protocolo),
    KEY idx_os_edit_lock_heartbeat (heartbeat_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
