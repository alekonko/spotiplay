Diagnostica un errore Spotify e proponi la soluzione. Argomento: descrizione dell'errore (es. "403 su POST /playlists/{id}/tracks").

## Steps

### 1. Snapshot live con lo script diagnostico
```bash
.venv/bin/python scripts/diagnose.py
```
Se `SPOTIFY_TEST_TOKEN` non è in `.env`, avvisa l'utente che servono credenziali per la diagnosi live.

### 2. Identifica l'endpoint incriminato
Dall'argomento `$ARGUMENTS` e dall'output del diagnostico, determina:
- L'endpoint esatto (metodo + path)
- Il codice HTTP ricevuto
- Il messaggio di errore Spotify (es. `{"error":{"status":403,"message":"Forbidden"}}`)

### 3. Leggi il codice backend
Leggi la route corrispondente in `main.py`. Identifica:
- Come viene costruita la richiesta a Spotify (header, body, params)
- Se il token viene gestito correttamente
- Se ci sono trasformazioni del body che potrebbero essere errate

### 4. Analisi delle cause comuni per codice HTTP

**403 Forbidden**:
- Token non ha gli scope necessari → controlla `SCOPES` in `main.py`
- Token ottenuto prima che gli scope venissero aggiunti → serve re-login con `show_dialog=true`
- App in Development Mode e utente non in User Management → aggiungilo nel Spotify Dashboard
- Endpoint ristretto post-novembre 2024 → verifica nelle Spotify API docs se richiede Extended Quota

**401 Unauthorized**:
- Token scaduto → controlla la logica di refresh in `get_valid_token`
- Token invalido → logout e re-login

**400 Bad Request**:
- Body malformato → controlla il formato (es. `uris` vs `tracks` per DELETE)
- Parametri mancanti o invalidi

**429 Too Many Requests**:
- Rate limit → aggiungi retry con backoff esponenziale

### 5. Proponi la fix
Basandoti sull'analisi, proponi una soluzione concreta con:
- Quale file modificare
- Cosa cambiare esattamente
- Perché questa fix risolve il problema

Chiedi conferma prima di applicare modifiche a `main.py`.

### 6. Verifica
Dopo la fix, esegui di nuovo lo script diagnostico:
```bash
.venv/bin/python scripts/diagnose.py
```
E poi i test unitari:
```bash
make test
```
