'use strict';

// ═══════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════

const state = {
  user: null,
  topTracks: [],          // full list from API
  filteredTracks: [],     // after artist filter
  playlists: [],
  selectedUris: new Set(),
  timeRange: 'medium_term',
  artistFilter: '',
  currentPlaylist: null,
  currentPlaylistTracks: [],
};

// ═══════════════════════════════════════════════════
//  API helpers
// ═══════════════════════════════════════════════════

async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (resp.status === 401) {
    window.location.href = '/login';
    return null;
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }

  return resp.status === 204 ? null : resp.json();
}

const apiGet    = (path, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return api(qs ? `${path}?${qs}` : path);
};
const apiPost   = (path, body) => api(path, { method: 'POST',   body: JSON.stringify(body) });
const apiDelete = (path, body) => api(path, { method: 'DELETE', body: JSON.stringify(body) });

// ═══════════════════════════════════════════════════
//  Toast notifications
// ═══════════════════════════════════════════════════

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : '✕'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// ═══════════════════════════════════════════════════
//  Utils
// ═══════════════════════════════════════════════════

function formatDuration(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function getArtistNames(track) {
  return track.artists.map(a => a.name).join(', ');
}

function getAlbumImage(track, size = 40) {
  const images = track.album?.images;
  if (!images?.length) return null;
  // Pick smallest image >= size
  const sorted = [...images].sort((a, b) => a.width - b.width);
  return (sorted.find(i => i.width >= size) || sorted[sorted.length - 1]).url;
}

// ═══════════════════════════════════════════════════
//  Render: Top Tracks
// ═══════════════════════════════════════════════════

function applyArtistFilter() {
  const q = state.artistFilter.toLowerCase().trim();
  state.filteredTracks = q
    ? state.topTracks.filter(t => t.artists.some(a => a.name.toLowerCase().includes(q)))
    : [...state.topTracks];
}

function renderTopTracks() {
  const container = document.getElementById('tracks-container');

  if (!state.filteredTracks.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Nessun brano trovato</h3>
        <p>${state.artistFilter ? 'Prova con un altro artista.' : 'Nessun dato disponibile per questo periodo.'}</p>
      </div>`;
    updateSelectionBar();
    return;
  }

  const items = state.filteredTracks.map((track, idx) => {
    const img = getAlbumImage(track, 40);
    const selected = state.selectedUris.has(track.uri);
    const originalRank = state.topTracks.indexOf(track) + 1;

    return `
      <div class="track-row ${selected ? 'selected' : ''}" data-uri="${track.uri}">
        <input type="checkbox" ${selected ? 'checked' : ''}
               aria-label="Seleziona ${track.name}" />
        <span class="track-rank">${originalRank}</span>
        ${img
          ? `<img class="track-img" src="${img}" alt="${track.album.name}" loading="lazy" />`
          : `<div class="track-img"></div>`}
        <div class="track-info">
          <div class="track-name">${track.name}</div>
          <div class="track-artist">${getArtistNames(track)}</div>
        </div>
        <span class="track-duration">${formatDuration(track.duration_ms)}</span>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="tracks-list">${items}</div>`;

  // Attach click handlers
  container.querySelectorAll('.track-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.tagName === 'A') return;
      toggleTrackSelection(row.dataset.uri);
    });
  });

  updateSelectionBar();
}

function toggleTrackSelection(uri) {
  if (state.selectedUris.has(uri)) {
    state.selectedUris.delete(uri);
  } else {
    state.selectedUris.add(uri);
  }
  renderTopTracks();
}

function updateSelectionBar() {
  const bar = document.getElementById('selection-bar');
  const count = document.getElementById('selected-count');
  const n = state.selectedUris.size;

  count.textContent = n;
  bar.classList.toggle('hidden', n === 0);

  document.getElementById('add-to-playlist-btn').disabled = n === 0;
}

// ═══════════════════════════════════════════════════
//  Load: Top Tracks
// ═══════════════════════════════════════════════════

async function loadTopTracks() {
  document.getElementById('tracks-container').innerHTML = '<div class="loader">Caricamento brani…</div>';
  state.selectedUris.clear();

  try {
    const data = await apiGet('/api/top-tracks', { time_range: state.timeRange, limit: 50 });
    if (!data) return;
    state.topTracks = data.items || [];
    applyArtistFilter();
    renderTopTracks();
  } catch (err) {
    document.getElementById('tracks-container').innerHTML =
      `<div class="empty-state"><h3>Errore</h3><p>${err.message}</p></div>`;
  }
}

// ═══════════════════════════════════════════════════
//  Render: Playlists grid
// ═══════════════════════════════════════════════════

function renderPlaylists() {
  const container = document.getElementById('playlists-container');

  if (!state.playlists.length) {
    container.innerHTML = '<div class="empty-state"><h3>Nessuna playlist trovata</h3></div>';
    return;
  }

  const items = state.playlists.map(pl => {
    const img = pl.images?.[0]?.url;
    return `
      <div class="playlist-card" data-id="${pl.id}" data-name="${pl.name}">
        ${img
          ? `<img class="playlist-card-img" src="${img}" alt="${pl.name}" loading="lazy" />`
          : `<div class="playlist-card-img-placeholder">♪</div>`}
        <div class="playlist-card-name">${pl.name}</div>
        <div class="playlist-card-count">${pl.tracks?.total ?? 0} brani</div>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="playlists-grid">${items}</div>`;

  container.querySelectorAll('.playlist-card').forEach(card => {
    card.addEventListener('click', () => openPlaylistDetail(card.dataset.id, card.dataset.name));
  });
}

// ═══════════════════════════════════════════════════
//  Load: Playlists
// ═══════════════════════════════════════════════════

async function loadPlaylists() {
  document.getElementById('playlists-container').innerHTML = '<div class="loader">Caricamento playlist…</div>';

  try {
    const data = await apiGet('/api/playlists');
    if (!data) return;
    state.playlists = data.items || [];
    renderPlaylists();
  } catch (err) {
    document.getElementById('playlists-container').innerHTML =
      `<div class="empty-state"><h3>Errore</h3><p>${err.message}</p></div>`;
  }
}

// ═══════════════════════════════════════════════════
//  Playlist detail
// ═══════════════════════════════════════════════════

async function openPlaylistDetail(playlistId, playlistName) {
  const playlist = state.playlists.find(p => p.id === playlistId);
  state.currentPlaylist = playlist;

  document.getElementById('playlists-container').classList.add('hidden');
  document.getElementById('playlist-detail').classList.remove('hidden');

  const nameEl  = document.getElementById('detail-name');
  const countEl = document.getElementById('detail-count');
  const coverEl = document.getElementById('detail-cover');
  const detailContainer = document.getElementById('detail-tracks-container');

  nameEl.textContent = playlistName;
  countEl.textContent = '';
  detailContainer.innerHTML = '<div class="loader">Caricamento brani…</div>';

  const img = playlist?.images?.[0]?.url;
  if (img) {
    coverEl.src = img;
    coverEl.classList.remove('hidden');
  } else {
    coverEl.classList.add('hidden');
  }

  try {
    const data = await apiGet(`/api/playlists/${playlistId}/tracks`);
    if (!data) return;
    state.currentPlaylistTracks = data.items || [];
    countEl.textContent = `${data.total} brani`;
    renderPlaylistDetail(playlistId);
  } catch (err) {
    detailContainer.innerHTML =
      `<div class="empty-state"><h3>Errore</h3><p>${err.message}</p></div>`;
  }
}

function renderPlaylistDetail(playlistId) {
  const container = document.getElementById('detail-tracks-container');
  const items = state.currentPlaylistTracks;

  if (!items.length) {
    container.innerHTML = '<div class="empty-state"><h3>Playlist vuota</h3></div>';
    return;
  }

  const rows = items.map((item, idx) => {
    const track = item.track;
    if (!track) return '';
    const img = getAlbumImage(track, 40);
    return `
      <div class="detail-track-row">
        <span class="track-rank">${idx + 1}</span>
        ${img
          ? `<img class="track-img" src="${img}" alt="${track.album?.name}" loading="lazy" />`
          : `<div class="track-img"></div>`}
        <div class="track-info">
          <div class="track-name">${track.name}</div>
          <div class="track-artist">${getArtistNames(track)}</div>
        </div>
        <span class="track-duration">${formatDuration(track.duration_ms)}</span>
        <button class="remove-track-btn" data-uri="${track.uri}" title="Rimuovi dalla playlist">✕</button>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="tracks-list">${rows}</div>`;

  container.querySelectorAll('.remove-track-btn').forEach(btn => {
    btn.addEventListener('click', () => removeTrackFromCurrentPlaylist(playlistId, btn.dataset.uri));
  });
}

async function removeTrackFromCurrentPlaylist(playlistId, uri) {
  try {
    await apiDelete(`/api/playlists/${playlistId}/tracks`, { uris: [uri] });
    state.currentPlaylistTracks = state.currentPlaylistTracks.filter(item => item.track?.uri !== uri);
    document.getElementById('detail-count').textContent = `${state.currentPlaylistTracks.length} brani`;
    renderPlaylistDetail(playlistId);
    showToast('Brano rimosso dalla playlist');
    // Refresh playlists list in background
    loadPlaylists();
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
  }
}

function closePlaylistDetail() {
  document.getElementById('playlist-detail').classList.add('hidden');
  document.getElementById('playlists-container').classList.remove('hidden');
  state.currentPlaylist = null;
  state.currentPlaylistTracks = [];
}

// ═══════════════════════════════════════════════════
//  Modal helpers
// ═══════════════════════════════════════════════════

function openModal(title = 'Aggiungi a playlist') {
  document.getElementById('modal-title').textContent = title;
  showModalStep('choose');
  document.getElementById('modal-backdrop').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
  // Reset form
  document.getElementById('new-playlist-name').value = '';
  document.getElementById('new-playlist-desc').value = '';
  document.getElementById('new-playlist-public').checked = false;
}

function showModalStep(step) {
  ['choose', 'existing', 'new'].forEach(s => {
    document.getElementById(`modal-step-${s}`).classList.toggle('hidden', s !== step);
  });
}

function renderModalPlaylistList() {
  const container = document.getElementById('modal-playlist-list');
  const userId = state.user?.id;

  // Only show playlists the user owns (can modify)
  const editable = state.playlists.filter(
    pl => pl.owner?.id === userId || pl.collaborative
  );

  if (!editable.length) {
    container.innerHTML = '<p style="color:var(--text-muted);padding:16px">Nessuna playlist modificabile trovata.</p>';
    return;
  }

  container.innerHTML = editable.map(pl => {
    const img = pl.images?.[0]?.url;
    return `
      <div class="modal-playlist-item" data-id="${pl.id}">
        ${img
          ? `<img src="${img}" alt="${pl.name}" />`
          : `<div class="modal-playlist-item-placeholder">♪</div>`}
        <div class="modal-playlist-item-info">
          <div class="modal-playlist-item-name">${pl.name}</div>
          <div class="modal-playlist-item-count">${pl.tracks?.total ?? 0} brani</div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.modal-playlist-item').forEach(item => {
    item.addEventListener('click', () => addSelectedToExistingPlaylist(item.dataset.id));
  });
}

// ═══════════════════════════════════════════════════
//  Add tracks to playlist actions
// ═══════════════════════════════════════════════════

async function addSelectedToExistingPlaylist(playlistId) {
  const uris = [...state.selectedUris];
  closeModal();

  try {
    await apiPost(`/api/playlists/${playlistId}/tracks`, { uris });
    showToast(`${uris.length} brani aggiunti alla playlist`);
    state.selectedUris.clear();
    renderTopTracks();
    loadPlaylists();
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
  }
}

async function createPlaylistWithSelected() {
  const name = document.getElementById('new-playlist-name').value.trim();
  if (!name) {
    document.getElementById('new-playlist-name').focus();
    return;
  }

  const desc    = document.getElementById('new-playlist-desc').value.trim();
  const isPublic = document.getElementById('new-playlist-public').checked;
  const uris    = [...state.selectedUris];

  const btn = document.getElementById('create-playlist-confirm');
  btn.disabled = true;
  btn.textContent = 'Creazione…';

  try {
    await apiPost('/api/playlists', { name, description: desc, public: isPublic, uris });
    closeModal();
    showToast(`Playlist "${name}" creata con ${uris.length} brani`);
    state.selectedUris.clear();
    renderTopTracks();
    loadPlaylists();
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crea e aggiungi brani';
  }
}

// ═══════════════════════════════════════════════════
//  Tab switching
// ═══════════════════════════════════════════════════

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(sec => {
    sec.classList.toggle('active', sec.id === `tab-${tabName}`);
    sec.classList.toggle('hidden', sec.id !== `tab-${tabName}`);
  });
}

// ═══════════════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════════════

async function init() {
  // Check auth status quickly without triggering a redirect
  const status = await fetch('/api/auth-status').then(r => r.json()).catch(() => ({ authenticated: false }));

  if (!status.authenticated) {
    showLoginView();
    return;
  }

  // Load user profile
  try {
    state.user = await apiGet('/api/me');
  } catch {
    showLoginView();
    return;
  }

  showAppView();
  loadTopTracks();
  loadPlaylists();
}

function showLoginView() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');

  // Show error if present in URL
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  if (error) {
    const el = document.getElementById('login-error');
    el.textContent = `Accesso negato: ${error.replace(/_/g, ' ')}`;
    el.classList.remove('hidden');
  }
}

function showAppView() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');

  const user = state.user;
  document.getElementById('user-name').textContent = user.display_name || user.id;

  const avatar = document.getElementById('user-avatar');
  const img = user.images?.[0]?.url;
  if (img) {
    avatar.src = img;
    avatar.classList.remove('hidden');
  }
}

// ═══════════════════════════════════════════════════
//  Event listeners
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

  // ─── Tab buttons ───────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ─── Time range buttons ────────────────────────
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

  // ─── Artist filter ─────────────────────────────
  const filterInput = document.getElementById('artist-filter');
  const clearFilterBtn = document.getElementById('clear-filter');

  filterInput.addEventListener('input', () => {
    state.artistFilter = filterInput.value;
    clearFilterBtn.classList.toggle('hidden', !filterInput.value);
    applyArtistFilter();
    renderTopTracks();
  });

  clearFilterBtn.addEventListener('click', () => {
    filterInput.value = '';
    state.artistFilter = '';
    clearFilterBtn.classList.add('hidden');
    applyArtistFilter();
    renderTopTracks();
  });

  // ─── Selection bar ─────────────────────────────
  document.getElementById('select-all-btn').addEventListener('click', () => {
    state.filteredTracks.forEach(t => state.selectedUris.add(t.uri));
    renderTopTracks();
  });

  document.getElementById('clear-selection-btn').addEventListener('click', () => {
    state.selectedUris.clear();
    renderTopTracks();
  });

  document.getElementById('add-to-playlist-btn').addEventListener('click', () => {
    openModal('Aggiungi a playlist');
  });

  // ─── Playlists tab: new playlist button ────────
  document.getElementById('new-playlist-btn').addEventListener('click', () => {
    openModal('Crea nuova playlist');
    showModalStep('new');
  });

  // ─── Playlist detail: back button ─────────────
  document.getElementById('back-btn').addEventListener('click', closePlaylistDetail);

  // ─── Modal ─────────────────────────────────────
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-backdrop')) closeModal();
  });

  document.getElementById('opt-existing').addEventListener('click', () => {
    renderModalPlaylistList();
    showModalStep('existing');
  });

  document.getElementById('opt-new').addEventListener('click', () => {
    showModalStep('new');
  });

  document.getElementById('back-to-choose-existing').addEventListener('click', () => showModalStep('choose'));
  document.getElementById('back-to-choose-new').addEventListener('click', () => showModalStep('choose'));

  document.getElementById('create-playlist-confirm').addEventListener('click', createPlaylistWithSelected);

  document.getElementById('new-playlist-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') createPlaylistWithSelected();
  });

  // ─── Keyboard shortcuts ────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // ─── Boot ──────────────────────────────────────
  init();
});
