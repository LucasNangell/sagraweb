-- Dias não úteis para expediente (feriados, recesso, etc.).
CREATE TABLE IF NOT EXISTS tab_calendario_nao_util (
    `data` DATE NOT NULL PRIMARY KEY,
    descricao VARCHAR(120) NOT NULL,
    tipo ENUM('feriado','recesso','ponto_facultativo','manutencao') NOT NULL DEFAULT 'feriado',
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
