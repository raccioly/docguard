# @implements docguard.precision-evidence-loop#FR-004
"""Business rules for orders. The service layer owns model access."""
from models.order import Order


def load_order(order_id):
    return Order(order_id)
