-- Rastreamento idempotente da importação tabRegistroPT (Access SAT) -> tabAnaliseItens.
-- SatCodigo = coluna Código do Access (chave natural).

CREATE TABLE IF NOT EXISTS `tabMigracaoSatRegistroPT` (
  `SatCodigo` int NOT NULL,
  `ID_AnaliseItem` int NOT NULL,
  `OS` int NOT NULL,
  `Ano` int NOT NULL,
  `VersaoSat` int DEFAULT NULL,
  `ProbTecFileName` varchar(255) DEFAULT NULL,
  `Componente` varchar(100) DEFAULT NULL,
  `ProbTecTitulo` varchar(255) DEFAULT NULL,
  `PdfSourcePath` varchar(1024) DEFAULT NULL,
  `PdfStoragePath` varchar(1024) DEFAULT NULL,
  `ImportadoEm` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`SatCodigo`),
  UNIQUE KEY `uq_migracao_item` (`ID_AnaliseItem`),
  KEY `idx_migracao_os_ano` (`OS`, `Ano`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
