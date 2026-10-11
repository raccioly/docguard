<?php

declare(strict_types=1);

namespace App\Billing;

use App\Billing\Contracts\TaxPolicy;
use DateTimeInterface;
use InvalidArgumentException;
use Stringable;

interface Renderable extends Stringable
{
    public const FORMAT_TEXT = 'text';
    public const FORMAT_HTML = 'html';

    public function render(string $format = self::FORMAT_TEXT): string;
}

enum Currency: string
{
    case Usd = 'USD';
    case Eur = 'EUR';
    case Jpy = 'JPY';

    public function minorUnits(): int
    {
        return match ($this) {
            self::Jpy => 0,
            default => 2,
        };
    }

    public function format(int $amountMinor): string
    {
        $symbol = match ($this) {
            self::Usd => '$',
            self::Eur => "\u{20AC}",
            self::Jpy => "\u{00A5}",
        };
        $amount = number_format($amountMinor / (10 ** $this->minorUnits()), $this->minorUnits());

        return "{$symbol}{$amount}";
    }
}

final class LineItem
{
    public function __construct(
        public readonly string $description,
        public readonly int $unitPriceMinor,
        public readonly int|float $quantity = 1,
    ) {
    }

    public function totalMinor(): int
    {
        return (int) round($this->unitPriceMinor * $this->quantity);
    }
}

trait FormatsTables
{
    protected function padRow(array $cells, array $widths, string $glue = ' | '): string
    {
        $padded = [];
        foreach ($cells as $index => $cell) {
            $width = $widths[$index] ?? 10;
            $padded[] = is_numeric($cell)
                ? str_pad((string) $cell, $width, ' ', STR_PAD_LEFT)
                : str_pad((string) $cell, $width);
        }

        return rtrim(implode($glue, $padded));
    }

    protected static function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}

abstract class Document implements Renderable
{
    protected array $lines = [];

    public function __construct(
        protected readonly string $number,
        protected readonly Currency $currency,
        protected readonly DateTimeInterface $issuedAt,
    ) {
    }

    abstract protected function title(): string;

    abstract protected function footer(
        int $subtotalMinor,
        int $taxMinor,
    ): string;

    public function add(LineItem ...$items): static
    {
        foreach ($items as $item) {
            $this->lines[] = $item;
        }

        return $this;
    }

    public function subtotalMinor(): int
    {
        return array_reduce(
            $this->lines,
            static fn (int $carry, LineItem $line): int => $carry + $line->totalMinor(),
            0,
        );
    }

    public function __toString(): string
    {
        return $this->render();
    }
}

class Invoice extends Document
{
    use FormatsTables;

    private const TEXT_TEMPLATE = <<<'TPL'
        ==============================
        {title}  #{number}
        Issued: {date}
        ==============================
        {rows}
        ------------------------------
        {footer}
        TPL;

    public function __construct(
        string $number,
        Currency $currency,
        DateTimeInterface $issuedAt,
        private readonly TaxPolicy $taxPolicy,
        private readonly string $customerName = 'Customer',
        private int|string|null $purchaseOrder = null,
    ) {
        parent::__construct($number, $currency, $issuedAt);
    }

    protected function title(): string
    {
        return 'INVOICE';
    }

    protected function footer(
        int $subtotalMinor,
        int $taxMinor,
    ): string {
        $total = $this->currency->format($subtotalMinor + $taxMinor);
        $po = $this->purchaseOrder !== null ? "PO: {$this->purchaseOrder}\n" : '';

        return <<<TXT
            {$po}Subtotal: {$this->currency->format($subtotalMinor)}
            Tax:      {$this->currency->format($taxMinor)}
            Total:    {$total}
            Payable to "Accounts Receivable" within 30 days; quote {$this->number} on remittance.
            TXT;
    }

    #[\Override]
    public function render(string $format = self::FORMAT_TEXT): string
    {
        $subtotal = $this->subtotalMinor();
        $tax = $this->taxPolicy->taxFor($this->lines, $this->currency);

        return match ($format) {
            self::FORMAT_TEXT => $this->renderText($subtotal, $tax),
            self::FORMAT_HTML => $this->renderHtml($subtotal, $tax),
            default => throw new InvalidArgumentException("Unsupported format '{$format}'"),
        };
    }

    public function reminder(string $recipient, int $daysOverdue, int $feeMinor = 0): string
    {
        $fee = $this->currency->format($feeMinor);
        $plural = $daysOverdue === 1 ? 'day' : 'days';
        $feeLine = $feeMinor > 0 ? "A late fee of {$fee} has been applied." : 'No late fee has been applied yet.';

        return <<<MSG
            Dear ${recipient},

            Invoice {$this->number} is now ${daysOverdue} {$plural} overdue.
            {$feeLine} Literal braces such as {this} and \${escaped} are left alone.
            MSG;
    }

    private function renderText(int $subtotal, int $tax): string
    {
        $widths = [24, 6, 12];
        $rows = array_map(
            fn (LineItem $line): string => $this->padRow(
                [$line->description, $line->quantity, $this->currency->format($line->totalMinor())],
                $widths,
            ),
            $this->lines,
        );

        return strtr(self::TEXT_TEMPLATE, [
            '{title}' => $this->title(),
            '{number}' => $this->number,
            '{date}' => $this->issuedAt->format('Y-m-d'),
            '{rows}' => implode("\n", $rows),
            '{footer}' => $this->footer($subtotal, $tax),
        ]);
    }

    private function renderHtml(int $subtotal, int $tax): string
    {
        $customer = self::escape($this->customerName);
        $rows = '';
        foreach ($this->lines as $i => $line) {
            $class = $i % 2 === 0 ? 'even' : 'odd';
            $desc = self::escape($line->description);
            $rows .= "<tr class=\"{$class}\"><td>{$desc}</td><td>{$line->quantity}</td></tr>\n";
        }

        $styles = <<<'CSS'
            table { border-collapse: collapse; width: 100%; }
            td, th { padding: 4px 8px; border: 1px solid #ccc; }
            tr.odd { background: #f7f7f7; }
            CSS;

        return <<<HTML
            <style>{$styles}</style>
            <h1 data-number="{$this->number}">Invoice for {$customer}</h1>
            <table>
            {$rows}</table>
            <p class="total">Total: {$this->currency->format($subtotal + $tax)}</p>
            HTML;
    }
}
