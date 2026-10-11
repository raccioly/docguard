"""Billing helpers.

@implements acme.billing#FR-001
"""
import math

# @implements acme.billing#FR-002
RATE = 0.2


@staticmethod
# @implements acme.billing#FR-003
def apply(total):
    # @implements acme.billing#FR-004
    value = total * RATE
    return math.floor(value)


class Invoice:
    def total(self):
        """Sum lines. @implements acme.billing#FR-005"""
        return 1


text = "# @implements acme.billing#FR-009"
