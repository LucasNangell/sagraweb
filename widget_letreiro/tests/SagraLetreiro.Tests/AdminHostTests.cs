namespace SagraLetreiro.Tests;

public class AdminHostTests
{
    [Fact]
    public void TryMapProxyPath_OnlyLetreiroApi()
    {
        Assert.True(AdminHost.TryMapProxyPath("/api/letreiro/instances", out var mapped));
        Assert.Equal("/letreiro/instances", mapped);
        Assert.True(AdminHost.TryMapProxyPath("/api/letreiro/jobs/run?x=1", out mapped));
        Assert.Equal("/letreiro/jobs/run?x=1", mapped);
        Assert.False(AdminHost.TryMapProxyPath("/api/os/search", out _));
        Assert.False(AdminHost.TryMapProxyPath("/api/letreiro-extra", out _));
        Assert.False(AdminHost.TryMapProxyPath("/index.html", out _));
    }

    [Fact]
    public void TryMapLocalPath_OnlyLocalApi()
    {
        Assert.True(AdminHost.TryMapLocalPath("/local/config", out var mapped));
        Assert.Equal("/local/config", mapped);
        Assert.True(AdminHost.TryMapLocalPath("/local/me?x=1", out mapped));
        Assert.Equal("/local/me", mapped);
        Assert.True(AdminHost.TryMapLocalPath("/local/situacoes", out mapped));
        Assert.Equal("/local/situacoes", mapped);
        Assert.True(AdminHost.TryMapLocalPath("/local/preview-notification", out mapped));
        Assert.Equal("/local/preview-notification", mapped);
        Assert.True(AdminHost.TryMapLocalPath("/local/config-profiles", out mapped));
        Assert.Equal("/local/config-profiles", mapped);
        Assert.True(AdminHost.TryMapLocalPath("/local/config-profiles/3", out mapped));
        Assert.Equal("/local/config-profiles/3", mapped);
        Assert.False(AdminHost.TryMapLocalPath("/api/letreiro/settings", out _));
        Assert.False(AdminHost.TryMapLocalPath("/index.html", out _));
    }

    [Fact]
    public void ResolveStaticPath_RejectsTraversalAndServesIndex()
    {
        var root = Path.Combine(Path.GetTempPath(), "letreiro-admin-web-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        Directory.CreateDirectory(Path.Combine(root, "assets"));
        File.WriteAllText(Path.Combine(root, "index.html"), "<html>ok</html>");
        File.WriteAllText(Path.Combine(root, "assets", "app.js"), "console.log(1)");
        try
        {
            Assert.Equal(
                Path.GetFullPath(Path.Combine(root, "index.html")),
                AdminHost.ResolveStaticPath(root, "/"));
            Assert.Equal(
                Path.GetFullPath(Path.Combine(root, "assets", "app.js")),
                AdminHost.ResolveStaticPath(root, "/assets/app.js"));
            Assert.Null(AdminHost.ResolveStaticPath(root, "/../secret.txt"));
            Assert.Null(AdminHost.ResolveStaticPath(root, "/%2e%2e/secret.txt"));
            Assert.Null(AdminHost.ResolveStaticPath(root, "/assets/missing.js"));
            Assert.Equal(
                Path.GetFullPath(Path.Combine(root, "index.html")),
                AdminHost.ResolveStaticPath(root, "/computadores"));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
