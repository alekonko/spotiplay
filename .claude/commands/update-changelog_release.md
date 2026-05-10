Aggiorna CHANGELOG.md promuovendo [Unreleased] alla versione $ARGUMENTS.

Steps:
1. Esegui `git describe --tags --abbrev=0 2>/dev/null || echo ""` per trovare l'ultimo tag.
2. Se il tag esiste: `git log <tag>..HEAD --pretty=format:"%s"` per i commit recenti.
   Se non esiste: `git log --pretty=format:"%s"`.
3. Esegui `date +%Y-%m-%d` per la data odierna.
4. Leggi CHANGELOG.md.
5. Edita CHANGELOG.md:
   - Sposta il contenuto della sezione [Unreleased] in una nuova sezione `## [$ARGUMENTS] - <data>`.
   - Ricrea una sezione `## [Unreleased]` vuota in cima (subito dopo `# Changelog`).
   - Mantieni il formato Keep a Changelog esistente nel file.
   - Non duplicare voci già presenti in [Unreleased].
   - Aggiungi tra le voci della nuova sezione i commit recuperati che non siano già coperti.
6. Modifica solo CHANGELOG.md.
7. Chiedi all'utente se vuole committare e pushare sul repo.
