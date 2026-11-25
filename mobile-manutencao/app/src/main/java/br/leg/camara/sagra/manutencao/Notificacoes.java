package br.leg.camara.sagra.manutencao;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;

/** Canais e montagem das notificações do app. */
final class Notificacoes {
    static final String CANAL_CHAMADOS = "chamados";
    static final String CANAL_URGENTES = "urgentes";
    static final String CANAL_CONEXAO = "conexao";
    static final String CANAL_APP = "app";

    static final int ID_SERVICO = 1;
    static final int ID_UPDATE = 2;
    static final int ID_SESSAO = 3;

    static final String EXTRA_ROTA = "rota";
    static final String EXTRA_ATUALIZAR = "atualizar";

    private static final int COR = 0xFFF59E0B;

    private Notificacoes() {}

    static void criarCanais(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        NotificationChannel chamados = new NotificationChannel(
                CANAL_CHAMADOS, ctx.getString(R.string.canal_chamados), NotificationManager.IMPORTANCE_HIGH);
        chamados.setDescription(ctx.getString(R.string.canal_chamados_desc));
        chamados.enableVibration(true);
        chamados.setVibrationPattern(new long[]{0, 250, 150, 250});
        chamados.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), attrs);
        chamados.setLightColor(COR);
        chamados.enableLights(true);
        chamados.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

        NotificationChannel urgentes = new NotificationChannel(
                CANAL_URGENTES, ctx.getString(R.string.canal_urgentes), NotificationManager.IMPORTANCE_HIGH);
        urgentes.setDescription(ctx.getString(R.string.canal_urgentes_desc));
        urgentes.enableVibration(true);
        urgentes.setVibrationPattern(new long[]{0, 600, 200, 600, 200, 900});
        urgentes.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), attrs);
        urgentes.setLightColor(0xFFDC2626);
        urgentes.enableLights(true);
        urgentes.setBypassDnd(false);
        urgentes.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

        NotificationChannel conexao = new NotificationChannel(
                CANAL_CONEXAO, ctx.getString(R.string.canal_conexao), NotificationManager.IMPORTANCE_MIN);
        conexao.setDescription(ctx.getString(R.string.canal_conexao_desc));
        conexao.setShowBadge(false);

        NotificationChannel app = new NotificationChannel(
                CANAL_APP, ctx.getString(R.string.canal_app), NotificationManager.IMPORTANCE_DEFAULT);

        nm.createNotificationChannel(chamados);
        nm.createNotificationChannel(urgentes);
        nm.createNotificationChannel(conexao);
        nm.createNotificationChannel(app);
    }

    static PendingIntent abrirApp(Context ctx, int requestCode, String rota, boolean atualizar) {
        Intent i = new Intent(ctx, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (rota != null) i.putExtra(EXTRA_ROTA, rota);
        if (atualizar) i.putExtra(EXTRA_ATUALIZAR, true);
        return PendingIntent.getActivity(ctx, requestCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static Notification servico(Context ctx) {
        return new Notification.Builder(ctx, CANAL_CONEXAO)
                .setSmallIcon(R.drawable.ic_notif)
                .setColor(COR)
                .setContentTitle("Manutenção conectada")
                .setContentText("Aguardando novos chamados")
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(abrirApp(ctx, 0, null, false))
                .build();
    }

    static void chamado(Context ctx, long id, String titulo, String mensagem, String rota, boolean urgente) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        Notification.Builder b = new Notification.Builder(ctx, urgente ? CANAL_URGENTES : CANAL_CHAMADOS)
                .setSmallIcon(R.drawable.ic_notif)
                .setColor(COR)
                .setContentTitle(titulo)
                .setContentText(mensagem)
                .setStyle(new Notification.BigTextStyle().bigText(mensagem))
                .setAutoCancel(true)
                .setCategory(urgente ? Notification.CATEGORY_ALARM : Notification.CATEGORY_MESSAGE)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .setContentIntent(abrirApp(ctx, (int) (1000 + id % 100000), rota, false));
        nm.notify((int) (1000 + id % 100000), b.build());
    }

    static void atualizacao(Context ctx, String versao) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.notify(ID_UPDATE, new Notification.Builder(ctx, CANAL_APP)
                .setSmallIcon(R.drawable.ic_notif)
                .setColor(COR)
                .setContentTitle("Atualização do app disponível")
                .setContentText("Toque para instalar a versão " + versao)
                .setAutoCancel(true)
                .setContentIntent(abrirApp(ctx, ID_UPDATE, null, true))
                .build());
    }

    /** Depois da auto-atualização o Android fecha o app: avisa e oferece reabrir. */
    static void atualizado(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.notify(ID_UPDATE, new Notification.Builder(ctx, CANAL_APP)
                .setSmallIcon(R.drawable.ic_notif)
                .setColor(COR)
                .setContentTitle("App atualizado")
                .setContentText("Manutenção " + BuildConfig.VERSION_NAME + " instalada. Toque para abrir.")
                .setAutoCancel(true)
                .setContentIntent(abrirApp(ctx, ID_UPDATE, null, false))
                .build());
    }

    static void sessaoEncerrada(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.notify(ID_SESSAO, new Notification.Builder(ctx, CANAL_APP)
                .setSmallIcon(R.drawable.ic_notif)
                .setColor(COR)
                .setContentTitle("Manutenção desconectada")
                .setContentText("Este celular foi desconectado. Abra o app e entre novamente.")
                .setAutoCancel(true)
                .setContentIntent(abrirApp(ctx, ID_SESSAO, null, false))
                .build());
    }
}
