---
name: TTL ZIP apos download
overview: Fazer o ZIP expirar 24h após o último download real, não após a montagem. ZIPs nunca baixados continuam expirando 24h depois de prontos.
todos:
  - id: extend-ttl-on-download
    content: Renovar ExpiraEm no download real; não renovar em POST/status
    status: completed
  - id: test-ttl-renew
    content: Cobrir o UPDATE de ExpiraEm no teste do job
    status: completed
isProject: false
---

# TTL do ZIP a partir do download

Hoje [`_finalize_ready`](app/backend/services/gravacao_externa_zip_job_service.py) grava `ExpiraEm = agora + 24h` quando o ZIP termina de montar. [`touch_zip_last_access`](app/backend/services/gravacao_externa_zip_job_service.py) só atualiza `UltimoAcessoEm` e **não** empurra a expiração — por isso quem demora mais de 24h para baixar perde o arquivo.

## Comportamento

- ZIP **nunca baixado:** continua expirando 24h depois de ficar pronto (evita ocupar disco para sempre).
- ZIP **baixado** (`GET .../zip/download` ou `download-all` já pronto): `ExpiraEm` passa a `agora + 24h`. Cada transferência real renova o prazo.
- Consulta de status / reuso de cache no `POST` **não** renovam o TTL (não são download).

O teto de 20 GB (LRU) permanece como rede de segurança.

## Alteração

Em [`gravacao_externa_zip_job_service.py`](app/backend/services/gravacao_externa_zip_job_service.py), estender `touch_zip_last_access` (ou um helper usado só no download) para:

```sql
UPDATE ... SET UltimoAcessoEm = NOW(),
  ExpiraEm = DATE_ADD(NOW(), INTERVAL %s HOUR)
WHERE GravacaoExternaId = %s AND Status = 'pronto'
```

Usar isso em [`_zip_file_response`](app/backend/routers/gravacao_externa_routes.py) (único ponto que serve o arquivo).

Manter o `touch` atual (só `UltimoAcessoEm`) no `POST`/status, para o LRU não tratar “abriu a tela” como download.

## Teste

Em [`test_gravacao_externa_zip_job.py`](app/backend/tests/test_gravacao_externa_zip_job.py): o UPDATE de download inclui `ExpiraEm = DATE_ADD(...)`.
