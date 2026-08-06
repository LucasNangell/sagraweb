-- SAGRA Web — índices sugeridos para GET /api/os/search e filas PCP
-- NÃO aplicar automaticamente. Revisar em horário de baixa carga e fazer backup antes.
-- Executar manualmente no MySQL (sagrafulldb) após validar com EXPLAIN.

-- Andamento atual por OS (subquery em _OS_SEARCH_ANDAMENTO_JOIN)
-- Ajuda: NroProtocoloLink + AnoProtocoloLink + UltimoStatus + ordenação por Data
CREATE INDEX IF NOT EXISTS idx_andamento_os_ultimo
  ON tabAndamento (NroProtocoloLink, AnoProtocoloLink, UltimoStatus, `Data` DESC, CodStatus DESC);

-- Filtro por setor/situação na busca e fila PCP
CREATE INDEX IF NOT EXISTS idx_andamento_setor_situacao
  ON tabAndamento (SetorLink, SituacaoLink, UltimoStatus);

-- Detalhes do serviço (JOIN titulo/produto/formato)
CREATE INDEX IF NOT EXISTS idx_detalhes_servico_os
  ON tabDetalhesServico (NroProtocoloLinkDet, AnoProtocoloLinkDet);

-- Protocolos por ano/número (filtros exatos e ordenação)
CREATE INDEX IF NOT EXISTS idx_protocolos_ano_nro
  ON tabProtocolos (AnoProtocolo DESC, NroProtocolo DESC);

-- Fila PCP por setor
CREATE INDEX IF NOT EXISTS idx_pcp_fila_setor_os
  ON tab_pcp_fila (setor, nro_os, ano, ordem);

-- Validar plano (exemplo):
-- EXPLAIN SELECT p.NroProtocolo, p.AnoProtocolo FROM tabProtocolos p
--   LEFT JOIN tabDetalhesServico d ON ...
--   LEFT JOIN tabAndamento a ON ...
--   WHERE a.SetorLink = 'SEFOC' AND a.SituacaoLink NOT IN ('Entregue','Cancelada')
--   LIMIT 21;
