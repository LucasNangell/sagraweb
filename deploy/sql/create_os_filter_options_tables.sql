-- Tabelas auxiliares para dropdowns Produto/Solicitante (idempotente via IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS tab_os_filter_produtos (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    produto VARCHAR(255) NOT NULL,
    produto_normalizado VARCHAR(255) NOT NULL,
    total_os INT NOT NULL DEFAULT 0,
    ultima_os_ano INT NULL,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_produto_normalizado (produto_normalizado),
    INDEX idx_filter_produtos_label (produto),
    INDEX idx_filter_produtos_norm (produto_normalizado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tab_os_filter_solicitantes (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    solicitante VARCHAR(255) NOT NULL,
    solicitante_normalizado VARCHAR(255) NOT NULL,
    total_os INT NOT NULL DEFAULT 0,
    ultima_os_ano INT NULL,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_solicitante_normalizado (solicitante_normalizado),
    INDEX idx_filter_solicitantes_label (solicitante),
    INDEX idx_filter_solicitantes_norm (solicitante_normalizado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
