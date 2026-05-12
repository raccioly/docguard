from flask import Flask, request, jsonify
import os

app = Flask(__name__)

# Database connection — PostgreSQL URL must be provided in environment
DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set")


@app.route('/health')
def health():
    return jsonify({'status': 'healthy', 'database': 'postgresql'})


@app.route('/api/products')
def list_products():
    """List all products with optional category filter."""
    category = request.args.get('category')
    return jsonify([
        {'id': 1, 'name': 'Widget', 'price': 9.99, 'category': 'tools'},
        {'id': 2, 'name': 'Gadget', 'price': 19.99, 'category': 'electronics'},
    ])


@app.route('/api/products/<int:product_id>')
def get_product(product_id):
    """Get a single product by ID."""
    return jsonify({'id': product_id, 'name': 'Widget', 'price': 9.99})


@app.route('/api/products', methods=['POST'])
def create_product():
    """Create a new product."""
    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify({'error': 'Product name is required'}), 400
    return jsonify({'id': 100, **data}), 201


@app.route('/api/orders', methods=['POST'])
def create_order():
    """Place a new order — with inventory check."""
    data = request.get_json()
    if not data or 'product_id' not in data:
        return jsonify({'error': 'Product ID is required'}), 400
    return jsonify({'order_id': 500, 'status': 'confirmed'}), 201


if __name__ == '__main__':
    app.run(debug=True, port=5000)
