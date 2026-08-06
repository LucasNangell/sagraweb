-- Índices FULLTEXT para filtros textuais da lista de OSs (Produto, Título, Solicitante).
-- ATENÇÃO: em bases com 1M+ registros, executar em janela de manutenção.
-- Engine requerida: InnoDB (MySQL 5.7+ / 8.x).
--
-- Verificar antes:
--   SHOW TABLE STATUS LIKE 'tabDetalhesServico';
--   SHOW TABLE STATUS LIKE 'tabProtocolos';
--
-- Aplicação automática no startup (se SAGRA_AUTO_CREATE_FULLTEXT_INDEXES=true):
--   app/backend/os_text_search_indexes_schema.py
--
-- Ou manualmente:

CREATE FULLTEXT INDEX ft_detalhes_titulo
  ON tabDetalhesServico (`Titulo`);

CREATE FULLTEXT INDEX ft_detalhes_produto
  ON tabDetalhesServico (`TipoPublicacaoLink`);

CREATE FULLTEXT INDEX ft_protocolos_solicitante
  ON tabProtocolos (`NomeUsuario`);
