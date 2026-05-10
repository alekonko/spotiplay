"""Unit tests for SpotiPlay routes — all Spotify HTTP calls are mocked."""
import json
import time
from unittest.mock import AsyncMock, patch

import pytest
import httpx

from tests.conftest import (
    FAKE_PLAYLIST,
    FAKE_PLAYLIST_TRACKS_PAGE1,
    FAKE_PLAYLISTS,
    FAKE_SNAPSHOT,
    FAKE_TOP_TRACKS,
    FAKE_TRACK,
    FAKE_USER,
    TEST_TOKEN,
)


# ─── /api/auth-status ─────────────────────────────────────────────────────────

def test_auth_status_not_authenticated(client):
    resp = client.get("/api/auth-status")
    assert resp.status_code == 200
    assert resp.json() == {"authenticated": False}


def test_auth_status_authenticated(authed_client):
    resp = authed_client.get("/api/auth-status")
    assert resp.status_code == 200
    assert resp.json() == {"authenticated": True}


# ─── /login ───────────────────────────────────────────────────────────────────

def test_login_redirects_to_spotify(client):
    resp = client.get("/login", follow_redirects=False)
    assert resp.status_code in (302, 307)
    location = resp.headers["location"]
    assert "accounts.spotify.com/authorize" in location
    assert "playlist-modify-public" in location
    assert "response_type=code" in location


# ─── /logout ──────────────────────────────────────────────────────────────────

def test_logout_clears_session(authed_client):
    resp = authed_client.get("/logout", follow_redirects=False)
    assert resp.status_code in (302, 307)
    # Starlette deletes the session cookie via Set-Cookie with past expiry
    set_cookie = resp.headers.get("set-cookie", "")
    assert "session" in set_cookie
    assert "1970" in set_cookie or "null" in set_cookie


# ─── /callback ────────────────────────────────────────────────────────────────

def test_callback_state_mismatch(client):
    resp = client.get("/callback?code=abc&state=wrongstate")
    assert resp.status_code == 400


def test_callback_spotify_error(client):
    resp = client.get("/callback?error=access_denied&state=anything", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert "error=access_denied" in resp.headers["location"]


def _login_and_get_state(client) -> str:
    """Hit /login to establish a session, return the oauth_state from the redirect URL."""
    resp = client.get("/login", follow_redirects=False)
    location = resp.headers["location"]
    from urllib.parse import parse_qs, urlparse
    return parse_qs(urlparse(location).query)["state"][0]


def test_callback_token_exchange_ok(client, httpx_mock):
    state = _login_and_get_state(client)

    httpx_mock.add_response(
        method="POST",
        url="https://accounts.spotify.com/api/token",
        json={
            "access_token": "new-token",
            "refresh_token": "new-refresh",
            "expires_in": 3600,
        },
    )
    resp = client.get(f"/callback?code=authcode&state={state}", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert resp.headers["location"] == "/"


def test_callback_token_exchange_failure(client, httpx_mock):
    state = _login_and_get_state(client)

    httpx_mock.add_response(
        method="POST",
        url="https://accounts.spotify.com/api/token",
        status_code=400,
        json={"error": "invalid_grant"},
    )
    resp = client.get(f"/callback?code=badcode&state={state}", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert "error=" in resp.headers["location"]


# ─── /api/me ──────────────────────────────────────────────────────────────────

def test_debug_token_authenticated(authed_client):
    resp = authed_client.get("/api/debug/token")
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_debug_token_unauthenticated(client):
    resp = client.get("/api/debug/token")
    assert resp.status_code == 401


def test_get_me(authed_client, mock_token, httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="https://api.spotify.com/v1/me",
        json=FAKE_USER,
    )
    resp = authed_client.get("/api/me")
    assert resp.status_code == 200
    assert resp.json()["id"] == "testuser123"


def test_get_me_unauthenticated(client):
    resp = client.get("/api/me")
    assert resp.status_code == 401


# ─── /api/top-tracks ──────────────────────────────────────────────────────────

def test_top_tracks_default(authed_client, mock_token, httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="https://api.spotify.com/v1/me/top/tracks?time_range=medium_term&limit=50",
        json=FAKE_TOP_TRACKS,
    )
    resp = authed_client.get("/api/top-tracks")
    assert resp.status_code == 200
    assert resp.json()["items"][0]["uri"] == "spotify:track:abc123"


def test_top_tracks_invalid_time_range(authed_client, mock_token):
    resp = authed_client.get("/api/top-tracks?time_range=invalid")
    assert resp.status_code == 400


def test_top_tracks_limit_out_of_range(authed_client, mock_token):
    resp = authed_client.get("/api/top-tracks?limit=100")
    assert resp.status_code == 400


def test_top_tracks_valid_short_term(authed_client, mock_token, httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=10",
        json=FAKE_TOP_TRACKS,
    )
    resp = authed_client.get("/api/top-tracks?time_range=short_term&limit=10")
    assert resp.status_code == 200


# ─── /api/playlists GET ───────────────────────────────────────────────────────

def test_get_playlists(authed_client, mock_token, httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="https://api.spotify.com/v1/me/playlists?limit=50",
        json=FAKE_PLAYLISTS,
    )
    resp = authed_client.get("/api/playlists")
    assert resp.status_code == 200
    assert resp.json()["items"][0]["id"] == "playlist123"


# ─── /api/playlists POST ──────────────────────────────────────────────────────

def test_create_playlist_no_name(authed_client, mock_token):
    resp = authed_client.post("/api/playlists", json={"name": ""})
    assert resp.status_code == 400


def test_create_playlist_without_tracks(authed_client, mock_token, httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.spotify.com/v1/me/playlists",
        json=FAKE_PLAYLIST,
        status_code=201,
    )
    resp = authed_client.post("/api/playlists", json={"name": "My Playlist"})
    assert resp.status_code == 200
    assert resp.json()["id"] == "playlist123"


def test_create_playlist_with_tracks(authed_client, mock_token, httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.spotify.com/v1/me/playlists",
        json=FAKE_PLAYLIST,
        status_code=201,
    )
    httpx_mock.add_response(
        method="POST",
        url="https://api.spotify.com/v1/playlists/playlist123/tracks",
        json=FAKE_SNAPSHOT,
    )
    resp = authed_client.post(
        "/api/playlists",
        json={"name": "My Playlist", "uris": ["spotify:track:abc123"]},
    )
    assert resp.status_code == 200


def test_create_playlist_add_tracks_spotify_error(authed_client, mock_token, httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.spotify.com/v1/me/playlists",
        json=FAKE_PLAYLIST,
        status_code=201,
    )
    httpx_mock.add_response(
        method="POST",
        url="https://api.spotify.com/v1/playlists/playlist123/tracks",
        status_code=403,
        json={"error": {"status": 403, "message": "Forbidden"}},
    )
    resp = authed_client.post(
        "/api/playlists",
        json={"name": "My Playlist", "uris": ["spotify:track:abc123"]},
    )
    assert resp.status_code == 403


# ─── /api/playlists/{id}/tracks POST ─────────────────────────────────────────

def test_add_tracks_ok(authed_client, mock_token, httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.spotify.com/v1/playlists/playlist123/tracks",
        json=FAKE_SNAPSHOT,
    )
    resp = authed_client.post(
        "/api/playlists/playlist123/tracks",
        json={"uris": ["spotify:track:abc123"]},
    )
    assert resp.status_code == 200


def test_add_tracks_empty_uris(authed_client, mock_token):
    resp = authed_client.post(
        "/api/playlists/playlist123/tracks",
        json={"uris": []},
    )
    assert resp.status_code == 400


# ─── /api/playlists/{id}/tracks GET ──────────────────────────────────────────

def test_get_playlist_tracks_single_page(authed_client, mock_token, httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="https://api.spotify.com/v1/playlists/playlist123/tracks?limit=50&offset=0",
        json=FAKE_PLAYLIST_TRACKS_PAGE1,
    )
    resp = authed_client.get("/api/playlists/playlist123/tracks")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 1


def test_get_playlist_tracks_pagination(authed_client, mock_token, httpx_mock):
    page1 = {
        "items": [{"track": FAKE_TRACK}] * 50,
        "total": 51,
        "next": "https://api.spotify.com/v1/playlists/playlist123/tracks?limit=50&offset=50",
    }
    page2 = {
        "items": [{"track": FAKE_TRACK}],
        "total": 51,
        "next": None,
    }
    httpx_mock.add_response(
        method="GET",
        url="https://api.spotify.com/v1/playlists/playlist123/tracks?limit=50&offset=0",
        json=page1,
    )
    httpx_mock.add_response(
        method="GET",
        url="https://api.spotify.com/v1/playlists/playlist123/tracks?limit=50&offset=50",
        json=page2,
    )
    resp = authed_client.get("/api/playlists/playlist123/tracks")
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 51


# ─── /api/playlists/{id}/tracks DELETE ───────────────────────────────────────

def test_remove_tracks_ok(authed_client, mock_token, httpx_mock):
    httpx_mock.add_response(
        method="DELETE",
        url="https://api.spotify.com/v1/playlists/playlist123/tracks",
        json=FAKE_SNAPSHOT,
    )
    resp = authed_client.request(
        "DELETE",
        "/api/playlists/playlist123/tracks",
        json={"uris": ["spotify:track:abc123"]},
    )
    assert resp.status_code == 200


def test_remove_tracks_empty_uris(authed_client, mock_token):
    resp = authed_client.request(
        "DELETE",
        "/api/playlists/playlist123/tracks",
        json={"uris": []},
    )
    assert resp.status_code == 400
