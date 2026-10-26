using System.Diagnostics;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;

namespace SagraLetreiro;

public partial class OsBalloonWindow : Window
{
    readonly TickerCard _card;
    readonly LetreiroApiClient _client;
    Window? _overlay;
    Point _anchor;
    bool _openingFolder;
    bool _ready;

    public OsBalloonWindow(TickerCard card, LetreiroApiClient client)
    {
        InitializeComponent();
        _card = card;
        _client = client;
        OsTitle.Text = card.Label;
        SolicitanteValue.Text = string.IsNullOrWhiteSpace(card.Solicitante) ? "—" : card.Solicitante;
        ProdutoValue.Text = string.IsNullOrWhiteSpace(card.Produto) ? "—" : card.Produto;
        TituloValue.Text = string.IsNullOrWhiteSpace(card.Titulo) ? "—" : card.Titulo;
        Loaded += async (_, _) =>
        {
            await LoadDetailsAsync();
            if (_overlay is not null) PlaceAbove(_overlay, _anchor);
            _ready = true;
        };
        Deactivated += (_, _) =>
        {
            if (_ready && !_openingFolder) Close();
        };
    }

    public void PlaceAbove(Window overlay, Point cardScreenTopLeft)
    {
        _overlay = overlay;
        _anchor = cardScreenTopLeft;
        UpdateLayout();
        var dpi = VisualTreeHelper.GetDpi(this);
        var overlayTop = overlay.PointToScreen(new Point(0, 0));
        var widthPx = ActualWidth * dpi.DpiScaleX;
        var heightPx = ActualHeight * dpi.DpiScaleY;
        var geom = TaskbarService.At((int)cardScreenTopLeft.X, (int)overlayTop.Y);
        var left = cardScreenTopLeft.X;
        var top = overlayTop.Y - heightPx - 8;
        if (top < geom.MonitorTop) top = overlayTop.Y + overlay.ActualHeight * dpi.DpiScaleY + 8;
        if (left + widthPx > geom.MonitorRight) left = geom.MonitorRight - widthPx - 8;
        if (left < geom.MonitorLeft) left = geom.MonitorLeft + 8;
        Left = left / dpi.DpiScaleX;
        Top = top / dpi.DpiScaleY;
    }

    async Task LoadDetailsAsync()
    {
        StatusText.Visibility = Visibility.Visible;
        StatusText.Text = "Carregando detalhes...";
        StatusText.Foreground = new SolidColorBrush(Color.FromRgb(0x9b, 0x9b, 0xa8));
        DetailsGrid.Opacity = 0.4;
        try
        {
            var details = await _client.FetchOsDetailsAsync(_card.FolderAno, _card.FolderNr).ConfigureAwait(true);
            Bind(details);
            StatusText.Visibility = Visibility.Collapsed;
            DetailsGrid.Opacity = 1;
        }
        catch (Exception ex)
        {
            AppLog.Error("Falha ao carregar detalhes da OS", ex);
            StatusText.Text = "Erro ao carregar detalhes.";
            StatusText.Foreground = new SolidColorBrush(Color.FromRgb(0xff, 0x69, 0x61));
        }
    }

    void Bind(OsDetails data)
    {
        MaquinaBox.Text = OsDisplay.Text(data.MaquinaLink);
        TiragemBox.Text = OsDisplay.Text(data.Tiragem);
        PagsBox.Text = OsDisplay.Text(data.Pags);
        ModelosBox.Text = OsDisplay.Text(data.ModelosArq);
        FrenteVersoBox.IsChecked = OsDisplay.ToCheck(data.FrenteVerso);
        FormatoBox.Text = OsDisplay.Text(data.FormatoLink);
        PrioridadeBox.Text = OsDisplay.Text(data.EntregPrazoLink);
        DataBox.Text = OsDisplay.DateBr(data.EntregData);
        TurnoBox.Text = OsDisplay.Text(data.EntregPeriodo);
        ContatoBox.Text = OsDisplay.Text(data.ContatoTrab);
        PapelBox.Text = OsDisplay.JoinLines(data.PapelLink, data.PapelDescricao);
        CoresBox.Text = OsDisplay.JoinLines(data.Cores, data.CoresDescricao);
        AcabamentoBox.Text = OsDisplay.Text(data.DescAcabamento);
        ObsBox.Text = OsDisplay.Text(data.Observ);
    }

    async void OnOpenFolder(object sender, RoutedEventArgs e)
    {
        FolderError.Text = "";
        _openingFolder = true;
        try
        {
            var path = await _client.FetchOsPathAsync(_card.FolderAno, _card.FolderNr).ConfigureAwait(true);
            if (!OsFolderPath.IsUsable(path))
            {
                FolderError.Text = string.IsNullOrWhiteSpace(path) ? "Pasta não encontrada na rede." : path;
                return;
            }
            Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                Arguments = "\"" + path.Trim() + "\"",
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            AppLog.Error("Falha ao abrir pasta da OS", ex);
            FolderError.Text = ex.Message;
        }
        finally
        {
            _openingFolder = false;
        }
    }

    void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape) Close();
    }
}
