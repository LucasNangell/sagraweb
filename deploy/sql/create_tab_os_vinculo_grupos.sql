-- Comportamento sincronizado de grupos de OSs vinculadas (andamento + setor)
CREATE TABLE IF NOT EXISTS tabOSVinculoGrupos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    situacao VARCHAR(120) NOT NULL,
    setor VARCHAR(80) NOT NULL,
    criado_por_ponto VARCHAR(32) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- grupo_id é adicionado via ensure_os_vinculo_grupo_schema() no startup da API
