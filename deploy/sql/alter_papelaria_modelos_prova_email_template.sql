-- PDF padrão opcional de prova (modo e-mail) por modelo de papelaria.
-- Idempotente via ensure_papelaria_modelos_table(); este script é para deploy manual.
ALTER TABLE tabPapelariaModelos
  ADD COLUMN ProvaEmailTemplatePdf VARCHAR(512) NULL;
