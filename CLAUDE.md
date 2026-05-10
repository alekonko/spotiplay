# SpotiPlay — Claude Code guide

## Project overview

SpotiPlay is a single-file FastAPI web app that acts as an OAuth proxy to the Spotify Web API. The backend lives entirely in `main.py`; the frontend is static files under `static/` with no build step.

## Running the app locally

```bash
# Activate the virtual environment first
source .venv/bin/activate          # macOS/Linux
# .venv\Scripts\activate           # Windows

uvicorn main:app --reload
```

The server starts at `http://localhost:8000`. Hot-reload is enabled via `--reload`.

## Architecture

```
Browser  ──►  FastAPI (main.py)  ──►  Spotify Web API
                    │
               SessionMiddleware
               (signed cookies)
```

- **Auth flow**: `/login` → Spotify OAuth → `/callback` → session cookie with `access_token` + `refresh_token`
- **Token refresh**: `get_valid_token()` transparently refreshes the token 60 s before expiry
- **Static serving**: `StaticFiles` mount on `/` is registered last so API routes take priority

## Key files

| File | Purpose |
|------|---------|
| `main.py` | All backend logic: OAuth, token management, Spotify API proxy routes |
| `static/index.html` | Full SPA markup (login view + app view + modal) |
| `static/app.js` | All frontend logic — state management, API calls, rendering |
| `static/style.css` | All styles |
| `requirements.txt` | Python dependencies (pinned versions) |
| `.env.example` | Template for required environment variables |

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/login` | Redirects to Spotify OAuth |
| GET | `/callback` | OAuth callback, sets session |
| GET | `/logout` | Clears session |
| GET | `/api/auth-status` | `{ authenticated: bool }` — safe, never redirects |
| GET | `/api/me` | Current user profile |
| GET | `/api/top-tracks` | Top tracks (`time_range`, `limit` params) |
| GET | `/api/playlists` | User's playlists (up to 50) |
| POST | `/api/playlists` | Create playlist, optionally with initial tracks |
| GET | `/api/playlists/{id}/tracks` | All tracks in a playlist (auto-paginated) |
| POST | `/api/playlists/{id}/tracks` | Add tracks to playlist |
| DELETE | `/api/playlists/{id}/tracks` | Remove tracks from playlist |

## Frontend state model (`app.js`)

```js
state = {
  user,                // Spotify user profile object
  topTracks,           // raw list from /api/top-tracks
  filteredTracks,      // topTracks after artistFilter applied
  playlists,           // list from /api/playlists
  selectedUris,        // Set of Spotify track URIs
  timeRange,           // 'short_term' | 'medium_term' | 'long_term'
  artistFilter,        // current filter string
  currentPlaylist,     // playlist object being viewed in detail
  currentPlaylistTracks, // tracks of currentPlaylist
}
```

## Development notes

- There is no test suite. Manual testing via the browser is the primary verification method.
- No TypeScript, no bundler — edits to `static/` take effect immediately on page reload.
- Session cookies are signed with `SECRET_KEY`. If the env var is absent, a random key is generated at startup (sessions break on restart — fine for dev, not for prod).
- Spotify's `/me/top/tracks` returns at most 50 items per request; the limit is enforced server-side.
- Playlist track fetching (`/api/playlists/{id}/tracks`) paginates automatically in 50-track pages.

## Dependencies

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
httpx==0.27.0
python-dotenv==1.0.1
itsdangerous==2.2.0
starlette==0.37.2
python-multipart==0.0.9
```

Do not upgrade starlette independently — it must stay in sync with the version bundled by fastapi.

## Environment variables

```
SPOTIFY_CLIENT_ID       # required
SPOTIFY_CLIENT_SECRET   # required
REDIRECT_URI            # default: http://localhost:8000/callback
SECRET_KEY              # recommended for stable sessions
```
