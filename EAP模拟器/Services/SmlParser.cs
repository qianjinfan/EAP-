using Secs4Net;

namespace EAP模拟器.Services;

/// <summary>
/// 自定义 SML 解析器，将 SML 文本解析为 Secs4Net 的 Item 对象。
/// 支持格式: &lt;L [n] ...&gt;, &lt;A [n] 'text'&gt;, &lt;U4 [n] val&gt; 等标准 SECS-II SML。
/// </summary>
public static class SmlParser
{
    /// <summary>
    /// 将 SML 文本解析为 SecsMessage。
    /// 文本格式示例：
    /// <code>
    /// &lt;L [2]
    ///   &lt;A 'PP_SELECT_HANDLER'&gt;
    ///   &lt;L [1]
    ///     &lt;L [2]
    ///       &lt;A 'Recipe'&gt;
    ///       &lt;A 'SIC - PCB-new'&gt;
    ///     &gt;
    ///   &gt;
    /// &gt;
    /// </code>
    /// </summary>
    public static SecsMessage Parse(byte stream, byte function, bool replyExpected, string smlBody)
    {
        var body = smlBody.Trim();
        if (string.IsNullOrEmpty(body))
        {
            return new SecsMessage(stream, function, replyExpected: replyExpected);
        }

        var pos = 0;
        var item = ParseItem(body, ref pos);
        return new SecsMessage(stream, function, replyExpected: replyExpected)
        {
            SecsItem = item
        };
    }

    private static Item ParseItem(string text, ref int pos)
    {
        SkipWhitespace(text, ref pos);

        if (pos >= text.Length || text[pos] != '<')
            throw new FormatException($"位置 {pos}: 期望 '<'，但遇到 '{(pos < text.Length ? text[pos] : "EOF")}'");

        pos++; // skip '<'
        SkipWhitespace(text, ref pos);

        // Read type token (L, A, U1, U2, U4, U8, I1, I2, I4, I8, F4, F8, B, Boolean)
        var typeStr = ReadToken(text, ref pos);

        SkipWhitespace(text, ref pos);

        // Skip optional [n] length annotation
        if (pos < text.Length && text[pos] == '[')
        {
            while (pos < text.Length && text[pos] != ']') pos++;
            if (pos < text.Length) pos++; // skip ']'
            SkipWhitespace(text, ref pos);
        }

        return typeStr.ToUpperInvariant() switch
        {
            "L" => ParseList(text, ref pos),
            "A" => ParseAscii(text, ref pos),
            "B" => ParseBinary(text, ref pos),
            "BOOLEAN" => ParseBoolean(text, ref pos),
            "U1" => ParseNumeric<byte>(text, ref pos, byte.Parse, Item.U1),
            "U2" => ParseNumeric<ushort>(text, ref pos, ushort.Parse, Item.U2),
            "U4" => ParseNumeric<uint>(text, ref pos, uint.Parse, Item.U4),
            "U8" => ParseNumeric<ulong>(text, ref pos, ulong.Parse, Item.U8),
            "I1" => ParseNumeric<sbyte>(text, ref pos, sbyte.Parse, Item.I1),
            "I2" => ParseNumeric<short>(text, ref pos, short.Parse, Item.I2),
            "I4" => ParseNumeric<int>(text, ref pos, int.Parse, Item.I4),
            "I8" => ParseNumeric<long>(text, ref pos, long.Parse, Item.I8),
            "F4" => ParseNumeric<float>(text, ref pos, float.Parse, Item.F4),
            "F8" => ParseNumeric<double>(text, ref pos, double.Parse, Item.F8),
            _ => throw new FormatException($"未知的 SECS-II 类型: '{typeStr}'")
        };
    }

    private static Item ParseList(string text, ref int pos)
    {
        var items = new List<Item>();
        SkipWhitespace(text, ref pos);

        while (pos < text.Length)
        {
            SkipWhitespace(text, ref pos);
            if (pos >= text.Length) break;

            if (text[pos] == '>')
            {
                pos++; // skip '>'
                return Item.L(items.ToArray());
            }

            if (text[pos] == '<')
            {
                items.Add(ParseItem(text, ref pos));
            }
            else
            {
                pos++;
            }
        }

        return Item.L(items.ToArray());
    }

    private static Item ParseAscii(string text, ref int pos)
    {
        SkipWhitespace(text, ref pos);

        if (pos < text.Length && text[pos] == '>')
        {
            pos++; // empty ASCII: <A>
            return Item.A(string.Empty);
        }

        string value;
        if (pos < text.Length && (text[pos] == '\'' || text[pos] == '"'))
        {
            var quote = text[pos];
            pos++; // skip opening quote
            var start = pos;
            while (pos < text.Length && text[pos] != quote) pos++;
            value = text[start..pos];
            if (pos < text.Length) pos++; // skip closing quote
        }
        else
        {
            // Unquoted value until '>'
            var start = pos;
            while (pos < text.Length && text[pos] != '>') pos++;
            value = text[start..pos].Trim();
        }

        SkipWhitespace(text, ref pos);
        if (pos < text.Length && text[pos] == '>') pos++; // skip '>'

        return Item.A(value);
    }

    private static Item ParseBinary(string text, ref int pos)
    {
        var values = new List<byte>();
        SkipWhitespace(text, ref pos);

        while (pos < text.Length && text[pos] != '>')
        {
            SkipWhitespace(text, ref pos);
            if (pos >= text.Length || text[pos] == '>') break;

            var token = ReadToken(text, ref pos);
            if (string.IsNullOrEmpty(token)) continue;

            if (token.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
                values.Add(Convert.ToByte(token, 16));
            else
                values.Add(byte.Parse(token));
        }

        if (pos < text.Length && text[pos] == '>') pos++;
        return Item.B(values.ToArray());
    }

    private static Item ParseBoolean(string text, ref int pos)
    {
        var values = new List<bool>();
        SkipWhitespace(text, ref pos);

        while (pos < text.Length && text[pos] != '>')
        {
            SkipWhitespace(text, ref pos);
            if (pos >= text.Length || text[pos] == '>') break;

            var token = ReadToken(text, ref pos);
            if (string.IsNullOrEmpty(token)) continue;
            values.Add(bool.Parse(token));
        }

        if (pos < text.Length && text[pos] == '>') pos++;
        return Item.Boolean(values.ToArray());
    }

    private static Item ParseNumeric<T>(string text, ref int pos, Func<string, T> parse, Func<T[], Item> factory)
    {
        var values = new List<T>();
        SkipWhitespace(text, ref pos);

        while (pos < text.Length && text[pos] != '>')
        {
            SkipWhitespace(text, ref pos);
            if (pos >= text.Length || text[pos] == '>') break;

            var token = ReadToken(text, ref pos);
            if (string.IsNullOrEmpty(token)) continue;
            values.Add(parse(token));
        }

        if (pos < text.Length && text[pos] == '>') pos++;
        return factory(values.ToArray());
    }

    private static string ReadToken(string text, ref int pos)
    {
        SkipWhitespace(text, ref pos);
        var start = pos;
        while (pos < text.Length && !char.IsWhiteSpace(text[pos]) && text[pos] != '>' && text[pos] != '<' && text[pos] != '[')
        {
            pos++;
        }
        return text[start..pos];
    }

    private static void SkipWhitespace(string text, ref int pos)
    {
        while (pos < text.Length && char.IsWhiteSpace(text[pos])) pos++;
    }

    /// <summary>
    /// 将 SecsMessage 格式化为可读的 SML 文本。
    /// </summary>
    public static string Format(SecsMessage msg)
    {
        var header = $"S{msg.S}F{msg.F}{(msg.ReplyExpected ? " W" : "")}";
        if (msg.SecsItem is null)
            return header;
        return $"{header}\n{FormatItem(msg.SecsItem, 0)}";
    }

    /// <summary>
    /// 将 Item 格式化为缩进的 SML 文本。
    /// </summary>
    public static string FormatItem(Item item, int indent = 0)
    {
        var prefix = new string(' ', indent * 2);
        return item.Format switch
        {
            SecsFormat.List => FormatList(item, indent, prefix),
            SecsFormat.ASCII => $"{prefix}<A '{item.GetString()}'>",
            SecsFormat.Binary => $"{prefix}<B {FormatMemory(item.GetMemory<byte>(), "0x", "X2")}>",
            SecsFormat.Boolean => $"{prefix}<Boolean {FormatMemory(item.GetMemory<bool>())}>",
            SecsFormat.U1 => $"{prefix}<U1 {FormatMemory(item.GetMemory<byte>())}>",
            SecsFormat.U2 => $"{prefix}<U2 {FormatMemory(item.GetMemory<ushort>())}>",
            SecsFormat.U4 => $"{prefix}<U4 {FormatMemory(item.GetMemory<uint>())}>",
            SecsFormat.U8 => $"{prefix}<U8 {FormatMemory(item.GetMemory<ulong>())}>",
            SecsFormat.I1 => $"{prefix}<I1 {FormatMemory(item.GetMemory<sbyte>())}>",
            SecsFormat.I2 => $"{prefix}<I2 {FormatMemory(item.GetMemory<short>())}>",
            SecsFormat.I4 => $"{prefix}<I4 {FormatMemory(item.GetMemory<int>())}>",
            SecsFormat.I8 => $"{prefix}<I8 {FormatMemory(item.GetMemory<long>())}>",
            SecsFormat.F4 => $"{prefix}<F4 {FormatMemory(item.GetMemory<float>())}>",
            SecsFormat.F8 => $"{prefix}<F8 {FormatMemory(item.GetMemory<double>())}>",
            _ => $"{prefix}<{item.Format} ?>"
        };
    }

    private static string FormatList(Item item, int indent, string prefix)
    {
        var items = item.Items;
        if (items.Length == 0)
            return $"{prefix}<L>";

        var lines = new List<string> { $"{prefix}<L [{items.Length}]" };
        foreach (var child in items)
        {
            lines.Add(FormatItem(child, indent + 1));
        }
        lines.Add($"{prefix}>");
        return string.Join(Environment.NewLine, lines);
    }

    private static string FormatMemory<T>(Memory<T> values, string prefix = "", string format = "") where T : struct, IFormattable
    {
        var span = values.Span;
        var parts = new string[span.Length];
        for (var i = 0; i < span.Length; i++)
            parts[i] = string.IsNullOrEmpty(format) ? span[i].ToString()! : $"{prefix}{span[i].ToString(format, null)}";
        return string.Join(" ", parts);
    }

    private static string FormatMemory(Memory<bool> values)
    {
        var span = values.Span;
        var parts = new string[span.Length];
        for (var i = 0; i < span.Length; i++)
            parts[i] = span[i].ToString();
        return string.Join(" ", parts);
    }
}
