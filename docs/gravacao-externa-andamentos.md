# Sequência de andamentos — Gravação Externa

Fluxo feliz, da entrada em **Gravação Pendente** até a OS sair da lista **Aguardando retirada** (`/gravacao-externa`).

> Observação: todo texto de `Observaçao` é prefixado automaticamente com a hora no momento do registro (`HHhMM` + quebra de linha), via `format_andamento_obs`.

> **Juntada:** em **todas** as etapas abaixo, se a OS fizer parte de um `JuntadaGrupoId`, o corpo da observação começa com `OSs juntadas: OS A e OS B` (formato via `with_juntada_obs_prefix` / `format_juntada_membros_label`), seguido do bloco habitual (chapas e texto da etapa).

---

## 1. Gravação Pendente

| Campo | Valor |
|--------|--------|
| **Andamento** | `Gravação Pendente` |
| **Setor** | `SEGEP` |
| **Observação** | Bloco estruturado com chapas, por exemplo: |

```
HHhMM
Chapas por máquina:
- <máquina>: <qtd>
```

Se o operador informar texto livre no formulário, ele entra abaixo das chapas. Se houver juntada de OSs, a primeira linha do corpo fica:

`OSs juntadas: OS A e OS B` (ou lista com “e” antes da última).

| Quando é registrado | Ação do usuário |
|---------------------|-----------------|
| Ao lançar o andamento na OS (histórico / formulário de andamento), com arquivos de rede e chapas selecionados no modal **Gravação Pendente**. | Cria a sessão em `tab_os_gravacao_pendente` e coloca a OS na aba **OPs p/ Gravação Externa → Gravação pendente**. |

---

## 2. Gravação Externa

| Campo | Valor |
|--------|--------|
| **Andamento** | `Saída p/` |
| **Setor** | `Grav. Externa` |
| **Observação** | |

```
HHhMM
[OSs juntadas: …]   ← se juntada

Chapas por máquina:
- <máquina>: <qtd>
```

| Quando é registrado | Ação do usuário |
|---------------------|-----------------|
| Ao clicar em **Enviar para Gravação Externa** na aba Gravação pendente (com fornecedor, se aplicável). | Marca a sessão pendente como `enviada`, cria sessão em `tab_os_gravacao_externa` e move a OS para **OPs em andamento**. |

## 3. Recebido (NOVO)
> **Nota:** **Iniciar gravação** (operador/fornecedor) agora deve gerar o andamento "Recebido" no setor "Grav. Externa" e atualizar o status da sessão para `Recebido`.
>
> **Juntada:** se a sessão tiver `JuntadaGrupoId`, iniciar aplica o mesmo status/andamento a **todas** as OSs ativas do grupo.

| Campo | Valor |
|--------|--------|
| **Andamento** | `Recebido` |
| **Setor** | `Grav. Externa` |
| **Observação** | |

```
HHhMM
[OSs juntadas: …]   ← se juntada

Arquivos baixados: 

Chapas por máquina:
- <máquina>: <qtd>
```

---

## 4. Aguard. Retirada > mudar para "Gravação Ext. Concluída"

| Campo | Valor |
|--------|--------|
| **Andamento** | `Gravação Ext. Concluída` |
| **Setor** | `SEGEP` |
| **Observação** | |

```
HHhMM
[OSs juntadas: …]   ← se juntada

Gravação concluída. Aguardando retirada de:

Chapas por máquina:
- <máquina>: <qtd>
```

(Sem chapas na origem: `- (não informado)`.)

| Quando é registrado | Ação do usuário |
|---------------------|-----------------|
| Ao confirmar **Gravação concluída** (com sessão `iniciada`, ou sem sessão para operador com permissão). | Sessão externa passa a `concluida` e a OS entra na lista **Aguardando retirada**. | Se a OS estiver no Setor "Grav. Externa" e o usuário tentar lançar algum andamento manualmente, sem ser pelo botão de gravação concluída, o sistema deve exibir um modal com os mesmos campos que são exibidos quando clica no botão gravação concluída, para preencher as informações e lançar o andamento corretamente e atualizar a lista de controle de chapas gravadas, assim ele registra o andamento "Gravação Ext. Concluída" antes de registrar o andamento que o usuário estava tentando fazer.

> **Juntada:** concluir replica `Gravação Ext. Concluída` e marca `concluida` em **todas** as sessões ativas do mesmo `JuntadaGrupoId`. A lista Aguardando retirada exibe o grupo agregado.

---

## 5. Recebido *(saída de Aguardando retirada)*

| Campo | Valor |
|--------|--------|
| **Andamento** | `Recebido` |
| **Setor** | `Gravação` |
| **Observação** | |

```
HHhMM
[OSs juntadas: …]   ← se juntada

Chapas recebidas:

Chapas por máquina:
- <máquina>: <qtd>
```

| Quando é registrado | Ação do usuário |
|---------------------|-----------------|
| Ao lançar o **recebimento / entrega de chapas** no modal da lista Aguardando retirada. | Preenche `EntregaLancadaEm` na sessão; a OS **sai** de Aguardando retirada (filtro: `Status = concluida` e `EntregaLancadaEm IS NULL`). |

> **Juntada:** a entrega aplica recebimento e andamento a **todas** as sessões concluídas do grupo ainda sem `EntregaLancadaEm`.

---

## Lançamento manual com juntada

Quando a OS já faz parte de uma juntada (sessões em pendente/externa com `JuntadaGrupoId` e irmãs), qualquer **novo lançamento manual** de andamento na OS principal pergunta se deve replicar o mesmo andamento (situação, setor e observação) nas demais OSs juntadas — mesmo fluxo/modal usado para vínculo de OSs (`origem: juntada`). O lançamento inicial de **Gravação Pendente** (modal com arquivos/chapas/juntadas) já replica na criação e não passa por essa pergunta.

Nas listas de cards em `/gravacao-externa` (pendente, em andamento e aguardando retirada), o subtítulo do card agregado mostra **Juntada de OPs** no lugar de solicitante · produto.

---

## Resumo em ordem

```
1. Gravação Pendente         | SEGEP         | [OSs juntadas…] Chapas por máquina: …          → lançamento + arquivos
2. Saída p/                  | Grav. Externa | [OSs juntadas…] Chapas por máquina: …          → Enviar para Externa
3. Recebido                  | Grav. Externa | [OSs juntadas…] Arquivos baixados: …           → Iniciar gravação
4. Gravação Ext. Concluída    | SEGEP         | [OSs juntadas…] Gravação concluída. Aguardando… → Gravação concluída
5. Recebido                  | Gravação      | [OSs juntadas…] Chapas recebidas: …            → recebimento (sai da lista)
```
