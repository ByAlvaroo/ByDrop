// =====================================================================
//  ByDrop · app principal
//  HECHO POR @BYALVARO__
// =====================================================================

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import {
  $, $$, h, icon, fmtSize, timeAgo, timeLeft, fileKind, kindIcon, deviceInfo, devIcon,
  randomCode, uid, safeName, linkify, toast, vibrate, copyText, openModal, closeModal,
  saveBlob, downloadUrl, isIOS,
} from './js/util.js';
import { createDirect } from './js/direct.js';

const BUCKET = 'bydrop';
const MAX_CLOUD = 50 * 1024 * 1024;     // límite por archivo del plan gratis de Supabase
const QUOTA = 1024 * 1024 * 1024;       // 1 GB de almacenamiento gratis
const BASE = location.origin + location.pathname;
const params = new URLSearchParams(location.search);

// ---------- estado ----------
const dev = deviceInfo();
const me = {
  peerId: uid(),
  name: localStorage.getItem('bydrop.name') || dev.label,
  type: dev.type,
  guest: false,
};
const S = {
  sb: null, user: null, items: [], filter: 'all', search: '',
  compose: [], thumbs: new Map(), direct: null, peers: [],
  peerStatus: new Map(), peerProgress: new Map(), room: null, pendingDirect: null,
};

// ---------- arranque ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
init();

async function init() {
  if (SUPABASE_URL.includes('TU-PROYECTO') || SUPABASE_KEY.startsWith('TU-')) return show('#screen-setup');

  let createClient;
  try {
    ({ createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'));
  } catch {
    show('#screen-setup');
    $('#screen-setup p').textContent = 'No hay conexión a internet. Conéctate y vuelve a abrir ByDrop.';
    return;
  }
  S.sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

  if (params.get('s')) return openShared(params.get('s'));

  const { data: { session } } = await S.sb.auth.getSession();
  if (session?.user) return startApp(session.user);
  if (params.get('sala')) return startGuest(params.get('sala'));
  show('#screen-login');
}

function show(sel) {
  $$('.screen').forEach(s => (s.hidden = true));
  $(sel).hidden = false;
}

// ---------- login ----------
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter || $('#login-form button[type=submit]');
  btn.disabled = true;
  $('#login-error').hidden = true;
  const { data, error } = await S.sb.auth.signInWithPassword({
    email: $('#login-email').value.trim(),
    password: $('#login-pass').value,
  });
  btn.disabled = false;
  if (error) {
    $('#login-error').textContent = error.message.includes('Invalid') ? 'Correo o contraseña incorrectos' : error.message;
    $('#login-error').hidden = false;
    return;
  }
  startApp(data.user);
});

$('#guest-join').addEventListener('click', () => {
  const c = $('#guest-code').value.trim().toUpperCase();
  if (c.length < 4) return toast('Escribe el código de la sala', { type: 'err' });
  startGuest(c);
});

// ---------- app (con cuenta) ----------
async function startApp(user) {
  S.user = user;
  show('#app');
  setupTabs();
  setupComposer();
  setupDirect();
  S.direct.join('u-' + user.id);
  if (params.get('sala')) joinRoom(params.get('sala'));

  await cleanupExpired();
  await loadItems();
  subscribeItems();
  setInterval(() => { cleanupExpired(); renderItems(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadItems(); });
}

// ---------- modo invitado (amigo sin cuenta) ----------
function startGuest(code) {
  me.guest = true;
  show('#app');
  $('#tabs').hidden = true;
  setupTabs();
  switchTab('direct');
  setupDirect();
  joinRoom(code);
}

// ---------- pestañas ----------
function setupTabs() {
  const pill = $('.seg-pill');
  const place = () => {
    const a = $('#tabs button.active');
    if (!a) return;
    pill.style.width = a.offsetWidth + 'px';
    pill.style.transform = `translateX(${a.offsetLeft - 3}px)`;
  };
  $$('#tabs button').forEach(b => b.addEventListener('click', () => { switchTab(b.dataset.tab); place(); }));
  requestAnimationFrame(place);
  addEventListener('resize', place);
  $('#btn-settings').addEventListener('click', openSettings);
}

function switchTab(tab) {
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#view-cloud').hidden = tab !== 'cloud';
  $('#view-direct').hidden = tab !== 'direct';
  const a = $('#tabs button.active'), pill = $('.seg-pill');
  if (a && pill) { pill.style.width = a.offsetWidth + 'px'; pill.style.transform = `translateX(${a.offsetLeft - 3}px)`; }
}
const currentTab = () => ($('#view-direct').hidden ? 'cloud' : 'direct');

// =====================================================================
//  NUBE
// =====================================================================

async function loadItems() {
  const now = new Date().toISOString();
  const { data, error } = await S.sb.from('items').select('*')
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return toast('Error al cargar: ' + error.message, { type: 'err' });
  S.items = data;
  renderItems();
}

function subscribeItems() {
  S.sb.channel('items-' + S.user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `user_id=eq.${S.user.id}` }, p => {
      if (p.eventType === 'INSERT') {
        if (S.items.some(i => i.id === p.new.id)) return;
        S.items.unshift(p.new);
        if (p.new.device !== me.name) {
          toast(`Nuevo desde ${p.new.device || 'otro dispositivo'}: ${p.new.kind === 'text' ? 'texto' : p.new.file_name}`, { iconName: 'cloud' });
          vibrate([20, 40, 20]);
        }
      } else if (p.eventType === 'UPDATE') {
        S.items = S.items.map(i => (i.id === p.new.id ? p.new : i));
      } else if (p.eventType === 'DELETE') {
        S.items = S.items.filter(i => i.id !== p.old.id);
      }
      renderItems();
    })
    .subscribe();
}

async function cleanupExpired() {
  const { data } = await S.sb.from('items').select('id,file_path').lt('expires_at', new Date().toISOString());
  if (!data?.length) return;
  const paths = data.map(d => d.file_path).filter(Boolean);
  if (paths.length) await S.sb.storage.from(BUCKET).remove(paths);
  await S.sb.from('items').delete().in('id', data.map(d => d.id));
}

const itemKind = it => (it.kind === 'text' ? 'text' : fileKind(it.mime, it.file_name));

function renderItems() {
  const q = S.search.toLowerCase();
  const now = Date.now();
  let list = S.items.filter(it => !it.expires_at || new Date(it.expires_at).getTime() > now);
  if (S.filter !== 'all') list = list.filter(it => {
    const k = itemKind(it);
    return S.filter === 'file' ? !['text', 'image', 'video'].includes(k) : k === S.filter;
  });
  if (q) list = list.filter(it => (it.text || '').toLowerCase().includes(q) || (it.file_name || '').toLowerCase().includes(q));
  list.sort((a, b) => (b.pinned - a.pinned) || (new Date(b.created_at) - new Date(a.created_at)));

  $('#items').replaceChildren(...list.map(itemCard));
  $('#items-empty').hidden = list.length > 0 || $('#uploads').children.length > 0;
  if (!S.items.length) $('#items-empty p b').textContent = 'Tu nube está vacía';
  else if (!list.length) $('#items-empty p b').textContent = 'Nada coincide';

  const used = S.items.reduce((a, i) => a + (i.file_size || 0), 0);
  const pct = Math.min(100, (used / QUOTA) * 100);
  $('#usage-fill').style.width = pct + '%';
  $('#usage-fill').classList.toggle('high', pct > 85);
  $('#usage-text').textContent = `${fmtSize(used)} de 1 GB`;
  loadThumbs(list);
}

function itemCard(it) {
  const k = itemKind(it);
  const thumb = h('div', { class: 'thumb t-' + k, onclick: () => openPreview(it) }, icon(kindIcon(k)));
  if (k === 'image' && S.thumbs.has(it.file_path)) thumb.replaceChildren(h('img', { src: S.thumbs.get(it.file_path), alt: '', loading: 'lazy' }));
  thumb.dataset.path = it.file_path || '';

  const left = timeLeft(it.expires_at);
  const meta = h('div', { class: 'meta' },
    it.kind === 'file' ? h('span', {}, fmtSize(it.file_size)) : null,
    it.kind === 'file' ? h('span', { class: 'dot' }) : null,
    h('span', {}, `${it.device || ''} · ${timeAgo(it.created_at)}`),
    h('span', { class: 'dot' }),
    h('span', { class: 'exp' }, icon('clock'), left ? left : 'nunca'),
    it.share_code ? h('span', { class: 'exp', title: 'Compartido por enlace' }, icon('link')) : null,
  );

  const body = h('div', { class: 'body', onclick: () => openPreview(it) },
    it.kind === 'text' ? h('div', { class: 'text-preview' }, linkify(it.text || '')) : h('div', { class: 'title' }, it.file_name),
    meta);

  const main = it.kind === 'text'
    ? h('button', { class: 'icon-btn', title: 'Copiar', onclick: () => copyText(it.text) }, icon('copy'))
    : h('button', { class: 'icon-btn', title: 'Descargar', onclick: () => downloadItem(it) }, icon('down'));

  return h('div', { class: 'item card' + (it.pinned ? ' pinned' : '') }, thumb, body,
    h('div', { class: 'actions' }, main,
      h('button', { class: 'icon-btn', title: 'Más', onclick: () => itemMenu(it) }, icon('more'))));
}

async function loadThumbs(list) {
  const need = list.filter(it => it.kind === 'file' && itemKind(it) === 'image' && !S.thumbs.has(it.file_path)).map(it => it.file_path);
  if (!need.length) return;
  const { data } = await S.sb.storage.from(BUCKET).createSignedUrls(need, 3600);
  for (const d of data || []) {
    if (!d.signedUrl) continue;
    S.thumbs.set(d.path, d.signedUrl);
    const t = $(`.thumb[data-path="${CSS.escape(d.path)}"]`);
    if (t) t.replaceChildren(h('img', { src: d.signedUrl, alt: '', loading: 'lazy' }));
  }
}

async function signed(it, download = false) {
  const { data, error } = await S.sb.storage.from(BUCKET).createSignedUrl(it.file_path, 3600, download ? { download: it.file_name } : undefined);
  if (error) { toast('No se pudo abrir el archivo', { type: 'err' }); return null; }
  return data.signedUrl;
}

async function downloadItem(it) {
  const url = await signed(it, true);
  if (!url) return;
  if (isIOS()) {
    toast('Preparando…', { iconName: 'down', ms: 1500 });
    try {
      const blob = await (await fetch(url)).blob();
      return saveBlob(new Blob([blob], { type: it.mime || blob.type }), it.file_name);
    } catch {}
  }
  downloadUrl(url, it.file_name);
}

// ---------- vista previa ----------
async function openPreview(it) {
  if (it.kind === 'text') {
    return openModal(h('div', { class: 'preview' },
      h('div', { class: 'preview-text' }, linkify(it.text || '')),
      h('div', { class: 'preview-meta' }, `${it.device || ''} · ${timeAgo(it.created_at)}`),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', 'data-close': true }, 'Cerrar'),
        h('button', { class: 'btn primary', onclick: () => copyText(it.text) }, icon('copy'), 'Copiar'))));
  }
  const k = itemKind(it);
  const media = h('div', { class: 'preview-media' }, icon(kindIcon(k)));
  openModal(h('div', { class: 'preview' },
    media,
    h('div', {}, h('div', { class: 'preview-name' }, it.file_name),
      h('div', { class: 'preview-meta' }, `${fmtSize(it.file_size)} · ${it.device || ''} · ${timeAgo(it.created_at)}`)),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn', 'data-close': true }, 'Cerrar'),
      h('button', { class: 'btn primary', onclick: () => downloadItem(it) }, icon('down'), isIOS() ? 'Guardar' : 'Descargar'))));
  if (['image', 'video', 'audio', 'pdf'].includes(k)) {
    const url = await signed(it);
    if (!url) return;
    const el = k === 'image' ? h('img', { src: url, alt: it.file_name })
      : k === 'video' ? h('video', { src: url, controls: true, playsinline: true })
      : k === 'audio' ? h('audio', { src: url, controls: true })
      : h('iframe', { src: url, title: it.file_name });
    media.replaceChildren(el);
  }
}

// ---------- menú de un elemento ----------
function itemMenu(it) {
  const close = openModal(h('div', {},
    h('div', { class: 'sheet-title' }, it.kind === 'text' ? 'Texto' : it.file_name),
    h('div', { class: 'sheet-list' },
      h('button', { onclick: () => { close(); togglePin(it); } }, icon('pin'), it.pinned ? 'Quitar de fijados' : 'Fijar arriba'),
      h('button', { onclick: () => { close(); shareItem(it); } }, icon('link'), it.share_code ? 'Copiar enlace para compartir' : 'Crear enlace para un amigo'),
      it.share_code ? h('button', { onclick: () => { close(); unshare(it); } }, icon('x'), 'Dejar de compartir') : null,
      h('button', { onclick: () => { close(); changeExpiry(it); } }, icon('clock'), 'Cambiar cuándo se borra'),
    ),
    h('div', { class: 'sheet-gap' }),
    h('div', { class: 'sheet-list' },
      h('button', { class: 'danger', onclick: () => { close(); deleteItem(it); } }, icon('trash'), 'Borrar')),
  ));
}

async function togglePin(it) {
  await S.sb.from('items').update({ pinned: !it.pinned }).eq('id', it.id);
  it.pinned = !it.pinned; renderItems();
}

async function shareItem(it) {
  let code = it.share_code;
  if (!code) {
    code = randomCode(10);
    const { error } = await S.sb.from('items').update({ share_code: code }).eq('id', it.id);
    if (error) return toast('No se pudo crear el enlace', { type: 'err' });
    it.share_code = code; renderItems();
  }
  const url = `${BASE}?s=${code}`;
  if (navigator.share && (isIOS() || /Android/.test(navigator.userAgent))) {
    try { await navigator.share({ title: 'ByDrop', url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(url);
  toast(it.expires_at ? `Enlace copiado (válido ${timeLeft(it.expires_at)})` : 'Enlace copiado', { iconName: 'link' });
}

async function unshare(it) {
  await S.sb.from('items').update({ share_code: null }).eq('id', it.id);
  it.share_code = null; renderItems();
  toast('Ya no se comparte');
}

function changeExpiry(it) {
  const opt = (h_, label) => h('button', { onclick: async () => {
    close();
    const exp = h_ ? new Date(Date.now() + h_ * 3600e3).toISOString() : null;
    await S.sb.from('items').update({ expires_at: exp }).eq('id', it.id);
    it.expires_at = exp; renderItems(); toast('Hecho');
  } }, icon('clock'), label);
  const close = openModal(h('div', {},
    h('div', { class: 'sheet-title' }, 'Se borrará dentro de…'),
    h('div', { class: 'sheet-list' }, opt(1, '1 hora'), opt(24, '24 horas'), opt(168, '7 días'), opt(720, '30 días'), opt(0, 'Nunca'))));
}

async function deleteItem(it) {
  S.items = S.items.filter(i => i.id !== it.id); renderItems();
  if (it.file_path) await S.sb.storage.from(BUCKET).remove([it.file_path]);
  const { error } = await S.sb.from('items').delete().eq('id', it.id);
  if (error) { toast('No se pudo borrar', { type: 'err' }); loadItems(); }
  else toast('Borrado', { iconName: 'trash' });
}

// ---------- escribir / adjuntar ----------
function setupComposer() {
  const ta = $('#compose-text');
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; updateSend(); };
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); sendCompose(); }
  });
  $('#btn-attach').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  $('#btn-send').addEventListener('click', sendCompose);
  $('#btn-paste').addEventListener('click', pasteFromClipboard);
  $('#search').addEventListener('input', e => { S.search = e.target.value; renderItems(); });
  $$('#filters button').forEach(b => b.addEventListener('click', () => {
    $$('#filters button').forEach(x => x.classList.toggle('active', x === b));
    S.filter = b.dataset.f; renderItems();
  }));

  // Pegar archivos o capturas con Ctrl+V
  document.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    if (currentTab() === 'direct') return setPendingDirect(files);
    addFiles(files);
  });

  // Arrastrar y soltar
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', e => { if (!hasFiles(e)) return; depth++; $('#drop-overlay').hidden = false;
    $('#drop-overlay b').textContent = currentTab() === 'direct' ? 'Suelta para enviar en directo' : 'Suelta para subir a tu nube'; });
  addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; $('#drop-overlay').hidden = true; } });
  addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; $('#drop-overlay').hidden = true;
    const files = [...e.dataTransfer.files];
    if (currentTab() === 'direct') setPendingDirect(files); else addFiles(files);
  });
}

async function pasteFromClipboard() {
  try {
    if (navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const ci of items) {
        const img = ci.types.find(t => t.startsWith('image/'));
        if (img) {
          const b = await ci.getType(img);
          files.push(new File([b], `captura-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${img.split('/')[1]}`, { type: img }));
        } else if (ci.types.includes('text/plain')) {
          insertText(await (await ci.getType('text/plain')).text());
        }
      }
      if (files.length) addFiles(files);
      return;
    }
    insertText(await navigator.clipboard.readText());
  } catch {
    toast('Permite el acceso al portapapeles o mantén pulsado el cuadro y pega', { type: 'err', ms: 3500 });
  }
}

function insertText(t) {
  if (!t) return;
  const ta = $('#compose-text');
  ta.value = ta.value ? ta.value + '\n' + t : t;
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

function addFiles(list) {
  const files = [...list];
  const big = files.filter(f => f.size > MAX_CLOUD);
  const ok = files.filter(f => f.size <= MAX_CLOUD);
  S.compose.push(...ok);
  renderCompose();
  if (big.length) bigFilesNotice(big);
}

function bigFilesNotice(big) {
  const close = openModal(h('div', { class: 'request' },
    h('div', { class: 'big-icon' }, icon('bolt')),
    h('div', { class: 'sheet-title' }, big.length === 1 ? 'Archivo grande' : 'Archivos grandes'),
    h('p', { class: 'muted' }, `La nube gratis admite hasta 50 MB por archivo. Estos pásalos en Directo: van de un dispositivo a otro sin límite de tamaño (con ByDrop abierto en los dos).`),
    h('ul', {}, big.map(f => h('li', {}, h('span', {}, f.name), h('span', { class: 'muted' }, fmtSize(f.size))))),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn', 'data-close': true }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: () => { close(); switchTab('direct'); setPendingDirect(big); } }, icon('bolt'), 'Enviar en Directo'))));
}

function renderCompose() {
  $('#compose-files').replaceChildren(...S.compose.map((f, i) =>
    h('span', { class: 'chip' }, icon(kindIcon(fileKind(f.type, f.name))), h('span', {}, f.name), h('small', {}, fmtSize(f.size)),
      h('button', { onclick: () => { S.compose.splice(i, 1); renderCompose(); } }, icon('x')))));
  updateSend();
}

function updateSend() {
  $('#btn-send').disabled = !$('#compose-text').value.trim() && !S.compose.length;
}

function expiryISO() {
  const hrs = +$('#compose-expiry').value;
  return hrs ? new Date(Date.now() + hrs * 3600e3).toISOString() : null;
}

async function sendCompose() {
  const text = $('#compose-text').value.trim();
  const files = S.compose.splice(0);
  if (!text && !files.length) return;
  const expires_at = expiryISO();
  $('#compose-text').value = ''; $('#compose-text').dispatchEvent(new Event('input'));
  renderCompose();
  vibrate(15);

  if (text) {
    const { data, error } = await S.sb.from('items').insert({ kind: 'text', text, device: me.name, expires_at }).select().single();
    if (error) { toast('No se pudo enviar: ' + error.message, { type: 'err' }); insertText(text); }
    else if (!S.items.some(i => i.id === data.id)) { S.items.unshift(data); renderItems(); }
  }
  for (const f of files) uploadFile(f, expires_at);
}

function uploadFile(file, expires_at) {
  const id = uid();
  const path = `${S.user.id}/${id}-${safeName(file.name)}`;
  const k = fileKind(file.type, file.name);
  const bar = h('i');
  const card = h('div', { class: 'item card' },
    h('div', { class: 'thumb t-' + k }, icon(kindIcon(k))),
    h('div', { class: 'body' }, h('div', { class: 'title' }, file.name), h('div', { class: 'meta' }, h('span', { class: 'pct' }, 'Subiendo… 0 %'))),
    h('div', { class: 'progress' }, bar));
  $('#uploads').prepend(card);
  $('#items-empty').hidden = true;

  S.sb.auth.getSession().then(({ data: { session } }) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`);
    xhr.setRequestHeader('Authorization', 'Bearer ' + session.access_token);
    xhr.setRequestHeader('apikey', SUPABASE_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable) return;
      const p = Math.round((e.loaded / e.total) * 100);
      bar.style.width = p + '%';
      $('.pct', card).textContent = `Subiendo… ${p} % · ${fmtSize(file.size)}`;
    };
    xhr.onerror = () => { card.remove(); toast(`Error subiendo ${file.name}`, { type: 'err' }); };
    xhr.onload = async () => {
      if (xhr.status >= 300) {
        card.remove();
        let msg = xhr.statusText;
        try { msg = JSON.parse(xhr.responseText).message || msg; } catch {}
        return toast(`No se pudo subir ${file.name}: ${msg}`, { type: 'err', ms: 4000 });
      }
      const { data, error } = await S.sb.from('items').insert({
        id, kind: 'file', file_path: path, file_name: file.name, file_size: file.size,
        mime: file.type || 'application/octet-stream', device: me.name, expires_at,
      }).select().single();
      card.remove();
      if (error) return toast('Error guardando: ' + error.message, { type: 'err' });
      if (k === 'image') S.thumbs.set(path, URL.createObjectURL(file));
      if (!S.items.some(i => i.id === data.id)) S.items.unshift(data);
      renderItems();
      toast(`${file.name} subido`, { iconName: 'cloud' });
    };
    xhr.send(file);
  });
}

// =====================================================================
//  DIRECTO
// =====================================================================

function setupDirect() {
  if (S.direct) return;
  $('#me-name').textContent = me.name;
  $('#me-icon use').setAttribute('href', '#i-' + devIcon(me.type));
  $('#me-sub').textContent = me.guest ? 'Visible para la sala' : 'Visible para tus dispositivos';

  S.direct = createDirect(S.sb, me, {
    onPeers: peers => { S.peers = peers; renderPeers(); },
    onStatus: (id, st) => { if (st) S.peerStatus.set(id, st); else { S.peerStatus.delete(id); S.peerProgress.delete(id); } renderPeers(); },
    onProgress: (id, p) => {
      S.peerProgress.set(id, p);
      if (!S.peerStatus.get(id)?.startsWith('Env')) S.peerStatus.set(id, p >= 1 ? 'Listo' : `${Math.round(p * 100)} %`);
      else S.peerStatus.set(id, p >= 1 ? 'Enviado' : `Enviando ${Math.round(p * 100)} %`);
      renderPeers();
      if (p >= 1) setTimeout(() => { S.peerStatus.delete(id); S.peerProgress.delete(id); renderPeers(); }, 2500);
    },
    onSent: (peer, n) => { toast(`Enviado a ${peer.name}${n > 1 ? ` (${n} archivos)` : ''}`); vibrate([20, 40, 20]); },
    onError: msg => toast(msg, { type: 'err', ms: 4000 }),
    onRequest: req => askAccept(req),
    onReceived: (blob, name, from) => addReceived({ blob, name, from }),
    onText: (text, from) => addReceived({ text, from }),
  });

  $('#btn-room-create').addEventListener('click', () => joinRoom(randomCode(6)));
  $('#btn-room-join').addEventListener('click', () => {
    const c = $('#room-code-input').value.trim().toUpperCase();
    if (c.length < 4) return toast('Escribe el código', { type: 'err' });
    joinRoom(c);
  });
  $('#btn-room-leave').addEventListener('click', leaveRoom);
  $('#btn-room-link').addEventListener('click', () => copyText(`${BASE}?sala=${S.room}`));
  $('#direct-file-input').addEventListener('change', e => {
    const peer = S.pickTarget; S.pickTarget = null;
    if (peer && e.target.files.length) S.direct.sendFiles(peer, e.target.files);
    e.target.value = '';
  });
  renderPeers();
}

function renderPeers() {
  const box = $('#peers');
  box.replaceChildren(...S.peers.map(p => {
    const prog = S.peerProgress.get(p.peerId);
    const st = S.peerStatus.get(p.peerId);
    const C = 2 * Math.PI * 37;
    const ring = prog != null ? (() => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ring'); svg.setAttribute('viewBox', '0 0 78 78');
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', 39); c.setAttribute('cy', 39); c.setAttribute('r', 37);
      c.setAttribute('stroke-dasharray', C); c.setAttribute('stroke-dashoffset', C * (1 - prog));
      svg.append(c); return svg;
    })() : null;
    return h('button', { class: 'peer', onclick: () => peerAction(p) },
      h('div', { class: 'peer-avatar' + (prog >= 1 ? ' done' : '') }, icon(prog >= 1 ? 'check' : devIcon(p.type), 'dev'), ring,
        p.key.startsWith('r-') ? h('span', { class: 'badge', title: 'De la sala' }, icon('users')) : null),
      h('div', { class: 'peer-name' }, p.name || 'Dispositivo'),
      st ? h('div', { class: 'peer-status' }, st) : null);
  }));

  const hint = $('#radar-hint');
  if (S.pendingDirect) {
    hint.replaceChildren(h('b', {}, `Toca un dispositivo para enviar ${S.pendingDirect.length === 1 ? S.pendingDirect[0].name : S.pendingDirect.length + ' archivos'}`),
      ' · ', h('a', { href: '#', onclick: e => { e.preventDefault(); S.pendingDirect = null; renderPeers(); } }, 'cancelar'));
  } else {
    hint.textContent = S.peers.length
      ? 'Toca un dispositivo para enviarle archivos o texto.'
      : me.guest ? 'Esperando a que aparezca alguien en la sala…' : 'Abre ByDrop en otro dispositivo y aparecerá aquí.';
  }
}

function setPendingDirect(files) {
  S.pendingDirect = [...files];
  switchTab('direct');
  renderPeers();
  if (!S.peers.length) toast('Abre ByDrop en el otro dispositivo', { iconName: 'bolt' });
}

function peerAction(p) {
  if (S.pendingDirect) {
    const files = S.pendingDirect; S.pendingDirect = null;
    S.direct.sendFiles(p, files); renderPeers();
    return;
  }
  const close = openModal(h('div', {},
    h('div', { class: 'sheet-title' }, `Enviar a ${p.name}`),
    h('div', { class: 'sheet-list' },
      h('button', { onclick: () => { close(); S.pickTarget = p; $('#direct-file-input').click(); } }, icon('file'), 'Fotos, vídeos o archivos'),
      h('button', { onclick: () => { close(); sendTextTo(p); } }, icon('text'), 'Texto o enlace'))));
}

function sendTextTo(p) {
  const ta = h('textarea', { rows: 5, placeholder: 'Escribe o pega aquí…' });
  const close = openModal(h('div', {},
    h('div', { class: 'sheet-title' }, `Texto para ${p.name}`), ta,
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn', 'data-close': true }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: () => {
        const t = ta.value.trim(); if (!t) return;
        S.direct.sendText(p, t); close(); toast(`Enviado a ${p.name}`); vibrate(15);
      } }, icon('send'), 'Enviar'))));
  setTimeout(() => ta.focus(), 300);
}

function askAccept(req) {
  const total = req.files.reduce((a, f) => a + f.size, 0);
  if (req.sameAccount) {
    toast(`Recibiendo de ${req.fromName}…`, { iconName: 'bolt' });
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    let answered = false;
    const answer = ok => { if (answered) return; answered = true; resolve(ok); closeModal(); };
    openModal(h('div', { class: 'request' },
      h('div', { class: 'big-icon' }, icon(devIcon(req.fromType))),
      h('div', { class: 'sheet-title' }, `${req.fromName} quiere enviarte ${req.files.length === 1 ? 'un archivo' : req.files.length + ' archivos'}`),
      h('div', { class: 'muted' }, fmtSize(total)),
      h('ul', {}, req.files.map(f => h('li', {}, h('span', {}, f.name), h('span', { class: 'muted' }, fmtSize(f.size))))),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', onclick: () => answer(false) }, 'Rechazar'),
        h('button', { class: 'btn primary', onclick: () => answer(true) }, 'Aceptar'))),
      { onClose: () => { if (!answered) { answered = true; resolve(false); } } });
    vibrate([30, 60, 30]);
  });
}

function addReceived({ blob, name, text, from }) {
  $('#received-wrap').hidden = false;
  let card;
  if (text != null) {
    card = h('div', { class: 'item card' },
      h('div', { class: 'thumb t-text' }, icon('text')),
      h('div', { class: 'body' }, h('div', { class: 'text-preview' }, linkify(text)), h('div', { class: 'meta' }, `De ${from} · ahora`)),
      h('div', { class: 'actions' }, h('button', { class: 'icon-btn', title: 'Copiar', onclick: () => copyText(text) }, icon('copy'))));
    toast(`Texto de ${from}`, { iconName: 'text' });
  } else {
    const k = fileKind(blob.type, name);
    const thumb = h('div', { class: 'thumb t-' + k }, icon(kindIcon(k)));
    if (k === 'image' && blob.size < 40 * 1024 * 1024) thumb.replaceChildren(h('img', { src: URL.createObjectURL(blob), alt: '' }));
    card = h('div', { class: 'item card' }, thumb,
      h('div', { class: 'body' }, h('div', { class: 'title' }, name), h('div', { class: 'meta' }, `${fmtSize(blob.size)} · De ${from} · ahora`)),
      h('div', { class: 'actions' },
        h('button', { class: 'icon-btn', title: isIOS() ? 'Guardar' : 'Descargar', onclick: () => saveBlob(blob, name) }, icon(isIOS() ? 'share' : 'down'))));
    toast(`Recibido: ${name}`, { iconName: 'down' });
  }
  vibrate([20, 40, 20]);
  $('#received').prepend(card);
}

// ---------- salas para amigos ----------
async function joinRoom(code) {
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (S.room) S.direct.leave('r-' + S.room);
  S.room = code;
  S.direct.join('r-' + code);
  $('#room-idle').hidden = true;
  $('#room-active').hidden = false;
  $('#room-code').textContent = code;
  const link = `${BASE}?sala=${code}`;
  const qrBox = $('#room-qr');
  qrBox.replaceChildren();
  try {
    const { default: qrcode } = await import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm');
    const qr = qrcode(0, 'M'); qr.addData(link); qr.make();
    qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch { qrBox.hidden = true; }
  if (currentTab() !== 'direct' && !me.guest) toast(`Sala ${code} abierta`, { iconName: 'users' });
}

function leaveRoom() {
  if (S.room) S.direct.leave('r-' + S.room);
  S.room = null;
  $('#room-idle').hidden = false;
  $('#room-active').hidden = true;
  $('#room-code-input').value = '';
  if (me.guest) location.href = BASE;
}

// =====================================================================
//  AJUSTES
// =====================================================================

function openSettings() {
  const name = h('input', { value: me.name, maxlength: 30 });
  const theme = h('select', {},
    ...[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) =>
      h('option', { value: v, selected: (localStorage.getItem('bydrop.theme') || 'auto') === v }, l)));
  theme.addEventListener('change', () => {
    localStorage.setItem('bydrop.theme', theme.value);
    document.documentElement.dataset.theme = theme.value;
  });
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  openModal(h('div', {},
    h('div', { class: 'sheet-title' }, 'Ajustes'),
    h('div', { class: 'sheet-list' },
      h('label', { class: 'li' }, icon(devIcon(me.type)), 'Nombre de este dispositivo', name),
      h('label', { class: 'li' }, icon('gear'), 'Tema', theme)),
    !standalone ? h('div', {}, h('div', { class: 'sheet-gap' }),
      h('div', { class: 'sheet-list' }, h('div', { class: 'li' }, icon('share'),
        h('span', { class: 'small' }, isIOS()
          ? 'Para instalarla: botón Compartir → «Añadir a pantalla de inicio».'
          : 'Para instalarla: menú del navegador → «Instalar ByDrop» / «Añadir a pantalla de inicio».')))) : null,
    h('div', { class: 'sheet-gap' }),
    h('div', { class: 'sheet-list' },
      S.user
        ? h('button', { class: 'danger', onclick: async () => { await S.sb.auth.signOut(); location.href = BASE; } }, icon('x'), 'Cerrar sesión')
        : h('button', { onclick: () => (location.href = BASE) }, icon('cloud'), 'Iniciar sesión')),
    h('p', { class: 'sign' }, 'HECHO POR @BYALVARO__')),
  { onClose: () => {
    const n = name.value.trim() || dev.label;
    if (n !== me.name) {
      me.name = n; localStorage.setItem('bydrop.name', n);
      $('#me-name').textContent = n; S.direct?.retrack();
    }
  } });
}

// =====================================================================
//  ENLACE COMPARTIDO (lo que ve tu amigo)
// =====================================================================

async function openShared(code) {
  show('#screen-shared');
  const body = $('#shared-body');
  body.replaceChildren(h('p', { class: 'muted' }, 'Cargando…'));
  const { data, error } = await S.sb.rpc('get_shared', { code });
  const it = data?.[0];
  if (error || !it) {
    body.replaceChildren(h('div', { class: 'empty-icon' }, icon('clock')), h('h2', {}, 'Enlace no disponible'),
      h('p', { class: 'muted' }, 'Puede que haya caducado o que lo hayan dejado de compartir.'));
    return;
  }
  const left = timeLeft(it.expires_at);
  const metaLine = left ? `Caduca en ${left}` : '';
  if (it.kind === 'text') {
    body.replaceChildren(
      h('div', { class: 'preview-text', style: 'text-align:left' }, linkify(it.text)),
      metaLine ? h('div', { class: 'preview-meta' }, metaLine) : null,
      h('button', { class: 'btn primary big', onclick: () => copyText(it.text) }, icon('copy'), 'Copiar texto'));
    return;
  }
  const k = fileKind(it.mime, it.file_name);
  const media = h('div', { class: 'preview-media' }, icon(kindIcon(k)));
  const btn = h('button', { class: 'btn primary big' }, icon('down'), isIOS() ? 'Guardar' : 'Descargar');
  body.replaceChildren(media,
    h('div', {}, h('div', { class: 'preview-name' }, it.file_name), h('div', { class: 'preview-meta' }, [fmtSize(it.file_size), metaLine].filter(Boolean).join(' · '))),
    btn);
  const view = await S.sb.storage.from(BUCKET).createSignedUrl(it.file_path, 3600);
  const dl = await S.sb.storage.from(BUCKET).createSignedUrl(it.file_path, 3600, { download: it.file_name });
  if (view.data && ['image', 'video', 'audio'].includes(k)) {
    const url = view.data.signedUrl;
    media.replaceChildren(k === 'image' ? h('img', { src: url, alt: '' })
      : k === 'video' ? h('video', { src: url, controls: true, playsinline: true }) : h('audio', { src: url, controls: true }));
  }
  btn.addEventListener('click', async () => {
    if (!dl.data) return toast('No se pudo descargar', { type: 'err' });
    if (isIOS()) {
      try { const b = await (await fetch(dl.data.signedUrl)).blob(); return saveBlob(new Blob([b], { type: it.mime }), it.file_name); } catch {}
    }
    downloadUrl(dl.data.signedUrl, it.file_name);
  });
}
