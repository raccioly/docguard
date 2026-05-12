# Product Catalog API

A Flask-based REST API for managing products. Provides **3 endpoints** for product listing and retrieval.

## Stack

- Python 3.10+
- Flask
- **SQLite** for local storage

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /api/products | List all products |
| GET | /api/products/:id | Get product by ID |

## Running

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Set the required environment variable (see `.env.example`):
   ```bash
   export DATABASE_URL=postgresql://localhost:5432/myapp
   ```

3. Start the application:
   ```bash
   python app.py
   ```
