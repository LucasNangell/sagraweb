# Deploy produção (releases)

Fluxo em **duas etapas**: DEV envia a release; PROD publica com **um script único**.

---

## 1. DEV — build + enviar release

```bat
cd C:\dev\SagraWeb
deploy-release-dev.bat
```

Anote o nome da release (ex.: `20260611_201054`).

---

## 2. PROD — script único (tudo automático)

No servidor **10.1.1.73**, **PowerShell como Administrador**:

```bat
cd "C:\Sistemas CGraf\Sagra Web"
publicar-release.bat -ReleaseName 20260611_201054 -ConfirmProductionSwitch
```

Ou:

```powershell
powershell -File deploy\scripts\publicar-release-prod.ps1 `
  -ReleaseName "20260611_201054" `
  -ConfirmProductionSwitch
```

### O que o script faz (sozinho)

1. Junctions `release` → `shared`
2. **Para a API** só se a porta 8050 estiver em uso
3. Ativa `current` → release escolhida
4. Copia `.env` / `config.json` de `shared` e remove BOM UTF-8
5. **Inicia a API** em `current\` (background)
6. Aguarda `/health` OK

**Downtime:** ~1–3 min (só na troca/reinício da API).  
**NGINX:** não precisa reiniciar.

### Opções

| Flag | Efeito |
|------|--------|
| `-InteractiveApi` | Abre `iniciar-api.bat` em janela (em vez de background) |
| `-HealthWaitSec 90` | Aguarda mais tempo pelo health check |

---

## Rollback

```powershell
cd "C:\Sistemas CGraf\Sagra Web"
powershell -File deploy\scripts\rollback_release.ps1 -ConfirmProductionSwitch -ToRelease "nome_anterior"
publicar-release.bat -ReleaseName "nome_anterior" -ConfirmProductionSwitch
```

---

## Referência

`GUIA_DEPLOY_RELEASES_SAGRA.md`
