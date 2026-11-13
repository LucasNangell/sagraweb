-- Configuração de imposição (folha/grid) por modelo — uso futuro pelo worker
ALTER TABLE tabPapelariaModelos
    ADD COLUMN ImposicaoConfigJson JSON NULL AFTER PastaImposicao;
