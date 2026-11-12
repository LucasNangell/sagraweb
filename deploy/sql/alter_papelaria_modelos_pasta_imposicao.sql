-- Pasta UNC absoluta onde o PDF de Imposição do modelo deve ser salvo
ALTER TABLE tabPapelariaModelos
    ADD COLUMN PastaImposicao VARCHAR(512) NULL AFTER NomeExibicao;
