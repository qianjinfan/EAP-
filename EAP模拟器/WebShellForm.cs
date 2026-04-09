using Microsoft.Web.WebView2.WinForms;

namespace EAP模拟器;

/// <summary>
/// 仅承载 WebView2，界面由 WebUi 内网页提供。
/// </summary>
public sealed class WebShellForm : Form
{
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };
    private WebAppBridge? _bridge;

    public WebShellForm()
    {
        Text = "EAP 模拟器 · SECS/GEM";
        ClientSize = new Size(1280, 800);
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(960, 600);
        Controls.Add(_webView);

        Load += OnLoadAsync;
        FormClosing += OnFormClosingAsync;
    }

    private async void OnLoadAsync(object? sender, EventArgs e)
    {
        try
        {
            _bridge = new WebAppBridge(_webView);
            await _bridge.InitializeAsync();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this,
                $"无法加载网页界面。请确认已安装 [Microsoft Edge WebView2 运行时]。\r\n\r\n{ex.Message}",
                "WebView2",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private async void OnFormClosingAsync(object? sender, FormClosingEventArgs e)
    {
        if (_bridge is not null)
            await _bridge.DisposeAsync();
    }
}
