<?php

declare(strict_types=1);

namespace Warehouse\Inventory;

use Closure;
use DateTimeImmutable;
use Generator;
use InvalidArgumentException;
use JsonSerializable;
use RuntimeException;
use Warehouse\Audit\Auditable;

use function array_filter;
use function sprintf;

use const ARRAY_FILTER_USE_BOTH;
use const DATE_ATOM;

enum MovementKind: string
{
    case Receipt = 'receipt';
    case Shipment = 'shipment';
    case Adjustment = 'adjustment';
    case Transfer = 'transfer';

    public const FALLBACK = self::Adjustment;

    public static function fromLabel(string $label): self
    {
        return self::tryFrom(strtolower(trim($label)))
            ?? throw new InvalidArgumentException("Unknown movement kind \"{$label}\"");
    }

    public function sign(): int
    {
        return match ($this) {
            self::Receipt => 1,
            self::Shipment => -1,
            self::Adjustment, self::Transfer => 0,
        };
    }
}

interface StockRepository
{
    /** @return iterable<StockMovement> */
    public function movementsFor(string $sku, ?DateTimeImmutable $since = null): iterable;

    public function append(StockMovement $movement): void;

    public function reserve(
        string $sku,
        int $quantity,
        string|int|null $reference = null,
    ): bool;
}

final class InsufficientStockException extends RuntimeException
{
    public static function forShipment(string $sku, int $requested, int $available): self
    {
        return new self(sprintf(
            'Cannot ship %d of %s: only %d available (short by %d)',
            $requested,
            $sku,
            $available,
            $requested - $available,
        ));
    }
}

#[Auditable(channel: 'stock')]
final class StockMovement implements JsonSerializable
{
    public function __construct(
        public readonly string $sku,
        public readonly MovementKind $kind,
        public readonly int $quantity,
        public readonly DateTimeImmutable $occurredAt = new DateTimeImmutable(),
        public readonly ?string $note = null,
    ) {
        if ($quantity < 0) {
            throw new InvalidArgumentException("Quantity for {$sku} must be non-negative, got {$quantity}");
        }
    }

    public function signedQuantity(): int
    {
        return $this->kind === MovementKind::Adjustment
            ? $this->quantity
            : $this->quantity * $this->kind->sign();
    }

    public function jsonSerialize(): array
    {
        return [
            'sku' => $this->sku,
            'kind' => $this->kind->value,
            'quantity' => $this->quantity,
            'occurred_at' => $this->occurredAt->format(DATE_ATOM),
            'note' => $this->note,
        ];
    }
}

trait RecordsEvents
{
    /** @var list<array{name: string, payload: array<string, mixed>}> */
    private array $recordedEvents = [];

    protected function record(string $name, array $payload = []): void
    {
        $this->recordedEvents[] = ['name' => $name, 'payload' => $payload];
    }

    public function releaseEvents(): array
    {
        [$events, $this->recordedEvents] = [$this->recordedEvents, []];

        return $events;
    }
}

final class StockLedger
{
    use RecordsEvents;

    private const LOW_STOCK_THRESHOLD = 5;

    public function __construct(
        private readonly StockRepository $repository,
        private readonly Closure $clock,
        private int $lowStockThreshold = self::LOW_STOCK_THRESHOLD,
    ) {
    }

    public static function withSystemClock(StockRepository $repository): self
    {
        return new self($repository, static fn (): DateTimeImmutable => new DateTimeImmutable('now'));
    }

    public function onHand(string $sku): int
    {
        $total = 0;
        foreach ($this->repository->movementsFor($sku) as $movement) {
            $total += $movement->signedQuantity();
        }

        return $total;
    }

    public function receive(string $sku, int $quantity, ?string $note = null): StockMovement
    {
        $movement = new StockMovement($sku, MovementKind::Receipt, $quantity, ($this->clock)(), $note);
        $this->repository->append($movement);
        $this->record('stock.received', ['sku' => $sku, 'quantity' => $quantity]);

        return $movement;
    }

    public function ship(string $sku, int $quantity): StockMovement
    {
        $available = $this->onHand($sku);
        if ($available < $quantity) {
            throw InsufficientStockException::forShipment($sku, $quantity, $available);
        }

        $movement = new StockMovement($sku, MovementKind::Shipment, $quantity, ($this->clock)());
        $this->repository->append($movement);

        if ($available - $quantity <= $this->lowStockThreshold) {
            $this->record('stock.low', ['sku' => $sku, 'remaining' => $available - $quantity]);
        }

        return $movement;
    }

    /**
     * @param iterable<string> $skus
     * @return Generator<string, int>
     */
    public function snapshot(iterable $skus): Generator
    {
        foreach ($skus as $sku) {
            yield $sku => $this->onHand($sku);
        }
    }

    public function history(string $sku, ?DateTimeImmutable $since = null): Generator
    {
        $running = 0;
        foreach ($this->repository->movementsFor($sku, $since) as $movement) {
            $running += $movement->signedQuantity();
            $command = yield [$movement, $running];
            if ($command === 'stop') {
                return $running;
            }
        }

        return $running;
    }

    public function lowStock(iterable $skus): array
    {
        $threshold = $this->lowStockThreshold;
        $levels = iterator_to_array($this->snapshot($skus));

        return array_filter($levels, function (int $level, string $sku) use ($threshold): bool {
            $isTracked = !str_starts_with($sku, 'TMP-');

            return $isTracked && $level <= $threshold;
        }, ARRAY_FILTER_USE_BOTH);
    }
}

function normalize_sku(string $raw): string
{
    $clean = preg_replace('/[^A-Z0-9\-]/', '', strtoupper($raw)) ?? '';

    return $clean === '' ? throw new InvalidArgumentException('SKU "' . $raw . '" is empty after cleanup') : $clean;
}
