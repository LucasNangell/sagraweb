-- Módulo Manutenção (máquinas da Gráfica) — MySQL-only.
-- A API também aplica via manutencao_schema.py / ip_permissions_schema / user_auth_schema no startup.
-- Ignore "Duplicate column" nos ALTER se a coluna já existir.

USE sagrafulldb;

CREATE TABLE IF NOT EXISTS tab_manutencao_maquina (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(32) NOT NULL,
    nome VARCHAR(160) NOT NULL,
    setor VARCHAR(80) NULL,
    fabricante VARCHAR(120) NULL,
    modelo VARCHAR(120) NULL,
    numero_serie VARCHAR(120) NULL,
    observacoes TEXT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    ordem INT NOT NULL DEFAULT 100,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    atualizado_por VARCHAR(32) NULL,
    UNIQUE KEY uk_manut_maquina_codigo (codigo),
    KEY idx_manut_maquina_ativo (ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tab_manutencao_recorrente (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    titulo VARCHAR(200) NOT NULL,
    descricao TEXT NULL,
    maquina_id BIGINT NULL,
    periodicidade_dias INT NULL,
    prioridade_padrao VARCHAR(16) NOT NULL DEFAULT 'normal',
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criado_por VARCHAR(32) NULL,
    atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    atualizado_por VARCHAR(32) NULL,
    KEY idx_manut_rec_maquina (maquina_id),
    KEY idx_manut_rec_ativo (ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tab_manutencao_pedido (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    maquina_id BIGINT NOT NULL,
    recorrente_id BIGINT NULL,
    titulo VARCHAR(200) NOT NULL,
    descricao TEXT NULL,
    prioridade VARCHAR(16) NOT NULL DEFAULT 'normal',
    status VARCHAR(16) NOT NULL DEFAULT 'fila',
    posicao_fila INT NOT NULL DEFAULT 0,
    maquina_parada TINYINT(1) NOT NULL DEFAULT 0,
    solicitado_por VARCHAR(32) NOT NULL,
    solicitado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    iniciado_por VARCHAR(32) NULL,
    iniciado_em DATETIME NULL,
    diagnostico TEXT NULL,
    solucao_passos TEXT NULL,
    pausa_motivo VARCHAR(500) NULL,
    concluido_por VARCHAR(32) NULL,
    concluido_em DATETIME NULL,
    conclusao TEXT NULL,
    cancelado_por VARCHAR(32) NULL,
    cancelado_em DATETIME NULL,
    motivo_cancelamento VARCHAR(500) NULL,
    atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_manut_pedido_status (status, posicao_fila),
    KEY idx_manut_pedido_maquina (maquina_id, status),
    KEY idx_manut_pedido_recorrente (recorrente_id, maquina_id, status),
    KEY idx_manut_pedido_concluido (concluido_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tab_manutencao_evento (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pedido_id BIGINT NOT NULL,
    tipo VARCHAR(32) NOT NULL,
    ponto VARCHAR(32) NULL,
    texto TEXT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_manut_evento_pedido (pedido_id, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Máquinas iniciais (só rode em tabela vazia).
INSERT INTO tab_manutencao_maquina (codigo, nome, setor, ordem, atualizado_por) VALUES
  ('MAQ-0001', 'CTP Impose', 'Pré-impressão', 10, 'seed'),
  ('MAQ-0002', 'Guilhotina A', 'Acabamento', 20, 'seed'),
  ('MAQ-0003', 'Guilhotina B', 'Acabamento', 30, 'seed'),
  ('MAQ-0004', 'Komori', 'Impressão', 40, 'seed'),
  ('MAQ-0005', 'PM 52', 'Impressão', 50, 'seed'),
  ('MAQ-0006', 'Speed Master 74', 'Impressão', 60, 'seed'),
  ('MAQ-0007', 'Trilateral Trim-tec 45i', 'Acabamento', 70, 'seed'),
  ('MAQ-0008', 'Capeadeira', 'Encadernação', 80, 'seed'),
  ('MAQ-0009', 'Alceadeira AM Graphics', 'Acabamento', 90, 'seed'),
  ('MAQ-0010', 'Dobradeira Rotary', 'Acabamento', 100, 'seed'),
  ('MAQ-0011', 'Dobradeira StahlTI52', 'Acabamento', 110, 'seed'),
  ('MAQ-0012', 'Dobradeira Stahlfolder', 'Acabamento', 120, 'seed'),
  ('MAQ-0013', 'Cintadeira', 'Acabamento', 130, 'seed'),
  ('MAQ-0014', 'Encadernadora Perfecta Bookline', 'Encadernação', 140, 'seed'),
  ('MAQ-0015', 'Laminadora', 'Acabamento', 150, 'seed'),
  ('MAQ-0016', 'Corte e Vinco Feva', 'Acabamento', 160, 'seed'),
  ('MAQ-0017', 'Capeadeira Capa Dura', 'Encadernação', 170, 'seed'),
  ('MAQ-0018', 'Encadernadora Perfuramax 50', 'Encadernação', 180, 'seed'),
  ('MAQ-0019', 'Encadernadora Perfuramax', 'Encadernação', 190, 'seed'),
  ('MAQ-0020', 'Grampeador Miruna', 'Encadernação', 200, 'seed'),
  ('MAQ-0021', 'Perfurador Universal 4 furos', 'Encadernação', 210, 'seed');

-- Permissões independentes das abas Gerência e Operador.
ALTER TABLE ip_permissions ADD COLUMN sb_manutencao_gerencia TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ip_permissions ADD COLUMN sb_manutencao_operador TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE user_permissions ADD COLUMN sb_manutencao_gerencia TINYINT(1) DEFAULT 0;
ALTER TABLE user_permissions ADD COLUMN sb_manutencao_operador TINYINT(1) DEFAULT 0;

-- 0.125.0 — App Android: aparelhos (login persistente), aberturas, visualizações e notificações do app.
CREATE TABLE IF NOT EXISTS tab_manutencao_aparelho (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ponto VARCHAR(32) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    aparelho_id VARCHAR(64) NOT NULL,
    modelo VARCHAR(120) NULL,
    versao_app VARCHAR(20) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultimo_acesso_em DATETIME NULL,
    ultima_abertura_em DATETIME NULL,
    revogado_em DATETIME NULL,
    revogado_por VARCHAR(32) NULL,
    UNIQUE KEY uq_manut_aparelho_token (token_hash),
    KEY idx_manut_aparelho_ponto (ponto, revogado_em),
    KEY idx_manut_aparelho_device (aparelho_id, revogado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tab_manutencao_app_abertura (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    aparelho_id BIGINT NOT NULL,
    ponto VARCHAR(32) NOT NULL,
    versao_app VARCHAR(20) NULL,
    aberto_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_manut_abertura_ponto (ponto, aberto_em),
    KEY idx_manut_abertura_aparelho (aparelho_id, aberto_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tab_manutencao_visualizacao (
    pedido_id BIGINT NOT NULL,
    ponto VARCHAR(32) NOT NULL,
    primeira_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultima_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    origem VARCHAR(10) NOT NULL DEFAULT 'web',
    vezes INT NOT NULL DEFAULT 1,
    PRIMARY KEY (pedido_id, ponto),
    KEY idx_manut_visualizacao_ponto (ponto, ultima_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tab_manutencao_app_notificacao (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ponto VARCHAR(32) NOT NULL,
    pedido_id BIGINT NULL,
    titulo VARCHAR(200) NOT NULL,
    mensagem VARCHAR(1000) NOT NULL,
    url VARCHAR(500) NULL,
    urgente TINYINT(1) NOT NULL DEFAULT 0,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_manut_app_notif_ponto (ponto, id),
    KEY idx_manut_app_notif_criado (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
