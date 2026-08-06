-- Revisão técnica da prova gerada (OK / Cancelar na página Papelaria)
ALTER TABLE tabPapelariaJobs
ADD COLUMN IF NOT EXISTS ProvaRevisao VARCHAR(20) NULL
AFTER ArquivoPdfGerado;
