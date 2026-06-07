from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import get_db
from app.models import User
from app.schemas import AuthLoginRequest, AuthRegisterRequest, AuthTokenRead
from app.services.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthTokenRead, status_code=201)
def register(
    payload: AuthRegisterRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role="user",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _token_response(user, settings)


@router.post("/login", response_model=AuthTokenRead)
def login(
    payload: AuthLoginRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user = db.scalar(select(User).where(User.email == payload.email))
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return _token_response(user, settings)


def _token_response(user: User, settings: Settings) -> AuthTokenRead:
    return AuthTokenRead(
        access_token=create_access_token(user, settings),
        user={"id": user.id, "email": user.email, "role": user.role},
    )
