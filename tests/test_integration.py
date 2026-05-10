"""Integration tests — hit real Spotify API.

Requires SPOTIFY_TEST_TOKEN env var (a valid Bearer token).
Skipped automatically if not set.

Usage:
    SPOTIFY_TEST_TOKEN=BQA... pytest tests/test_integration.py -v

Or via Makefile:
    make test-integration
"""
import os
import uuid

import httpx
import pytest

SPOTIFY_API_BASE = "https://api.spotify.com/v1"

pytestmark = pytest.mark.skipif(
    not os.getenv("SPOTIFY_TEST_TOKEN"),
    reason="SPOTIFY_TEST_TOKEN non impostato — usa: SPOTIFY_TEST_TOKEN=<token> make test-integration",
)


@pytest.fixture(scope="module")
def token() -> str:
    return os.environ["SPOTIFY_TEST_TOKEN"]


@pytest.fixture(scope="module")
def spotify(token) -> httpx.Client:
    with httpx.Client(
        base_url=SPOTIFY_API_BASE,
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    ) as client:
        yield client


@pytest.fixture(scope="module")
def user_id(spotify) -> str:
    resp = spotify.get("/me")
    resp.raise_for_status()
    return resp.json()["id"]


@pytest.fixture
def test_playlist(spotify, user_id):
    """Create a temporary playlist for the test, delete it on teardown."""
    name = f"spotiplay-test-{uuid.uuid4().hex[:8]}"
    resp = spotify.post("/me/playlists", json={"name": name, "public": False})
    resp.raise_for_status()
    playlist_id = resp.json()["id"]
    yield playlist_id
    # Cleanup: unfollow (delete) the playlist
    spotify.delete(f"/playlists/{playlist_id}/followers")


# ─── Tests ────────────────────────────────────────────────────────────────────

def test_get_me(spotify):
    resp = spotify.get("/me")
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data
    assert "display_name" in data


def test_get_playlists(spotify):
    resp = spotify.get("/me/playlists", params={"limit": 50})
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data


def test_create_playlist(spotify, test_playlist):
    """test_playlist fixture already creates and cleans up."""
    assert test_playlist is not None


def test_add_tracks_to_playlist(spotify, test_playlist):
    """The critical test: add a track to a freshly created playlist."""
    uri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC"  # Never Gonna Give You Up (stable track)
    resp = spotify.post(
        f"/playlists/{test_playlist}/tracks",
        json={"uris": [uri]},
    )
    assert resp.status_code == 201, (
        f"Spotify rifiuta l'aggiunta di tracce: {resp.status_code} — {resp.text}"
    )
    assert "snapshot_id" in resp.json()


def test_get_playlist_tracks(spotify, test_playlist):
    # Add a track first
    uri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC"
    spotify.post(f"/playlists/{test_playlist}/tracks", json={"uris": [uri]})

    resp = spotify.get(f"/playlists/{test_playlist}/tracks", params={"limit": 50, "offset": 0})
    assert resp.status_code == 200
    assert len(resp.json()["items"]) >= 1


def test_remove_tracks_from_playlist(spotify, test_playlist):
    uri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC"
    spotify.post(f"/playlists/{test_playlist}/tracks", json={"uris": [uri]})

    resp = spotify.delete(
        f"/playlists/{test_playlist}/tracks",
        json={"tracks": [{"uri": uri}]},
    )
    assert resp.status_code == 200
