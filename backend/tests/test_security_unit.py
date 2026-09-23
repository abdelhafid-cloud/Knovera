import os
import sys

import pytest

# Ensure backend package is importable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def test_slugify():
    from app.utils.security import slugify

    assert slugify("Acme Corp!") == "acme-corp"


def test_password_hash_roundtrip():
    from app.utils.security import hash_password, verify_password

    h = hash_password("Secret123!")
    assert verify_password(h, "Secret123!")
    assert not verify_password(h, "wrong")
