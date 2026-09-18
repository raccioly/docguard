# @implements docguard.precision-evidence-loop#FR-004
"""Persistence record for an order."""


class Order:
    def __init__(self, order_id):
        self.order_id = order_id
        self.status = "new"
