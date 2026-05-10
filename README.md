# SpotiPlay

A lightweight web application to manage your Spotify playlists. SpotiPlay lets you browse your top tracks, filter them by artist, and add them to existing or new playlists — all from a clean browser UI.

## Features

- **Top Tracks** — view your most listened-to songs across three time ranges (last 4 weeks, last 6 months, all time)
- **Artist filter** — instantly narrow the track list by artist name
- **Multi-select** — check individual tracks or select all at once
- **Add to playlist** — add selected tracks to an existing playlist or create a new one on the fly
- **Playlist manager** — browse all your playlists and view/remove their tracks

## Tech stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Backend  | Python 3.11+, FastAPI, Uvicorn      |
| HTTP     | HTTPX (async Spotify API calls)     |
| Sessions | Starlette SessionMiddleware         |
| Frontend | Vanilla JS, HTML5, CSS3 (no build step) |

---

## Prerequisites

- Python 3.11 or higher
- A [Spotify Developer](https://developer.spotify.com/dashboard) account with an app created

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/alekonko/spotiplay.git
cd spotiplay
```

### 2. Create and activate a virtual environment

**macOS / Linux**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

**Windows (PowerShell)**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

**Windows (CMD)**
```cmd
python -m venv .venv
.venv\Scripts\activate.bat
```

> To deactivate the virtual environment at any time, run `deactivate`.

### 3. Install dependencies

With the virtual environment active:

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

Copy the example file and fill in your Spotify credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
REDIRECT_URI=http://127.0.0.1:8000/callback
SECRET_KEY=a_random_secret_string_for_sessions
```

#### Getting Spotify credentials

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create (or open) an app.
2. Copy **Client ID** and **Client Secret** into `.env`.
3. In the app settings, add `http://127.0.0.1:8000/callback` to **Redirect URIs** and save.

### 5. Run the application

```bash
uvicorn main:app --reload
```

The app is now available at [http://127.0.0.1:8000](http://127.0.0.1:8000).

---

## Usage

1. Open the browser at `http://127.0.0.1:8000`.
2. Click **Accedi con Spotify** and authorize the app.
3. Browse your top tracks, select those you want to keep, and click **+ Aggiungi a playlist**.
4. Choose an existing playlist or create a new one.
5. Switch to the **Le mie Playlist** tab to view playlist contents or remove individual tracks.

---

## Project structure

```
spotiplay/
├── main.py            # FastAPI backend (OAuth, Spotify API proxy)
├── requirements.txt   # Python dependencies
├── .env.example       # Environment variable template
├── .gitignore
└── static/
    ├── index.html     # Single-page frontend
    ├── app.js         # Frontend logic (vanilla JS)
    └── style.css      # Styles
```

---

## Environment variables reference

| Variable              | Required | Default                          | Description                              |
|-----------------------|----------|----------------------------------|------------------------------------------|
| `SPOTIFY_CLIENT_ID`   | Yes      | —                                | Spotify app Client ID                    |
| `SPOTIFY_CLIENT_SECRET` | Yes    | —                                | Spotify app Client Secret                |
| `REDIRECT_URI`        | No       | `http://127.0.0.1:8000/callback` | Must match the Spotify app settings      |
| `SECRET_KEY`          | No       | Random (changes on restart)      | Signs session cookies — set a fixed value in production |

---

## License

MIT
