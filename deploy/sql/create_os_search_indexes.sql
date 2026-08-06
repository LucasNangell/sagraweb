-- Índices para acelerar listagem/busca de OS sem alterar regras de negócio.
-- Preferível: python deploy/scripts/apply_os_search_indexes.py  (idempotente)
-- Ou execute manualmente em janela de manutenção (EXPLAIN antes/depois).

CREATE INDEX idx_andamento_os_ultimo_data
  ON tabAndamento (NroProtocoloLink, AnoProtocoloLink, UltimoStatus, `Data`, CodStatus);

CREATE INDEX idx_andamento_filtros
  ON tabAndamento (SituacaoLink(64), SetorLink(32), UltimoStatus);

CREATE INDEX idx_protocolos_data_prioridade
  ON tabProtocolos (EntregData, EntregPrazoLink(32), AnoProtocolo, NroProtocolo);

CREATE INDEX idx_protocolos_solicitante
  ON tabProtocolos (NomeUsuario(64));

CREATE INDEX idx_detalhes_join
  ON tabDetalhesServico (NroProtocoloLinkDet, AnoProtocoloLinkDet);

CREATE INDEX idx_detalhes_produto_titulo
  ON tabDetalhesServico (TipoPublicacaoLink(64), Titulo(64));
