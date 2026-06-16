using System.Text.Json;
using EAP模拟器.Models;
using EAP模拟器.Services;
using ClosedXML.Excel;
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
    private readonly ProjectStorageService _projects = new();
    private readonly SecsClientService _secs = new();
    private readonly LogFileService _logFile = new();
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

        _secs.LogMessage += line =>
        {
            _logFile.Write(line);
            PostEvent("log", new { line });
        };
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
                case "getLogDir":
                    PostReply(id, true, new { dir = _logFile.LogDirectory }, null);
                    break;

                case "openLogDir":
                    try
                    {
                        var dir = _logFile.LogDirectory;
                        Directory.CreateDirectory(dir);
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                        {
                            FileName = dir,
                            UseShellExecute = true,
                        });
                        PostReply(id, true, new { }, null);
                    }
                    catch (Exception ex)
                    {
                        PostReply(id, false, null, ex.Message);
                    }
                    break;

                case "getWorkspace":
                    {
                        var ws = _projects.Load();
                        PostReply(id, true, new { workspace = ws }, null);
                    }
                    break;

                case "setWorkspace":
                    {
                        if (!prm.TryGetProperty("workspace", out var wsEl))
                        {
                            PostReply(id, false, null, "缺少 workspace");
                            break;
                        }
                        var ws = wsEl.Deserialize<SimulatorWorkspace>(JsonOpts);
                        if (ws is null || ws.Projects.Count == 0)
                        {
                            PostReply(id, false, null, "无效工作区");
                            break;
                        }
                        if (ws.Projects.All(p => p.Id != ws.CurrentProjectId))
                            ws.CurrentProjectId = ws.Projects[0].Id;
                        _projects.Save(ws);
                        PostReply(id, true, null, null);
                    }
                    break;

                case "importExcel":
                    {
                        if (!prm.TryGetProperty("projectId", out var pidEl) || !Guid.TryParse(pidEl.GetString(), out var pid))
                        {
                            PostReply(id, false, null, "缺少或无效 projectId");
                            break;
                        }
                        var fileName = prm.TryGetProperty("fileName", out var fnEl) ? (fnEl.GetString() ?? "") : "";
                        if (!prm.TryGetProperty("contentBase64", out var b64El))
                        {
                            PostReply(id, false, null, "缺少 contentBase64");
                            break;
                        }
                        var base64 = b64El.GetString() ?? "";
                        byte[] bytes;
                        try
                        {
                            bytes = Convert.FromBase64String(base64);
                        }
                        catch
                        {
                            PostReply(id, false, null, "Excel 内容不是有效的 Base64");
                            break;
                        }

                        try
                        {
                            var ws = _projects.Load();
                            var proj = ws.Projects.FirstOrDefault(p => p.Id == pid);
                            if (proj is null)
                            {
                                PostReply(id, false, null, "未找到项目");
                                break;
                            }

                            proj.ExcelSheet = ParseFirstSheet(bytes, fileName);
                            _projects.Save(ws);
                            PostReply(id, true, new { workspace = ws }, null);
                        }
                        catch (Exception ex)
                        {
                            PostReply(id, false, null, ex.Message);
                        }
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
                                // Secs4Net.Sml.SmlReader 要求首行为 'SxFy' [W]（带单引号）；原先拼成 SxFy 会导致解析越界异常。
                                var body = smlBody.Trim();
                                while (body.EndsWith('.'))
                                    body = body[..^1].TrimEnd();
                                var header = wait ? $"'S{s}F{f}' W" : $"'S{s}F{f}'";
                                var sml = string.IsNullOrEmpty(body)
                                    ? $"{header}\n."
                                    : $"{header}\n{body}\n.";
                                msg = SmlReader.ToSecsMessage(sml);
                            }

                            var reply = await _secs.SendAsync(msg).ConfigureAwait(true);
                            PostReply(id, true, new
                            {
                                reply = reply is null
                                    ? null
                                    : new { stream = (int)reply.S, function = (int)reply.F },
                            }, null);
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

    private static ExcelSequenceSheet ParseFirstSheet(byte[] bytes, string fileName)
    {
        using var ms = new MemoryStream(bytes);
        using var wb = new XLWorkbook(ms);
        var ws = wb.Worksheets.First();

        var sheet = new ExcelSequenceSheet
        {
            FileName = string.IsNullOrWhiteSpace(fileName) ? ws.Name : fileName.Trim(),
            ImportedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
        };

        var range = ws.RangeUsed();
        if (range is null) return sheet;

        // 根据你的约定：
        // - B 列：>>> 行表示发送内容（每行一条）
        // - E 列：<<< 行表示期望接收内容
        // 这里保留 A/B/D/E/F/G 以及方向箭头，方便后续生成流程。
        var firstRow = range.FirstRow().RowNumber();
        var lastRow = range.LastRow().RowNumber();

        for (var r = firstRow; r <= lastRow; r++)
        {
            var dir = (ws.Cell(r, 3).GetString() ?? "").Trim(); // C 列
            var a = (ws.Cell(r, 1).GetString() ?? "").Trim();
            var b = (ws.Cell(r, 2).GetString() ?? "").Trim();
            var d = (ws.Cell(r, 4).GetString() ?? "").Trim();
            var e = (ws.Cell(r, 5).GetString() ?? "").Trim();
            var f = (ws.Cell(r, 6).GetString() ?? "").Trim();
            var g = (ws.Cell(r, 7).GetString() ?? "").Trim();

            // 跳过完全空行
            if (string.IsNullOrWhiteSpace(a) &&
                string.IsNullOrWhiteSpace(dir) &&
                string.IsNullOrWhiteSpace(b) &&
                string.IsNullOrWhiteSpace(d) &&
                string.IsNullOrWhiteSpace(e) &&
                string.IsNullOrWhiteSpace(f) &&
                string.IsNullOrWhiteSpace(g))
                continue;

            // 只保留 >>> / <<<；其他内容（标题/分隔）方向留空但也可展示
            if (dir != ">>>" && dir != "<<<") dir = string.Empty;

            sheet.Rows.Add(new ExcelSequenceRow
            {
                ExcelRow = r,
                A = a,
                Direction = dir,
                B = b,
                D = d,
                E = e,
                F = f,
                G = g,
            });
        }

        return sheet;
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
        _logFile.Dispose();
    }
}
