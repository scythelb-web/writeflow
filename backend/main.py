from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from jose import jwt, JWTError
import stripe
import secrets
import datetime
import asyncio

from config import JWT_SECRET, JWT_ALGORITHM, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID, FRONTEND_URL
from database import get_db, init_db

# ── Setup ──────────────────────────────────────────────

app = FastAPI(title="WriteFlow API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
stripe.api_key = STRIPE_SECRET_KEY

# ── Models ─────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class LicenseValidateRequest(BaseModel):
    license_key: str

# ── Auth helpers ───────────────────────────────────────

def create_token(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=90)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

def generate_license_key() -> str:
    return f"WF-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}"

# ── Lifecycle ──────────────────────────────────────────

@app.on_event("startup")
async def startup():
    await init_db()

# ── Health ─────────────────────────────────────────────

@app.get("/")
async def root():
    return {"service": "WriteFlow API", "status": "ok"}

# ── Auth routes ────────────────────────────────────────

@app.post("/auth/signup")
async def signup(body: SignupRequest):
    db = await get_db()
    
    # Check existing
    cursor = await db.execute("SELECT id FROM users WHERE email = ?", (body.email.lower(),))
    if await cursor.fetchone():
        raise HTTPException(status_code=409, detail="Email already registered")
    
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    
    password_hash = pwd_context.hash(body.password)
    
    cursor = await db.execute(
        "INSERT INTO users (email, password_hash) VALUES (?, ?)",
        (body.email.lower(), password_hash)
    )
    await db.commit()
    
    user_id = cursor.lastrowid
    token = create_token(user_id, body.email.lower())
    
    return {"token": token, "email": body.email.lower()}


@app.post("/auth/login")
async def login(body: LoginRequest):
    db = await get_db()
    
    cursor = await db.execute("SELECT id, email, password_hash FROM users WHERE email = ?", (body.email.lower(),))
    user = await cursor.fetchone()
    
    if not user or not pwd_context.verify(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    token = create_token(user["id"], user["email"])
    
    return {
        "token": token,
        "email": user["email"],
        "subscription_status": user["subscription_status"]
    }

# ── Stripe routes ──────────────────────────────────────

@app.post("/stripe/checkout")
async def create_checkout(request: Request):
    """Create a Stripe checkout session for $5/mo Pro subscription"""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    
    payload = verify_token(auth_header.replace("Bearer ", ""))
    user_id = int(payload["sub"])
    
    db = await get_db()
    cursor = await db.execute("SELECT email, stripe_customer_id FROM users WHERE id = ?", (user_id,))
    user = await cursor.fetchone()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Create or get Stripe customer
    customer_id = user["stripe_customer_id"]
    if not customer_id:
        customer = stripe.Customer.create(email=user["email"])
        customer_id = customer.id
        await db.execute("UPDATE users SET stripe_customer_id = ? WHERE id = ?", (customer_id, user_id))
        await db.commit()
    
    # Create checkout session
    session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{
            "price": STRIPE_PRICE_ID,
            "quantity": 1,
        }],
        mode="subscription",
        success_url=f"{FRONTEND_URL}/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{FRONTEND_URL}/cancel",
        metadata={"user_id": str(user_id)}
    )
    
    return {"url": session.url}


@app.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events"""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    db = await get_db()
    
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = int(session.get("metadata", {}).get("user_id", 0))
        
        if user_id:
            # Generate license key
            license_key = generate_license_key()
            await db.execute(
                "UPDATE users SET subscription_status = 'active', license_key = ? WHERE id = ?",
                (license_key, user_id)
            )
            
            # Create license record
            await db.execute(
                "INSERT INTO licenses (user_id, license_key, expires_at) VALUES (?, ?, ?)",
                (user_id, license_key, datetime.datetime.utcnow() + datetime.timedelta(days=365))
            )
            await db.commit()
    
    elif event["type"] == "customer.subscription.deleted":
        subscription = event["data"]["object"]
        customer_id = subscription["customer"]
        
        await db.execute(
            "UPDATE users SET subscription_status = 'cancelled', license_key = NULL WHERE stripe_customer_id = ?",
            (customer_id,)
        )
        await db.commit()
    
    return {"status": "ok"}


@app.post("/stripe/portal")
async def customer_portal(request: Request):
    """Create a Stripe customer portal session"""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    
    payload = verify_token(auth_header.replace("Bearer ", ""))
    user_id = int(payload["sub"])
    
    db = await get_db()
    cursor = await db.execute("SELECT stripe_customer_id FROM users WHERE id = ?", (user_id,))
    user = await cursor.fetchone()
    
    if not user or not user["stripe_customer_id"]:
        raise HTTPException(status_code=404, detail="No Stripe customer found")
    
    session = stripe.billing_portal.Session.create(
        customer=user["stripe_customer_id"],
        return_url=FRONTEND_URL,
    )
    
    return {"url": session.url}

# ── License routes ─────────────────────────────────────

@app.post("/license/validate")
async def validate_license(body: LicenseValidateRequest):
    """Validate a license key (called by extension)"""
    db = await get_db()
    
    cursor = await db.execute(
        "SELECT u.id, u.email, u.subscription_status, l.expires_at "
        "FROM users u JOIN licenses l ON u.id = l.user_id "
        "WHERE u.license_key = ? AND l.active = 1",
        (body.license_key,)
    )
    row = await cursor.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail="Invalid license key")
    
    if row["subscription_status"] != "active":
        raise HTTPException(status_code=403, detail="Subscription not active")
    
    return {
        "valid": True,
        "email": row["email"],
        "expires_at": row["expires_at"]
    }


@app.get("/license/status")
async def license_status(request: Request):
    """Get current user's subscription status"""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    
    payload = verify_token(auth_header.replace("Bearer ", ""))
    user_id = int(payload["sub"])
    
    db = await get_db()
    cursor = await db.execute(
        "SELECT subscription_status, license_key FROM users WHERE id = ?",
        (user_id,)
    )
    user = await cursor.fetchone()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "subscription_status": user["subscription_status"],
        "license_key": user["license_key"]
    }

# ── Run ────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    from config import HOST, PORT
    uvicorn.run(app, host=HOST, port=PORT)
