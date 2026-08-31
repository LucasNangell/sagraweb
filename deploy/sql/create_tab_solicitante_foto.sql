-- Fotos cadastradas de solicitantes (cadastro por nome, não por OS).
CREATE TABLE IF NOT EXISTS tab_solicitante_foto (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    solicitante VARCHAR(255) NOT NULL,
    solicitante_normalizado VARCHAR(255) NOT NULL,
    image_path VARCHAR(512) NOT NULL,
    content_type VARCHAR(64) NOT NULL DEFAULT 'image/jpeg',
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_solicitante_foto_norm (solicitante_normalizado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
