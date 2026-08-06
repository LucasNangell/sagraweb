<?php
/**
 * Envio usando a conta Windows logada (Negotiate + impersonation).
 *
 * Use nesta máquina quando:
 * - whoami é redecamara\SEU_USUARIO (domínio)
 * - credentials.enc de OUTRO usuário falha com HTTP 401
 *
 * Uso:
 *   php enviar_windows.php
 *   php enviar_windows.php --probe-only
 */

declare(strict_types=1);

putenv('EWS_AUTH_MODE=negotiate');
putenv('EWS_USERNAME=');
putenv('EWS_PASSWORD=');
putenv('EWS_USER=');

if (getenv('EWS_IMPERSONATE_MAILBOX') === false && getenv('EWS_IMPERSONATE') === false) {
    putenv('EWS_IMPERSONATE_MAILBOX=sepim.deapa@camara.leg.br');
}

require __DIR__ . '/enviar_teste.php';
