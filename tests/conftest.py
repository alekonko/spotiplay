import base64
import json
import os
import time
from unittest.mock import AsyncMock, patch

import pytest
from itsdangerous import TimestampSigner
from starlette.testclient import TestClient

# Set env vars before importing app so dotenv doesn't override them
os.environ.setdefault("SPOTIFY_CLIENT_ID", "test-client-id")
os.environ.setdefault("SPOTIFY_CLIENT_SECRET", "test-client-secret")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-only!!")

from main import app  # noqa: E402

TEST_SECRET_KEY = os.environ["SECRET_KEY"]
TEST_TOKEN = "fake-spotify-access-token"


def make_session_cookie(data: dict) -> str:
    """Build a signed Starlette session cookie (TimestampSigner over base64-JSON)."""
    signer = TimestampSigner(TEST_SECRET_KEY)
    payload = base64.b64encode(json.dumps(data).encode("utf-8"))
    return signer.sign(payload).decode("utf-8")


@pytest.fixture
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def authed_client():
    """TestClient with a pre-injected authenticated session."""
    session_data = {
        "access_token": TEST_TOKEN,
        "refresh_token": "fake-refresh-token",
        "expires_at": time.time() + 3600,
    }
    cookie_value = make_session_cookie(session_data)
    with TestClient(app, raise_server_exceptions=False) as c:
        c.cookies.set("session", cookie_value)
        yield c


@pytest.fixture
def mock_token():
    """Patch get_valid_token so route tests don't need to worry about OAuth."""
    with patch("main.get_valid_token", new=AsyncMock(return_value=TEST_TOKEN)):
        yield TEST_TOKEN


# ─── Spotify API mock helpers ─────────────────────────────────────────────────

FAKE_USER = {
    "id": "testuser123",
    "display_name": "Test User",
    "email": "test@example.com",
}

FAKE_TRACK = {
    "uri": "spotify:track:abc123",
    "id": "abc123",
    "name": "Test Track",
    "artists": [{"name": "Test Artist"}],
    "album": {"name": "Test Album", "images": []},
}

FAKE_PLAYLIST = {
    "id": "playlist123",
    "name": "Test Playlist",
    "description": "",
    "public": False,
    "tracks": {"total": 0},
    "images": [],
}

FAKE_TOP_TRACKS = {
    "items": [FAKE_TRACK],
    "total": 1,
    "next": None,
}

FAKE_PLAYLISTS = {
    "items": [FAKE_PLAYLIST],
    "total": 1,
    "next": None,
}

FAKE_PLAYLIST_TRACKS_PAGE1 = {
    "items": [{"track": FAKE_TRACK}],
    "total": 1,
    "next": None,
}

FAKE_SNAPSHOT = {"snapshot_id": "snap123"}
