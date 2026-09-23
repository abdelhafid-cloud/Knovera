"""Bootstrap DB schema + seed without Alembic (dev convenience)."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from app import create_app
from app.extensions import db
from app.services.organizations.service import seed_super_admin


def main():
    app = create_app()
    with app.app_context():
        db.create_all()
        user = seed_super_admin(
            email=app.config["SEED_SUPER_ADMIN_EMAIL"],
            password=app.config["SEED_SUPER_ADMIN_PASSWORD"],
            first_name=app.config["SEED_SUPER_ADMIN_FIRST_NAME"],
            last_name=app.config["SEED_SUPER_ADMIN_LAST_NAME"],
        )
        print(f"DB ready. Super admin: {user.email}")


if __name__ == "__main__":
    main()
