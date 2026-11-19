-- 0.78.0: textos de todas as ocorrências por objeto na inspeção de .cdr
-- (comparação dos dados do Corel da pasta com o formulário da Papelaria).
-- A API também aplica esta coluna automaticamente se faltar.
ALTER TABLE tabPapelariaCdrInspect ADD COLUMN OcorrenciasJson JSON NULL;
