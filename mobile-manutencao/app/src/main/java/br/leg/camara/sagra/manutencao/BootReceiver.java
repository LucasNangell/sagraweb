package br.leg.camara.sagra.manutencao;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Religa o serviço de chamados após reiniciar o celular ou atualizar o app. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            MonitorService.iniciar(context);
        }
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Notificacoes.atualizado(context);
        }
    }
}
