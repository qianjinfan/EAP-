namespace EAP模拟器.Models;

/// <summary>
/// SECS 命令模板，用于保存和加载用户自定义的 SECS 命令。
/// </summary>
public sealed class SecsCommandTemplate
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>显示名称，如 "Establish Communication"</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Stream 编号 (1-127)</summary>
    public byte Stream { get; set; }

    /// <summary>Function 编号 (0-255)</summary>
    public byte Function { get; set; }

    /// <summary>是否等待回复 (W-bit)</summary>
    public bool WaitReply { get; set; } = true;

    /// <summary>SECS-II 消息体的 SML 文本，为空表示 Header Only</summary>
    public string SmlBody { get; set; } = string.Empty;

    /// <summary>用于列表显示</summary>
    public string DisplayName => $"S{Stream}F{Function}{(WaitReply ? " W" : "")} - {Name}";
}
