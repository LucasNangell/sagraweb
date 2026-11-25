# File Mover XP

Utilitário Windows (compatível com **Windows XP**) que monitora uma pasta de origem e move automaticamente os arquivos para a pasta de destino assim que aparecem.

## Interface

- Campo **Origem** + Procurar
- Campo **Destino** + Procurar
- Botão que fica **MONITORANDO** (verde) enquanto ativo
- Status e log simples das movimentações

## Requisitos

- Windows XP ou superior
- [.NET Framework 2.0](https://www.microsoft.com/pt-br/download/details.aspx?id=1639) ou 3.5 instalado no PC de destino

## Compilar

No PC de desenvolvimento (com .NET 2.0/3.5):

```bat
cd tools\FileMoverXP
build.bat
```

Isso gera `FileMoverXP.exe` nesta pasta.

## Uso

1. Copie `FileMoverXP.exe` para o PC com Windows XP.
2. Abra o programa.
3. Escolha a pasta de origem e a de destino.
4. Clique em **Iniciar monitoramento**.
5. Qualquer arquivo que surgir na origem será movido para o destino.

As pastas ficam salvas em `FileMoverXP.ini` ao lado do executável.

## Comportamento

- Não entra em subpastas (só arquivos na raiz da origem).
- Aguarda o arquivo ficar liberado antes de mover (evita mover cópia incompleta).
- Se já existir arquivo com o mesmo nome no destino, cria `nome_1.ext`, `nome_2.ext`, etc.
- Usa `FileSystemWatcher` + verificação a cada 2 segundos (mais confiável no XP).
