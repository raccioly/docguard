import math


# @implements acme.golden#FR-001
def total(items, rate):
    total_price = sum(item.price for item in items)
    return total_price * (1 - rate)


# @implements acme.golden#FR-002
class Cart:
    def add(self, item):
        return math.floor(item)
