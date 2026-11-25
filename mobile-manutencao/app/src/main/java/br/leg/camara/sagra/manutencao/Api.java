package br.leg.camara.sagra.manutencao;

import android.os.Build;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Cliente HTTP mínimo (sem dependências) para a API do SAGRA. */
final class Api {
    static final String TOKEN_HEADER = "X-Sagra-App-Token";
    static final String VERSAO_HEADER = "X-Sagra-App-Versao";

    private Api() {}

    static final class Resp {
        final int code;
        final String body;
        final List<String> setCookies;

        Resp(int code, String body, List<String> setCookies) {
            this.code = code;
            this.body = body;
            this.setCookies = setCookies;
        }

        boolean ok() {
            return code >= 200 && code < 300;
        }
    }

    /** Base da SPA, sempre terminando em "/" (ex.: https://host/sagra/). */
    static String base() {
        String b = BuildConfig.BASE_URL;
        return b.endsWith("/") ? b : b + "/";
    }

    /** Origem (scheme://host[:porta]/) — usada para os cookies. */
    static String origin() {
        try {
            URL u = new URL(base());
            int port = u.getPort();
            return u.getProtocol() + "://" + u.getHost() + (port > 0 ? ":" + port : "") + "/";
        } catch (Exception e) {
            return base();
        }
    }

    static String host() {
        try {
            return new URL(base()).getHost();
        } catch (Exception e) {
            return "";
        }
    }

    static String url(String path) {
        return base() + (path.startsWith("/") ? path.substring(1) : path);
    }

    static String userAgent() {
        return "SagraManutencaoApp/" + BuildConfig.VERSION_NAME + " (Android " + Build.VERSION.RELEASE + "; "
                + Build.MANUFACTURER + " " + Build.MODEL + ")";
    }

    static Resp request(String method, String path, String token, String cookie, String jsonBody,
                        int readTimeoutMs) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url(path)).openConnection();
        try {
            c.setRequestMethod(method);
            c.setConnectTimeout(15_000);
            c.setReadTimeout(readTimeoutMs);
            c.setUseCaches(false);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", userAgent());
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty(VERSAO_HEADER, BuildConfig.VERSION_NAME);
            if (token != null) c.setRequestProperty(TOKEN_HEADER, token);
            if (cookie != null && !cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
            if (jsonBody != null) {
                byte[] bytes = jsonBody.getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream os = c.getOutputStream()) {
                    os.write(bytes);
                }
            } else if ("POST".equals(method)) {
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(0);
                c.getOutputStream().close();
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String body = in == null ? "" : readAll(in);
            List<String> cookies = new ArrayList<>();
            for (Map.Entry<String, List<String>> h : c.getHeaderFields().entrySet()) {
                if (h.getKey() != null && h.getKey().equalsIgnoreCase("Set-Cookie")) {
                    cookies.addAll(h.getValue());
                }
            }
            return new Resp(code, body, cookies);
        } finally {
            c.disconnect();
        }
    }

    static String readAll(InputStream in) throws IOException {
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
