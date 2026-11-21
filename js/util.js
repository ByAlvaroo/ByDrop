// ByDrop · utilidades
// HECHO POR @BYALVARO__

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const icon = (name, cls = '') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) s.setAttribute('class', cls);
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
};

export function fmtSize(b) {
  if (b == null) return '';
  if (b < 1024) return b + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return (b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)).replace('.', ',') + ' ' + u[i];
}

export function timeAgo(d) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 45) return 'ahora';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  if (s < 86400 * 7) return `hace ${Math.round(s / 86400)} d`;
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function timeLeft(d) {
  if (!d) return null;
  const s = (new Date(d).getTime() - Date.now()) / 1000;
  if (s <= 0) return 'caducado';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

export function fileKind(mime = '', name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'svg'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'].includes(ext)) return 'audio';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'zip';
  return 'file';
}

export const kindIcon = k => ({ image: 'image', video: 'video', audio: 'music', zip: 'zip', text: 'text' }[k] || 'file');

export function deviceInfo() {
  const ua = navigator.userAgent;
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (iPad) return { type: 'tablet', label: 'iPad' };
  if (/iPhone|iPod/.test(ua)) return { type: 'phone', label: 'iPhone' };
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? { type: 'phone', label: 'Móvil Android' } : { type: 'tablet', label: 'Tablet Android' };
  if (/Mac/.test(ua)) return { type: 'laptop', label: 'Mac' };
  if (/Windows/.test(ua)) return { type: 'laptop', label: 'PC' };
  return { type: 'laptop', label: 'Ordenador' };
}
export const devIcon = t => ({ phone: 'phone', tablet: 'tablet' }[t] || 'laptop');

export function randomCode(len = 6) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint8Array(len));
  return [...a].map(x => abc[x % abc.length]).join('');
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function safeName(name) {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_');
  return base.slice(-80) || 'archivo';
}

export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(h('a', { href: m[0], target: '_blank', rel: 'noopener', onclick: e => e.stopPropagation() }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

// ---------- Avisos ----------
export function toast(msg, { type = 'ok', ms = 2600, iconName } = {}) {
  const el = h('div', { class: 'toast' + (type === 'err' ? ' err' : '') },
    icon(iconName || (type === 'err' ? 'x' : 'check')), h('span', {}, msg));
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}

export function vibrate(p = 30) { try { navigator.vibrate?.(p); } catch {} }

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = t;
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Copiado', { iconName: 'copy' }); vibrate(15);
}

// ---------- Modal / hoja inferior ----------
let modalClose = null;
export function openModal(content, { onClose } = {}) {
  const m = $('#modal'), sheet = $('#modal-sheet');
  sheet.replaceChildren(h('div', { class: 'grabber' }), content);
  m.hidden = false;
  modalClose = onClose || null;
  return closeModal;
}
export function closeModal() {
  const m = $('#modal');
  if (m.hidden) return;
  m.hidden = true;
  $('#modal-sheet').replaceChildren();
  const cb = modalClose; modalClose = null; cb?.();
}
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---------- Guardar archivos (PC: descarga · iPhone/iPad: hoja de compartir para "Guardar en Fotos/Archivos") ----------
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export async function saveBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) {
      if (e.name === 'AbortError') return;
      if (e.name === 'NotAllowedError') {
        // Safari pide un toque reciente: mostramos un botón para confirmar
        const close = openModal(h('div', { class: 'request' },
          h('div', { class: 'sheet-title' }, 'Listo para guardar'),
          h('p', { class: 'muted' }, name),
          h('div', { class: 'sheet-actions' },
            h('button', { class: 'btn', 'data-close': true }, 'Cancelar'),
            h('button', { class: 'btn primary', onclick: () => { close(); navigator.share({ files: [file] }).catch(() => {}); } }, icon('share'), 'Guardar'))));
        return;
      }
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadUrl(url, name) {
  const a = h('a', { href: url, download: name || '', rel: 'noopener' });
  document.body.append(a); a.click(); a.remove();
}
