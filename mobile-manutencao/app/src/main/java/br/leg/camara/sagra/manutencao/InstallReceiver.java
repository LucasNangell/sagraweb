package br.leg.camara.sagra.manutencao;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;
import android.widget.Toast;

/** Resultado da sessão do PackageInstaller (auto-atualização). */
public class InstallReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmar = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmar != null) {
                confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirmar);
                } catch (Exception e) {
                    Log.w("SagraUpdate", "Tela de instalação indisponível: " + e);
                }
            }
        } else if (status != PackageInstaller.STATUS_SUCCESS) {
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            Log.w("SagraUpdate", "Instalação falhou (" + status + "): " + msg);
            Toast.makeText(context, "Não foi possível atualizar o app" + (msg != null ? ": " + msg : ""),
                    Toast.LENGTH_LONG).show();
        }
    }
}
