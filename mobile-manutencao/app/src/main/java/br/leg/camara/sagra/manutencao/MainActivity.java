package br.leg.camara.sagra.manutencao;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

/**
 * Tela única do app: a própria página Manutenção do SAGRA em uma WebView,
 * com login persistente (token do aparelho) e serviço de notificações.
 */
public class MainActivity extends Activity {
    private static final String TAG = "SagraMain";
    private static final int REQ_NOTIF = 10;
    private static final int REQ_ARQUIVO = 11;
    /** Voltar ao app depois disso conta como nova abertura (e renova a sessão). */
    private static final long REABERTURA_MS = 10 * 60_000L;

    private WebView web;
    private AppPrefs prefs;
    private ValueCallback<Uri[]> arquivoCallback;
    private long pausadoEm;
    private volatile boolean registrando;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new AppPrefs(this);
        Notificacoes.criarCanais(this);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0F172A);
        web = new WebView(this);
        web.setBackgroundColor(0xFFF1F5F9);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        aplicarInsets(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " SagraManutencaoApp/" + BuildConfig.VERSION_NAME);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new SagraBridge(this), "SagraApp");
        web.setWebViewClient(new Cliente());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> baixar(url, mimeType));

        pedirPermissaoNotificacoes();
        abrir(rotaDoIntent(getIntent()), true);
        if (getIntent() != null && getIntent().getBooleanExtra(Notificacoes.EXTRA_ATUALIZAR, false)) {
            Updater.verificar(this);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String rota = rotaDoIntent(intent);
        if (rota != null) web.loadUrl(Api.url(rota));
        if (intent.getBooleanExtra(Notificacoes.EXTRA_ATUALIZAR, false)) Updater.verificar(this);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        if (pausadoEm > 0 && System.currentTimeMillis() - pausadoEm > REABERTURA_MS && prefs.hasToken()) {
            // Voltou depois de um tempo: registra abertura e renova a sessão.
            renovarSessao(null);
        }
        pausadoEm = 0;
        Updater.verificar(this);
    }

    @Override
    protected void onPause() {
        pausadoEm = System.currentTimeMillis();
        CookieManager.getInstance().flush();
        web.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    // ---------------------------------------------------------------- abertura

    private String rotaDoIntent(Intent i) {
        if (i == null) return null;
        String rota = i.getStringExtra(Notificacoes.EXTRA_ROTA);
        return rota == null || rota.isEmpty() ? null : rota;
    }

    private void abrir(String rota, boolean inicial) {
        String destino = Api.url(rota != null ? rota : "manutencao?aba=operador");
        if (prefs.hasToken()) {
            renovarSessao(() -> web.loadUrl(destino));
        } else {
            web.loadUrl(destino);
        }
    }

    /** Troca o token do aparelho por uma sessão nova (login persistente). */
    private void renovarSessao(Runnable depois) {
        String token = prefs.token();
        new Thread(() -> {
            try {
                Api.Resp r = Api.request("POST", "api/manutencao/app/sessao", token, null, null, 15_000);
                if (r.ok()) {
                    CookieManager cm = CookieManager.getInstance();
                    for (String c : r.setCookies) cm.setCookie(Api.origin(), c);
                    cm.flush();
                    MonitorService.iniciar(this);
                } else if (r.code == 401 || r.code == 403) {
                    // Aparelho desconectado pela gerência ou conta sem acesso: volta ao login.
                    prefs.clearToken();
                    MonitorService.parar(this);
                }
            } catch (Exception e) {
                Log.w(TAG, "Renovação de sessão falhou (offline?): " + e);
            }
            if (depois != null) runOnUiThread(depois);
        }, "sagra-sessao").start();
    }

    /** Depois do login na página, autoriza o aparelho e guarda o token. */
    private void registrarSeNecessario(String url) {
        if (prefs.hasToken() || registrando || url == null || !url.contains("/manutencao")) return;
        String cookies = CookieManager.getInstance().getCookie(Api.origin());
        if (cookies == null || !cookies.contains("sagra_session=")) return;
        registrando = true;
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject()
                        .put("aparelho_id", prefs.deviceId())
                        .put("modelo", (Build.MANUFACTURER + " " + Build.MODEL).trim())
                        .put("versao_app", BuildConfig.VERSION_NAME);
                Api.Resp r = Api.request("POST", "api/manutencao/aparelhos", null, cookies, body.toString(), 15_000);
                if (r.ok()) {
                    String token = new JSONObject(r.body).optString("token", "");
                    if (!token.isEmpty()) {
                        prefs.setToken(token);
                        MonitorService.iniciar(this);
                        runOnUiThread(this::pedirIsencaoBateria);
                    }
                } else {
                    Log.w(TAG, "Registro do aparelho HTTP " + r.code + ": " + r.body);
                }
            } catch (Exception e) {
                Log.w(TAG, "Registro do aparelho falhou: " + e);
            } finally {
                registrando = false;
            }
        }, "sagra-registro").start();
    }

    /** Telas permitidas dentro do app: Manutenção, login/ativação de conta e chamado por QR. */
    static boolean foraDaManutencao(String url) {
        if (url == null || !url.startsWith(Api.base())) return false;
        String rel = url.substring(Api.base().length());
        int corte = rel.length();
        for (char c : new char[]{'?', '#'}) {
            int i = rel.indexOf(c);
            if (i >= 0 && i < corte) corte = i;
        }
        String caminho = rel.substring(0, corte);
        return !(caminho.startsWith("manutencao") || caminho.startsWith("login") || caminho.startsWith("chamado"));
    }

    /** Chamado pela página (botão Sair): desconecta este aparelho. */
    void sair() {
        String token = prefs.token();
        prefs.clearToken();
        MonitorService.parar(this);
        new Thread(() -> {
            try {
                if (token != null) Api.request("POST", "api/manutencao/app/sair", token, null, null, 10_000);
            } catch (Exception ignored) {
            }
        }, "sagra-sair").start();
        CookieManager cm = CookieManager.getInstance();
        cm.removeAllCookies(ok -> {
            cm.flush();
            web.clearHistory();
            web.loadUrl(Api.url("login?redirect=%2Fmanutencao"));
        });
    }

    // --------------------------------------------------------------- permissões

    private void pedirPermissaoNotificacoes() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
    }

    /** Sem isso o Android pode suspender a conexão em segundo plano. */
    @SuppressLint("BatteryLife")
    private void pedirIsencaoBateria() {
        PowerManager pm = getSystemService(PowerManager.class);
        if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName()) || prefs.batteryAsked()) return;
        prefs.setBatteryAsked();
        new AlertDialog.Builder(this)
                .setTitle("Receber chamados com o app fechado")
                .setMessage("Para os avisos chegarem na hora, permita que o app Manutenção funcione em "
                        + "segundo plano sem restrição de bateria.")
                .setPositiveButton("Permitir", (d, w) -> {
                    try {
                        startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                Uri.parse("package:" + getPackageName())));
                    } catch (ActivityNotFoundException e) {
                        startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                    }
                })
                .setNegativeButton("Agora não", null)
                .show();
    }

    // ------------------------------------------------------------------- layout

    private void aplicarInsets(View root) {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets b = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(b.left, b.top, b.right, b.bottom);
                return WindowInsets.CONSUMED;
            });
        }
    }

    // ---------------------------------------------------------------- arquivos

    private void baixar(String url, String mime) {
        if (url != null && url.startsWith("data:")) {
            int virgula = url.indexOf(',');
            String cabecalho = virgula > 0 ? url.substring(5, virgula) : "";
            String dados = virgula > 0 ? url.substring(virgula + 1) : "";
            String tipo = cabecalho.split(";")[0];
            if (!cabecalho.contains("base64")) {
                dados = Base64.encodeToString(Uri.decode(dados).getBytes(), Base64.NO_WRAP);
            }
            new SagraBridge(this).salvarArquivo(dados, "arquivo-sagra", tipo.isEmpty() ? mime : tipo);
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_ARQUIVO && arquivoCallback != null) {
            arquivoCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            arquivoCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ------------------------------------------------------------------ clients

    private final class Cliente extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (Api.host().equalsIgnoreCase(u.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (ActivityNotFoundException ignored) {
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
            registrarSeNecessario(url);
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            // O app é só a Manutenção: outras telas do SAGRA (ex.: início após o login) voltam para ela.
            if (foraDaManutencao(url)) {
                view.loadUrl(Api.url("manutencao?aba=operador"));
                return;
            }
            // Navegação interna da SPA (ex.: login → /manutencao) não dispara onPageFinished.
            registrarSeNecessario(url);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String html = "<html><body style='font-family:sans-serif;background:#f1f5f9;color:#0f172a;"
                    + "display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;"
                    + "text-align:center;padding:24px'><h2>Sem conexão com o SAGRA</h2>"
                    + "<p>Verifique a internet do celular e tente novamente.</p>"
                    + "<a href='" + Api.url("manutencao?aba=operador") + "' style='margin-top:16px;"
                    + "background:#0f172a;color:#fff;padding:14px 24px;border-radius:12px;text-decoration:none'>"
                    + "Tentar novamente</a></body></html>";
            view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (arquivoCallback != null) arquivoCallback.onReceiveValue(null);
            arquivoCallback = callback;
            try {
                startActivityForResult(params.createIntent(), REQ_ARQUIVO);
                return true;
            } catch (ActivityNotFoundException e) {
                arquivoCallback = null;
                return false;
            }
        }
    }
}
