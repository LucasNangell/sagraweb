# SAGRA — Letreiro na barra de tarefas

Faixa compacta, arrastável, com a **mesma altura da barra de tarefas do Windows**. Exibe as OS que apareceriam em `/painel/setor`, em letreiro horizontal (não em colunas).

Configuração é **local** (`config.yaml` + janela de ajustes). Não usa a preferência salva no site.

## Requisitos

- Windows 10/11
- Python 3.10+
- Acesso HTTP à API Sagra (`https://cgrafsysvm.redecamara.camara.gov.br/sagra/api`)
- Login com `ponto`/`nome` **ou** IP da máquina cadastrado com permissão de painel setor (modo TV)

Coluna “Fonte: caixa de entrada” só funciona com sessão (`ponto` preenchido).

## Instalação

```powershell
cd widget_letreiro
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy config.example.yaml config.yaml
```

O padrão já é a API de produção (`.../sagra/api`). Para DEV local, troque no `config.yaml` ou na engrenagem. Preencha `ponto` / `nome` se o IP não tiver permissão de painel.

## Executar

Duplo clique em `iniciar-letreiro.bat`, ou:

```powershell
.\.venv\Scripts\python.exe letreiro.py
```

## Uso

- **Arrastar** pelo handle à esquerda (ao longo da taskbar; troca de monitor se cruzar).
- **Largura** pelas bordas esquerda/direita.
- **Engrenagem** ou botão direito no handle: ajustes (setor, grupos/situações, velocidade, login).
- Hover no letreiro **pausa** o deslize.
- Uma instância por usuário (lock em `%LOCALAPPDATA%\SagraLetreiro`).

## Cores

Iguais ao painel clássico: Prometido vermelho, Solicitado laranja, Sub OS âmbar, OS nova borda verde, acento da coluna pelo índice.

## Testes

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
```
