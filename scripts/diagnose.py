#!/usr/bin/env python3
"""
SpotiPlay — Spotify API diagnostic script.

Tests every Spotify operation directly (bypassing FastAPI) using a real
Bearer token to isolate issues in the Spotify API vs the backend.

Usage:
    python scripts/diagnose.py                      # reads SPOTIFY_TEST_TOKEN from .env
    python scripts/diagnose.py --token BQA...       # explicit token
    python scripts/diagnose.py --token BQA... -v    # verbose (show response bodies)
"""
import argparse
import os
import sys
import uuid

import httpx
from dotenv import load_dotenv

load_dotenv()

SPOTIFY_API_BASE = "https://api.spotify.com/v1"
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"
BOLD = "\033[1m"


def ok(label: str, detail: str = "") -> None:
    print(f"  {GREEN}✅{RESET} {label:<45} {detail}")


def fail(label: str, detail: str = "") -> None:
    print(f"  {RED}❌{RESET} {label:<45} {detail}")


def skip(label: str, detail: str = "") -> None:
    print(f"  {YELLOW}⏭ {RESET} {label:<45} {detail}")


def check(client: httpx.Client, method: str, path: str, label: str, verbose: bool, **kwargs):
    """Execute a request and print pass/fail. Returns (ok: bool, response)."""
    try:
        resp = client.request(method, path, **kwargs)
        detail = f"→ {resp.status_code}"
        if verbose:
            try:
                detail += f"  {resp.json()}"
            except Exception:
                detail += f"  {resp.text[:120]}"
        if resp.is_success:
            ok(label, detail)
            return True, resp
        else:
            body = resp.text[:200]
            fail(label, f"→ {resp.status_code}: {body}")
            return False, resp
    except Exception as e:
        fail(label, f"→ exception: {e}")
        return False, None


def main():
    parser = argparse.ArgumentParser(description="SpotiPlay Spotify API diagnostics")
    parser.add_argument("--token", help="Spotify Bearer token (overrides SPOTIFY_TEST_TOKEN)")
    parser.add_argument("-v", "--verbose", action="store_true", help="Show response bodies")
    args = parser.parse_args()

    token = args.token or os.getenv("SPOTIFY_TEST_TOKEN")

    if not token:
        # Try to fetch the token from the running app
        app_url = os.getenv("APP_URL", "http://127.0.0.1:8000")
        try:
            resp = httpx.get(f"{app_url}/api/debug/token", timeout=3)
            if resp.status_code == 200:
                token = resp.json().get("access_token")
                print(f"  Token letto da {app_url}/api/debug/token")
        except Exception:
            pass

    if not token:
        print(f"{RED}Errore:{RESET} nessun token trovato.")
        print("  Opzioni:")
        print("  1. Avvia l'app con `make dev` e fai il login, poi riesegui")
        print("  2. Imposta SPOTIFY_TEST_TOKEN in .env")
        print("  3. Passa --token <token>")
        sys.exit(1)

    print(f"\n{BOLD}SpotiPlay — Spotify API Diagnostics{RESET}")
    print(f"  Token: {token[:20]}…")
    print()

    client = httpx.Client(
        base_url=SPOTIFY_API_BASE,
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )

    failures = []
    test_playlist_id = None

    # 1. GET /me
    passed, resp = check(client, "GET", "/me", "GET /me (user profile)", args.verbose)
    if not passed:
        failures.append("GET /me")
        user_id = None
    else:
        user_id = resp.json().get("id")
        name = resp.json().get("display_name", "?")
        ok("  → user", f"{name} ({user_id})")

    # 2. GET /me/playlists
    existing_playlist_id = None
    passed, resp = check(
        client, "GET", "/me/playlists",
        "GET /me/playlists", args.verbose,
        params={"limit": 50},
    )
    if not passed:
        failures.append("GET /me/playlists")
    else:
        total = resp.json().get("total", "?")
        ok("  → playlists found", str(total))
        items = resp.json().get("items", [])
        if items:
            existing_playlist_id = items[0]["id"]
            ok("  → existing playlist for test", f"{items[0]['name']} ({existing_playlist_id})")

    # 2b. GET /playlists/{existing_id}/tracks (on pre-existing playlist)
    if existing_playlist_id:
        passed, _ = check(
            client, "GET", f"/playlists/{existing_playlist_id}/tracks",
            "GET /playlists/{existing}/tracks", args.verbose,
            params={"limit": 1, "offset": 0},
        )
        if not passed:
            failures.append("GET /playlists/{existing}/tracks")
            print(f"  {YELLOW}→ NOTA: anche playlist esistente dà 403 — problema globale API, non di nuova playlist{RESET}")
        else:
            print(f"  {YELLOW}→ NOTA: playlist esistente OK, problema specifico a playlist appena create{RESET}")

    # 3. GET /me/top/tracks
    passed, _ = check(
        client, "GET", "/me/top/tracks",
        "GET /me/top/tracks", args.verbose,
        params={"time_range": "medium_term", "limit": 5},
    )
    if not passed:
        failures.append("GET /me/top/tracks")

    # 4. POST /me/playlists (create)
    test_name = f"spotiplay-diagnose-{uuid.uuid4().hex[:6]}"
    passed, resp = check(
        client, "POST", "/me/playlists",
        "POST /me/playlists (create)", args.verbose,
        json={"name": test_name, "public": False},
    )
    if not passed:
        failures.append("POST /me/playlists")
    else:
        test_playlist_id = resp.json().get("id")
        ok("  → playlist created", test_playlist_id)

    # 5. POST /playlists/{id}/tracks (add tracks)
    if test_playlist_id:
        test_uri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC"  # Never Gonna Give You Up
        passed, _ = check(
            client, "POST", f"/playlists/{test_playlist_id}/tracks",
            "POST /playlists/{id}/tracks (add)", args.verbose,
            json={"uris": [test_uri]},
        )
        if not passed:
            failures.append("POST /playlists/{id}/tracks")
    else:
        skip("POST /playlists/{id}/tracks (add)", "skipped — no playlist created")

    # 6. GET /playlists/{id}/tracks
    if test_playlist_id:
        passed, resp = check(
            client, "GET", f"/playlists/{test_playlist_id}/tracks",
            "GET /playlists/{id}/tracks", args.verbose,
            params={"limit": 50, "offset": 0},
        )
        if not passed:
            failures.append("GET /playlists/{id}/tracks")
    else:
        skip("GET /playlists/{id}/tracks", "skipped — no playlist created")

    # 7. DELETE /playlists/{id}/tracks (remove)
    if test_playlist_id:
        test_uri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC"
        passed, _ = check(
            client, "DELETE", f"/playlists/{test_playlist_id}/tracks",
            "DELETE /playlists/{id}/tracks (remove)", args.verbose,
            json={"tracks": [{"uri": test_uri}]},
        )
        if not passed:
            failures.append("DELETE /playlists/{id}/tracks")
    else:
        skip("DELETE /playlists/{id}/tracks (remove)", "skipped — no playlist created")

    # Cleanup: unfollow test playlist
    if test_playlist_id:
        try:
            client.delete(f"/playlists/{test_playlist_id}/followers")
            ok("Cleanup: test playlist removed", test_playlist_id)
        except Exception:
            skip("Cleanup: test playlist removal", "failed — remove manually")

    client.close()

    # Summary
    print()
    if not failures:
        print(f"{GREEN}{BOLD}✅ Tutti i test passati — Spotify API operativa{RESET}")
        sys.exit(0)
    else:
        print(f"{RED}{BOLD}❌ Falliti:{RESET}")
        for f in failures:
            print(f"   - {f}")
        print()
        print("Suggerimenti:")
        if any("tracks" in f for f in failures):
            print("  • 403 su /tracks → token potrebbe non avere scope playlist-modify-*")
            print("    Fai /logout e ri-autentica con show_dialog=true in main.py")
            print("  • Verifica che l'account sia in User Management nel Spotify Dashboard")
        sys.exit(1)


if __name__ == "__main__":
    main()
