Esegui i test unitari di SpotiPlay e, se ci sono fallimenti, analizza e correggi automaticamente.

## Steps

1. Installa le dipendenze di test se non presenti:
   ```bash
   ls .venv/bin/pytest 2>/dev/null || make install-dev
   ```

2. Esegui i test:
   ```bash
   make test
   ```

3. **Se tutti i test passano**: riporta "✅ Tutti i test passano" e fermati.

4. **Se ci sono fallimenti**:
   a. Analizza l'output di pytest: identifica il test fallito, il file, la riga, il messaggio di errore.
   b. Leggi la route corrispondente in `main.py`.
   c. Leggi il test fallito in `tests/test_routes.py`.
   d. Determina se il problema è nel test (aspettativa sbagliata) o nel codice (`main.py`).
   e. Proponi la fix con spiegazione e applicala.
   f. Ri-esegui `make test` per conferma.
   g. Se ancora fallisce, ripeti da (a) per un massimo di 3 iterazioni.

## Regole

- Preferisci sempre correggere `main.py` se la logica è sbagliata.
- Correggi il test solo se l'aspettativa è chiaramente errata (es. HTTP status code sbagliato nel mock).
- Non modificare `conftest.py` senza prima capire l'impatto su tutti i test.
- Dopo ogni fix, spiega brevemente cosa era sbagliato e perché.
