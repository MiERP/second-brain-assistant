from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import User


def get_or_create_local_user(db: Session, settings: Settings) -> User:
    user = db.get(User, settings.local_user_id)
    if user:
        return user

    existing_email = db.scalar(select(User).where(User.email == settings.local_user_email))
    if existing_email:
        return existing_email

    user = User(
        id=settings.local_user_id,
        email=settings.local_user_email,
        hashed_password="",
        role="admin",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
