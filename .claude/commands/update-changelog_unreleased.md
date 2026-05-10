Aggiorna solo la sezione [Unreleased] di CHANGELOG.md con i commit recenti.

Steps:
1. Esegui `git describe --tags --abbrev=0 2>/dev/null || echo ""` per trovare l'ultimo tag.
2. Se il tag esiste: `git log <tag>..HEAD --pretty=format:"%s"` per i commit recenti.
   Se non esiste: `git log --pretty=format:"%s"`.
3. Leggi CHANGELOG.md.
4. Edita CHANGELOG.md:
   - Aggiungi i commit pertinenti nella sezione [Unreleased], seguendo il formato Keep a Changelog esistente nel file.
   - NON promuovere a versione numerata.
   - NON modificare sezioni versionate esistenti.
   - Non duplicare voci già presenti in [Unreleased].
5. Modifica solo CHANGELOG.md.
6. Chiedi all'utente se vuole committare e pushare sul repo.
