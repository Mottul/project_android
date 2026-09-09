/**
 * Verbindung zur Bruecke (bridge/osc-bridge.mjs).
 *
 * Der Browser kann kein UDP. Die Bruecke laeuft auf dem Rechner und macht aus
 * jedem BINAER-Frame ein UDP-Paket an das eingestellte Ziel — und umgekehrt aus
 * jedem eingehenden UDP-Paket wieder einen Binaer-Frame. Steuerbefehle
 * (Ziel setzen, Feedback-Port, NovaStar) laufen als JSON-TEXT-Frames.
 *
 * Die Bruecke bleibt dadurch dumm und muss nie mitwachsen: die App kodiert das
 * OSC selbst und bestimmt das Ziel zur Laufzeit.
 */

import { encodeMessage, decodePacket } from './osc.js';

const RECONNECT_MIN = 600;
const RECONNECT_MAX = 6000;
const PING_INTERVAL = 4000;
const FLUSH_MS = 16;           // ~60 Sendungen/s je Adresse

/** Vorschlag fuer die Bruecken-Adresse aus der aktuellen Seite ableiten. */
export function defaultBridgeUrl() {
  const { protocol, hostname, port } = location;
  // Von der Bruecke selbst geladen (http://<rechner>:8090) -> gleiche Adresse.
  if (protocol === 'http:' && hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return `ws://${hostname}:${port || 80}`;
  }
  if (protocol === 'http:' && port) return `ws://${hostname}:${port}`;
  return 'ws://127.0.0.1:8090';
}

export function createLink(handlers = {}) {
  const on = {
    state: handlers.onState || (() => {}),
    feedback: handlers.onFeedback || (() => {}),
    log: handlers.onLog || (() => {}),
  };

  let ws = null;
  let url = defaultBridgeUrl();
  let target = { host: '127.0.0.1', port: 8000 };
  let listenPort = 9000;
  let nova = { host: '', port: 5200 };
  let wanted = false;          // soll verbunden sein?
  let attempt = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let flushTimer = null;
  let pingSentAt = 0;

  const pending = new Map();   // Adresse -> {address,args}
  const state = {
    status: 'off',             // 'off' | 'connecting' | 'open' | 'error'
    error: '',
    latency: null,
    sent: 0,
    recv: 0,
    bridge: '',                // Version/Info der Bruecke
    targetOk: false,
  };

  function emit() {
    on.state({ ...state, url, target: { ...target }, listenPort, nova: { ...nova } });
  }

  function setStatus(next, error = '') {
    state.status = next;
    state.error = error;
    emit();
  }

  /* ------------------------------------------------------------ Senden --- */

  function rawSend(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(obj);
      return true;
    } catch (err) {
      setStatus('error', String(err && err.message ? err.message : err));
      return false;
    }
  }

  function pushConfig() {
    rawSend(JSON.stringify({ t: 'target', host: target.host, port: target.port }));
    rawSend(JSON.stringify({ t: 'listen', port: listenPort }));
    rawSend(JSON.stringify({ t: 'nova', host: nova.host, port: nova.port }));
  }

  function flush() {
    flushTimer = null;
    if (!pending.size) return;
    for (const msg of pending.values()) transmit(msg.address, msg.args);
    pending.clear();
  }

  function transmit(address, args) {
    let buf;
    try {
      buf = encodeMessage(address, args);
    } catch (err) {
      on.log({ dir: 'err', address, args, at: Date.now(), note: String(err.message || err) });
      return;
    }
    const ok = rawSend(buf);
    if (ok) state.sent += 1;
    on.log({ dir: 'out', address, args, at: Date.now(), note: ok ? '' : 'nicht verbunden' });
  }

  return {
    get state() { return { ...state, url, target: { ...target }, listenPort, nova: { ...nova } }; },

    /** Einstellungen uebernehmen; bei geaenderter URL wird neu verbunden. */
    configure(cfg = {}) {
      const nextUrl = cfg.url != null ? String(cfg.url).trim() : url;
      if (cfg.target) target = { host: String(cfg.target.host || '127.0.0.1'), port: Number(cfg.target.port) || 8000 };
      if (cfg.listenPort != null) listenPort = Number(cfg.listenPort) || 0;
      if (cfg.nova) nova = { host: String(cfg.nova.host || ''), port: Number(cfg.nova.port) || 5200 };
      const urlChanged = nextUrl !== url;
      url = nextUrl;
      if (urlChanged && wanted) this.connect();
      else if (ws && ws.readyState === WebSocket.OPEN) pushConfig();
      emit();
    },

    connect() {
      wanted = true;
      clearTimeout(reconnectTimer);
      if (ws) { try { ws.onclose = null; ws.close(); } catch { /* egal */ } ws = null; }
      let sock;
      setStatus('connecting');
      try {
        sock = new WebSocket(url);
      } catch (err) {
        setStatus('error', 'Adresse unbrauchbar');
        return;
      }
      sock.binaryType = 'arraybuffer';
      ws = sock;

      sock.onopen = () => {
        if (ws !== sock) return;
        attempt = 0;
        state.error = '';
        setStatus('open');
        pushConfig();
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          pingSentAt = performance.now();
          rawSend(JSON.stringify({ t: 'ping' }));
        }, PING_INTERVAL);
        pingSentAt = performance.now();
        rawSend(JSON.stringify({ t: 'ping' }));
      };

      sock.onmessage = (ev) => {
        if (ws !== sock) return;
        if (typeof ev.data === 'string') {
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg.t === 'pong') {
            state.latency = Math.round(performance.now() - pingSentAt);
            emit();
          } else if (msg.t === 'hello') {
            state.bridge = `${msg.name || 'Bruecke'} ${msg.version || ''}`.trim();
            emit();
          } else if (msg.t === 'status') {
            state.targetOk = !!msg.targetOk;
            if (msg.error) state.error = String(msg.error);
            emit();
          } else if (msg.t === 'error') {
            setStatus('open', String(msg.error || 'Fehler in der Bruecke'));
          }
          return;
        }
        state.recv += 1;
        for (const m of decodePacket(ev.data)) {
          on.log({ dir: 'in', address: m.address, args: m.args, at: Date.now(), note: '' });
          on.feedback(m);
        }
      };

      sock.onerror = () => {
        if (ws !== sock) return;
        state.error = 'keine Verbindung';
      };

      sock.onclose = () => {
        if (ws !== sock) return;
        ws = null;
        clearInterval(pingTimer);
        state.latency = null;
        if (!wanted) { setStatus('off'); return; }
        setStatus('connecting', state.error || 'getrennt');
        attempt += 1;
        const wait = Math.min(RECONNECT_MAX, RECONNECT_MIN * Math.pow(1.6, Math.min(attempt, 8)));
        reconnectTimer = setTimeout(() => { if (wanted) this.connect(); }, wait);
      };
    },

    disconnect() {
      wanted = false;
      clearTimeout(reconnectTimer);
      clearInterval(pingTimer);
      if (ws) { try { ws.close(); } catch { /* egal */ } ws = null; }
      state.latency = null;
      setStatus('off');
    },

    /** Sofort senden (Taster, Auswahl — jeder Druck zaehlt). */
    sendNow(address, args) {
      pending.delete(address);
      transmit(address, args);
    },

    /**
     * Gebuendelt senden (Fader, Poti, XY, Farbe): pro Adresse bleibt nur der
     * letzte Wert eines 16-ms-Fensters uebrig. Das haelt die Funkstrecke frei
     * und den Regler trotzdem fluessig.
     */
    send(address, args) {
      pending.set(address, { address, args });
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
    },

    /** Alles Wartende sofort rausschreiben (z. B. beim Loslassen). */
    flush,
  };
}
