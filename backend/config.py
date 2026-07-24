import os

# Server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8001"))

# Database
DATABASE_PATH = os.getenv("DATABASE_PATH", "writeflow.db")

# JWT
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"

# Stripe
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_ID = os.getenv("STRIPE_PRICE_ID", "price_1TwqDQIh3bqeW0wSzpYgRfsP")  # $5/mo Pro

# Frontend URL (for Stripe redirect)
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://writeflow.app")
