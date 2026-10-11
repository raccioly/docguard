using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Billing.Invoicing;

public enum LineKind
{
    Product,
    Service,
    Shipping,
    Discount,
}

[Flags]
public enum InvoiceFlags : byte
{
    None = 0,
    Draft = 1 << 0,
    TaxExempt = 1 << 1,
    Recurring = 1 << 2,
}

public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money Zero(string currency) => new(0m, currency);

    public static Money operator +(Money left, Money right)
    {
        EnsureSameCurrency(left, right);
        return left with { Amount = left.Amount + right.Amount };
    }

    public static Money operator -(Money left, Money right)
    {
        EnsureSameCurrency(left, right);
        return left with { Amount = left.Amount - right.Amount };
    }

    public static Money operator -(Money money) => money with { Amount = -money.Amount };

    public static Money operator *(Money money, decimal factor) =>
        money with { Amount = decimal.Round(money.Amount * factor, 2, MidpointRounding.ToEven) };

    public static explicit operator decimal(Money money) => money.Amount;

    public override string ToString() =>
        $"{Amount.ToString("0.00", CultureInfo.InvariantCulture)} {Currency}";

    private static void EnsureSameCurrency(Money a, Money b)
    {
        if (!string.Equals(a.Currency, b.Currency, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Currency mismatch: {a.Currency} vs {b.Currency}");
        }
    }
}

public sealed record InvoiceLine(string Sku, LineKind Kind, int Quantity, Money UnitPrice)
{
    public Money Total => UnitPrice * Quantity;
}

public abstract record TaxRule(string Region);

public sealed record FlatTax(string Region, decimal Rate) : TaxRule(Region);

public sealed record TieredTax(string Region, IReadOnlyList<(decimal Threshold, decimal Rate)> Tiers)
    : TaxRule(Region);

public sealed record ExemptTax(string Region, string Certificate) : TaxRule(Region);

public readonly record struct InvoiceSummary(Money Net, Money Tax, Money Gross, InvoiceFlags Flags)
{
    public bool IsCredit => Gross.Amount < 0;
}

public sealed class InvoiceCalculator
{
    private readonly IReadOnlyDictionary<string, TaxRule> _rules;
    private readonly string _currency;

    public InvoiceCalculator(IEnumerable<TaxRule> rules, string currency = "USD")
    {
        _rules = rules.ToDictionary(r => r.Region, StringComparer.OrdinalIgnoreCase);
        _currency = currency;
    }

    public InvoiceFlags Flags { get; set; } = InvoiceFlags.None;

    public decimal RateFor(string region, Money taxableBase) =>
        _rules.TryGetValue(region, out var rule)
            ? rule switch
            {
                _ when Flags.HasFlag(InvoiceFlags.TaxExempt) => 0m,
                FlatTax { Rate: var rate } => rate,
                TieredTax { Tiers: [] } => 0m,
                TieredTax { Tiers: [var only] } => only.Rate,
                TieredTax tiered => tiered.Tiers
                    .Where(t => taxableBase.Amount >= t.Threshold)
                    .Select(t => t.Rate)
                    .DefaultIfEmpty(tiered.Tiers[0].Rate)
                    .Max(),
                ExemptTax { Certificate.Length: > 0 } => 0m,
                ExemptTax => throw new InvalidOperationException($"Exemption for '{region}' has no certificate."),
                _ => throw new NotSupportedException(rule.GetType().Name),
            }
            : throw new KeyNotFoundException($"No tax rule for region \"{region}\".");

    public InvoiceSummary Summarize(IReadOnlyCollection<InvoiceLine> lines, string region)
    {
        ArgumentNullException.ThrowIfNull(lines);

        var byKind =
            from line in lines
            where line.Quantity != 0
            group line by line.Kind into g
            let subtotal = g.Aggregate(Money.Zero(_currency), (acc, l) => acc + l.Total)
            orderby subtotal.Amount descending
            select new { Kind = g.Key, Subtotal = subtotal, Count = g.Count() };

        var taxable = Money.Zero(_currency);
        var discounts = Money.Zero(_currency);
        foreach (var bucket in byKind)
        {
            if (bucket.Kind == LineKind.Discount)
            {
                discounts += bucket.Subtotal;
                continue;
            }

            taxable += bucket.Subtotal;
        }

        var net = taxable - Abs(discounts);
        var tax = net * RateFor(region, net);
        return new InvoiceSummary(net, tax, net + tax, Flags);

        static Money Abs(Money m) => m.Amount < 0 ? -m : m;
    }

    public static string RenderJson(InvoiceSummary summary, string invoiceId) =>
        $"{{ \"id\": \"{invoiceId}\", \"gross\": {((decimal)summary.Gross).ToString(CultureInfo.InvariantCulture)}, " +
        $"\"flags\": \"{summary.Flags}\", \"credit\": {(summary.IsCredit ? "true" : "false")} }}";

    public string RenderText(InvoiceSummary summary, IEnumerable<InvoiceLine> lines)
    {
        var sb = new StringBuilder();
        foreach (var line in lines)
        {
            var label = line.Kind switch
            {
                LineKind.Shipping or LineKind.Service => line.Sku.ToLowerInvariant(),
                LineKind.Discount when line.Quantity < 0 => $"-{line.Sku}",
                _ => line.Sku,
            };
            sb.AppendLine($"{label,-14}|{line.Quantity,6}|{line.Total.Amount,12:N2}");
        }

        sb.Append($@"Totals ({_currency})
  net:   {summary.Net}
  tax:   {summary.Tax}
  gross: {summary.Gross} {(summary.IsCredit ? "(credit)" : string.Empty)}");
        return sb.ToString();
    }
}
