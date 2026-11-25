package br.leg.camara.sagra.manutencao;

import android.app.NotificationManager;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** Objeto `window.SagraApp` exposto à página Manutenção (só o servidor SAGRA é carregado). */
final class SagraBridge {
    private final MainActivity activity;

    SagraBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String versao() {
        return BuildConfig.VERSION_NAME;
    }

    @JavascriptInterface
    public String statusNotificacoes() {
        NotificationManager nm = activity.getSystemService(NotificationManager.class);
        if (nm == null) return "desativadas";
        return nm.areNotificationsEnabled() ? "ativas" : "desativadas";
    }

    @JavascriptInterface
    public void abrirConfigNotificacoes() {
        activity.runOnUiThread(() -> {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
            activity.startActivity(i);
        });
    }

    @JavascriptInterface
    public void salvarArquivo(String base64, String nome, String mime) {
        String arquivo = nome == null || nome.isEmpty() ? "arquivo" : nome.replaceAll("[\\\\/:*?\"<>|]", "_");
        try {
            byte[] dados = Base64.decode(base64, Base64.DEFAULT);
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, arquivo);
                cv.put(MediaStore.Downloads.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
                cv.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) throw new IllegalStateException("sem acesso a Downloads");
                try (OutputStream os = activity.getContentResolver().openOutputStream(uri)) {
                    if (os == null) throw new IllegalStateException("sem acesso a Downloads");
                    os.write(dados);
                }
                cv.clear();
                cv.put(MediaStore.Downloads.IS_PENDING, 0);
                activity.getContentResolver().update(uri, cv, null, null);
            } else {
                File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                try (FileOutputStream fos = new FileOutputStream(new File(dir, arquivo))) {
                    fos.write(dados);
                }
            }
            toast("Salvo em Downloads: " + arquivo);
        } catch (Exception e) {
            toast("Não foi possível salvar o arquivo");
        }
    }

    @JavascriptInterface
    public void sair() {
        activity.runOnUiThread(activity::sair);
    }

    private void toast(String msg) {
        activity.runOnUiThread(() -> Toast.makeText(activity, msg, Toast.LENGTH_LONG).show());
    }
}
