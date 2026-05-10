'use strict';

// ═══════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════

const state = {
  user: null,
  topTracks: [],
  filteredTracks: [],
  playlists: [],
  selectedUris: new Set(),
  timeRange: 'medium_term',
  artistFilter: '',
  currentPlaylist: null,
  currentPlaylistTracks: [],
  // Library
  library: [],
  libraryFiltered: [],
  libraryFilter: '',
  librarySort: { field: 'added_at', dir: 'desc' },
  libraryLoaded: false,
  // Stats
  recentlyPlayed: [],
  statsLoaded: false,
  freqChart: null,
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
  const sorted = [...images].sort((a, b) => a.width - b.width);
  return (sorted.find(i => i.width >= size) || sorted[sorted.length - 1]).url;
}

function formatDatetime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDate(iso) {
  if (!iso) return '';
  return iso.slice(0, 10);
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

async function loadTopTracks(refresh = false) {
  document.getElementById('tracks-container').innerHTML = '<div class="loader">Caricamento brani…</div>';
  state.selectedUris.clear();

  try {
    const data = await apiGet('/api/top-tracks', { time_range: state.timeRange, limit: 50, refresh });
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

async function loadPlaylists(refresh = false) {
  document.getElementById('playlists-container').innerHTML = '<div class="loader">Caricamento playlist…</div>';

  try {
    const data = await apiGet('/api/playlists', refresh ? { refresh: true } : {});
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
//  Library
// ═══════════════════════════════════════════════════

const LIBRARY_COLS = [
  { field: 'name',      label: 'Titolo',      sortable: true },
  { field: 'artists',   label: 'Artista',     sortable: true },
  { field: 'album',     label: 'Album',       sortable: true },
  { field: 'year',      label: 'Anno',        sortable: true },
  { field: 'duration_ms', label: 'Durata',    sortable: true },
  { field: 'popularity',  label: 'Pop.',      sortable: true },
  { field: 'explicit',    label: 'E',         sortable: false },
  { field: 'added_at',    label: 'Aggiunto',  sortable: true },
];

function applyLibraryFilter() {
  const q = state.libraryFilter.toLowerCase().trim();
  state.libraryFiltered = q
    ? state.library.filter(t =>
        t.name.toLowerCase().includes(q) || t.artists.toLowerCase().includes(q)
      )
    : [...state.library];
  sortLibrary();
}

function sortLibrary() {
  const { field, dir } = state.librarySort;
  state.libraryFiltered.sort((a, b) => {
    let va = a[field] ?? '';
    let vb = b[field] ?? '';
    if (field === 'duration_ms' || field === 'popularity') {
      va = Number(va);
      vb = Number(vb);
    } else {
      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
    }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function renderLibrary() {
  const container = document.getElementById('library-container');
  const countEl   = document.getElementById('library-count');

  countEl.textContent = `${state.libraryFiltered.length} brani${state.libraryFilter ? ` (filtrati su ${state.library.length})` : ''}`;

  if (!state.libraryFiltered.length) {
    container.innerHTML = `<div class="empty-state"><h3>Nessun brano trovato</h3></div>`;
    return;
  }

  const { field: sortField, dir: sortDir } = state.librarySort;

  const headerCells = LIBRARY_COLS.map(col => {
    if (!col.sortable) return `<th class="lib-th">${col.label}</th>`;
    const active = sortField === col.field;
    const indicator = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="lib-th sortable${active ? ' sort-active' : ''}" data-field="${col.field}">${col.label}${indicator}</th>`;
  }).join('');

  const rows = state.libraryFiltered.map(t => {
    const dur = formatDuration(t.duration_ms);
    const added = formatDate(t.added_at);
    const explicitBadge = t.explicit ? '<span class="explicit-badge">E</span>' : '';
    const popBar = `<span class="pop-bar"><span style="width:${t.popularity}%"></span></span>${t.popularity}`;
    const img = t.image
      ? `<img class="lib-thumb" src="${t.image}" alt="" loading="lazy" />`
      : `<div class="lib-thumb"></div>`;
    return `
      <tr>
        <td class="lib-td lib-td-title">
          <div class="lib-title-cell">${img}<div class="track-info"><div class="track-name">${escapeHtml(t.name)}</div></div></div>
        </td>
        <td class="lib-td">${escapeHtml(t.artists)}</td>
        <td class="lib-td">${escapeHtml(t.album)}</td>
        <td class="lib-td lib-td-num">${t.year}</td>
        <td class="lib-td lib-td-num">${dur}</td>
        <td class="lib-td lib-td-pop">${popBar}</td>
        <td class="lib-td lib-td-center">${explicitBadge}</td>
        <td class="lib-td lib-td-num">${added}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="lib-table-wrap">
      <table class="lib-table">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  container.querySelectorAll('.lib-th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const f = th.dataset.field;
      if (state.librarySort.field === f) {
        state.librarySort.dir = state.librarySort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.librarySort.field = f;
        state.librarySort.dir = 'asc';
      }
      sortLibrary();
      renderLibrary();
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadLibrary(refresh = false) {
  document.getElementById('library-container').innerHTML = '<div class="loader">Caricamento libreria…</div>';
  document.getElementById('library-count').textContent = '';

  try {
    const params = refresh ? { refresh: true } : {};
    const data = await apiGet('/api/library', params);
    if (!data) return;
    state.library = data.items || [];
    state.libraryLoaded = true;
    applyLibraryFilter();
    renderLibrary();
  } catch (err) {
    document.getElementById('library-container').innerHTML =
      `<div class="empty-state"><h3>Errore</h3><p>${err.message}</p></div>`;
  }
}

// ═══════════════════════════════════════════════════
//  Stats
// ═══════════════════════════════════════════════════

function renderRecentTracks() {
  const container = document.getElementById('recent-tracks-container');
  const items = state.recentlyPlayed;

  if (!items.length) {
    container.innerHTML = '<div class="empty-state"><h3>Nessun ascolto recente</h3></div>';
    return;
  }

  const rows = items.map(item => `
    <div class="recent-row">
      ${item.image
        ? `<img class="track-img" src="${item.image}" alt="" loading="lazy" />`
        : `<div class="track-img"></div>`}
      <div class="track-info">
        <div class="track-name">${escapeHtml(item.name)}</div>
        <div class="track-artist">${escapeHtml(item.artists)}</div>
      </div>
      <span class="recent-time">${formatDatetime(item.played_at)}</span>
    </div>`).join('');

  container.innerHTML = `<div class="recent-list">${rows}</div>`;
}

function renderFreqChart() {
  const items = state.recentlyPlayed;
  const canvas = document.getElementById('freq-chart');
  const emptyEl = document.getElementById('chart-empty');

  // Count frequency
  const freq = {};
  const names = {};
  items.forEach(item => {
    freq[item.uri] = (freq[item.uri] || 0) + 1;
    names[item.uri] = item.name;
  });

  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (!sorted.length) {
    canvas.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  canvas.style.display = 'block';
  emptyEl.style.display = 'none';

  const labels = sorted.map(([uri]) => {
    const name = names[uri];
    return name.length > 30 ? name.slice(0, 28) + '…' : name;
  });
  const values = sorted.map(([, count]) => count);

  if (state.freqChart) {
    state.freqChart.destroy();
    state.freqChart = null;
  }

  state.freqChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Ascolti',
        data: values,
        backgroundColor: 'rgba(29,185,84,0.7)',
        borderColor: '#1DB954',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.x} ascolto${ctx.parsed.x !== 1 ? 'i' : ''}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#A7A7A7', stepSize: 1 },
          grid: { color: '#333' },
          beginAtZero: true,
        },
        y: {
          ticks: { color: '#fff', font: { size: 12 } },
          grid: { display: false },
        },
      },
    },
  });
}

async function loadStats(refresh = false) {
  document.getElementById('recent-tracks-container').innerHTML = '<div class="loader">Caricamento…</div>';
  if (state.freqChart) { state.freqChart.destroy(); state.freqChart = null; }

  try {
    const params = refresh ? { refresh: true } : {};
    const data = await apiGet('/api/recently-played', params);
    if (!data) return;
    state.recentlyPlayed = data.items || [];
    state.statsLoaded = true;
    renderRecentTracks();
    renderFreqChart();
  } catch (err) {
    document.getElementById('recent-tracks-container').innerHTML =
      `<div class="empty-state"><h3>Errore</h3><p>${err.message}</p></div>`;
  }
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

  if (tabName === 'library' && !state.libraryLoaded) loadLibrary();
  if (tabName === 'stats'   && !state.statsLoaded)   loadStats();
}

// ═══════════════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════════════

async function init() {
  const status = await fetch('/api/auth-status').then(r => r.json()).catch(() => ({ authenticated: false }));

  if (!status.authenticated) {
    showLoginView();
    return;
  }

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

  // ─── Playlists tab ─────────────────────────────
  document.getElementById('new-playlist-btn').addEventListener('click', () => {
    openModal('Crea nuova playlist');
    showModalStep('new');
  });

  document.getElementById('back-btn').addEventListener('click', closePlaylistDetail);

  // ─── Library tab ───────────────────────────────
  const libFilter = document.getElementById('library-filter');
  const clearLibFilter = document.getElementById('clear-library-filter');

  libFilter.addEventListener('input', () => {
    state.libraryFilter = libFilter.value;
    clearLibFilter.classList.toggle('hidden', !libFilter.value);
    if (state.libraryLoaded) {
      applyLibraryFilter();
      renderLibrary();
    }
  });

  clearLibFilter.addEventListener('click', () => {
    libFilter.value = '';
    state.libraryFilter = '';
    clearLibFilter.classList.add('hidden');
    if (state.libraryLoaded) {
      applyLibraryFilter();
      renderLibrary();
    }
  });

  document.getElementById('library-refresh-btn').addEventListener('click', () => {
    loadLibrary(true);
  });

  document.getElementById('library-export-btn').addEventListener('click', () => {
    window.location.href = '/api/library/export.csv';
  });

  // ─── Stats tab ─────────────────────────────────
  document.getElementById('stats-refresh-btn').addEventListener('click', () => {
    loadStats(true);
  });

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
