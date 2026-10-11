"""Fixture for the doclock-v0 compatibility golden."""
RATE = 0.2
LIMIT: int = 10


def apply_discount(total, coupon=None):
    """Apply the coupon."""
    if coupon is None:
        return total
    return round(total * (1 - RATE), 2)


class Invoice:
    def __init__(self, lines):
        self.lines = lines

    def total(self):
        return sum(line.price for line in self.lines)
