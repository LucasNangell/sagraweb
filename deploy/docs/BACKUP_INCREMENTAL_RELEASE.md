# Backup Incremental de Releases (DEV)

Este documento explica como utilizar, configurar e testar o script de backup incremental dos arquivos do servidor DEV (`deploy/scripts/backup_incremental_release.py`), que está integrado ao fluxo de release (`deploy-release-dev.bat`).

---

## 1. Para que serve o Script?

O script Python realiza backups versionados (completos ou incrementais) a partir da pasta de desenvolvimento (DEV), identificando e registrando quais arquivos foram adicionados, modificados ou removidos em cada release de produção.

Os registros são salvos:
1. **No filesystem:** Em uma estrutura organizada sob a pasta `backups/releases/`.
2. **No banco de dados:** Registrando os metadados do release em `tabReleases` e a lista de arquivos afetados em `tabReleaseFiles` (MySQL ou SQLite local como fallback).

---

## 2. Como Usar

### 2.1. Execução Automática (Integrada ao Release)
Sempre que você rodar o processo de release padrão, o backup será executado de forma automática:
```bash
# Executa build, roda o backup incremental e gera a pasta de release
deploy-release-dev.bat -ReleaseDescription "Correção de bug no envio de WebSocket"
```

Se desejar pular o backup durante um release:
```bash
deploy-release-dev.bat -SkipBackup
```

Se precisar forçar um novo backup completo no release:
```bash
deploy-release-dev.bat -ForceFullBackup
```

---

### 2.2. Execução Manual via Python
Você pode rodar o script diretamente pelo terminal para backups rápidos:

```bash
# Executa um backup incremental/completo usando os diretórios padrão do projeto
python deploy/scripts/backup_incremental_release.py --release-name "release_custom_1" --description "Backup manual antes de alteração de banco"
```

#### Parâmetros suportados:
* `--source-root`: Pasta raiz a ser monitorada (Padrão: raiz do projeto `c:\dev\SagraWeb`).
* `--backup-root`: Pasta onde os backups serão guardados (Padrão: `source_root/backups`).
* `--release-name`: Identificador único do release (Padrão: `release_YYYYMMDD_HHMMSS`).
* `--description`: Breve resumo do que foi entregue no release.
* `--dry-run`: Executa a varredura e a comparação, mas **não altera arquivos no disco e não escreve no banco de dados**.
* `--force-full`: Força a criação de um backup completo (`full`), ignorando o manifesto do backup anterior.
* `--config`: Caminho opcional para arquivo JSON de configurações de exclusão.
* `--exclude`: Padrões de arquivos ou pastas adicionais para excluir (separados por vírgula).
* `--verbose`: Ativa mensagens de log detalhadas em nível debug.

---

### 2.3. Simulação Segura com `--dry-run`
Recomendado para testar se as regras de exclusão estão funcionando sem criar pastas físicas ou inserir dados no banco:
```bash
python deploy/scripts/backup_incremental_release.py --release-name "teste_simulacao" --dry-run
```

---

### 2.4. Consulta e Restauração via Linha de Comando

O script também atua como um utilitário administrativo para consultar o histórico e restaurar arquivos diretamente de um release:

#### A. Listar todos os releases gravados no histórico:
```bash
python deploy/scripts/backup_incremental_release.py --list
```
*Gera uma tabela ASCII formatada no terminal mostrando ID, Nome, Tipo, Status, Data e a Descrição do Release.*

#### B. Visualizar arquivos modificados/deletados em um release específico (ID ou Nome):
```bash
python deploy/scripts/backup_incremental_release.py --list-files 3
```

#### C. Restaurar a versão de um arquivo de um release específico:
```bash
# Restaura na pasta original do DEV (avisa antes de sobrescrever)
python deploy/scripts/backup_incremental_release.py --restore-file "app/backend/main.py" --release-id 3

# Sobrescreve o arquivo original sem perguntar (forçado)
python deploy/scripts/backup_incremental_release.py --restore-file "app/backend/main.py" --release-id 3 --force

# Restaura o arquivo salvando-o em outra pasta ou nome diferente
python deploy/scripts/backup_incremental_release.py --restore-file "app/backend/main.py" --release-id 3 --output "C:\temp\main_recuperado.py"
```

---

### 2.5. Painel de Controle por Interface Gráfica (GUI)

Para uma experiência visual completa e amigável (sem usar comandos de terminal), você pode usar o painel gráfico desktop:

#### Como abrir a GUI:
1. Vá na raiz do projeto e clique duas vezes no atalho:
   `backup-gui-dev.bat`
2. Ou execute pelo terminal:
   ```bash
   python deploy/scripts/backup_gui.py
   ```

#### Funcionalidades da Interface Gráfica:
* **Navegação Histórica:** Selecione qualquer release no painel da esquerda para atualizar instantaneamente os detalhes do Git e a lista de arquivos alterados (no painel da direita).
* **Restauração em 1 clique:** Clique em qualquer arquivo modificado no painel da direita, clique em `Restaurar Arquivo Selecionado` e escolha se deseja sobrescrever no caminho original do DEV ou salvá-lo em uma pasta customizada com caixas de diálogo nativas.
* **Geração Visual de Backup:** Insira a descrição da nova entrega, escolha o tipo de backup (Incremental ou Full) e clique em `Iniciar Backup do DEV`. O progresso e os logs são impressos em tempo real em um console integrado sem travar a tela.

---

## 3. Estrutura dos Arquivos de Backup

Os backups são salvos em subpastas numeradas sequencialmente na raiz do backup (`backups/releases/`):

```text
backups/
  releases.db                              # Banco SQLite fallback (se MySQL estiver inacessível)
  backup_incremental.log                   # Logs persistentes do script de backup
  releases/
    000001_full_20260617_153000/           # Backup completo inicial
      files/                               # Todos os arquivos válidos copiados
        app/
          backend/
            main.py
        ...
      manifest.json                        # Estado completo dos arquivos nesse backup
      release_summary.json                 # Metadados do release
    000002_incremental_20260617_180000/   # Próximo backup (incremental)
      files/                               # Apenas arquivos novos ou modificados copiados
        app/
          backend/
            routers/
              api.py
      manifest.json                        # Estado completo da pasta DEV na data do release
      changed_files.json                   # Listagem com o que foi adicionado/modificado/removido neste release
      release_summary.json                 # Metadados do release
```

* **`manifest.json`:** Contém o mapeamento de caminho relativo, tamanho, data de modificação e hash SHA-256 de todos os arquivos monitorados no momento do backup.
* **`changed_files.json`:** Lista explícita dos arquivos adicionados, modificados e removidos nesse release específico (presente apenas em backups incrementais).

---

## 4. Estrutura do Banco de Dados

Se as tabelas do MySQL `tabReleases` e `tabReleaseFiles` não existirem, o script tentará criá-las automaticamente. Se a conexão falhar, o script usará um arquivo local **SQLite** (`backups/releases.db`) transparente.

### 4.1. Tabela `tabReleases` (Resumo)
Registra o status geral do release e do backup, duração, total de arquivos alterados e dados do Git (se aplicável):

* `id` (chave primária)
* `release_name` (nome da release)
* `description` (mensagem do release)
* `backup_type` (`full` ou `incremental`)
* `source_root` / `backup_path` / `manifest_path` (caminhos absolutos e relativos)
* `status` (`success` ou `failed`)
* `started_at` / `finished_at` / `duration_seconds` (tempos de processamento)
* `total_files_scanned` / `total_added` / `total_modified` / `total_deleted` / `total_unchanged`
* `created_by` (usuário do SO que iniciou)
* `git_branch` / `git_commit` (ramificação e hash de commit ativos)

### 4.2. Tabela `tabReleaseFiles` (Lista de Arquivos)
Registra cada arquivo individual modificado no release:

* `id` (chave primária)
* `release_id` (vínculo com `tabReleases`)
* `relative_path` (caminho relativo do arquivo)
* `action` (`added`, `modified` ou `deleted`)
* `size_bytes` (tamanho do arquivo)
* `mtime` (data de modificação)
* `sha256_before` / `sha256_after` (hash antes e depois da alteração)
* `backup_file_path` (caminho do arquivo de backup correspondente para restauração)

---

## 5. Como Restaurar Arquivos Manualmente

Para restaurar o estado dos arquivos em uma determinada release:

### 5.1. Restauração Completa de uma Release
1. Acesse a pasta do backup correspondente sob `backups/releases/XXXXXX_type_name_timestamp/`.
2. O arquivo `manifest.json` lista todos os arquivos que compunham aquela versão e seus respectivos hashes.
3. Se o backup da versão for `full`, basta copiar o conteúdo da pasta `files/` de volta para a origem.
4. Se o backup da versão for `incremental`:
   - Comece restaurando o último backup `full` anterior a essa versão.
   - Aplique sequencialmente a pasta `files/` de cada backup incremental posterior até chegar na versão desejada.
   - Apague os arquivos marcados como `deleted` em cada `changed_files.json` intermediário.

### 5.2. Restaurar um único arquivo modificado
1. Se você precisa recuperar uma versão antiga do arquivo `app/backend/main.py`:
2. Faça uma busca nas tabelas do banco de dados (MySQL ou SQLite) ou nos arquivos `changed_files.json` para descobrir em qual release o arquivo foi alterado pela última vez.
3. O campo `backup_file_path` na tabela `tabReleaseFiles` (ou a pasta do backup) indicará o caminho exato do arquivo de cópia física (ex.: `backups/releases/000002_incremental_.../files/app/backend/main.py`).
4. Copie este arquivo diretamente para a sua pasta de trabalho.

---

## 6. Cuidados e Boas Práticas

> [!WARNING]
> **Segredos e Credenciais:**
> O arquivo `config/.env` e arquivos com dados confidenciais estão nas regras de exclusão padrão do script (`DEFAULT_EXCLUDE_FILES`). Nunca adicione chaves, senhas ou tokens que fujam desses padrões em arquivos monitorados.

> [!IMPORTANT]
> **Permissão de escrita:**
> Certifique-se de que o usuário executando o release possui permissão de leitura na pasta do projeto e escrita na pasta de backups (`backups/`).
