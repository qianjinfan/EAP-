using System.Text.Json;
using EAP模拟器.Models;
using EAP模拟器.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Secs4Net;
using Secs4Net.Sml;

namespace EAP模拟器;

/// <summary>
/// 通过 WebView2 与页面 JSON 消息通信，桥接存储与 SECS 客户端。
/// </summary>
public sealed class WebAppBridge : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false,
    };

    private readonly WebView2 _web;
    private readonly CommandStorageService _storage = new();
    private readonly SecsClientService _secs = new();
    private CoreWebView2? _core;
    private bool _initialized;

    public WebAppBridge(WebView2 webView)
    {
        _web = webView;
    }

    public async Task InitializeAsync()
    {
        if (_initialized) return;

        await _web.EnsureCoreWebView2Async();
        _core = _web.CoreWebView2;
        _core.WebMessageReceived += OnWebMessageReceived;

        _secs.LogMessage += line => PostEvent("log", new { line });
        _secs.ConnectionStateChanged += state =>
        {
            var connected = state == ConnectionState.Selected;
            PostEvent("connection", new { connected, state = state.ToString() });
        };

        var webUi = Path.Combine(AppContext.BaseDirectory, "WebUi");
        if (!Directory.Exists(webUi))
            throw new DirectoryNotFoundException($"未找到 WebUi 目录: {webUi}");

        _core.SetVirtualHostNameToFolderMapping(
            "app.local",
            webUi,
            CoreWebView2HostResourceAccessKind.Allow);

        _initialized = true;
        _core.Navigate("https://app.local/index.html");
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        _ = HandleMessageAsync(e);
    }

    private async Task HandleMessageAsync(CoreWebView2WebMessageReceivedEventArgs e)
    {
        var id = 0;
        try
        {
            var json = e.WebMessageAsJson;
            // 若脚本误用 postMessage(JSON.stringify(obj))，根节点会是 JSON 字符串，需再解析一层
            using (var outer = JsonDocument.Parse(json))
            {
                var r = outer.RootElement;
                if (r.ValueKind == JsonValueKind.String)
                    json = r.GetString() ?? "{}";
            }

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.GetProperty("type").GetString() != "call")
                return;

            id = root.GetProperty("id").GetInt32();
            var method = root.GetProperty("method").GetString() ?? "";
            var prm = root.TryGetProperty("params", out var p) ? p : default;

            switch (method)
            {
                case "getCommands":
                    var cmds = _storage.Load();
                    PostReply(id, true, new { commands = cmds }, null);
                    break;

                case "setCommands":
                    {
                        if (!prm.TryGetProperty("commands", out var cmdArr))
                        {
                            PostReply(id, false, null, "缺少 commands");
                            break;
                        }
                        var list = cmdArr.Deserialize<List<SecsCommandTemplate>>(JsonOpts) ?? [];
                        _storage.Save(list);
                        PostReply(id, true, null, null);
                    }
                    break;

                case "connect":
                    {
                        var ip = prm.GetProperty("ip").GetString() ?? "";
                        if (!prm.TryGetProperty("port", out var portEl) || !portEl.TryGetInt32(out var port))
                        {
                            PostReply(id, false, null, "无效端口");
                            break;
                        }
                        if (!prm.TryGetProperty("deviceId", out var devEl) || !devEl.TryGetInt32(out var devInt) || devInt < 0 || devInt > ushort.MaxValue)
                        {
                            PostReply(id, false, null, "无效 DeviceID");
                            break;
                        }
                        var active = prm.TryGetProperty("active", out var a) && a.GetBoolean();
                        try
                        {
                            await _secs.ConnectAsync(ip, port, (ushort)devInt, active).ConfigureAwait(true);
                            PostReply(id, true, new { }, null);
                        }
                        catch (Exception ex)
                        {
                            PostReply(id, false, null, ex.Message);
                        }
                    }
                    break;

                case "disconnect":
                    await _secs.DisconnectAsync().ConfigureAwait(true);
                    PostReply(id, true, new { }, null);
                    break;

                case "send":
                    {
                        if (!_secs.IsConnected)
                        {
                            PostReply(id, false, null, "未连接");
                            break;
                        }
                        if (!prm.TryGetProperty("stream", out var sEl) || !sEl.TryGetInt32(out var si) || si is < 0 or > 127 ||
                            !prm.TryGetProperty("function", out var fEl) || !fEl.TryGetInt32(out var fi) || fi is < 0 or > 255)
                        {
                            PostReply(id, false, null, "无效 Stream/Function");
                            break;
                        }
                        var s = (byte)si;
                        var f = (byte)fi;
                        var wait = !prm.TryGetProperty("waitReply", out var w) || w.GetBoolean();
                        var smlBody = prm.TryGetProperty("smlBody", out var sb) ? (sb.GetString() ?? "") : "";

                        try
                        {
                            SecsMessage msg;
                            if (string.IsNullOrWhiteSpace(smlBody))
                                msg = new SecsMessage(s, f, replyExpected: wait);
                            else
                            {
                                var sml = $"S{s}F{f} {(wait ? "W" : "")}\n{smlBody.Trim()}.";
                                msg = SmlReader.ToSecsMessage(sml);
                            }

                            await _secs.SendAsync(msg).ConfigureAwait(true);
                            PostReply(id, true, new { }, null);
                        }
                        catch (Exception ex)
                        {
                            PostReply(id, false, null, ex.Message);
                        }
                    }
                    break;

                default:
                    PostReply(id, false, null, $"未知方法: {method}");
                    break;
            }
        }
        catch (Exception ex)
        {
            PostReply(id, false, null, ex.Message);
        }
    }

    private void PostReply(int id, bool ok, object? result, string? error)
    {
        string json;
        if (ok && result is not null)
            json = JsonSerializer.Serialize(new { type = "reply", id, ok = true, result }, JsonOpts);
        else if (ok)
            json = JsonSerializer.Serialize(new { type = "reply", id, ok = true }, JsonOpts);
        else
            json = JsonSerializer.Serialize(new { type = "reply", id, ok = false, error }, JsonOpts);

        PostJsonString(json);
    }

    private void PostEvent(string name, object payload)
    {
        var json = JsonSerializer.Serialize(new { type = "event", name, payload }, JsonOpts);
        PostJsonString(json);
    }

    private void PostJsonString(string json)
    {
        void Post()
        {
            if (_core is null) return;
            try
            {
                _core.PostWebMessageAsJson(json);
            }
            catch
            {
                /* 窗体关闭过程中可能失败 */
            }
        }

        if (_web.InvokeRequired)
            _web.BeginInvoke(Post);
        else
            Post();
    }

    public async ValueTask DisposeAsync()
    {
        if (_core is not null)
            _core.WebMessageReceived -= OnWebMessageReceived;
        await _secs.DisposeAsync();
    }
}
