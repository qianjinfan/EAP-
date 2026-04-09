using Microsoft.Extensions.Options;
using Secs4Net;

namespace EAP模拟器.Services;

/// <summary>
/// 实现 ISecsGemLogger，将日志转发到事件。
/// </summary>
internal sealed class SecsLogger(Action<string> log) : ISecsGemLogger
{
    public void MessageIn(SecsMessage msg, int id) => log($"<< [0x{id:X8}] {msg}");
    public void MessageOut(SecsMessage msg, int id) => log($">> [0x{id:X8}] {msg}");
    public void Debug(string msg) => log($"[DEBUG] {msg}");
    public void Info(string msg) => log($"[INFO] {msg}");
    public void Warning(string msg) => log($"[WARN] {msg}");
    public void Error(string msg) => log($"[ERROR] {msg}");
    public void Error(string msg, Exception? ex) => log($"[ERROR] {msg} {ex?.Message}");
    public void Error(string msg, SecsMessage? secsMsg, Exception? ex) => log($"[ERROR] {msg} {secsMsg} {ex?.Message}");
}

/// <summary>
/// 封装 Secs4Net 的 HSMS 连接管理和消息收发。
/// </summary>
public sealed class SecsClientService : IAsyncDisposable
{
    private HsmsConnection? _connection;
    private SecsGem? _secsGem;
    private CancellationTokenSource? _cts;

    /// <summary>是否已连接</summary>
    public bool IsConnected => _connection?.State == ConnectionState.Selected;

    /// <summary>收到日志消息时触发</summary>
    public event Action<string>? LogMessage;

    /// <summary>收到设备主动上报的 Primary 消息时触发</summary>
    public event Action<SecsMessage>? PrimaryMessageReceived;

    /// <summary>连接状态变化时触发</summary>
    public event Action<ConnectionState>? ConnectionStateChanged;

    public async Task ConnectAsync(string ip, int port, ushort deviceId, bool isActive)
    {
        await DisconnectAsync();

        _cts = new CancellationTokenSource();

        var options = Options.Create(new SecsGemOptions
        {
            IpAddress = ip,
            Port = port,
            DeviceId = deviceId,
            IsActive = isActive,
            SocketReceiveBufferSize = 32768,
        });

        var logger = new SecsLogger(msg => Log(msg));

        _connection = new HsmsConnection(options, logger);
        _connection.ConnectionChanged += (sender, state) =>
        {
            Log($"连接状态: {state}");
            ConnectionStateChanged?.Invoke(state);
        };

        _secsGem = new SecsGem(options, _connection, logger);

        // 在后台开始监听设备主动上报的消息
        _ = Task.Run(async () =>
        {
            try
            {
                await foreach (var e in _secsGem.GetPrimaryMessageAsync(_cts.Token))
                {
                    try
                    {
                        Log($"<< S{e.PrimaryMessage.S}F{e.PrimaryMessage.F} {(e.PrimaryMessage.ReplyExpected ? "W" : "")}\n{FormatMessage(e.PrimaryMessage)}");
                        PrimaryMessageReceived?.Invoke(e.PrimaryMessage);

                        // 自动回复：对需要回复的消息返回空回复
                        if (e.PrimaryMessage.ReplyExpected)
                        {
                            var reply = new SecsMessage(e.PrimaryMessage.S, (byte)(e.PrimaryMessage.F + 1));
                            await e.TryReplyAsync(reply);
                            Log($">> S{reply.S}F{reply.F} (自动回复)");
                        }
                    }
                    catch (Exception ex)
                    {
                        Log($"处理消息异常: {ex.Message}");
                    }
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception ex)
            {
                Log($"消息监听异常: {ex.Message}");
            }
        });

        Log($"正在连接 {ip}:{port} (DeviceId={deviceId}, Mode={(isActive ? "Active" : "Passive")})...");
    }

    public async Task<SecsMessage?> SendAsync(SecsMessage message)
    {
        if (_secsGem is null || !IsConnected)
        {
            Log("未连接，无法发送");
            return null;
        }

        try
        {
            Log($">> S{message.S}F{message.F} {(message.ReplyExpected ? "W" : "")}\n{FormatMessage(message)}");
            var reply = await _secsGem.SendAsync(message);
            if (reply is not null)
            {
                Log($"<< S{reply.S}F{reply.F}\n{FormatMessage(reply)}");
            }
            return reply;
        }
        catch (Exception ex)
        {
            Log($"发送失败: {ex.Message}");
            return null;
        }
    }

    public async Task DisconnectAsync()
    {
        _cts?.Cancel();
        if (_connection is not null)
        {
            await _connection.DisposeAsync();
            _connection = null;
        }
        _secsGem?.Dispose();
        _secsGem = null;
        _cts?.Dispose();
        _cts = null;
        Log("已断开连接");
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
    }

    private void Log(string msg)
    {
        var text = $"[{DateTime.Now:HH:mm:ss.fff}] {msg}";
        LogMessage?.Invoke(text);
    }

    private static string FormatMessage(SecsMessage msg)
    {
        if (msg.SecsItem is null)
            return "  (Header Only)";
        try
        {
            return "  " + SmlParser.FormatItem(msg.SecsItem, 1);
        }
        catch
        {
            return "  (无法格式化)";
        }
    }
}
