Esegui la checklist pre-release per SpotiPlay prima di promuovere [Unreleased] a una versione.

Esegui i controlli in ordine. Fermati al primo fallimento e indica cosa correggere.

## Checks

### 1. Avvio app
Avvia l'app in background e verifica che risponda:
```bash
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 19998 &
APP_PID=$!
sleep 2
curl -sf http://127.0.0.1:19998/api/auth-status
kill $APP_PID 2>/dev/null
```
Se fallisce: riporta l'errore e stop. Non procedere.

### 2. Sezione [Unreleased]
Leggi `CHANGELOG.md`. Verifica che la sezione `[Unreleased]` contenga almeno una voce.

Se è vuota o mancante: riporta "CHANGELOG.md [Unreleased] è vuoto — esegui /update-changelog_unreleased prima" e stop.

### 3. Git status
```bash
git status --porcelain
```
Se ci sono modifiche non committate: elencale e avvisa l'utente. Questo è un avviso, non uno stop bloccante.

### 4. Versione corrente
Leggi `build_counter.txt` per mostrare il numero di build corrente. Mostra qual è la prossima versione (N+1 → `v1.0.<N+1>`).

## Summary

Se tutti i controlli bloccanti passano, stampa:

```
## Pre-release Checklist

✅ App si avvia e risponde su /api/auth-status
✅ CHANGELOG.md [Unreleased] ha voci
✅ (o ⚠️) Working tree pulito

Versione corrente : v1.0.<N>
Prossima versione : v1.0.<N+1>

Pronto per la release. Esegui `make release` per procedere.
```

NON eseguire `make release` automaticamente. L'utente deve farlo manualmente.
