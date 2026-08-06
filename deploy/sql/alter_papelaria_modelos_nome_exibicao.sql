-- Nome amigável definido pelo admin para exibição na página Papelaria
ALTER TABLE tabPapelariaModelos
    ADD COLUMN IF NOT EXISTS NomeExibicao VARCHAR(255) NULL AFTER ArquivoModelo;
