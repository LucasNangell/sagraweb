package br.leg.camara.sagra.manutencao;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.UUID;

/** Estado persistente do app (armazenamento privado do aparelho). */
final class AppPrefs {
    private static final String FILE = "sagra_manutencao";
    private static final String K_TOKEN = "token";
    private static final String K_DEVICE = "aparelho_id";
    private static final String K_LAST_EVENT = "ultimo_evento";
    private static final String K_UPDATE_NOTIFIED = "update_notificado";
    private static final String K_BATTERY_ASKED = "bateria_perguntado";

    private final SharedPreferences sp;

    AppPrefs(Context ctx) {
        sp = ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    String token() {
        return sp.getString(K_TOKEN, null);
    }

    boolean hasToken() {
        String t = token();
        return t != null && !t.isEmpty();
    }

    void setToken(String token) {
        // Novo login: reinicia o cursor de eventos (sincroniza sem reenviar antigos).
        sp.edit().putString(K_TOKEN, token).putLong(K_LAST_EVENT, -1L).apply();
    }

    void clearToken() {
        sp.edit().remove(K_TOKEN).putLong(K_LAST_EVENT, -1L).apply();
    }

    /** Identificador estável deste aparelho (gerado na primeira execução). */
    String deviceId() {
        String id = sp.getString(K_DEVICE, null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            sp.edit().putString(K_DEVICE, id).apply();
        }
        return id;
    }

    long lastEventId() {
        return sp.getLong(K_LAST_EVENT, -1L);
    }

    void setLastEventId(long id) {
        sp.edit().putLong(K_LAST_EVENT, id).apply();
    }

    int updateNotified() {
        return sp.getInt(K_UPDATE_NOTIFIED, 0);
    }

    void setUpdateNotified(int code) {
        sp.edit().putInt(K_UPDATE_NOTIFIED, code).apply();
    }

    boolean batteryAsked() {
        return sp.getBoolean(K_BATTERY_ASKED, false);
    }

    void setBatteryAsked() {
        sp.edit().putBoolean(K_BATTERY_ASKED, true).apply();
    }
}
