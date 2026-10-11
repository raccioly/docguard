<?php

namespace Sample;

// @implements acme.golden#FR-001
function total(array $items, float $rate): float
{
    $sum = 0;
    foreach ($items as $item) {
        $sum += $item;
    }
    return $sum * (1 - $rate);
}

class Cart
{
    // @implements acme.golden#FR-002
    public function add(int $item): void
    {
        echo "item {$item}";
    }
}
