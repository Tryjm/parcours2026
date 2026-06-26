let allRoutes = [];
let selectedFile = null;
let map = null;
let currentLine = null;
let currentLineHalo = null;
let startMarker = null;
let endMarker = null;
let baseLayerControl = null;
let activeTileLayer = null;
let tileWatchdog = null;

const el = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('fr-FR');
const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const isSmallScreen = () => window.matchMedia('(max-width: 820px)').matches;
const DEFAULT_CENTER = [47.2972, -1.4918];

async function init(){
  const res = await fetch('parcours.json', {cache: 'force-cache'});
  allRoutes = await res.json();
  populateMonths();
  populateQuickDates();
  renderStats();
  bindFilters();
  renderList(true);
  if(allRoutes.length) selectRoute(allRoutes[0].file, {scrollToDetail:false});
}

function populateMonths(){
  const months = [...new Set(allRoutes.map(r => r.date ? Number(r.date.slice(5,7)) : null).filter(Boolean))].sort((a,b)=>a-b);
  el('month').insertAdjacentHTML('beforeend', months.map(m => `<option value="${String(m).padStart(2,'0')}">${monthNames[m-1]}</option>`).join(''));
}

function populateQuickDates(){
  const options = [...allRoutes].sort((a,b)=>a.date.localeCompare(b.date)).map(r =>
    `<option value="${escapeHtml(r.file)}">${r.date_fr} — ${r.distance_km.toFixed(1).replace('.', ',')} km / ${fmt.format(r.elevation_m)} m D+</option>`
  ).join('');
  el('quickDate').insertAdjacentHTML('beforeend', options);
}

function renderStats(){
  const totalKm = allRoutes.reduce((s,r)=>s+r.distance_km,0);
  const totalElev = allRoutes.reduce((s,r)=>s+r.elevation_m,0);
  el('stats').innerHTML = `
    <div class="stat"><strong>${allRoutes.length}</strong><span>parcours</span></div>
    <div class="stat"><strong>${fmt.format(Math.round(totalKm))}</strong><span>km cumulés</span></div>
    <div class="stat"><strong>${fmt.format(totalElev)}</strong><span>m D+ cumulés</span></div>`;
}

function bindFilters(){
  ['search','month','minKm','minElev','sort'].forEach(id => el(id).addEventListener('input', () => renderList(true)));
  el('quickDate').addEventListener('change', e => {
    if(!e.target.value) return;
    clearTextFilters();
    renderList(false);
    selectRoute(e.target.value, {scrollToDetail:true});
  });
}

function clearTextFilters(){
  el('search').value = '';
  el('month').value = '';
  el('minKm').value = '';
  el('minElev').value = '';
  el('sort').value = 'date';
}

function normalize(str){
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function filteredRoutes(){
  const q = normalize(el('search').value);
  const month = el('month').value;
  const minKm = Number(el('minKm').value || 0);
  const minElev = Number(el('minElev').value || 0);
  let routes = allRoutes.filter(r => {
    const hay = normalize(`${r.date_fr} ${r.date} ${r.title} ${r.source_filename}`);
    return (!q || hay.includes(q)) && (!month || r.date.slice(5,7) === month) && r.distance_km >= minKm && r.elevation_m >= minElev;
  });
  const sort = el('sort').value;
  routes.sort((a,b)=>{
    if(sort==='distance_desc') return b.distance_km-a.distance_km;
    if(sort==='elevation_desc') return b.elevation_m-a.elevation_m;
    if(sort==='title') return a.title.localeCompare(b.title,'fr');
    return a.date.localeCompare(b.date);
  });
  return routes;
}

function renderList(autoSelectFirst=false){
  const routes = filteredRoutes();
  el('count').textContent = `${routes.length} résultat${routes.length>1?'s':''}`;
  el('routes').innerHTML = routes.map(r => `
    <button class="route-card${r.file === selectedFile ? ' active' : ''}" data-file="${escapeHtml(r.file)}">
      <div class="route-title">${escapeHtml(r.title)}</div>
      <div class="route-meta">
        <span class="badge">${r.date_fr}</span>
        <span class="badge">${r.distance_km.toFixed(1).replace('.', ',')} km</span>
        <span class="badge">${fmt.format(r.elevation_m)} m D+</span>
      </div>
    </button>`).join('') || '<p>Aucun parcours ne correspond aux filtres.</p>';

  document.querySelectorAll('.route-card').forEach(btn => btn.addEventListener('click', () => selectRoute(btn.dataset.file, {scrollToDetail: isSmallScreen()})));

  if(autoSelectFirst && routes.length && !routes.some(r => r.file === selectedFile)) {
    selectRoute(routes[0].file, {scrollToDetail:false});
  }
}

function selectRoute(file, options={scrollToDetail:false}){
  const route = allRoutes.find(r => r.file === file);
  if(!route) return;
  selectedFile = file;
  el('quickDate').value = file;
  document.querySelectorAll('.route-card').forEach(b => b.classList.toggle('active', b.dataset.file === file));

  el('details').className = 'details';
  el('details').innerHTML = `
    <h2>${escapeHtml(route.title)}</h2>
    <p>${route.date_fr} · Fichier source : ${escapeHtml(route.source_filename)}</p>
    <div class="details-grid">
      <div class="detail-stat"><span>Distance</span><strong>${route.distance_km.toFixed(1).replace('.', ',')} km</strong></div>
      <div class="detail-stat"><span>Dénivelé +</span><strong>${fmt.format(route.elevation_m)} m</strong></div>
      <div class="detail-stat"><span>Points GPS</span><strong>${fmt.format(route.points)}</strong></div>
      <div class="detail-stat"><span>Date</span><strong>${route.date_fr}</strong></div>
    </div>
    <div class="actions">
      <a class="btn" href="${route.file}" download>Télécharger le GPX</a>
      <a class="btn secondary" href="${route.file}" target="_blank" rel="noopener">Ouvrir le fichier</a>
    </div>`;

  el('profileArea').innerHTML = profileHtml(route);
  el('mapCard').hidden = false;
  scheduleMapUpdate(route);

  if(options.scrollToDetail){
    document.querySelector('.detail').scrollIntoView({behavior:'smooth', block:'start'});
  }
}

function createFastTileLayer(){
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
    subdomains: 'abcd',
    maxZoom: 18,
    maxNativeZoom: 18,
    detectRetina: false,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: isSmallScreen() ? 1 : 2,
    crossOrigin: true,
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  });
}

function createOsmTileLayer(){
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    maxNativeZoom: 18,
    detectRetina: false,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: isSmallScreen() ? 1 : 2,
    crossOrigin: true,
    attribution: '&copy; OpenStreetMap'
  });
}

function ensureMap(){
  if(map) return map;
  map = L.map('map', {
    preferCanvas: true,
    renderer: L.canvas({padding: 0.35}),
    tap: true,
    zoomControl: !isSmallScreen(),
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    fadeAnimation: false,
    zoomAnimation: false,
    markerZoomAnimation: false,
    attributionControl: true
  });

  map.createPane('routePane');
  map.getPane('routePane').style.zIndex = 650;
  map.getPane('routePane').style.pointerEvents = 'none';

  const osm = createOsmTileLayer();
  const fast = createFastTileLayer();
  activeTileLayer = osm.addTo(map);
  watchTileLoading(activeTileLayer);

  baseLayerControl = L.control.layers({ 'OpenStreetMap lisible': osm, 'Fond clair léger': fast }, null, { position: 'bottomright', collapsed: true }).addTo(map);
  map.on('baselayerchange', e => {
    activeTileLayer = e.layer;
    el('mapMode').textContent = e.name.includes('OpenStreetMap') ? 'fond OpenStreetMap lisible · tracé simplifié' : 'fond clair léger · tracé simplifié';
    watchTileLoading(activeTileLayer);
  });

  map.setView(DEFAULT_CENTER, 10, {animate:false});
  return map;
}

function watchTileLoading(layer){
  if(!layer) return;
  const status = el('mapStatus');
  if(!status) return;
  status.classList.remove('hidden');
  status.textContent = 'Chargement du fond de carte…';
  clearTimeout(tileWatchdog);
  tileWatchdog = setTimeout(() => {
    status.textContent = 'Fond de carte partiellement chargé — le tracé reste disponible.';
    setTimeout(() => status.classList.add('hidden'), 1600);
  }, 2600);
  layer.once('load', () => {
    clearTimeout(tileWatchdog);
    status.textContent = 'Carte chargée';
    setTimeout(() => status.classList.add('hidden'), 500);
  });
  layer.once('tileerror', () => {
    status.textContent = 'Certaines tuiles sont lentes à charger.';
    setTimeout(() => status.classList.add('hidden'), 1800);
  });
}

function scheduleMapUpdate(route){
  requestAnimationFrame(() => {
    requestAnimationFrame(() => updateMap(route));
  });
}

function updateMap(route){
  const pts = route.map_points || [];
  const m = ensureMap();
  m.invalidateSize({animate:false});

  if(currentLine) currentLine.remove();
  if(currentLineHalo) currentLineHalo.remove();
  if(startMarker) startMarker.remove();
  if(endMarker) endMarker.remove();

  if(!pts.length){
    m.setView([route.start_lat || DEFAULT_CENTER[0], route.start_lon || DEFAULT_CENTER[1]], 10, {animate:false});
    setTimeout(() => m.invalidateSize({animate:false}), 80);
    return;
  }

  currentLineHalo = L.polyline(pts, {
    pane: 'routePane',
    weight: isSmallScreen() ? 7 : 9,
    opacity: 0.95,
    color: '#ffffff',
    lineCap: 'round',
    lineJoin: 'round',
    smoothFactor: 1.1,
    interactive: false
  }).addTo(m);

  currentLine = L.polyline(pts, {
    pane: 'routePane',
    weight: isSmallScreen() ? 4 : 5.5,
    opacity: 1,
    color: '#005fbd',
    lineCap: 'round',
    lineJoin: 'round',
    smoothFactor: 1.1,
    interactive: false
  }).addTo(m);

  const start = pts[0];
  const end = pts[pts.length - 1];
  startMarker = L.circleMarker(start, {pane:'routePane', radius: isSmallScreen() ? 5 : 6, weight: 3, color:'#ffffff', fillColor:'#1c8f5a', fillOpacity:1}).addTo(m).bindTooltip('Départ');
  endMarker = L.circleMarker(end, {pane:'routePane', radius: isSmallScreen() ? 5 : 6, weight: 3, color:'#ffffff', fillColor:'#c2410c', fillOpacity:1}).addTo(m).bindTooltip('Arrivée');

  const maxZoom = isSmallScreen() ? 11 : 12;
  const bounds = currentLine.getBounds().pad(0.08);
  m.fitBounds(bounds, {padding: isSmallScreen() ? [16,16] : [28,28], maxZoom, animate:false});
  setTimeout(() => m.invalidateSize({animate:false}), 120);
  setTimeout(() => m.invalidateSize({animate:false}), 450);
}

function profileHtml(route){
  const profile = route.profile;
  const pts = profile && profile.points ? profile.points : [];
  if(!pts.length) return '';
  const linePath = smoothPath(pts);
  const areaPath = `${linePath} L1000,1000 L0,1000 Z`;
  const min = profile.min_m ?? 0;
  const max = profile.max_m ?? 0;
  return `
    <div class="visual-card profile-card" aria-label="Profil altimétrique du circuit">
      <div class="visual-head"><h3>Profil du circuit</h3><span>D+ ${fmt.format(route.elevation_m)} m · ${fmt.format(min)} à ${fmt.format(max)} m</span></div>
      <svg class="profile-svg" viewBox="0 0 1000 1000" role="img" aria-label="Profil altimétrique ${escapeHtml(route.title)}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="profileFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#2b83ba" stop-opacity="0.22"></stop>
            <stop offset="70%" stop-color="#2b83ba" stop-opacity="0.07"></stop>
            <stop offset="100%" stop-color="#2b83ba" stop-opacity="0"></stop>
          </linearGradient>
          <linearGradient id="profileStroke" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stop-color="#166a9a"></stop>
            <stop offset="55%" stop-color="#2b83ba"></stop>
            <stop offset="100%" stop-color="#0f5f8e"></stop>
          </linearGradient>
        </defs>
        <line class="profile-grid" x1="0" y1="250" x2="1000" y2="250"></line>
        <line class="profile-grid" x1="0" y1="500" x2="1000" y2="500"></line>
        <line class="profile-grid" x1="0" y1="750" x2="1000" y2="750"></line>
        <path class="profile-area" d="${areaPath}"></path>
        <path class="profile-line" d="${linePath}" vector-effect="non-scaling-stroke"></path>
        <circle class="profile-dot start" cx="${pts[0][0]}" cy="${pts[0][1]}" r="10" vector-effect="non-scaling-stroke"></circle>
        <circle class="profile-dot end" cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="10" vector-effect="non-scaling-stroke"></circle>
      </svg>
      <div class="profile-labels"><span>${fmt.format(min)} m</span><span>${fmt.format(max)} m</span></div>
    </div>`;
}

function smoothPath(points){
  if(points.length < 2) return '';
  const p = points;
  let d = `M${p[0][0]},${p[0][1]}`;
  for(let i=0; i<p.length-1; i++){
    const p0 = p[i-1] || p[i];
    const p1 = p[i];
    const p2 = p[i+1];
    const p3 = p[i+2] || p2;
    const c1x = p1[0] + (p2[0]-p0[0]) / 6;
    const c1y = p1[1] + (p2[1]-p0[1]) / 6;
    const c2x = p2[0] - (p3[0]-p1[0]) / 6;
    const c2y = p2[1] - (p3[1]-p1[1]) / 6;
    d += ` C${round(c1x)},${round(c1y)} ${round(c2x)},${round(c2y)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function round(n){
  return Math.round(n * 10) / 10;
}

function escapeHtml(str){
  return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

init();
