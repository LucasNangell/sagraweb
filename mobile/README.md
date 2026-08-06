# SAGRA Tablet (APK)

App Android isolado do monorepo web. Reimplementa o painel `/painel/tablet` com UI responsiva (celular e tablet), conectando à API de produção:

- API: `https://cgrafsysvm.camara.leg.br/sagra/api/...`
- WebSocket: `wss://cgrafsysvm.camara.leg.br/sagra/api/ws/`

**Nada nesta pasta altera `apps/web`, `app/backend` ou o workspace pnpm da raiz.**

## Pré-requisitos

- Node ≥ 20 e pnpm ≥ 9
- **JDK 21+** (Capacitor 7). O script `build-apk.ps1` usa automaticamente o JBR do Android Studio se `JAVA_HOME` for 17.
- Android SDK (`ANDROID_HOME` / `ANDROID_SDK_ROOT`)
- Android Studio (recomendado; fornece o JDK 21 embutido)

## Desenvolvimento (navegador)

```powershell
cd mobile
pnpm install
pnpm dev
```

Abre em `http://localhost:5180`. O Vite faz proxy de `/sagra/api` para o host de produção (cookies reescritos para o domínio local).

## Gerar APK debug

```powershell
cd mobile
pnpm install
pnpm apk:debug
```

O APK fica em:

`mobile/android/app/build/outputs/apk/debug/app-debug.apk`

## Gerar APK release assinado

Defina variáveis de ambiente com o keystore (fora do repositório) e rode:

```powershell
$env:SAGRA_KEYSTORE_PATH = "C:\path\to\sagra-tablet.keystore"
$env:SAGRA_KEYSTORE_PASSWORD = "..."
$env:SAGRA_KEY_ALIAS = "sagra-tablet"
$env:SAGRA_KEY_PASSWORD = "..."
pnpm apk:release
```

## Login

Como `cgrafsysvm.camara.leg.br` é host público, o app usa **`POST /auth/login`** (ponto/e-mail + senha). Contas que só usavam ponto+nome na LAN precisam ativar a senha pelo e-mail antes.

## Configuração do painel

Colunas/andamentos vêm de `GET /settings/preferences/painel_setor` (fallback para o padrão definido pelo administrador em Usuários → "Padrão do painel por setor"). Não há editor de layout no app.

## Capacitor

- `CapacitorHttp` habilitado (cookie jar nativo Android — necessário porque a sessão é cookie HttpOnly).
- Câmera frontal para reconhecimento facial.
- Keep-awake enquanto o quadro estiver aberto.
