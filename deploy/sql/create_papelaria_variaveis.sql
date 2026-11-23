-- Variáveis universais da Papelaria: rótulo, tipo, obrigatório e fonte de
-- preenchimento automático (NULL = informado pelo usuário).
-- (A API também cria a tabela e o cadastro inicial automaticamente.)
CREATE TABLE IF NOT EXISTS tabPapelariaVariaveis (
    Chave VARCHAR(64) NOT NULL PRIMARY KEY,
    Rotulo VARCHAR(120) NOT NULL,
    Fonte VARCHAR(64) NULL,
    Tipo VARCHAR(16) NOT NULL DEFAULT 'text',
    Obrigatorio TINYINT(1) NOT NULL DEFAULT 0,
    Ordem INT NOT NULL DEFAULT 0,
    AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
