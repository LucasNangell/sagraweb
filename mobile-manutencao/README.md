# SAGRA Manutenção — app Android

App nativo (Java, sem dependências externas) que abre a página **Manutenção** do SAGRA
numa WebView. As telas são as mesmas do site: toda melhoria publicada no servidor já
aparece no app, sem precisar de um APK novo.

## O que o app adiciona ao site

| Recurso | Como funciona |
| --- | --- |
| **Login persistente** | O usuário entra uma vez (tela de login do SAGRA dentro do app). O app troca a sessão por um *token de aparelho* (`POST /api/manutencao/aparelhos`). O servidor guarda só o SHA-256. A cada abertura, `POST /api/manutencao/app/sessao` recria o cookie de sessão. A Gerência pode desconectar o aparelho em **Manutenção → Gerência → App**. |
| **Notificações com o app fechado** | Um serviço em primeiro plano mantém uma conexão de *long-poll* (`GET /api/manutencao/app/eventos`) e mostra a notificação nativa na hora. Não usa Firebase. O Android exige a notificação fixa "Manutenção conectada". Na primeira abertura o app pede a isenção de otimização de bateria. O serviço volta sozinho após reiniciar o celular. |
| **Registro de aberturas** | Cada abertura (ou volta ao app após 10 min) grava `tab_manutencao_app_abertura`. A lista aparece em Gerência → App. |
| **Quem já viu** | A fila do Operador registra os pedidos exibidos (`POST /api/manutencao/visualizacoes`, origem `app`/`web`). Cards mostram "Visto por N"; o detalhe do pedido lista quem viu e quando. |
| **Atualização automática** | Ao abrir, o app consulta `GET /api/manutencao/app/versao`. Se houver `version_code` maior, baixa o APK, confere o SHA-256 e abre a confirmação de instalação do Android (1 toque). O serviço também avisa por notificação. |

## Pré-requisitos de build

- JDK 17 (`JAVA_HOME`) e Android SDK com platform 35 / build-tools 34+ (`ANDROID_HOME`).
- O Gradle Wrapper (8.9) é baixado na primeira execução.

## Gerar e publicar uma versão

1. Incremente `VERSION_CODE` (e `VERSION_NAME`) em `version.properties`.
   Sem `VERSION_CODE` maior, os celulares não atualizam.
2. Gere e publique:

   ```powershell
   powershell -File mobile-manutencao\scripts\build-apk.ps1 -PublicarEm "\\cgrafsysvm\Sistemas CGraf\Sagra Web\shared\storage\manutencao_app" -Notas "O que mudou"
   ```

   O script grava `dist\sagra-manutencao-<versão>.apk` e `dist\versao.json`. Depois copia
   o APK e, por último, o `versao.json` para a pasta indicada. A API lê essa pasta
   (`MANUTENCAO_APP_DIR` ou `<raiz>\storage\manutencao_app`). `-PublicarLocal` publica
   no `storage\` do ambiente de desenvolvimento.

O botão **Baixar app Android** da página Manutenção aparece para quem abre o site num
celular Android, sempre que existe um APK publicado.

## Chave de assinatura — FAÇA BACKUP

Na primeira geração de release, o script cria `%USERPROFILE%\.sagra\sagra-manutencao.jks`
e `sagra-manutencao-signing.properties` (senha aleatória). **Guarde os dois em local
seguro.** Uma atualização só instala se o APK for assinado pela mesma chave. Se a chave
for perdida, será preciso desinstalar o app em todos os celulares e instalar de novo.
Para usar outra localização, defina `SAGRA_MANUTENCAO_SIGNING` com o caminho do
`.properties`. Nunca versione a chave (o `.gitignore` já a exclui).

## Instalação no celular

1. Abra o SAGRA → Manutenção no Chrome do celular e toque em **Baixar app Android**.
2. Permita "instalar apps desconhecidos" para o Chrome quando o Android pedir.
3. Abra o app, faça login e aceite as notificações e a isenção de bateria.
4. Para receber as atualizações automáticas, permita também "instalar apps desconhecidos"
   para o próprio app **Manutenção** (o app pede na primeira atualização).

## Desenvolvimento

- Build debug: `scripts\build-apk.ps1 -Debug` gera `app-debug.apk`
  (`br.leg.camara.sagra.manutencao.debug`, instalável junto com o release).
- O debug carrega `http://localhost:5173/`, que é o Vite do `iniciar-servidor.bat`.
  No emulador ou celular de teste, rode `adb reverse tcp:5173 tcp:5173`: `localhost`
  é contexto seguro (`crypto.randomUUID`), ao contrário de `10.0.2.2`.
- Outra URL: `-PsagraDebugBaseUrl=...` (debug) ou `-BaseUrl` / `-PsagraBaseUrl=...` (release).
- Em builds debug, a WebView pode ser inspecionada em `chrome://inspect`.
