-- Log de auditoria completo por OS (alterações de protocolo, detalhes, andamentos, vínculos)
CREATE TABLE IF NOT EXISTS tab_os_audit_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    nro_protocolo INT NOT NULL,
    ano_protocolo INT NOT NULL,
    evento_em DATETIME NOT NULL,
    acao VARCHAR(40) NOT NULL,
    entidade VARCHAR(40) NOT NULL,
    campo VARCHAR(80) NULL,
    valor_anterior TEXT NULL,
    valor_novo TEXT NULL,
    ponto VARCHAR(20) NULL,
    client_ip VARCHAR(45) NULL,
    ref_cod VARCHAR(64) NULL,
    origem VARCHAR(40) NOT NULL DEFAULT 'API',
    descricao TEXT NULL,
    INDEX idx_os_audit_os (ano_protocolo, nro_protocolo, evento_em),
    INDEX idx_os_audit_ref (ref_cod)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
