import os
import random
import time
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

# Secret key for JWT
SECRET_KEY = "super-secret-key-change-me"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class TokenData(BaseModel):
    id: str
    role: str
    real_name: Optional[str] = None
    alias: Optional[str] = None
    icon: Optional[str] = None
    slot: Optional[int] = None

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def verify_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None

def generate_alias():
    adjectives = ["Silent", "Swift", "Mystic", "Clever", "Brave", "Shadow", "Neon", "Azure"]
    nouns = ["Fox", "Hawk", "Wolf", "Ghost", "Stellar", "Cipher", "Drifter", "Voyager"]
    return f"{random.choice(adjectives)} {random.choice(nouns)} {random.randint(10, 99)}"

def hash_password(password: str):
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str):
    return pwd_context.verify(plain_password, hashed_password)
