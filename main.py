import asyncio
import csv
import hashlib
import io
import json
import os
import time
import base64
import secrets
from pathlib import Path
from urllib.parse import urlencode

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

load_dotenv()

CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID")
CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")
REDIRECT_URI = os.getenv("REDIRECT_URI", "http://127.0.0.1:8000/callback")
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
    "user-read-recently-played",
])

# ─── File cache ───────────────────────────────────────────────────────────────

CACHE_DIR = Path("cache")
CACHE_DIR.mkdir(exist_ok=True)


def _user_hash(request: Request) -> str:
    token = request.session.get("refresh_token") or request.session.get("access_token", "")
    return hashlib.sha256(token.encode()).hexdigest()[:16]


def _cache_path(request: Request, name: str) -> Path:
    return CACHE_DIR / f"{_user_hash(request)}_{name}.json"


def cache_get(request: Request, name: str):
    try:
        p = _cache_path(request, name)
        if p.exists():
            entry = json.loads(p.read_text())
            if entry["expires_at"] > time.time():
                return entry["data"]
            p.unlink(missing_ok=True)
    except Exception:
        pass
    return None


def cache_set(request: Request, name: str, data, ttl: int):
    try:
        _cache_path(request, name).write_text(
            json.dumps({"data": data, "expires_at": time.time() + ttl})
        )
    except Exception:
        pass


def cache_clear_user(request: Request):
    prefix = _user_hash(request)
    for f in CACHE_DIR.glob(f"{prefix}_*.json"):
        f.unlink(missing_ok=True)


def cache_bust(request: Request, name: str):
    _cache_path(request, name).unlink(missing_ok=True)


# ─── App setup ────────────────────────────────────────────────────────────────

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
    if not resp.is_success:
        print(f"[spotify_post] {path} → {resp.status_code}: {resp.text}")
        raise HTTPException(resp.status_code, f"Spotify error: {resp.text}")
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
        "show_dialog": "true",
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
    cache_clear_user(request)
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


@app.get("/api/debug/token")
async def debug_token(request: Request):
    """Restituisce il token corrente dalla sessione. Solo per uso locale/test."""
    token = request.session.get("access_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    return {"access_token": token}


# ─── API: top tracks ──────────────────────────────────────────────────────────

@app.get("/api/top-tracks")
async def get_top_tracks(
    request: Request,
    time_range: str = "medium_term",
    limit: int = 50,
    refresh: bool = False,
):
    if time_range not in ("short_term", "medium_term", "long_term"):
        raise HTTPException(400, "Invalid time_range")
    if not 1 <= limit <= 50:
        raise HTTPException(400, "limit must be 1-50")

    cache_name = f"top_tracks_{time_range}_{limit}"
    if not refresh:
        cached = cache_get(request, cache_name)
        if cached is not None:
            return cached

    token = await get_valid_token(request)
    data = await spotify_get(token, "/me/top/tracks", {"time_range": time_range, "limit": limit})
    cache_set(request, cache_name, data, ttl=300)
    return data


# ─── API: playlists ───────────────────────────────────────────────────────────

@app.get("/api/playlists")
async def get_playlists(request: Request, refresh: bool = False):
    if not refresh:
        cached = cache_get(request, "playlists")
        if cached is not None:
            return cached

    token = await get_valid_token(request)
    data = await spotify_get(token, "/me/playlists", {"limit": 50})
    cache_set(request, "playlists", data, ttl=300)
    return data


@app.post("/api/playlists")
async def create_playlist(request: Request):
    token = await get_valid_token(request)
    body = await request.json()

    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Playlist name is required")

    playlist = await spotify_post(
        token,
        "/me/playlists",
        {
            "name": name,
            "description": body.get("description", "Creata con SpotiPlay"),
            "public": bool(body.get("public", False)),
        },
    )

    uris = body.get("uris", [])
    if uris:
        print(f"[create_playlist] adding {len(uris)} tracks to {playlist['id']}, sample uri: {uris[0]!r}")
        await asyncio.sleep(1)
        for i in range(0, len(uris), 100):
            await spotify_post(token, f"/playlists/{playlist['id']}/items", {"uris": uris[i:i+100]})

    cache_bust(request, "playlists")
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
        result = await spotify_post(token, f"/playlists/{playlist_id}/items", {"uris": uris[i:i+100]})
        results.append(result)

    cache_bust(request, "playlists")
    return {"snapshot_id": results[-1].get("snapshot_id")}


@app.get("/api/playlists/{playlist_id}/tracks")
async def get_playlist_tracks(request: Request, playlist_id: str):
    token = await get_valid_token(request)
    all_items = []
    url = f"/playlists/{playlist_id}/items"
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
    result = await spotify_delete(token, f"/playlists/{playlist_id}/items", {"tracks": tracks})
    cache_bust(request, "playlists")
    return result


# ─── API: library ─────────────────────────────────────────────────────────────

def _extract_track(item: dict) -> dict:
    track = item.get("track") or {}
    album = track.get("album") or {}
    release_date = album.get("release_date", "")
    year = release_date[:4] if release_date else ""
    images = album.get("images", [])
    sorted_imgs = sorted(images, key=lambda i: i.get("width", 0))
    image = next((i["url"] for i in sorted_imgs if i.get("width", 0) >= 40), None)
    if not image and sorted_imgs:
        image = sorted_imgs[-1]["url"]
    return {
        "added_at": item.get("added_at", ""),
        "name": track.get("name", ""),
        "artists": ", ".join(a["name"] for a in track.get("artists", [])),
        "album": album.get("name", ""),
        "release_date": release_date,
        "year": year,
        "duration_ms": track.get("duration_ms", 0),
        "explicit": track.get("explicit", False),
        "popularity": track.get("popularity", 0),
        "isrc": (track.get("external_ids") or {}).get("isrc", ""),
        "preview_url": track.get("preview_url") or "",
        "spotify_url": (track.get("external_urls") or {}).get("spotify", ""),
        "uri": track.get("uri", ""),
        "image": image or "",
    }


async def _fetch_full_library(token: str) -> list[dict]:
    all_items = []
    params = {"limit": 50, "offset": 0}
    while True:
        data = await spotify_get(token, "/me/tracks", params)
        all_items.extend(_extract_track(item) for item in data.get("items", []))
        if not data.get("next"):
            break
        params["offset"] += 50
    return all_items


@app.get("/api/library")
async def get_library(request: Request, refresh: bool = False):
    if not refresh:
        cached = cache_get(request, "library")
        if cached is not None:
            return cached

    token = await get_valid_token(request)
    tracks = await _fetch_full_library(token)
    result = {"items": tracks, "total": len(tracks)}
    cache_set(request, "library", result, ttl=600)
    return result


@app.get("/api/library/export.csv")
async def export_library_csv(request: Request, refresh: bool = False):
    cached = None if refresh else cache_get(request, "library")
    if cached is None:
        token = await get_valid_token(request)
        tracks = await _fetch_full_library(token)
        cached = {"items": tracks, "total": len(tracks)}
        cache_set(request, "library", cached, ttl=600)

    tracks = cached["items"]

    def generate():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "Titolo", "Artista", "Album", "Anno", "Durata (mm:ss)",
            "Esplicito", "Popolarità", "Aggiunto il",
            "ISRC", "Anteprima URL", "Spotify URL",
        ])
        yield buf.getvalue()

        for t in tracks:
            buf = io.StringIO()
            writer = csv.writer(buf)
            ms = t["duration_ms"]
            duration = f"{ms // 60000}:{(ms % 60000 // 1000):02d}"
            added = t["added_at"][:10] if t["added_at"] else ""
            writer.writerow([
                t["name"], t["artists"], t["album"], t["year"], duration,
                "Sì" if t["explicit"] else "No",
                t["popularity"], added,
                t["isrc"], t["preview_url"], t["spotify_url"],
            ])
            yield buf.getvalue()

    return StreamingResponse(
        generate(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=libreria_spotify.csv"},
    )


# ─── API: recently played ────────────────────────────────────────────────────

@app.get("/api/recently-played")
async def get_recently_played(request: Request, refresh: bool = False):
    if not refresh:
        cached = cache_get(request, "recently_played")
        if cached is not None:
            return cached

    token = await get_valid_token(request)
    data = await spotify_get(token, "/me/player/recently-played", {"limit": 50})

    items = []
    for item in data.get("items", []):
        track = item.get("track") or {}
        album = track.get("album") or {}
        images = album.get("images", [])
        sorted_imgs = sorted(images, key=lambda i: i.get("width", 0))
        image = next((i["url"] for i in sorted_imgs if i.get("width", 0) >= 40), None)
        if not image and sorted_imgs:
            image = sorted_imgs[-1]["url"]
        items.append({
            "played_at": item.get("played_at", ""),
            "name": track.get("name", ""),
            "artists": ", ".join(a["name"] for a in track.get("artists", [])),
            "album": album.get("name", ""),
            "uri": track.get("uri", ""),
            "image": image or "",
        })

    result = {"items": items}
    cache_set(request, "recently_played", result, ttl=180)
    return result


# ─── Static files (must be last) ──────────────────────────────────────────────

app.mount("/", StaticFiles(directory="static", html=True), name="static")
