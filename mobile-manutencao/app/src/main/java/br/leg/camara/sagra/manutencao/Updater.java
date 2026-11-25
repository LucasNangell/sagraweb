package br.leg.camara.sagra.manutencao;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Auto-atualização: compara a versão publicada no servidor SAGRA, baixa o APK
 * novo, confere o SHA-256 e abre o instalador do Android (o sistema exige um
 * toque de confirmação para apps instalados fora da Play Store).
 */
final class Updater {
    private static final String TAG = "SagraUpdate";
    private static volatile boolean emAndamento;

    private Updater() {}

    /** Verifica e, havendo versão nova, baixa e instala sem perguntar antes. */
    static void verificar(Activity a) {
        if (emAndamento) return;
        emAndamento = true;
        new Thread(() -> {
            try {
                Api.Resp r = Api.request("GET", "api/manutencao/app/versao", null, null, null, 15_000);
                if (!r.ok()) return;
                JSONObject v = new JSONObject(r.body);
                int code = v.optInt("version_code", 0);
                if (code <= BuildConfig.VERSION_CODE) return;
                String nome = v.optString("version_name", String.valueOf(code));
                String sha = v.optString("sha256", "");
                a.runOnUiThread(() -> iniciar(a, nome, sha));
            } catch (Exception e) {
                Log.w(TAG, "Verificação de versão falhou: " + e);
            } finally {
                emAndamento = false;
            }
        }, "sagra-update-check").start();
    }

    private static void iniciar(Activity a, String versao, String sha) {
        if (a.isFinishing()) return;
        if (!a.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(a)
                    .setTitle("Atualização disponível (v" + versao + ")")
                    .setMessage("Para o app se atualizar sozinho, permita que ele instale atualizações: "
                            + "na próxima tela, ative \"Permitir desta fonte\" e volte ao app.")
                    .setPositiveButton("Permitir", (d, w) -> a.startActivity(
                            new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + a.getPackageName()))))
                    .setNegativeButton("Agora não", null)
                    .show();
            return;
        }
        AlertDialog progresso = new AlertDialog.Builder(a)
                .setTitle("Atualizando o app")
                .setMessage("Baixando a versão " + versao + "…")
                .setCancelable(false)
                .show();
        new Thread(() -> {
            String erro = null;
            try {
                File apk = baixar(a, sha);
                instalar(a, apk);
            } catch (Exception e) {
                Log.w(TAG, "Atualização falhou: " + e);
                erro = e.getMessage();
            }
            final String falha = erro;
            a.runOnUiThread(() -> {
                try {
                    progresso.dismiss();
                } catch (Exception ignored) {
                }
                if (falha != null && !a.isFinishing()) {
                    new AlertDialog.Builder(a)
                            .setTitle("Não foi possível atualizar")
                            .setMessage(falha + "\nTente novamente mais tarde.")
                            .setPositiveButton("OK", null)
                            .show();
                }
            });
        }, "sagra-update-download").start();
    }

    private static File baixar(Activity a, String shaEsperado) throws Exception {
        File destino = new File(a.getCacheDir(), "atualizacao.apk");
        HttpURLConnection c = (HttpURLConnection) new URL(Api.url("api/manutencao/app/apk")).openConnection();
        c.setConnectTimeout(15_000);
        c.setReadTimeout(60_000);
        c.setRequestProperty("User-Agent", Api.userAgent());
        try {
            if (c.getResponseCode() != 200) throw new Exception("Servidor respondeu " + c.getResponseCode());
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(destino)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    md.update(buf, 0, n);
                }
            }
            if (shaEsperado != null && !shaEsperado.isEmpty() && !shaEsperado.equalsIgnoreCase(hex(md.digest()))) {
                destino.delete();
                throw new Exception("Arquivo baixado está corrompido (checksum diferente)");
            }
            return destino;
        } finally {
            c.disconnect();
        }
    }

    private static void instalar(Activity a, File apk) throws Exception {
        PackageInstaller pi = a.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(a.getPackageName());
        if (Build.VERSION.SDK_INT >= 31) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }
        int id = pi.createSession(params);
        try (PackageInstaller.Session s = pi.openSession(id)) {
            try (InputStream in = new FileInputStream(apk);
                 OutputStream out = s.openWrite("sagra-manutencao", 0, apk.length())) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                s.fsync(out);
            }
            int flags = PendingIntent.FLAG_UPDATE_CURRENT
                    | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pIntent = PendingIntent.getBroadcast(a, id,
                    new Intent(a, InstallReceiver.class), flags);
            s.commit(pIntent.getIntentSender());
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
