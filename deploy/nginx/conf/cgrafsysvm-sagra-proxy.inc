        # --- SAGRA Web (React + FastAPI :8050) — include compartilhado ---
        # Copiar para \\cgrafsysvm\nginx\conf\cgrafsysvm-sagra-proxy.inc

        # ZIP Gravação Externa — job/status/download (Range) e legado download-all.
        # Regex específico: não altera timeouts/buffers de /sagra/api/ nem de outros sistemas.
        location ~ ^/sagra/api/gravacao-externa/.+/arquivos/(download-all|zip)(/download)?$ {
            rewrite ^/sagra/api/(.*)$ /api/$1 break;
            proxy_pass http://sagra_backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header Connection "";
            proxy_connect_timeout 5s;
            proxy_request_buffering off;
            proxy_buffering off;
            proxy_read_timeout 3600s;
            proxy_send_timeout 3600s;
        }

        location /sagra/api/ws {
            proxy_pass http://sagra_backend/api/ws;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_connect_timeout 5s;
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
            proxy_buffering off;
        }

        location /sagra/api/ {
            proxy_pass http://sagra_backend/api/;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header Connection "";
            proxy_connect_timeout 5s;
            proxy_send_timeout 120s;
            proxy_read_timeout 120s;
            proxy_buffers 8 16k;
            proxy_buffer_size 16k;
        }
