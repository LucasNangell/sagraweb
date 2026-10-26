# SAGRA — Letreiro na barra de tarefas

Faixa compacta, arrastável, com a **mesma altura da barra de tarefas do Windows**. Exibe as OS que apareceriam em `/painel/setor`, em letreiro horizontal (não em colunas). Cada OP aparece **uma vez**; o texto só desliza quando os cards não cabem na faixa.

Configuração é **local** (`config.yaml` ao lado do executável + janela de ajustes). Não usa a preferência salva no site.

## Uso portátil (sem instalar Python)

1. Gere o exe (máquina de desenvolvimento):

```powershell
cd widget_letreiro
.\build_exe.ps1
```

2. Copie só `SAGRA-Letreiro.exe` para o PC de destino e dê duplo clique.
3. Na primeira execução é criado `config.yaml` na **mesma pasta** do exe (API de produção já preenchida).

Não precisa de Python, venv nem `pip` na máquina de destino.

## Desenvolvimento (scripts)

```powershell
cd widget_letreiro
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy config.example.yaml config.yaml
.\.venv\Scripts\python.exe letreiro.py
```

Ou `iniciar-letreiro.bat` (usa o `.exe` se existir).

## Comportamento

- **Arrastar** pela faixa; **largura** pelas bordas.
- Botão direito: ajustes (setor, grupos, velocidade, login).
- Ponto à direita indica conexão.
- Hover **pausa** o deslize (quando a faixa está cheia).
- Uma instância por usuário (lock em `%LOCALAPPDATA%\SagraLetreiro`).

## Testes

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
```
