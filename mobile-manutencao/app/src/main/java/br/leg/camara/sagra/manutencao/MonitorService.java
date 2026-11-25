package br.leg.camara.sagra.manutencao;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Serviço em primeiro plano que mantém um long-poll com o servidor e mostra
 * os novos chamados como notificações — funciona com o app fechado.
 */
public class MonitorService extends Service {
    private static final String TAG = "SagraMonitor";
    private static final int ESPERA_S = 25;

    private volatile boolean rodando;
    private Thread loop;
    private ConnectivityManager.NetworkCallback redeCallback;

    static void iniciar(Context ctx) {
        if (!new AppPrefs(ctx).hasToken()) return;
        Intent i = new Intent(ctx, MonitorService.class);
        try {
            ctx.startForegroundService(i);
        } catch (Exception e) {
            Log.w(TAG, "Não foi possível iniciar o serviço: " + e);
        }
    }

    static void parar(Context ctx) {
        ctx.stopService(new Intent(ctx, MonitorService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Notificacoes.criarCanais(this);
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(Notificacoes.ID_SERVICO, Notificacoes.servico(this),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(Notificacoes.ID_SERVICO, Notificacoes.servico(this));
        }
        registrarRede();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!new AppPrefs(this).hasToken()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (loop == null || !loop.isAlive()) {
            rodando = true;
            loop = new Thread(this::executar, "sagra-monitor");
            loop.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        rodando = false;
        if (loop != null) loop.interrupt();
        if (redeCallback != null) {
            try {
                getSystemService(ConnectivityManager.class).unregisterNetworkCallback(redeCallback);
            } catch (Exception ignored) {
            }
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** Volta a conectar imediatamente quando a rede reaparece. */
    private void registrarRede() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm == null) return;
        redeCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                Thread t = loop;
                if (t != null) t.interrupt();
            }
        };
        try {
            cm.registerDefaultNetworkCallback(redeCallback);
        } catch (Exception e) {
            redeCallback = null;
        }
    }

    private void executar() {
        AppPrefs prefs = new AppPrefs(this);
        PowerManager pm = getSystemService(PowerManager.class);
        long espera = 2_000;
        while (rodando) {
            String token = prefs.token();
            if (token == null) break;
            long desde = prefs.lastEventId();
            try {
                Api.Resp r = Api.request("GET",
                        "api/manutencao/app/eventos?desde=" + desde + "&espera=" + (desde < 0 ? 0 : ESPERA_S),
                        token, null, null, (ESPERA_S + 20) * 1000);
                if (r.code == 401) {
                    prefs.clearToken();
                    Notificacoes.sessaoEncerrada(this);
                    break;
                }
                if (r.code == 200) {
                    PowerManager.WakeLock wl = pm == null ? null
                            : pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sagra:monitor");
                    if (wl != null) wl.acquire(10_000);
                    try {
                        processar(prefs, new JSONObject(r.body), desde < 0);
                    } finally {
                        if (wl != null && wl.isHeld()) wl.release();
                    }
                    espera = 2_000;
                    continue;
                }
                Log.w(TAG, "Eventos HTTP " + r.code);
            } catch (InterruptedException e) {
                // rede voltou: tenta de novo já.
            } catch (Exception e) {
                Log.w(TAG, "Falha no long-poll: " + e);
            }
            try {
                Thread.sleep(espera);
            } catch (InterruptedException ignored) {
                espera = 1_000;
                continue;
            }
            espera = Math.min(espera * 2, 60_000);
        }
        rodando = false;
        stopSelf();
    }

    private void processar(AppPrefs prefs, JSONObject body, boolean sincronizando) throws InterruptedException {
        long ultimo = body.optLong("ultimo_id", prefs.lastEventId());
        JSONArray itens = body.optJSONArray("itens");
        if (!sincronizando && itens != null) {
            for (int i = 0; i < itens.length(); i++) {
                JSONObject it = itens.optJSONObject(i);
                if (it == null) continue;
                Notificacoes.chamado(this,
                        it.optLong("id"),
                        it.optString("titulo", "Manutenção"),
                        it.optString("mensagem", ""),
                        it.optString("rota", "manutencao?aba=operador"),
                        it.optBoolean("urgente", false));
            }
        }
        prefs.setLastEventId(Math.max(ultimo, 0));
        JSONObject versao = body.optJSONObject("versao");
        if (versao != null) {
            int code = versao.optInt("version_code", 0);
            if (code > BuildConfig.VERSION_CODE && prefs.updateNotified() < code) {
                prefs.setUpdateNotified(code);
                Notificacoes.atualizacao(this, versao.optString("version_name", ""));
            }
        }
        if (Thread.interrupted()) throw new InterruptedException();
    }
}
