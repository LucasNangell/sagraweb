-- Pares andamento+setor sincronizados por grupo de OSs vinculadas
CREATE TABLE IF NOT EXISTS tabOSVinculoGrupoAndamentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    grupo_id INT NOT NULL,
    situacao VARCHAR(120) NOT NULL,
    setor VARCHAR(80) NOT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_grupo_andamento (grupo_id, situacao, setor),
    INDEX idx_vinculo_grupo_andamentos_grupo (grupo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: par legado em tabOSVinculoGrupos vira a primeira linha da filha
INSERT INTO tabOSVinculoGrupoAndamentos (grupo_id, situacao, setor)
SELECT g.id, g.situacao, g.setor
FROM tabOSVinculoGrupos g
WHERE g.situacao IS NOT NULL AND TRIM(g.situacao) <> ''
  AND g.setor IS NOT NULL AND TRIM(g.setor) <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM tabOSVinculoGrupoAndamentos a
      WHERE a.grupo_id = g.id
  );
