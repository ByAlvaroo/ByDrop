// ByDrop · Envío directo entre dispositivos (WebRTC, sin pasar por la nube)
// La "presentación" entre dispositivos se hace por Supabase Realtime;
// el archivo viaja directo de un dispositivo a otro.
// HECHO POR @BYALVARO__

import { uid } from './util.js';

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const CHUNK = 64 * 1024;            // trozo por mensaje (compatible con Safari)
const READ = 1024 * 1024;           // leemos el archivo de 1 MB en 1 MB
const HIGH = 8 * 1024 * 1024;       // límite del búfer antes de esperar
const FLUSH = 32 * 1024 * 1024;     // cada 32 MB se compacta lo recibido

export function createDirect(sb, me, ev) {
  const channels = new Map();   // key -> { ch, peers: Map }
  const pending = new Map();    // reqId -> datos de envío esperando respuesta
  const sessions = new Map();   // reqId -> { pc, queue }
  let wakeLock = null;

  // ---------- canales ----------
  function join(key) {
    if (channels.has(key)) return;
    const ch = sb.channel('bydrop-' + key, { config: { presence: { key: me.peerId }, broadcast: { self: false } } });
    const entry = { ch, peers: new Map() };
    channels.set(key, entry);

    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState();
      entry.peers.clear();
      for (const [k, metas] of Object.entries(st)) {
        if (k === me.peerId || !metas?.length) continue;
        const m = metas[metas.length - 1];
        entry.peers.set(k, { peerId: k, name: m.name, type: m.type, key, guest: !!m.guest });
      }
      emitPeers();
    });
    ch.on('broadcast', { event: 'sig' }, ({ payload }) => {
      if (payload?.to === me.peerId) onSignal(payload, key);
    });
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') ch.track({ name: me.name, type: me.type, guest: !!me.guest, at: Date.now() });
    });
  }

  function leave(key) {
    const e = channels.get(key);
    if (!e) return;
    sb.removeChannel(e.ch);
    channels.delete(key);
    emitPeers();
  }

  function retrack() {
    for (const { ch } of channels.values()) ch.track({ name: me.name, type: me.type, guest: !!me.guest, at: Date.now() });
  }

  function emitPeers() {
    const all = new Map();
    for (const [key, e] of channels) for (const p of e.peers.values()) {
      if (!all.has(p.peerId) || key.startsWith('u-')) all.set(p.peerId, p);
    }
    ev.onPeers?.([...all.values()]);
  }

  function send(key, payload) {
    const e = channels.get(key);
    if (!e) return;
    e.ch.send({ type: 'broadcast', event: 'sig', payload: { ...payload, from: me.peerId } });
  }

  // ---------- mantener la pantalla encendida mientras se transfiere ----------
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      if (!on && wakeLock && !pending.size && !sessions.size) { await wakeLock.release(); wakeLock = null; }
    } catch {}
  }

  // ---------- API pública ----------
  function sendText(peer, text) {
    send(peer.key, { to: peer.peerId, t: 'text', text, fromName: me.name });
  }

  function sendFiles(peer, files) {
    const reqId = uid();
    pending.set(reqId, { peer, files: [...files] });
    send(peer.key, {
      to: peer.peerId, t: 'req', reqId, fromName: me.name, fromType: me.type,
      files: [...files].map(f => ({ name: f.name, size: f.size, mime: f.type })),
    });
    ev.onStatus?.(peer.peerId, 'Esperando…');
    setTimeout(() => {
      if (pending.get(reqId) && !sessions.has(reqId)) {
        pending.delete(reqId);
        ev.onStatus?.(peer.peerId, '');
        ev.onError?.(`${peer.name} no respondió`);
      }
    }, 90_000);
  }

  // ---------- señalización ----------
  async function onSignal(m, key) {
    switch (m.t) {
      case 'text':
        ev.onText?.(m.text, m.fromName);
        break;

      case 'req': {
        const ok = await ev.onRequest({ fromName: m.fromName, fromType: m.fromType, files: m.files, sameAccount: key.startsWith('u-') });
        send(key, { to: m.from, t: 'res', reqId: m.reqId, ok });
        if (ok) sessions.set(m.reqId, {
          role: 'recv', pc: null, queue: [], from: m.from, fromName: m.fromName, key,
          total: (m.files || []).reduce((a, f) => a + (f.size || 0), 0),
        });
        break;
      }

      case 'res': {
        const p = pending.get(m.reqId);
        if (!p) return;
        if (!m.ok) {
          pending.delete(m.reqId);
          ev.onStatus?.(p.peer.peerId, '');
          ev.onError?.(`${p.peer.name} lo ha rechazado`);
          return;
        }
        startSender(m.reqId, p, key);
        break;
      }

      case 'offer': {
        const s = sessions.get(m.reqId);
        if (!s) return;
        const pc = s.pc = newPC(m.reqId, key, m.from);
        pc.ondatachannel = e => receive(e.channel, m.reqId, s);
        await pc.setRemoteDescription(m.sdp);
        for (const c of s.queue) await pc.addIceCandidate(c).catch(() => {});
        s.queue = [];
        await pc.setLocalDescription(await pc.createAnswer());
        send(key, { to: m.from, t: 'answer', reqId: m.reqId, sdp: pc.localDescription.toJSON() });
        break;
      }

      case 'answer': {
        const s = sessions.get(m.reqId);
        if (!s?.pc) return;
        await s.pc.setRemoteDescription(m.sdp);
        for (const c of s.queue) await s.pc.addIceCandidate(c).catch(() => {});
        s.queue = [];
        break;
      }

      case 'ice': {
        const s = sessions.get(m.reqId);
        if (!s) return;
        if (s.pc?.remoteDescription) await s.pc.addIceCandidate(m.cand).catch(() => {});
        else s.queue.push(m.cand);
        break;
      }
    }
  }

  function newPC(reqId, key, to) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pc.onicecandidate = e => { if (e.candidate) send(key, { to, t: 'ice', reqId, cand: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        const s = sessions.get(reqId);
        if (s && !s.finished) {
          ev.onError?.('No se pudo conectar. Prueba con los dos dispositivos en la misma Wi-Fi.');
          ev.onStatus?.(s.peerIdForUi || to, '');
        }
        cleanup(reqId);
      }
    };
    return pc;
  }

  function cleanup(reqId) {
    const s = sessions.get(reqId);
    try { s?.pc?.close(); } catch {}
    sessions.delete(reqId);
    pending.delete(reqId);
    keepAwake(false);
  }

  // ---------- emisor ----------
  async function startSender(reqId, p, key) {
    keepAwake(true);
    const s = { role: 'send', pc: null, queue: [], peerIdForUi: p.peer.peerId };
    sessions.set(reqId, s);
    const pc = s.pc = newPC(reqId, key, p.peer.peerId);
    const dc = pc.createDataChannel('bydrop', { ordered: true });
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1024 * 1024;

    const total = p.files.reduce((a, f) => a + f.size, 0) || 1;
    let sent = 0;

    dc.onopen = async () => {
      ev.onStatus?.(p.peer.peerId, 'Enviando…');
      try {
        for (let i = 0; i < p.files.length; i++) {
          const f = p.files[i];
          dc.send(JSON.stringify({ t: 'start', i, name: f.name, size: f.size, mime: f.type }));
          for (let off = 0; off < f.size; off += READ) {
            const buf = await f.slice(off, off + READ).arrayBuffer();
            for (let o = 0; o < buf.byteLength; o += CHUNK) {
              if (dc.bufferedAmount > HIGH) await new Promise(r => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; });
              if (dc.readyState !== 'open') throw new Error('closed');
              const part = buf.slice(o, o + CHUNK);
              dc.send(part);
              sent += part.byteLength;
              ev.onProgress?.(p.peer.peerId, Math.max(0, sent - dc.bufferedAmount) / total);
            }
          }
          dc.send(JSON.stringify({ t: 'end', i }));
        }
        dc.send(JSON.stringify({ t: 'done' }));
      } catch {
        ev.onError?.('Se cortó la conexión');
        ev.onStatus?.(p.peer.peerId, '');
        cleanup(reqId);
      }
    };
    dc.onmessage = e => {
      if (typeof e.data === 'string' && JSON.parse(e.data).t === 'ack') {
        s.finished = true;
        ev.onProgress?.(p.peer.peerId, 1);
        ev.onSent?.(p.peer, p.files.length);
        setTimeout(() => cleanup(reqId), 500);
      }
    };

    await pc.setLocalDescription(await pc.createOffer());
    send(key, { to: p.peer.peerId, t: 'offer', reqId, sdp: pc.localDescription.toJSON() });
  }

  // ---------- receptor ----------
  function receive(dc, reqId, s) {
    keepAwake(true);
    dc.binaryType = 'arraybuffer';
    let cur = null, totalExpected = 0, got = 0;
    const filesInfo = [];

    dc.onmessage = e => {
      if (typeof e.data === 'string') {
        const m = JSON.parse(e.data);
        if (m.t === 'start') {
          cur = { name: m.name, size: m.size, mime: m.mime || 'application/octet-stream', parts: [], blobs: [], buffered: 0 };
          filesInfo.push(cur);
          totalExpected += m.size;
        } else if (m.t === 'end' && cur) {
          if (cur.parts.length) cur.blobs.push(new Blob(cur.parts));
          const blob = new Blob(cur.blobs, { type: cur.mime });
          ev.onReceived?.(blob, cur.name, s.fromName);
          cur = null;
        } else if (m.t === 'done') {
          s.finished = true;
          dc.send(JSON.stringify({ t: 'ack' }));
          ev.onProgress?.(s.from, 1);
          setTimeout(() => cleanup(reqId), 1500);
        }
        return;
      }
      if (!cur) return;
      cur.parts.push(e.data);
      cur.buffered += e.data.byteLength;
      got += e.data.byteLength;
      if (cur.buffered >= FLUSH) { cur.blobs.push(new Blob(cur.parts)); cur.parts = []; cur.buffered = 0; }
      ev.onProgress?.(s.from, got / Math.max(s.total || totalExpected, got, 1));
    };
  }

  return { join, leave, retrack, sendFiles, sendText, has: k => channels.has(k) };
}
