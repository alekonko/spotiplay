Verifica che l'app SpotiPlay si avvii correttamente e risponda sull'endpoint di health.

Steps:
1. Controlla che il virtualenv esista:
   ```bash
   ls .venv/bin/uvicorn
   ```
   Se non esiste, esegui `make install` e fermati se fallisce.

2. Avvia l'app in background su una porta temporanea:
   ```bash
   .venv/bin/uvicorn main:app --host 127.0.0.1 --port 19998 &
   APP_PID=$!
   sleep 2
   ```

3. Verifica la risposta su `/api/auth-status`:
   ```bash
   curl -sf http://127.0.0.1:19998/api/auth-status
   ```
   - Se risponde con JSON (es. `{"authenticated": false}`): successo.
   - Se fallisce: riporta l'errore e passa al punto 5.

4. Verifica che le route statiche rispondano:
   ```bash
   curl -sf -o /dev/null -w "%{http_code}" http://127.0.0.1:19998/
   ```
   - Atteso: `200`.

5. Ferma il processo:
   ```bash
   kill $APP_PID 2>/dev/null
   ```

6. Riporta il risultato:
   - Se tutto ok: "Validation passed: app avviata, /api/auth-status risponde, static files OK."
   - Se fallisce: mostra l'output di errore e suggerisci `make install` o controllo delle dipendenze.
