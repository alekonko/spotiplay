import os
import time
import base64
import secrets
from urllib.parse import urlencode

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

load_dotenv()

CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID")
CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")
REDIRECT_URI = os.getenv("REDIRECT_URI", "http://localhost:8000/callback")
SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_hex(32))

SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_API_BASE = "https://api.spotify.com/v1"

SCOPES = " ".join([
    "user-top-read",
    "playlist-modify-public",
    "playlist-modify-private",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
])

app = FastAPI(title="SpotiPlay")
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, max_age=3600 * 24)


# ─── Auth helpers ────────────────────────────────────────────────────────────

def _auth_header() -> str:
    creds = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
    return f"Basic {creds}"


async def _refresh_token(request: Request) -> str:
    refresh_token = request.session.get("refresh_token")
    if not refresh_token:
        raise HTTPException(401, "Session expired – please log in again")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            SPOTIFY_TOKEN_URL,
            headers={"Authorization": _auth_header()},
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
        )

    if resp.status_code != 200:
        request.session.clear()
        raise HTTPException(401, "Token refresh failed – please log in again")

    data = resp.json()
    request.session["access_token"] = data["access_token"]
    request.session["expires_at"] = time.time() + data["expires_in"]
    if "refresh_token" in data:
        request.session["refresh_token"] = data["refresh_token"]

    return data["access_token"]


async def get_valid_token(request: Request) -> str:
    token = request.session.get("access_token")
    if not token:
        raise HTTPException(401, "Not authenticated")

    expires_at = request.session.get("expires_at", 0)
    if time.time() > expires_at - 60:
        token = await _refresh_token(request)

    return token


async def spotify_get(token: str, path: str, params: dict = None) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SPOTIFY_API_BASE}{path}",
            headers={"Authorization": f"Bearer {token}"},
            params=params or {},
        )
    if resp.status_code == 401:
        raise HTTPException(401, "Spotify token invalid")
    resp.raise_for_status()
    return resp.json()


async def spotify_post(token: str, path: str, body: dict) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SPOTIFY_API_BASE}{path}",
            headers={"Authorization": f"Bearer {token}"},
            json=body,
        )
    resp.raise_for_status()
    return resp.json()


async def spotify_delete(token: str, path: str, body: dict) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.request(
            "DELETE",
            f"{SPOTIFY_API_BASE}{path}",
            headers={"Authorization": f"Bearer {token}"},
            json=body,
        )
    resp.raise_for_status()
    return resp.json() if resp.content else {}


# ─── OAuth routes ─────────────────────────────────────────────────────────────

@app.get("/login")
async def login(request: Request):
    if not CLIENT_ID:
        return JSONResponse({"error": "SPOTIFY_CLIENT_ID not configured"}, status_code=500)

    state = secrets.token_urlsafe(16)
    request.session["oauth_state"] = state

    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "state": state,
        "scope": SCOPES,
        "show_dialog": "false",
    }
    return RedirectResponse(f"{SPOTIFY_AUTH_URL}?{urlencode(params)}")


@app.get("/callback")
async def callback(request: Request, code: str = None, state: str = None, error: str = None):
    if error:
        return RedirectResponse(f"/?error={error}")

    if not state or state != request.session.get("oauth_state"):
        raise HTTPException(400, "State mismatch – possible CSRF attack")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            SPOTIFY_TOKEN_URL,
            headers={"Authorization": _auth_header()},
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT_URI,
            },
        )

    if resp.status_code != 200:
        return RedirectResponse("/?error=token_exchange_failed")

    data = resp.json()
    request.session["access_token"] = data["access_token"]
    request.session["refresh_token"] = data["refresh_token"]
    request.session["expires_at"] = time.time() + data["expires_in"]
    request.session.pop("oauth_state", None)

    return RedirectResponse("/")


@app.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/")


# ─── API: user ────────────────────────────────────────────────────────────────

@app.get("/api/me")
async def get_me(request: Request):
    token = await get_valid_token(request)
    return await spotify_get(token, "/me")


@app.get("/api/auth-status")
async def auth_status(request: Request):
    token = request.session.get("access_token")
    return {"authenticated": bool(token)}


# ─── API: top tracks ──────────────────────────────────────────────────────────

@app.get("/api/top-tracks")
async def get_top_tracks(
    request: Request,
    time_range: str = "medium_term",
    limit: int = 50,
):
    if time_range not in ("short_term", "medium_term", "long_term"):
        raise HTTPException(400, "Invalid time_range")
    if not 1 <= limit <= 50:
        raise HTTPException(400, "limit must be 1-50")

    token = await get_valid_token(request)
    return await spotify_get(token, "/me/top/tracks", {"time_range": time_range, "limit": limit})


# ─── API: playlists ───────────────────────────────────────────────────────────

@app.get("/api/playlists")
async def get_playlists(request: Request):
    token = await get_valid_token(request)
    # Fetch up to 50 playlists owned by the user
    data = await spotify_get(token, "/me/playlists", {"limit": 50})
    return data


@app.post("/api/playlists")
async def create_playlist(request: Request):
    token = await get_valid_token(request)
    body = await request.json()

    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Playlist name is required")

    me = await spotify_get(token, "/me")
    user_id = me["id"]

    playlist = await spotify_post(
        token,
        f"/users/{user_id}/playlists",
        {
            "name": name,
            "description": body.get("description", "Creata con SpotiPlay"),
            "public": bool(body.get("public", False)),
        },
    )

    # Add tracks if provided
    uris = body.get("uris", [])
    if uris:
        for i in range(0, len(uris), 100):
            await spotify_post(token, f"/playlists/{playlist['id']}/tracks", {"uris": uris[i:i+100]})

    return playlist


@app.post("/api/playlists/{playlist_id}/tracks")
async def add_tracks_to_playlist(request: Request, playlist_id: str):
    token = await get_valid_token(request)
    body = await request.json()
    uris = body.get("uris", [])

    if not uris:
        raise HTTPException(400, "No track URIs provided")

    results = []
    for i in range(0, len(uris), 100):
        result = await spotify_post(token, f"/playlists/{playlist_id}/tracks", {"uris": uris[i:i+100]})
        results.append(result)

    return {"snapshot_id": results[-1].get("snapshot_id")}


@app.get("/api/playlists/{playlist_id}/tracks")
async def get_playlist_tracks(request: Request, playlist_id: str):
    token = await get_valid_token(request)
    all_items = []
    url = f"/playlists/{playlist_id}/tracks"
    params = {"limit": 50, "offset": 0}

    while True:
        data = await spotify_get(token, url, params)
        all_items.extend(data.get("items", []))
        if not data.get("next"):
            break
        params["offset"] += 50

    return {"items": all_items, "total": len(all_items)}


@app.delete("/api/playlists/{playlist_id}/tracks")
async def remove_tracks_from_playlist(request: Request, playlist_id: str):
    token = await get_valid_token(request)
    body = await request.json()
    uris = body.get("uris", [])

    if not uris:
        raise HTTPException(400, "No track URIs provided")

    tracks = [{"uri": uri} for uri in uris]
    return await spotify_delete(token, f"/playlists/{playlist_id}/tracks", {"tracks": tracks})


# ─── Static files (must be last) ──────────────────────────────────────────────

app.mount("/", StaticFiles(directory="static", html=True), name="static")
