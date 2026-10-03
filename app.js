const $ = id => document.getElementById(id);
const audio = $('audio');
let fuente = 'archive';
let resultados = [];      // resultados de búsqueda (pistas con .url)
let cola = [];            // cola de reproducción
let indiceCola = -1;
let locales = [];         // archivos locales del usuario
let shuffle = false;

/* ---------- Tabs de fuente ---------- */
document.querySelectorAll('.fuente').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.fuente').forEach(x => x.classList.remove('activa'));
  b.classList.add('activa');
  fuente = b.dataset.fuente;
  $('jamendo-config').hidden = fuente !== 'jamendo';
  $('local-config').hidden = fuente !== 'local';
  $('lista-resultados').innerHTML = '';
  $('sin-resultados').style.display = 'block';
  $('sin-resultados').textContent = fuente === 'local' ? 'Carga tus archivos de audio.' : 'Busca algo para comenzar 🎶';
  if (fuente === 'local') mostrarLocales();
}));

/* ---------- Búsqueda ---------- */
$('buscar-btn').addEventListener('click', buscar);
$('busqueda').addEventListener('keydown', e => { if (e.key === 'Enter') buscar(); });

async function buscar() {
  const q = $('busqueda').value.trim();
  if (!q) return;
  $('sin-resultados').textContent = 'Buscando...';
  $('sin-resultados').style.display = 'block';
  try {
    if (fuente === 'archive') await buscarArchive(q);
    else if (fuente === 'jamendo') await buscarJamendo(q);
  } catch (e) {
    $('sin-resultados').textContent = 'Error al buscar: ' + e.message;
  }
}

/* Internet Archive */
async function buscarArchive(q) {
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(creator:(${q}) OR title:(${q})) AND mediatype:audio`)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=15&output=json`;
  const r = await fetch(url);
  const d = await r.json();
  const docs = d.response?.docs || [];
  resultados = [];
  for (const doc of docs) {
    try {
      const meta = await (await fetch(`https://archive.org/metadata/${doc.identifier}`)).json();
      const archivos = (meta.files || []).filter(f => /\.(mp3|ogg|flac|m4a)$/i.test(f.name));
      // Una sola versión por canción (preferir mp3): evita duplicados mp3+ogg+flac
      const porTitulo = {};
      archivos.forEach(a => {
        const clave = (a.title || a.name.replace(/\.[^.]+$/, '')).toLowerCase().trim();
        const esMp3 = /\.mp3$/i.test(a.name);
        if (!porTitulo[clave] || esMp3) porTitulo[clave] = a;
      });
      Object.values(porTitulo).forEach(archivo => resultados.push({
        titulo: archivo.title || archivo.name.replace(/\.[^.]+$/, ''),
        artista: doc.creator || 'Desconocido',
        album: doc.title || doc.identifier,
        url: `https://archive.org/download/${doc.identifier}/${encodeURIComponent(archivo.name)}`,
        origen: 'Internet Archive'
      }));
    } catch (_) {}
  }
  pintarResultados();
}

/* Jamendo */
function jamendoKey() {
  return localStorage.getItem('jcho-jamendo-key') || '709fa152'; // demo; guarda la tuya
}
$('guardar-key').addEventListener('click', () => {
  const k = $('jamendo-key').value.trim();
  if (k) { localStorage.setItem('jcho-jamendo-key', k); alert('Guardada ✔'); }
});
async function buscarJamendo(q) {
  // Primero buscar artistas que coincidan y traer TODAS sus canciones
  const aUrl = `https://api.jamendo.com/v3.0/artists/?client_id=${jamendoKey()}&format=json&limit=5&namesearch=${encodeURIComponent(q)}`;
  const aData = await (await fetch(aUrl)).json();
  const artistas = aData.results || [];
  resultados = [];
  for (const a of artistas) {
    const tUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=${jamendoKey()}&format=json&limit=50&artist_id=${a.id}&audioformat=mp31`;
    const tData = await (await fetch(tUrl)).json();
    (tData.results || []).forEach(t => resultados.push({
      titulo: t.name, artista: t.artist_name, album: t.album_name, url: t.audio, origen: 'Jamendo (CC)'
    }));
  }
  // Evitar duplicados (misma canción de varios artistas similares)
  const vistos = new Set();
  resultados = resultados.filter(p => {
    const k = p.url;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  // Si no hubo artistas exactos, buscar directamente por nombre de pista
  if (!resultados.length) {
    const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${jamendoKey()}&format=json&limit=50&namesearch=${encodeURIComponent(q)}&audioformat=mp31`;
    const d = await (await fetch(url)).json();
    resultados = (d.results || []).map(t => ({ titulo: t.name, artista: t.artist_name, album: t.album_name, url: t.audio, origen: 'Jamendo (CC)' }));
  }
  pintarResultados();
}

/* Biblioteca local */
$('archivos-locales').addEventListener('change', e => {
  locales = [...e.target.files].map(f => ({
    titulo: f.name.replace(/\.[^.]+$/, ''),
    artista: 'Mi biblioteca',
    url: URL.createObjectURL(f),
    origen: 'Local'
  }));
  mostrarLocales();
});
function mostrarLocales() {
  resultados = locales;
  pintarResultados();
  if (!locales.length) $('sin-resultados').textContent = 'Aún no cargaste archivos.';
}

function pintarResultados() {
  // Quitar duplicados por URL
  const vistos = new Set();
  resultados = resultados.filter(p => !vistos.has(p.url) && vistos.add(p.url));
  const ul = $('lista-resultados');
  ul.innerHTML = '';
  $('sin-resultados').style.display = resultados.length ? 'none' : 'block';
  if (!resultados.length && fuente !== 'local') $('sin-resultados').textContent = 'Sin resultados.';
  resultados.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="meta"><strong>${escapeHtml(p.titulo)}</strong><small>${escapeHtml(p.artista)}${p.album ? ' · ' + escapeHtml(p.album) : ''} · ${p.origen}</small></div>
      <div><button class="tocar">▶</button> <button class="agregar">+ Cola</button></div>`;
    li.querySelector('.tocar').addEventListener('click', () => { cola = [...resultados]; indiceCola = i; reproducir(); });
    li.querySelector('.agregar').addEventListener('click', () => { cola.push(p); pintarCola(); });
    ul.appendChild(li);
  });
}

/* ---------- Géneros ---------- */
document.querySelectorAll('.genero').forEach(b => b.addEventListener('click', async () => {
  fuente = 'jamendo';
  document.querySelectorAll('.fuente').forEach(x => x.classList.remove('activa'));
  document.querySelector('.fuente[data-fuente="jamendo"]').classList.add('activa');
  $('jamendo-config').hidden = false;
  $('local-config').hidden = true;
  $('sin-resultados').textContent = 'Cargando ' + b.textContent + '...';
  $('sin-resultados').style.display = 'block';
  const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${jamendoKey()}&format=json&limit=30&fuzzytags=${b.dataset.g}&audioformat=mp31`;
  try {
    const d = await (await fetch(url)).json();
    resultados = (d.results || []).map(t => ({ titulo: t.name, artista: t.artist_name, album: t.album_name, url: t.audio, origen: 'Jamendo (CC)' }));
    pintarResultados();
  } catch (e) { $('sin-resultados').textContent = 'Error: ' + e.message; }
}));

/* ---------- Cola ---------- */
function pintarCola() {
  const ul = $('lista-cola');
  ul.innerHTML = '';
  cola.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="meta"><strong>${escapeHtml(p.titulo)}</strong><small>${escapeHtml(p.artista)}</small></div>
      <div><button class="tocar">▶</button></div>`;
    if (i === indiceCola) li.style.background = '#334155';
    li.querySelector('.tocar').addEventListener('click', () => { indiceCola = i; reproducir(); });
    ul.appendChild(li);
  });
}
$('limpiar-cola').addEventListener('click', () => { cola = []; indiceCola = -1; audio.pause(); $('pista-titulo').textContent = 'Nada sonando'; $('pista-artista').textContent = '—'; pintarCola(); });

/* ---------- Reproductor ---------- */
function reproducir() {
  if (!cola.length || indiceCola < 0 || indiceCola >= cola.length) return;
  const p = cola[indiceCola];
  audio.src = p.url;
  audio.play();
  $('pista-titulo').textContent = p.titulo;
  $('pista-artista').textContent = p.artista + ' · ' + p.origen;
  $('play').textContent = '⏸';
  pintarCola();
}
$('play').addEventListener('click', () => {
  if (!audio.src) return;
  audio.paused ? audio.play() : audio.pause();
  $('play').textContent = audio.paused ? '▶️' : '⏸';
});
audio.addEventListener('play', () => $('play').textContent = '⏸');
audio.addEventListener('pause', () => $('play').textContent = '▶️');
$('siguiente').addEventListener('click', () => {
  if (!cola.length) return;
  indiceCola = shuffle ? Math.floor(Math.random() * cola.length) : (indiceCola + 1) % cola.length;
  reproducir();
});
$('anterior').addEventListener('click', () => {
  if (!cola.length) return;
  indiceCola = (indiceCola - 1 + cola.length) % cola.length;
  reproducir();
});
audio.addEventListener('ended', () => $('siguiente').click());
$('shuffle').addEventListener('click', () => {
  shuffle = !shuffle;
  $('shuffle').classList.toggle('activo', shuffle);
});
$('volumen').addEventListener('input', e => audio.volume = e.target.value);
audio.volume = 0.8;
audio.addEventListener('timeupdate', () => {
  if (audio.duration) $('barra-progreso').value = (audio.currentTime / audio.duration) * 100;
  $('tiempo-actual').textContent = fmt(audio.currentTime);
});
audio.addEventListener('loadedmetadata', () => $('tiempo-total').textContent = fmt(audio.duration));
$('barra-progreso').addEventListener('input', e => {
  if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
});

const fmt = s => { s = Math.floor(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
