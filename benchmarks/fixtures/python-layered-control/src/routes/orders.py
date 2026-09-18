# @implements docguard.precision-evidence-loop#FR-005
"""HTTP entry point for orders. Routes reach the model through the service."""
from services.order_service import load_order


def get_order(order_id):
    return load_order(order_id)
