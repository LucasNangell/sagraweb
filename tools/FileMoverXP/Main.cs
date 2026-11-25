using System;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace FileMoverXP
{
    public class MainForm : Form
    {
        private TextBox txtOrigem;
        private TextBox txtDestino;
        private Button btnOrigem;
        private Button btnDestino;
        private Button btnMonitor;
        private Label lblStatus;
        private Label lblLog;
        private System.Windows.Forms.Timer pollTimer;
        private FileSystemWatcher watcher;
        private bool monitorando;
        private readonly object sync = new object();
        private string configPath;

        public MainForm()
        {
            configPath = Path.Combine(Application.StartupPath, "FileMoverXP.ini");
            BuildUi();
            LoadConfig();

            pollTimer = new System.Windows.Forms.Timer();
            pollTimer.Interval = 2000;
            pollTimer.Tick += PollTimer_Tick;
        }

        private void BuildUi()
        {
            Text = "File Mover XP";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(520, 220);
            Font = new Font("Tahoma", 9F);

            Label lblOrigem = new Label();
            lblOrigem.Text = "Origem:";
            lblOrigem.Location = new Point(12, 18);
            lblOrigem.AutoSize = true;

            txtOrigem = new TextBox();
            txtOrigem.Location = new Point(80, 15);
            txtOrigem.Size = new Size(330, 22);

            btnOrigem = new Button();
            btnOrigem.Text = "Procurar...";
            btnOrigem.Location = new Point(420, 13);
            btnOrigem.Size = new Size(85, 25);
            btnOrigem.Click += BtnOrigem_Click;

            Label lblDestino = new Label();
            lblDestino.Text = "Destino:";
            lblDestino.Location = new Point(12, 52);
            lblDestino.AutoSize = true;

            txtDestino = new TextBox();
            txtDestino.Location = new Point(80, 49);
            txtDestino.Size = new Size(330, 22);

            btnDestino = new Button();
            btnDestino.Text = "Procurar...";
            btnDestino.Location = new Point(420, 47);
            btnDestino.Size = new Size(85, 25);
            btnDestino.Click += BtnDestino_Click;

            btnMonitor = new Button();
            btnMonitor.Text = "Iniciar monitoramento";
            btnMonitor.Location = new Point(80, 90);
            btnMonitor.Size = new Size(330, 40);
            btnMonitor.BackColor = Color.FromArgb(220, 220, 220);
            btnMonitor.Click += BtnMonitor_Click;

            lblStatus = new Label();
            lblStatus.Text = "Status: parado";
            lblStatus.Location = new Point(80, 140);
            lblStatus.Size = new Size(330, 18);
            lblStatus.ForeColor = Color.DarkRed;

            lblLog = new Label();
            lblLog.Text = "";
            lblLog.Location = new Point(12, 170);
            lblLog.Size = new Size(490, 35);
            lblLog.ForeColor = Color.DimGray;

            Controls.Add(lblOrigem);
            Controls.Add(txtOrigem);
            Controls.Add(btnOrigem);
            Controls.Add(lblDestino);
            Controls.Add(txtDestino);
            Controls.Add(btnDestino);
            Controls.Add(btnMonitor);
            Controls.Add(lblStatus);
            Controls.Add(lblLog);

            FormClosing += MainForm_FormClosing;
        }

        private void BtnOrigem_Click(object sender, EventArgs e)
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.Description = "Selecione a pasta de origem";
                dlg.SelectedPath = txtOrigem.Text;
                if (dlg.ShowDialog(this) == DialogResult.OK)
                {
                    txtOrigem.Text = dlg.SelectedPath;
                }
            }
        }

        private void BtnDestino_Click(object sender, EventArgs e)
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.Description = "Selecione a pasta de destino";
                dlg.SelectedPath = txtDestino.Text;
                if (dlg.ShowDialog(this) == DialogResult.OK)
                {
                    txtDestino.Text = dlg.SelectedPath;
                }
            }
        }

        private void BtnMonitor_Click(object sender, EventArgs e)
        {
            if (monitorando)
            {
                PararMonitoramento();
            }
            else
            {
                IniciarMonitoramento();
            }
        }

        private void IniciarMonitoramento()
        {
            string origem = (txtOrigem.Text ?? "").Trim();
            string destino = (txtDestino.Text ?? "").Trim();

            if (origem.Length == 0 || destino.Length == 0)
            {
                MessageBox.Show(this, "Informe as pastas de origem e destino.", "File Mover XP",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            if (!Directory.Exists(origem))
            {
                MessageBox.Show(this, "A pasta de origem nao existe.", "File Mover XP",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            if (!Directory.Exists(destino))
            {
                try
                {
                    Directory.CreateDirectory(destino);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, "Nao foi possivel criar a pasta de destino:\n" + ex.Message,
                        "File Mover XP", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }
            }

            string origemFull = Path.GetFullPath(origem).TrimEnd('\\');
            string destinoFull = Path.GetFullPath(destino).TrimEnd('\\');
            if (string.Compare(origemFull, destinoFull, true) == 0)
            {
                MessageBox.Show(this, "Origem e destino nao podem ser a mesma pasta.", "File Mover XP",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            try
            {
                watcher = new FileSystemWatcher(origem);
                watcher.NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.CreationTime | NotifyFilters.Size;
                watcher.IncludeSubdirectories = false;
                watcher.Created += Watcher_Event;
                watcher.Changed += Watcher_Event;
                watcher.Renamed += Watcher_Renamed;
                watcher.EnableRaisingEvents = true;
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Nao foi possivel iniciar o monitoramento:\n" + ex.Message,
                    "File Mover XP", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            monitorando = true;
            txtOrigem.Enabled = false;
            txtDestino.Enabled = false;
            btnOrigem.Enabled = false;
            btnDestino.Enabled = false;

            btnMonitor.Text = "MONITORANDO";
            btnMonitor.BackColor = Color.FromArgb(80, 180, 80);
            btnMonitor.ForeColor = Color.White;
            lblStatus.Text = "Status: monitorando";
            lblStatus.ForeColor = Color.DarkGreen;

            SaveConfig();
            pollTimer.Start();
            MoverArquivosPendentes();
            SetLog("Monitoramento iniciado.");
        }

        private void PararMonitoramento()
        {
            pollTimer.Stop();

            if (watcher != null)
            {
                watcher.EnableRaisingEvents = false;
                watcher.Created -= Watcher_Event;
                watcher.Changed -= Watcher_Event;
                watcher.Renamed -= Watcher_Renamed;
                watcher.Dispose();
                watcher = null;
            }

            monitorando = false;
            txtOrigem.Enabled = true;
            txtDestino.Enabled = true;
            btnOrigem.Enabled = true;
            btnDestino.Enabled = true;

            btnMonitor.Text = "Iniciar monitoramento";
            btnMonitor.BackColor = Color.FromArgb(220, 220, 220);
            btnMonitor.ForeColor = SystemColors.ControlText;
            lblStatus.Text = "Status: parado";
            lblStatus.ForeColor = Color.DarkRed;
            SetLog("Monitoramento parado.");
        }

        private void Watcher_Event(object sender, FileSystemEventArgs e)
        {
            ThreadPool.QueueUserWorkItem(delegate { TentarMoverArquivo(e.FullPath); });
        }

        private void Watcher_Renamed(object sender, RenamedEventArgs e)
        {
            ThreadPool.QueueUserWorkItem(delegate { TentarMoverArquivo(e.FullPath); });
        }

        private void PollTimer_Tick(object sender, EventArgs e)
        {
            MoverArquivosPendentes();
        }

        private void MoverArquivosPendentes()
        {
            if (!monitorando) return;

            string origem = txtOrigem.Text.Trim();
            if (!Directory.Exists(origem)) return;

            string[] arquivos;
            try
            {
                arquivos = Directory.GetFiles(origem);
            }
            catch
            {
                return;
            }

            foreach (string arquivo in arquivos)
            {
                TentarMoverArquivo(arquivo);
            }
        }

        private void TentarMoverArquivo(string caminho)
        {
            if (string.IsNullOrEmpty(caminho)) return;
            if (!File.Exists(caminho)) return;

            // Aguarda o arquivo ficar liberado (ainda sendo copiado/escrito).
            if (!ArquivoLiberado(caminho, 10, 300))
            {
                return;
            }

            lock (sync)
            {
                if (!File.Exists(caminho)) return;

                string destinoPasta = txtDestino.Text.Trim();
                if (!Directory.Exists(destinoPasta))
                {
                    try { Directory.CreateDirectory(destinoPasta); }
                    catch { return; }
                }

                string nome = Path.GetFileName(caminho);
                string destino = Path.Combine(destinoPasta, nome);
                destino = NomeUnico(destino);

                try
                {
                    File.Move(caminho, destino);
                    BeginInvoke(new MethodInvoker(delegate
                    {
                        SetLog("Movido: " + nome);
                    }));
                }
                catch (Exception ex)
                {
                    BeginInvoke(new MethodInvoker(delegate
                    {
                        SetLog("Falha ao mover " + nome + ": " + ex.Message);
                    }));
                }
            }
        }

        private static bool ArquivoLiberado(string caminho, int tentativas, int esperaMs)
        {
            for (int i = 0; i < tentativas; i++)
            {
                try
                {
                    using (FileStream fs = File.Open(caminho, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                    {
                        return true;
                    }
                }
                catch (IOException)
                {
                    Thread.Sleep(esperaMs);
                }
                catch (UnauthorizedAccessException)
                {
                    Thread.Sleep(esperaMs);
                }
                catch
                {
                    return false;
                }
            }
            return false;
        }

        private static string NomeUnico(string caminho)
        {
            if (!File.Exists(caminho)) return caminho;

            string pasta = Path.GetDirectoryName(caminho);
            string nome = Path.GetFileNameWithoutExtension(caminho);
            string ext = Path.GetExtension(caminho);
            int i = 1;
            string candidato;
            do
            {
                candidato = Path.Combine(pasta, nome + "_" + i.ToString() + ext);
                i++;
            } while (File.Exists(candidato));
            return candidato;
        }

        private void SetLog(string texto)
        {
            lblLog.Text = DateTime.Now.ToString("HH:mm:ss") + " - " + texto;
        }

        private void SaveConfig()
        {
            try
            {
                using (StreamWriter sw = new StreamWriter(configPath, false))
                {
                    sw.WriteLine("origem=" + txtOrigem.Text.Trim());
                    sw.WriteLine("destino=" + txtDestino.Text.Trim());
                }
            }
            catch
            {
            }
        }

        private void LoadConfig()
        {
            if (!File.Exists(configPath)) return;
            try
            {
                string[] linhas = File.ReadAllLines(configPath);
                foreach (string linha in linhas)
                {
                    if (linha.StartsWith("origem="))
                        txtOrigem.Text = linha.Substring(7);
                    else if (linha.StartsWith("destino="))
                        txtDestino.Text = linha.Substring(8);
                }
            }
            catch
            {
            }
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (monitorando)
            {
                PararMonitoramento();
            }
            SaveConfig();
        }

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }
}
