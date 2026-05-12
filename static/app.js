'use strict';

// ═══════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════

const state = {
  user: null,
  topTracks: [],
  filteredTracks: [],
  topTracksView: 'grid',   // 'list' | 'grid'
  playlists: [],
  selectedUris: new Set(),
  timeRange: 'medium_term',
  artistFilter: '',
  genreFilter: '',
  genresByArtistId: {},
  currentPlaylist: null,
  currentPlaylistTracks: [],
  playlistEditMode: false,
  playlistSelectedUris: new Set(),
  // Library
  library: [],
  libraryFiltered: [],
  libraryFilter: '',
  libraryArtistFilter: '',
  libraryDecadeFilter: '',
  libraryExplicitFilter: '',
  libraryPopMin: 0,
  libraryDurMin: null,
  libraryDurMax: null,
  librarySource: 'saved',
  librarySort: { field: 'added_at', dir: 'desc' },
  libraryLoaded: false,
  librarySelectedUris: new Set(),
  // Shared modal
  pendingUris: [],
  // Stats
  recentlyPlayed: [],
  statsLoaded: false,
  freqChart: null,
  hourlyChart: null,
  artistsChart: null,
};

// ═══════════════════════════════════════════════════
//  Loading overlay
// ═══════════════════════════════════════════════════

let _loadingTimer = null;

function showLoading(msg = 'Caricamento…') {
  clearTimeout(_loadingTimer);
  document.getElementById('loading-message').textContent = msg;
  document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
  clearTimeout(_loadingTimer);
  _loadingTimer = setTimeout(() => document.getElementById('loading-overlay').classList.add('hidden'), 150);
}

// ═══════════════════════════════════════════════════
//  API
// ═══════════════════════════════════════════════════

async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (resp.status === 401) { window.location.href = '/login'; return null; }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  return resp.status === 204 ? null : resp.json();
}

const apiGet    = (path, params = {}) => { const qs = new URLSearchParams(params).toString(); return api(qs ? `${path}?${qs}` : path); };
const apiPost   = (path, body) => api(path, { method: 'POST',   body: JSON.stringify(body) });
const apiDelete = (path, body) => api(path, { method: 'DELETE', body: JSON.stringify(body) });

// ═══════════════════════════════════════════════════
//  Toast
// ═══════════════════════════════════════════════════

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : '✕'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 200); }, 3500);
}

// ═══════════════════════════════════════════════════
//  Utils
// ═══════════════════════════════════════════════════

function formatDuration(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatDurationLong(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getArtistNames(track) { return track.artists.map(a => a.name).join(', '); }

function getAlbumImage(track, size = 40) {
  const images = track.album?.images;
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => a.width - b.width);
  return (sorted.find(i => i.width >= size) || sorted[sorted.length - 1]).url;
}

function formatDatetime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDate(iso) { return iso ? iso.slice(0, 10) : ''; }

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function populateSelect(selectId, options, currentValue, defaultLabel) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = `<option value="">${defaultLabel}</option>` +
    options.map(o => `<option value="${escapeHtml(o)}"${o === currentValue ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('');
}

function popBar(n) {
  return `<span class="pop-bar" title="Popolarità: ${n}"><span style="width:${n}%"></span></span>`;
}

// ═══════════════════════════════════════════════════
//  Top Tracks — genre loading
// ═══════════════════════════════════════════════════

function getTrackGenres(track) {
  const genres = new Set();
  track.artists.forEach(a => (state.genresByArtistId[a.id] || []).forEach(g => genres.add(g)));
  return genres;
}

function applyTopTracksFilters() {
  let tracks = [...state.topTracks];
  if (state.artistFilter) tracks = tracks.filter(t => t.artists.some(a => a.name === state.artistFilter));
  if (state.genreFilter)  tracks = tracks.filter(t => getTrackGenres(t).has(state.genreFilter));
  state.filteredTracks = tracks;
}

function populateTopTracksSelects() {
  const artists = [...new Set(state.topTracks.flatMap(t => t.artists.map(a => a.name)))].sort((a, b) => a.localeCompare(b));
  populateSelect('artist-filter', artists, state.artistFilter, 'Tutti gli artisti');
  const genres = [...new Set(state.topTracks.flatMap(t => [...getTrackGenres(t)]))].sort((a, b) => a.localeCompare(b));
  populateSelect('genre-filter', genres, state.genreFilter, genres.length ? 'Tutti i generi' : 'Generi non disponibili');
}

async function loadTopTracksGenres() {
  const ids = [...new Set(state.topTracks.flatMap(t => t.artists.map(a => a.id)))].filter(id => !(id in state.genresByArtistId));
  if (!ids.length) return;
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const data = await apiGet('/api/artists/genres', { ids: ids.slice(i, i + 50).join(',') });
      if (data) Object.assign(state.genresByArtistId, data);
    }
  } catch { /* optional */ }
}

// ═══════════════════════════════════════════════════
//  Render: Top Tracks (list + grid)
// ═══════════════════════════════════════════════════

function renderTopTracks() {
  const container = document.getElementById('tracks-container');
  if (!state.filteredTracks.length) {
    container.innerHTML = `<div class="empty-state"><h3>Nessun brano trovato</h3><p>${state.artistFilter || state.genreFilter ? 'Prova con un altro filtro.' : 'Nessun dato disponibile.'}</p></div>`;
    updateSelectionBar();
    return;
  }
  state.topTracksView === 'grid' ? renderTopTracksGrid(container) : renderTopTracksList(container);
  updateSelectionBar();
}

function renderTopTracksList(container) {
  const items = state.filteredTracks.map(track => {
    const img  = getAlbumImage(track, 52);
    const sel  = state.selectedUris.has(track.uri);
    const rank = state.topTracks.indexOf(track) + 1;
    const explicit = track.explicit ? '<span class="explicit-badge">E</span>' : '';
    const album = track.album?.name || '';
    const year  = (track.album?.release_date || '').slice(0, 4);
    const pop   = track.popularity;
    return `
      <div class="track-row ${sel ? 'selected' : ''}" data-uri="${track.uri}">
        <input type="checkbox" ${sel ? 'checked' : ''} aria-label="Seleziona ${escapeHtml(track.name)}" />
        <span class="track-rank">${rank}</span>
        ${img ? `<img class="track-img track-img-lg" src="${img}" alt="" loading="lazy" />` : `<div class="track-img track-img-lg"></div>`}
        <div class="track-info">
          <div class="track-name">${escapeHtml(track.name)} ${explicit}</div>
          <div class="track-artist">${escapeHtml(getArtistNames(track))}</div>
          <div class="track-album-line">${escapeHtml(album)}${year ? ` · ${year}` : ''}</div>
        </div>
        <div class="track-meta">
          <span class="track-duration">${formatDuration(track.duration_ms)}</span>
          <div class="track-pop-row">
            <span class="pop-bar"><span style="width:${pop}%"></span></span>
            <span class="pop-num">${pop}</span>
          </div>
        </div>
      </div>`;
  }).join('');
  container.innerHTML = `<div class="tracks-list">${items}</div>`;
  container.querySelectorAll('.track-row').forEach(row => {
    row.addEventListener('click', e => { if (e.target.tagName !== 'A') toggleTrackSelection(row.dataset.uri); });
  });
}

function renderTopTracksGrid(container) {
  const items = state.filteredTracks.map(track => {
    const img = getAlbumImage(track, 200);
    const sel = state.selectedUris.has(track.uri);
    const rank = state.topTracks.indexOf(track) + 1;
    const explicit = track.explicit ? '<span class="explicit-badge">E</span>' : '';
    return `
      <div class="track-card ${sel ? 'selected' : ''}" data-uri="${track.uri}">
        <div class="track-card-img-wrap">
          ${img ? `<img src="${img}" alt="" loading="lazy" />` : `<div class="track-card-img-placeholder">♪</div>`}
          <span class="track-card-rank">${rank}</span>
          <input type="checkbox" class="track-card-check" ${sel ? 'checked' : ''} aria-label="Seleziona ${escapeHtml(track.name)}" />
        </div>
        <div class="track-card-info">
          <div class="track-card-name">${escapeHtml(track.name)} ${explicit}</div>
          <div class="track-card-artist">${escapeHtml(getArtistNames(track))}</div>
          <div class="track-card-meta">${popBar(track.popularity)}<span>${formatDuration(track.duration_ms)}</span></div>
        </div>
      </div>`;
  }).join('');
  container.innerHTML = `<div class="tracks-grid">${items}</div>`;
  container.querySelectorAll('.track-card').forEach(card => {
    card.addEventListener('click', e => { if (e.target.tagName !== 'A') toggleTrackSelection(card.dataset.uri); });
  });
}

function toggleTrackSelection(uri) {
  state.selectedUris.has(uri) ? state.selectedUris.delete(uri) : state.selectedUris.add(uri);
  renderTopTracks();
}

function updateSelectionBar() {
  const n = state.selectedUris.size;
  document.getElementById('selected-count').textContent = n;
  document.getElementById('selection-bar').classList.toggle('hidden', n === 0);
  document.getElementById('add-to-playlist-btn').disabled = n === 0;
}

async function loadTopTracks(refresh = false) {
  showLoading('Caricamento brani più ascoltati…');
  document.getElementById('tracks-container').innerHTML = '<div class="loader">Caricamento brani…</div>';
  state.selectedUris.clear();
  state.artistFilter = '';
  state.genreFilter = '';
  try {
    const data = await apiGet('/api/top-tracks', { time_range: state.timeRange, limit: 50, refresh });
    if (!data) return;
    state.topTracks = data.items || [];
    applyTopTracksFilters();
    populateTopTracksSelects();
    renderTopTracks();
    if (state.librarySource === 'top') { populateLibraryArtistSelect(); applyLibraryFilter(); renderLibrary(); }
    loadTopTracksGenres().then(() => populateTopTracksSelects());
  } catch (err) {
    document.getElementById('tracks-container').innerHTML = `<div class="empty-state"><h3>Errore</h3><p>${err.message}</p></div>`;
  } finally { hideLoading(); }
}

// ═══════════════════════════════════════════════════
//  Playlists grid
// ═══════════════════════════════════════════════════

function renderPlaylists() {
  const container = document.getElementById('playlists-container');
  if (!state.playlists.length) { container.innerHTML = '<div class="empty-state"><h3>Nessuna playlist trovata</h3></div>'; return; }
  const items = state.playlists.map(pl => {
    const img = pl.images?.[0]?.url;
    return `
      <div class="playlist-card" data-id="${pl.id}" data-name="${pl.name}">
        ${img ? `<img class="playlist-card-img" src="${img}" alt="${escapeHtml(pl.name)}" loading="lazy" />` : `<div class="playlist-card-img-placeholder">♪</div>`}
        <div class="playlist-card-name">${escapeHtml(pl.name)}</div>
        <div class="playlist-card-count">
          ${pl.tracks?.total ?? 0} brani
          ${pl._duration_ms ? `· ${formatDurationLong(pl._duration_ms)}` : ''}
        </div>
      </div>`;
  }).join('');
  container.innerHTML = `<div class="playlists-grid">${items}</div>`;
  container.querySelectorAll('.playlist-card').forEach(card => {
    card.addEventListener('click', () => openPlaylistDetail(card.dataset.id, card.dataset.name));
  });
}

async function loadPlaylists(refresh = false) {
  document.getElementById('playlists-container').innerHTML = '<div class="loader">Caricamento playlist…</div>';
  try {
    const data = await apiGet('/api/playlists', refresh ? { refresh: true } : {});
    if (!data) return;
    state.playlists = data.items || [];
    renderPlaylists();
  } catch (err) {
    document.getElementById('playlists-container').innerHTML = `<div class="empty-state"><h3>Errore</h3><p>${err.message}</p></div>`;
  }
}

// ═══════════════════════════════════════════════════
//  Playlist detail
// ═══════════════════════════════════════════════════

async function openPlaylistDetail(playlistId, playlistName) {
  const playlist = state.playlists.find(p => p.id === playlistId);
  state.currentPlaylist = playlist;
  state.playlistEditMode = false;
  state.playlistSelectedUris.clear();

  document.getElementById('playlist-edit-toggle').checked = false;
  document.getElementById('detail-edit-bar').classList.add('hidden');
  document.getElementById('playlists-container').classList.add('hidden');
  document.getElementById('playlist-detail').classList.remove('hidden');

  document.getElementById('detail-name').textContent = playlistName;
  document.getElementById('detail-count').textContent = '';
  document.getElementById('detail-tracks-container').innerHTML = '<div class="loader">Caricamento brani…</div>';

  const img = playlist?.images?.[0]?.url;
  const coverEl = document.getElementById('detail-cover');
  coverEl.src = img || ''; coverEl.classList.toggle('hidden', !img);

  try {
    const data = await apiGet(`/api/playlists/${playlistId}/tracks`);
    if (!data) return;
    state.currentPlaylistTracks = data.items || [];
    const realCount = data.total;
    const totalMs = (data.items || []).reduce((s, item) => s + (item.track?.duration_ms || 0), 0);

    // Patch count + duration into state so the grid stays updated
    const pl = state.playlists.find(p => p.id === playlistId);
    if (pl) {
      pl.tracks = pl.tracks || {};
      pl.tracks.total = realCount;
      pl._duration_ms = totalMs;
    }

    document.getElementById('detail-count').textContent =
      `${realCount} brani · ${formatDurationLong(totalMs)}`;
    renderPlaylistDetail(playlistId);
  } catch (err) {
    document.getElementById('detail-tracks-container').innerHTML = `<div class="empty-state"><h3>Errore</h3><p>${err.message}</p></div>`;
  }
}

function renderPlaylistDetail(playlistId) {
  const container = document.getElementById('detail-tracks-container');
  const items = state.currentPlaylistTracks;
  const editMode = state.playlistEditMode;

  if (!items.length) { container.innerHTML = '<div class="empty-state"><h3>Playlist vuota</h3></div>'; return; }

  const rows = items.map((item, idx) => {
    const track = item.track;
    if (!track) return '';
    const img = getAlbumImage(track, 40);
    const sel = state.playlistSelectedUris.has(track.uri);
    const explicit = track.explicit ? '<span class="explicit-badge">E</span>' : '';
    const year = (track.album?.release_date || '').slice(0, 4);
    return `
      <div class="detail-track-row ${editMode && sel ? 'selected' : ''}" data-uri="${track.uri}">
        ${editMode ? `<input type="checkbox" class="pl-row-check" ${sel ? 'checked' : ''} />` : `<span class="track-rank">${idx + 1}</span>`}
        ${img ? `<img class="track-img" src="${img}" alt="" loading="lazy" />` : `<div class="track-img"></div>`}
        <div class="track-info">
          <div class="track-name">${escapeHtml(track.name)} ${explicit}</div>
          <div class="track-artist">${escapeHtml(getArtistNames(track))}</div>
          <div class="track-album-line">${escapeHtml(track.album?.name || '')}${year ? ` · ${year}` : ''}</div>
        </div>
        <div class="track-meta">
          ${popBar(track.popularity)}
          <span class="track-duration">${formatDuration(track.duration_ms)}</span>
        </div>
        ${!editMode ? `<button class="remove-track-btn" data-uri="${track.uri}" title="Rimuovi dalla playlist">✕</button>` : ''}
      </div>`;
  }).join('');

  container.innerHTML = `<div class="tracks-list">${rows}</div>`;

  if (editMode) {
    container.querySelectorAll('.pl-row-check').forEach(cb => {
      cb.addEventListener('change', e => {
        e.stopPropagation();
        const uri = cb.closest('.detail-track-row').dataset.uri;
        cb.checked ? state.playlistSelectedUris.add(uri) : state.playlistSelectedUris.delete(uri);
        cb.closest('.detail-track-row').classList.toggle('selected', cb.checked);
        updatePlaylistEditBar();
      });
    });
    container.querySelectorAll('.detail-track-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.tagName === 'INPUT') return;
        const cb = row.querySelector('.pl-row-check');
        cb.checked = !cb.checked;
        const uri = row.dataset.uri;
        cb.checked ? state.playlistSelectedUris.add(uri) : state.playlistSelectedUris.delete(uri);
        row.classList.toggle('selected', cb.checked);
        updatePlaylistEditBar();
      });
    });
  } else {
    container.querySelectorAll('.remove-track-btn').forEach(btn => {
      btn.addEventListener('click', () => removeTrackFromCurrentPlaylist(playlistId, btn.dataset.uri));
    });
  }
}

function updatePlaylistEditBar() {
  const n = state.playlistSelectedUris.size;
  document.getElementById('detail-selected-count').textContent = n;
  document.getElementById('detail-remove-btn').disabled = n === 0;
}

async function removeTrackFromCurrentPlaylist(playlistId, uri) {
  try {
    await apiDelete(`/api/playlists/${playlistId}/tracks`, { uris: [uri] });
    state.currentPlaylistTracks = state.currentPlaylistTracks.filter(item => item.track?.uri !== uri);
    document.getElementById('detail-count').textContent = `${state.currentPlaylistTracks.length} brani`;
    renderPlaylistDetail(playlistId);
    showToast('Brano rimosso dalla playlist');
    loadPlaylists();
  } catch (err) { showToast(`Errore: ${err.message}`, 'error'); }
}

async function removeSelectedFromPlaylist() {
  const playlistId = state.currentPlaylist?.id;
  if (!playlistId) return;
  const uris = [...state.playlistSelectedUris];
  if (!uris.length) return;

  const btn = document.getElementById('detail-remove-btn');
  btn.disabled = true; btn.textContent = 'Rimozione…';

  try {
    await apiDelete(`/api/playlists/${playlistId}/tracks`, { uris });
    state.currentPlaylistTracks = state.currentPlaylistTracks.filter(item => !uris.includes(item.track?.uri));
    state.playlistSelectedUris.clear();
    document.getElementById('detail-count').textContent = `${state.currentPlaylistTracks.length} brani`;
    renderPlaylistDetail(playlistId);
    updatePlaylistEditBar();
    showToast(`${uris.length} brani rimossi dalla playlist`);
    loadPlaylists();
  } catch (err) { showToast(`Errore: ${err.message}`, 'error'); }
  finally { btn.disabled = false; btn.textContent = '✕ Rimuovi selezionati'; }
}

function closePlaylistDetail() {
  document.getElementById('playlist-detail').classList.add('hidden');
  document.getElementById('playlists-container').classList.remove('hidden');
  state.currentPlaylist = null;
  state.currentPlaylistTracks = [];
  state.playlistEditMode = false;
  state.playlistSelectedUris.clear();
  renderPlaylists(); // refresh grid with patched counts/durations
}

// ═══════════════════════════════════════════════════
//  Library — source & normalization
// ═══════════════════════════════════════════════════

function normalizeTopTrackForLibrary(track, rank) {
  const album = track.album || {};
  const images = [...(album.images || [])].sort((a, b) => a.width - b.width);
  const image = (images.find(i => i.width >= 40) || images[images.length - 1])?.url || '';
  return {
    name: track.name, artists: getArtistNames(track), artist_ids: track.artists.map(a => a.id),
    album: album.name || '', year: (album.release_date || '').slice(0, 4),
    duration_ms: track.duration_ms, explicit: track.explicit, popularity: track.popularity,
    added_at: '', rank, uri: track.uri, image,
  };
}

function getLibrarySource() {
  return state.librarySource === 'top'
    ? state.topTracks.map((t, i) => normalizeTopTrackForLibrary(t, i + 1))
    : state.library;
}

function switchLibrarySource(source) {
  state.librarySource = source;
  state.libraryArtistFilter = '';
  state.librarySelectedUris.clear();
  document.querySelectorAll('.lib-source-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.source === source));
  const artistSel = document.getElementById('library-artist-filter');
  if (artistSel) artistSel.value = '';
  updateLibrarySelectionBar();
  if (source === 'saved' && !state.libraryLoaded) { loadLibrary(); return; }
  populateLibraryArtistSelect();
  applyLibraryFilter();
  renderLibrary();
}

// ═══════════════════════════════════════════════════
//  Library — filter, sort, render
// ═══════════════════════════════════════════════════

const LIBRARY_COLS_SAVED = [
  { field: 'name',       label: 'Titolo',   sortable: true },
  { field: 'artists',    label: 'Artista',  sortable: true },
  { field: 'album',      label: 'Album',    sortable: true },
  { field: 'year',       label: 'Anno',     sortable: true },
  { field: 'duration_ms',label: 'Durata',   sortable: true },
  { field: 'popularity', label: 'Pop.',     sortable: true },
  { field: 'explicit',   label: 'E',        sortable: false },
  { field: 'added_at',   label: 'Aggiunto', sortable: true },
];
const LIBRARY_COLS_TOP = [
  { field: 'name',       label: 'Titolo',   sortable: true },
  { field: 'artists',    label: 'Artista',  sortable: true },
  { field: 'album',      label: 'Album',    sortable: true },
  { field: 'year',       label: 'Anno',     sortable: true },
  { field: 'duration_ms',label: 'Durata',   sortable: true },
  { field: 'popularity', label: 'Pop.',     sortable: true },
  { field: 'explicit',   label: 'E',        sortable: false },
  { field: 'rank',       label: '#',        sortable: true },
];

function applyLibraryFilter() {
  const source = getLibrarySource();
  const q      = state.libraryFilter.toLowerCase().trim();
  const artist = state.libraryArtistFilter;
  const decade = state.libraryDecadeFilter;
  const explicitF = state.libraryExplicitFilter;
  const popMin = state.libraryPopMin;
  const durMin = state.libraryDurMin != null ? state.libraryDurMin * 60000 : null;
  const durMax = state.libraryDurMax != null ? state.libraryDurMax * 60000 : null;

  state.libraryFiltered = source.filter(t => {
    if (q && !t.name.toLowerCase().includes(q) && !t.artists.toLowerCase().includes(q)) return false;
    if (artist && !t.artists.split(', ').includes(artist)) return false;
    if (decade && !(t.year || '').startsWith(decade)) return false;
    if (explicitF === 'explicit' && !t.explicit) return false;
    if (explicitF === 'clean'    && t.explicit)  return false;
    if (t.popularity < popMin) return false;
    if (durMin != null && t.duration_ms < durMin) return false;
    if (durMax != null && t.duration_ms > durMax) return false;
    return true;
  });
  sortLibrary();
}

function sortLibrary() {
  const { field, dir } = state.librarySort;
  state.libraryFiltered.sort((a, b) => {
    let va = a[field] ?? '', vb = b[field] ?? '';
    if (['duration_ms', 'popularity', 'rank'].includes(field)) { va = Number(va); vb = Number(vb); }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function populateLibraryArtistSelect() {
  const source = getLibrarySource();
  const artists = [...new Set(source.flatMap(t => t.artists.split(', ').map(a => a.trim())))].filter(Boolean).sort((a, b) => a.localeCompare(b));
  populateSelect('library-artist-filter', artists, state.libraryArtistFilter, 'Tutti gli artisti');
}

function populateLibraryDecadeSelect() {
  const source = getLibrarySource();
  const decades = [...new Set(source.map(t => t.year ? t.year.slice(0, 3) + '0' : null).filter(Boolean))].sort().reverse();
  populateSelect('library-decade-filter', decades, state.libraryDecadeFilter, 'Tutte');
}

function resetLibraryFilters() {
  state.libraryFilter = '';
  state.libraryArtistFilter = '';
  state.libraryDecadeFilter = '';
  state.libraryExplicitFilter = '';
  state.libraryPopMin = 0;
  state.libraryDurMin = null;
  state.libraryDurMax = null;

  const el = id => document.getElementById(id);
  el('library-filter').value = '';
  el('clear-library-filter').classList.add('hidden');
  el('library-artist-filter').value = '';
  el('library-decade-filter').value = '';
  el('library-explicit-filter').value = '';
  el('library-pop-filter').value = 0;
  el('library-pop-value').textContent = 0;
  el('library-dur-min').value = '';
  el('library-dur-max').value = '';
}

function renderLibrary() {
  const container = document.getElementById('library-container');
  const countEl   = document.getElementById('library-count');
  const source  = getLibrarySource();
  const isTop   = state.librarySource === 'top';
  const COLS    = isTop ? LIBRARY_COLS_TOP : LIBRARY_COLS_SAVED;
  const filterActive = state.libraryFilter || state.libraryArtistFilter || state.libraryDecadeFilter || state.libraryExplicitFilter || state.libraryPopMin > 0 || state.libraryDurMin || state.libraryDurMax;
  countEl.textContent = filterActive
    ? `${state.libraryFiltered.length} su ${source.length} ${isTop ? 'brani più ascoltati' : 'brani in libreria'}`
    : `${state.libraryFiltered.length} ${isTop ? 'brani più ascoltati' : 'brani in libreria'}`;

  if (!state.libraryFiltered.length) { container.innerHTML = `<div class="empty-state"><h3>Nessun brano trovato</h3></div>`; return; }

  const { field: sortField, dir: sortDir } = state.librarySort;
  const headerCells = [
    `<th class="lib-th lib-th-check"><input type="checkbox" id="lib-select-all" title="Seleziona/deseleziona tutti i visibili" /></th>`,
    ...COLS.map(col => {
      if (!col.sortable) return `<th class="lib-th">${col.label}</th>`;
      const active = sortField === col.field;
      return `<th class="lib-th sortable${active ? ' sort-active' : ''}" data-field="${col.field}">${col.label}${active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`;
    }),
    `<th class="lib-th lib-th-actions"></th>`,
  ].join('');

  const rows = state.libraryFiltered.map(t => {
    const dur = formatDuration(t.duration_ms);
    const lastCol = isTop ? `#${t.rank}` : formatDate(t.added_at);
    const explicitBadge = t.explicit ? '<span class="explicit-badge">E</span>' : '';
    const img = t.image ? `<img class="lib-thumb" src="${t.image}" alt="" loading="lazy" />` : `<div class="lib-thumb"></div>`;
    const checked = state.librarySelectedUris.has(t.uri) ? ' checked' : '';
    return `
      <tr class="${state.librarySelectedUris.has(t.uri) ? 'lib-row-selected' : ''}" data-uri="${escapeHtml(t.uri)}">
        <td class="lib-td lib-td-check"><input type="checkbox" class="lib-row-check"${checked} /></td>
        <td class="lib-td lib-td-title"><div class="lib-title-cell">${img}<div class="track-info"><div class="track-name">${escapeHtml(t.name)}</div></div></div></td>
        <td class="lib-td">${escapeHtml(t.artists)}</td>
        <td class="lib-td">${escapeHtml(t.album)}</td>
        <td class="lib-td lib-td-num">${t.year}</td>
        <td class="lib-td lib-td-num">${dur}</td>
        <td class="lib-td lib-td-pop"><span class="pop-bar"><span style="width:${t.popularity}%"></span></span>${t.popularity}</td>
        <td class="lib-td lib-td-center">${explicitBadge}</td>
        <td class="lib-td lib-td-num">${lastCol}</td>
        <td class="lib-td lib-td-actions"><button class="quick-add-btn" data-uri="${escapeHtml(t.uri)}" title="Aggiungi a playlist">+</button></td>
      </tr>`;
  }).join('');

  container.innerHTML = `<div class="lib-table-wrap"><table class="lib-table"><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table></div>`;

  container.querySelectorAll('.lib-th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const f = th.dataset.field;
      state.librarySort.dir = state.librarySort.field === f ? (state.librarySort.dir === 'asc' ? 'desc' : 'asc') : 'asc';
      state.librarySort.field = f;
      sortLibrary(); renderLibrary();
    });
  });

  const selectAllCb = container.querySelector('#lib-select-all');
  selectAllCb.addEventListener('change', () => {
    state.libraryFiltered.forEach(t => selectAllCb.checked ? state.librarySelectedUris.add(t.uri) : state.librarySelectedUris.delete(t.uri));
    renderLibrary(); updateLibrarySelectionBar();
  });

  container.querySelectorAll('.lib-row-check').forEach(cb => {
    cb.addEventListener('change', e => {
      e.stopPropagation();
      const uri = cb.closest('tr').dataset.uri;
      cb.checked ? state.librarySelectedUris.add(uri) : state.librarySelectedUris.delete(uri);
      cb.closest('tr').classList.toggle('lib-row-selected', cb.checked);
      updateLibrarySelectionBar();
    });
  });

  container.querySelectorAll('.quick-add-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openQuickAddDropdown(btn, btn.dataset.uri); });
  });
}

function updateLibrarySelectionBar() {
  const n = state.librarySelectedUris.size;
  document.getElementById('library-selected-count').textContent = n;
  document.getElementById('library-selection-bar').classList.toggle('hidden', n === 0);
}

async function loadLibrary(refresh = false) {
  if (state.librarySource === 'top') { switchLibrarySource('top'); return; }
  showLoading('Caricamento libreria…');
  document.getElementById('library-container').innerHTML = '<div class="loader">Caricamento libreria…</div>';
  document.getElementById('library-count').textContent = '';
  state.librarySelectedUris.clear();
  updateLibrarySelectionBar();
  try {
    const data = await apiGet('/api/library', refresh ? { refresh: true } : {});
    if (!data) return;
    state.library = data.items || [];
    state.libraryLoaded = true;
    state.libraryArtistFilter = '';
    populateLibraryArtistSelect();
    populateLibraryDecadeSelect();
    applyLibraryFilter();
    renderLibrary();
  } catch (err) {
    document.getElementById('library-container').innerHTML = `<div class="empty-state"><h3>Errore</h3><p>${err.message}</p></div>`;
  } finally { hideLoading(); }
}

// ═══════════════════════════════════════════════════
//  Quick-add dropdown
// ═══════════════════════════════════════════════════

let _quickAddUri = null;

function openQuickAddDropdown(btn, uri) {
  const dropdown = document.getElementById('quick-add-dropdown');
  if (_quickAddUri === uri && !dropdown.classList.contains('hidden')) { closeQuickAddDropdown(); return; }
  _quickAddUri = uri;

  const userId  = state.user?.id;
  const editable = state.playlists.filter(pl => pl.owner?.id === userId || pl.collaborative);
  const listEl  = document.getElementById('quick-add-list');

  listEl.innerHTML = editable.length
    ? editable.map(pl => `
        <div class="quick-add-item" data-id="${pl.id}">
          ${pl.images?.[0]?.url ? `<img src="${pl.images[0].url}" alt="" />` : `<div class="quick-add-item-img">♪</div>`}
          <span>${escapeHtml(pl.name)}</span>
        </div>`).join('')
    : '<div class="quick-add-empty">Nessuna playlist disponibile</div>';

  listEl.querySelectorAll('.quick-add-item').forEach(item => {
    item.addEventListener('click', async () => {
      const playlistId = item.dataset.id;
      closeQuickAddDropdown();
      try {
        await apiPost(`/api/playlists/${playlistId}/tracks`, { uris: [uri] });
        showToast(`Aggiunto a "${state.playlists.find(p => p.id === playlistId)?.name}"`);
        loadPlaylists();
      } catch (err) { showToast(`Errore: ${err.message}`, 'error'); }
    });
  });

  const rect = btn.getBoundingClientRect();
  dropdown.style.top  = `${rect.bottom + window.scrollY + 4}px`;
  dropdown.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 240)}px`;
  dropdown.classList.remove('hidden');
}

function closeQuickAddDropdown() {
  document.getElementById('quick-add-dropdown').classList.add('hidden');
  _quickAddUri = null;
}

// ═══════════════════════════════════════════════════
//  Stats
// ═══════════════════════════════════════════════════

function renderStatsSummary() {
  const el = document.getElementById('stats-summary');
  if (!state.topTracks.length && !state.recentlyPlayed.length) { el.classList.add('hidden'); return; }
  const uniqueArtists = new Set(state.topTracks.flatMap(t => t.artists.map(a => a.name))).size;
  const totalMs = state.topTracks.reduce((s, t) => s + t.duration_ms, 0);
  const avgPop  = state.topTracks.length ? Math.round(state.topTracks.reduce((s, t) => s + t.popularity, 0) / state.topTracks.length) : 0;
  const explicitPct = state.topTracks.length ? Math.round(state.topTracks.filter(t => t.explicit).length / state.topTracks.length * 100) : 0;
  el.innerHTML = `
    <div class="stat-chip"><span class="stat-chip-val">${state.topTracks.length}</span><span class="stat-chip-lbl">brani top</span></div>
    <div class="stat-chip"><span class="stat-chip-val">${uniqueArtists}</span><span class="stat-chip-lbl">artisti unici</span></div>
    <div class="stat-chip"><span class="stat-chip-val">${formatDurationLong(totalMs)}</span><span class="stat-chip-lbl">durata totale</span></div>
    <div class="stat-chip"><span class="stat-chip-val">${avgPop}</span><span class="stat-chip-lbl">pop. media</span></div>
    <div class="stat-chip"><span class="stat-chip-val">${explicitPct}%</span><span class="stat-chip-lbl">espliciti</span></div>
    <div class="stat-chip"><span class="stat-chip-val">${state.recentlyPlayed.length}</span><span class="stat-chip-lbl">ascolti recenti</span></div>
  `;
  el.classList.remove('hidden');
}

function renderRecentTracks() {
  const container = document.getElementById('recent-tracks-container');
  const items = state.recentlyPlayed;
  if (!items.length) { container.innerHTML = '<div class="empty-state"><h3>Nessun ascolto recente</h3></div>'; return; }
  container.innerHTML = `<div class="recent-list">${items.map(item => `
    <div class="recent-row">
      ${item.image ? `<img class="track-img" src="${item.image}" alt="" loading="lazy" />` : `<div class="track-img"></div>`}
      <div class="track-info"><div class="track-name">${escapeHtml(item.name)}</div><div class="track-artist">${escapeHtml(item.artists)}</div></div>
      <span class="recent-time">${formatDatetime(item.played_at)}</span>
    </div>`).join('')}</div>`;
}

function destroyChart(key) { if (state[key]) { state[key].destroy(); state[key] = null; } }

const chartDefaults = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
};

function renderFreqChart() {
  const canvas = document.getElementById('freq-chart'), emptyEl = document.getElementById('chart-empty');
  const freq = {}, names = {};
  state.recentlyPlayed.forEach(item => { freq[item.uri] = (freq[item.uri] || 0) + 1; names[item.uri] = item.name; });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!sorted.length) { canvas.style.display = 'none'; emptyEl.style.display = 'block'; return; }
  canvas.style.display = 'block'; emptyEl.style.display = 'none';
  destroyChart('freqChart');
  state.freqChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: sorted.map(([uri]) => { const n = names[uri]; return n.length > 28 ? n.slice(0, 26) + '…' : n; }), datasets: [{ data: sorted.map(([, c]) => c), backgroundColor: 'rgba(29,185,84,0.7)', borderColor: '#1DB954', borderWidth: 1, borderRadius: 4 }] },
    options: { ...chartDefaults, indexAxis: 'y', plugins: { ...chartDefaults.plugins, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} ascolto${ctx.parsed.x !== 1 ? 'i' : ''}` } } }, scales: { x: { ticks: { color: '#A7A7A7', stepSize: 1 }, grid: { color: '#333' }, beginAtZero: true }, y: { ticks: { color: '#fff', font: { size: 11 } }, grid: { display: false } } } },
  });
}

function renderHourlyChart() {
  const canvas = document.getElementById('hourly-chart'), emptyEl = document.getElementById('hourly-empty');
  const counts = Array(24).fill(0);
  state.recentlyPlayed.forEach(item => counts[new Date(item.played_at).getHours()]++);
  if (!counts.reduce((s, v) => s + v, 0)) { canvas.style.display = 'none'; emptyEl.style.display = 'block'; return; }
  canvas.style.display = 'block'; emptyEl.style.display = 'none';
  const max = Math.max(...counts);
  destroyChart('hourlyChart');
  state.hourlyChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: Array.from({ length: 24 }, (_, h) => `${h}:00`), datasets: [{ data: counts, backgroundColor: counts.map(v => v === max ? '#1DB954' : 'rgba(29,185,84,0.35)'), borderRadius: 3 }] },
    options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} ascolto${ctx.parsed.y !== 1 ? 'i' : ''}` } } }, scales: { x: { ticks: { color: '#A7A7A7', font: { size: 10 }, maxRotation: 0 }, grid: { display: false } }, y: { ticks: { color: '#A7A7A7', stepSize: 1 }, grid: { color: '#333' }, beginAtZero: true } } },
  });
}

function renderTopArtistsChart() {
  const canvas = document.getElementById('artists-chart'), emptyEl = document.getElementById('artists-empty');
  if (!state.topTracks.length) { canvas.style.display = 'none'; emptyEl.style.display = 'block'; return; }
  const counts = {};
  state.topTracks.forEach(t => t.artists.forEach(a => { counts[a.name] = (counts[a.name] || 0) + 1; }));
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  canvas.style.display = 'block'; emptyEl.style.display = 'none';
  destroyChart('artistsChart');
  state.artistsChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: sorted.map(([n]) => n.length > 22 ? n.slice(0, 20) + '…' : n), datasets: [{ data: sorted.map(([, c]) => c), backgroundColor: 'rgba(29,185,84,0.7)', borderColor: '#1DB954', borderWidth: 1, borderRadius: 4 }] },
    options: { ...chartDefaults, indexAxis: 'y', plugins: { ...chartDefaults.plugins, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} brano${ctx.parsed.x !== 1 ? 'i' : ''}` } } }, scales: { x: { ticks: { color: '#A7A7A7', stepSize: 1 }, grid: { color: '#333' }, beginAtZero: true }, y: { ticks: { color: '#fff', font: { size: 11 } }, grid: { display: false } } } },
  });
}

async function loadStats(refresh = false) {
  showLoading('Caricamento statistiche…');
  document.getElementById('recent-tracks-container').innerHTML = '<div class="loader">Caricamento…</div>';
  destroyChart('freqChart'); destroyChart('hourlyChart'); destroyChart('artistsChart');
  try {
    const data = await apiGet('/api/recently-played', refresh ? { refresh: true } : {});
    if (!data) return;
    state.recentlyPlayed = data.items || [];
    state.statsLoaded = true;
    renderStatsSummary(); renderRecentTracks(); renderFreqChart(); renderHourlyChart(); renderTopArtistsChart();
  } catch (err) {
    document.getElementById('recent-tracks-container').innerHTML = `<div class="empty-state"><h3>Errore</h3><p>${err.message}</p></div>`;
  } finally { hideLoading(); }
}

// ═══════════════════════════════════════════════════
//  Modal
// ═══════════════════════════════════════════════════

function openModal(title = 'Aggiungi a playlist', uris = []) {
  state.pendingUris = uris;
  document.getElementById('modal-title').textContent = title;
  showModalStep('choose');
  document.getElementById('modal-backdrop').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
  ['new-playlist-name', 'new-playlist-desc'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('new-playlist-public').checked = false;
  state.pendingUris = [];
}

function showModalStep(step) {
  ['choose', 'existing', 'new'].forEach(s => document.getElementById(`modal-step-${s}`).classList.toggle('hidden', s !== step));
}

function renderModalPlaylistList() {
  const container = document.getElementById('modal-playlist-list');
  const userId  = state.user?.id;
  const editable = state.playlists.filter(pl => pl.owner?.id === userId || pl.collaborative);
  if (!editable.length) { container.innerHTML = '<p style="color:var(--text-muted);padding:16px">Nessuna playlist modificabile.</p>'; return; }
  container.innerHTML = editable.map(pl => {
    const img = pl.images?.[0]?.url;
    return `
      <div class="modal-playlist-item" data-id="${pl.id}">
        ${img ? `<img src="${img}" alt="" />` : `<div class="modal-playlist-item-placeholder">♪</div>`}
        <div class="modal-playlist-item-info">
          <div class="modal-playlist-item-name">${escapeHtml(pl.name)}</div>
          <div class="modal-playlist-item-count">${pl.tracks?.total ?? 0} brani</div>
        </div>
      </div>`;
  }).join('');
  container.querySelectorAll('.modal-playlist-item').forEach(item => item.addEventListener('click', () => addPendingToExistingPlaylist(item.dataset.id)));
}

async function addPendingToExistingPlaylist(playlistId) {
  const uris = state.pendingUris;
  closeModal();
  try {
    await apiPost(`/api/playlists/${playlistId}/tracks`, { uris });
    const pl = state.playlists.find(p => p.id === playlistId);
    showToast(`${uris.length} brani aggiunti a "${pl?.name}"`);
    state.selectedUris.clear(); state.librarySelectedUris.clear();
    renderTopTracks(); updateLibrarySelectionBar(); loadPlaylists();
  } catch (err) { showToast(`Errore: ${err.message}`, 'error'); }
}

async function createPlaylistWithSelected() {
  const name = document.getElementById('new-playlist-name').value.trim();
  if (!name) { document.getElementById('new-playlist-name').focus(); return; }
  const desc     = document.getElementById('new-playlist-desc').value.trim();
  const isPublic = document.getElementById('new-playlist-public').checked;
  const uris     = state.pendingUris;
  const btn = document.getElementById('create-playlist-confirm');
  btn.disabled = true; btn.textContent = 'Creazione…';
  try {
    await apiPost('/api/playlists', { name, description: desc, public: isPublic, uris });
    closeModal();
    showToast(`Playlist "${name}" creata con ${uris.length} brani`);
    state.selectedUris.clear(); state.librarySelectedUris.clear();
    renderTopTracks(); updateLibrarySelectionBar(); loadPlaylists();
  } catch (err) { showToast(`Errore: ${err.message}`, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Crea e aggiungi brani'; }
}

// ═══════════════════════════════════════════════════
//  Tab switching
// ═══════════════════════════════════════════════════

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(sec => {
    sec.classList.toggle('active', sec.id === `tab-${tabName}`);
    sec.classList.toggle('hidden', sec.id !== `tab-${tabName}`);
  });
  if (tabName === 'library' && !state.libraryLoaded && state.librarySource === 'saved') loadLibrary();
  if (tabName === 'stats'   && !state.statsLoaded) loadStats();
}

// ═══════════════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════════════

async function init() {
  const status = await fetch('/api/auth-status').then(r => r.json()).catch(() => ({ authenticated: false }));
  if (!status.authenticated) { showLoginView(); return; }
  try { state.user = await apiGet('/api/me'); } catch { showLoginView(); return; }
  showAppView(); loadTopTracks(); loadPlaylists();
}

function showLoginView() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');
  const error = new URLSearchParams(window.location.search).get('error');
  if (error) { const el = document.getElementById('login-error'); el.textContent = `Accesso negato: ${error.replace(/_/g, ' ')}`; el.classList.remove('hidden'); }
}

function showAppView() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  document.getElementById('user-name').textContent = state.user.display_name || state.user.id;
  const img = state.user.images?.[0]?.url;
  if (img) { const a = document.getElementById('user-avatar'); a.src = img; a.classList.remove('hidden'); }
}

// ═══════════════════════════════════════════════════
//  Event listeners
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

  // Logo → home
  document.getElementById('brand-home').addEventListener('click', () => switchTab('top-tracks'));

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // Time range
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.range === state.timeRange) return;
      document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.timeRange = btn.dataset.range;
      state.selectedUris.clear();
      loadTopTracks();
    });
  });

  // View toggle (list/grid)
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.topTracksView = btn.dataset.view;
      renderTopTracks();
    });
  });

  // Top Tracks filters
  document.getElementById('artist-filter').addEventListener('change', e => { state.artistFilter = e.target.value; state.selectedUris.clear(); applyTopTracksFilters(); renderTopTracks(); });
  document.getElementById('genre-filter').addEventListener('change', e => { state.genreFilter = e.target.value; state.selectedUris.clear(); applyTopTracksFilters(); renderTopTracks(); });

  // Top Tracks selection bar
  document.getElementById('select-all-btn').addEventListener('click', () => { state.filteredTracks.forEach(t => state.selectedUris.add(t.uri)); renderTopTracks(); });
  document.getElementById('clear-selection-btn').addEventListener('click', () => { state.selectedUris.clear(); renderTopTracks(); });
  document.getElementById('add-to-playlist-btn').addEventListener('click', () => openModal('Aggiungi a playlist', [...state.selectedUris]));

  // Playlists tab
  document.getElementById('playlists-refresh-btn').addEventListener('click', () => loadPlaylists(true));
  document.getElementById('new-playlist-btn').addEventListener('click', () => { openModal('Crea nuova playlist', []); showModalStep('new'); });
  document.getElementById('back-btn').addEventListener('click', closePlaylistDetail);

  // Playlist edit mode toggle
  document.getElementById('playlist-edit-toggle').addEventListener('change', e => {
    state.playlistEditMode = e.target.checked;
    state.playlistSelectedUris.clear();
    document.getElementById('detail-edit-bar').classList.toggle('hidden', !state.playlistEditMode);
    updatePlaylistEditBar();
    if (state.currentPlaylist) renderPlaylistDetail(state.currentPlaylist.id);
  });

  document.getElementById('detail-select-all-btn').addEventListener('click', () => {
    state.currentPlaylistTracks.forEach(item => { if (item.track) state.playlistSelectedUris.add(item.track.uri); });
    if (state.currentPlaylist) renderPlaylistDetail(state.currentPlaylist.id);
    updatePlaylistEditBar();
  });

  document.getElementById('detail-clear-sel-btn').addEventListener('click', () => {
    state.playlistSelectedUris.clear();
    if (state.currentPlaylist) renderPlaylistDetail(state.currentPlaylist.id);
    updatePlaylistEditBar();
  });

  document.getElementById('detail-remove-btn').addEventListener('click', removeSelectedFromPlaylist);

  // Library source toggle
  document.querySelectorAll('.lib-source-btn').forEach(btn => btn.addEventListener('click', () => switchLibrarySource(btn.dataset.source)));

  // Library filters
  const libFilter = document.getElementById('library-filter');
  const clearLibFilter = document.getElementById('clear-library-filter');
  libFilter.addEventListener('input', () => {
    state.libraryFilter = libFilter.value;
    clearLibFilter.classList.toggle('hidden', !libFilter.value);
    if (state.libraryLoaded || state.librarySource === 'top') { applyLibraryFilter(); renderLibrary(); }
  });
  clearLibFilter.addEventListener('click', () => {
    libFilter.value = ''; state.libraryFilter = ''; clearLibFilter.classList.add('hidden');
    if (state.libraryLoaded || state.librarySource === 'top') { applyLibraryFilter(); renderLibrary(); }
  });
  document.getElementById('library-artist-filter').addEventListener('change', e => {
    state.libraryArtistFilter = e.target.value;
    if (state.libraryLoaded || state.librarySource === 'top') { applyLibraryFilter(); renderLibrary(); }
  });
  document.getElementById('library-decade-filter').addEventListener('change', e => {
    state.libraryDecadeFilter = e.target.value;
    if (state.libraryLoaded || state.librarySource === 'top') { applyLibraryFilter(); renderLibrary(); }
  });
  document.getElementById('library-explicit-filter').addEventListener('change', e => {
    state.libraryExplicitFilter = e.target.value;
    if (state.libraryLoaded || state.librarySource === 'top') { applyLibraryFilter(); renderLibrary(); }
  });
  document.getElementById('library-pop-filter').addEventListener('input', e => {
    state.libraryPopMin = Number(e.target.value);
    document.getElementById('library-pop-value').textContent = e.target.value;
    if (state.libraryLoaded || state.librarySource === 'top') { applyLibraryFilter(); renderLibrary(); }
  });
  ['library-dur-min', 'library-dur-max'].forEach(id => {
    document.getElementById(id).addEventListener('change', e => {
      const val = e.target.value === '' ? null : Number(e.target.value);
      if (id === 'library-dur-min') state.libraryDurMin = val;
      else state.libraryDurMax = val;
      if (state.libraryLoaded || state.librarySource === 'top') { applyLibraryFilter(); renderLibrary(); }
    });
  });
  document.getElementById('library-reset-filters-btn').addEventListener('click', () => {
    resetLibraryFilters();
    if (state.libraryLoaded || state.librarySource === 'top') {
      populateLibraryArtistSelect(); populateLibraryDecadeSelect(); applyLibraryFilter(); renderLibrary();
    }
  });

  document.getElementById('library-refresh-btn').addEventListener('click', () => loadLibrary(true));
  document.getElementById('library-export-btn').addEventListener('click', () => { window.location.href = '/api/library/export.csv'; });

  // Library selection bar
  document.getElementById('lib-select-visible-btn').addEventListener('click', () => { state.libraryFiltered.forEach(t => state.librarySelectedUris.add(t.uri)); renderLibrary(); updateLibrarySelectionBar(); });
  document.getElementById('lib-clear-selection-btn').addEventListener('click', () => { state.librarySelectedUris.clear(); renderLibrary(); updateLibrarySelectionBar(); });
  document.getElementById('lib-add-to-playlist-btn').addEventListener('click', () => openModal('Aggiungi a playlist', [...state.librarySelectedUris]));

  // Stats
  document.getElementById('stats-refresh-btn').addEventListener('click', () => loadStats(true));

  // Modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', e => { if (e.target.id === 'modal-backdrop') closeModal(); });
  document.getElementById('opt-existing').addEventListener('click', () => { renderModalPlaylistList(); showModalStep('existing'); });
  document.getElementById('opt-new').addEventListener('click', () => showModalStep('new'));
  document.getElementById('back-to-choose-existing').addEventListener('click', () => showModalStep('choose'));
  document.getElementById('back-to-choose-new').addEventListener('click', () => showModalStep('choose'));
  document.getElementById('create-playlist-confirm').addEventListener('click', createPlaylistWithSelected);
  document.getElementById('new-playlist-name').addEventListener('keydown', e => { if (e.key === 'Enter') createPlaylistWithSelected(); });

  // Keyboard
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeQuickAddDropdown(); } });
  document.addEventListener('click', e => { if (!e.target.closest('.quick-add-btn') && !e.target.closest('#quick-add-dropdown')) closeQuickAddDropdown(); });

  init();
});
