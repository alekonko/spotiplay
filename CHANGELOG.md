# Changelog

All notable changes to SpotiPlay will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v1.0.2] - 2026-05-11

### Added
- Sezione **Libreria**: visualizza tutti i brani salvati con campi estesi (popolarità, anno, durata, esplicito, data aggiunta, ISRC), ordinabile per colonna e filtrabile per titolo/artista
- Sezione **Statistiche**: tabella degli ultimi 50 ascolti recenti con timestamp e grafico a barre dei brani più frequenti (Chart.js)
- **Esportazione CSV** della libreria (`/api/library/export.csv`) con tutti i campi principali
- **Cache su file** (`./cache/`) per top-tracks (5 min), playlists (5 min), libreria (10 min) e recently-played (3 min); invalidata al logout
- Parametro `?refresh=true` su ogni endpoint API per forzare il rinnovo della cache
- Pulsante "↻ Aggiorna" in Libreria e Statistiche per refresh manuale
- Nuovo scope OAuth `user-read-recently-played`

## [v1.0.1] - 2026-05-11

### Added
- Makefile, Docker, K8s manifests, test suite and diagnostic tooling

