namespace EAP模拟器.Models;

public sealed class ExcelSequenceSheet
{
    public string FileName { get; set; } = string.Empty;

    /// <summary>导入时间（本地时间 ISO 字符串），仅用于展示。</summary>
    public string ImportedAt { get; set; } = string.Empty;

    public List<ExcelSequenceRow> Rows { get; set; } = [];
}

public sealed class ExcelSequenceRow
{
    /// <summary>Excel 行号（从 1 开始），便于对照原表。</summary>
    public int ExcelRow { get; set; }

    public string A { get; set; } = string.Empty;

    /// <summary>方向：&gt;&gt;&gt;（发送）或 &lt;&lt;&lt;（接收期望）。</summary>
    public string Direction { get; set; } = string.Empty;

    public string B { get; set; } = string.Empty;
    public string D { get; set; } = string.Empty;
    public string E { get; set; } = string.Empty;
    public string F { get; set; } = string.Empty;
    public string G { get; set; } = string.Empty;
}

