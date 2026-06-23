using Secs4Net;

namespace EAP模拟器.Services;

/// <summary>
/// 描述一条自动应答规则，用于在 UI 上展示当前支持的「收到命令 -&gt; 自动回复」处理。
/// </summary>
public sealed record AutoReplyRule(
    string Name,
    byte PrimaryStream,
    byte PrimaryFunction,
    byte ReplyStream,
    byte ReplyFunction,
    string Description);

/// <summary>
/// 根据收到的 Primary 消息生成对应的 Secondary 回复。
/// 内置常用 SECS/GEM 处理（如 S2F17 时间请求 -&gt; S2F18 时间应答）。
/// </summary>
public sealed class CommandResponder
{
    /// <summary>
    /// 当前内置支持的自动应答规则，供 UI 展示。
    /// </summary>
    public static IReadOnlyList<AutoReplyRule> Rules { get; } =
    [
        new("时间请求", 2, 17, 2, 18, "收到 S2F17 (Date/Time Request) 后，回复 S2F18 并附带本机当前时间 (TIME, 16 位 ASCII)"),
        new("建立通信", 1, 13, 1, 14, "收到 S1F13 后，回复 S1F14 (COMMACK=0 接受) 与本机软硬件版本"),
        new("在线请求", 1, 17, 1, 18, "收到 S1F17 (Request ON-LINE) 后，回复 S1F18 (ONLACK=0 同意上线)"),
    ];

    /// <summary>
    /// 为收到的 Primary 消息生成回复消息。
    /// 对已知命令返回带数据的回复，未知命令返回空的 SxF(y+1) 头消息。
    /// </summary>
    /// <param name="primary">收到的需要回复的 Primary 消息。</param>
    /// <returns>要发送回去的 Secondary 消息，以及一段用于日志展示的说明。</returns>
    public (SecsMessage reply, string note) CreateReply(SecsMessage primary)
    {
        return (primary.S, primary.F) switch
        {
            // S2F17 Date and Time Request -> S2F18 Date and Time Data
            (2, 17) => (BuildDateTimeData(), "时间请求 S2F17 -> S2F18 (本机时间)"),

            // S1F13 Establish Communication Request -> S1F14
            (1, 13) => (BuildEstablishCommReply(), "建立通信 S1F13 -> S1F14 (COMMACK=0)"),

            // S1F17 Request ON-LINE -> S1F18 (ONLACK = 0 接受)
            (1, 17) => (
                new SecsMessage(1, 18, replyExpected: false) { SecsItem = Item.B(0) },
                "在线请求 S1F17 -> S1F18 (ONLACK=0)"),

            // 默认：返回空的 SxF(y+1) 头消息
            _ => (
                new SecsMessage(primary.S, (byte)(primary.F + 1), replyExpected: false),
                $"默认空回复 S{primary.S}F{primary.F + 1}"),
        };
    }

    /// <summary>
    /// 构造 S2F18 (Date and Time Data, DTD)，TIME 为本机当前时间的 16 位 ASCII：yyyyMMddHHmmsscc。
    /// 其中末两位 cc 为百分之一秒 (centiseconds)。
    /// </summary>
    private static SecsMessage BuildDateTimeData()
    {
        var now = DateTime.Now;
        // 16 位格式：YYYYMMDDhhmmsscc（cc = 1/100 秒）
        var time16 = now.ToString("yyyyMMddHHmmss") + (now.Millisecond / 10).ToString("D2");
        return new SecsMessage(2, 18, replyExpected: false)
        {
            SecsItem = Item.A(time16),
        };
    }

    /// <summary>
    /// 构造 S1F14 (Establish Communication Acknowledge)：COMMACK=0 表示接受，
    /// 第二项为设备型号与软件版本（MDLN / SOFTREV）。
    /// </summary>
    private static SecsMessage BuildEstablishCommReply()
    {
        return new SecsMessage(1, 14, replyExpected: false)
        {
            SecsItem = Item.L(
                Item.B(0), // COMMACK = 0 接受
                Item.L(
                    Item.A("EAPSIM"),   // MDLN 设备型号
                    Item.A("1.0.0"))),  // SOFTREV 软件版本
        };
    }
}
