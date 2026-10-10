// Una mesa de torneo: guarda el estado del motor, quién es quién, los bots y los relojes.
// No sabe de Socket.IO: avisa de cambios con el callback `onChange` que le da el servidor.

import { randomBytes } from 'node:crypto';
import {
  MAXP, TURN_LIMIT, createState, addPlayer, removePlayer, startHand, act, autoAct, resign, sitIn,
  rebuy, declineRebuy, pendingRebuys, viewFor, isBetting,
} from './engine.js';
import { decide, makeBots, botDelay, botWantsRebuy, DIFFICULTIES } from './bots.js';

export const LEVEL_CHOICES = [2, 5, 10, 15, 20, 30];

const rid = () => randomBytes(5).toString('hex');

export function cleanNick(nick) {
  const n = String(nick ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return n || 'Jugador';
}

export class Room {
  // opts: { code, solo, levelMinutes } ; tuning: tiempos (se cambian en las pruebas)
  constructor(opts, tuning = {}, onChange = () => {}) {
    this.code = opts.code;
    this.solo = !!opts.solo;
    this.levelMinutes = LEVEL_CHOICES.includes(opts.levelMinutes) ? opts.levelMinutes : (this.solo ? 5 : 15);
    this.tuning = {
      turnLimitMs: TURN_LIMIT, dealDelayMs: 5000, rebuyWindowMs: 60000,
      botDelay: botDelay, levelMs: this.levelMinutes * 60000, ...tuning,
    };
    this.onChange = onChange;
    this.state = createState({ levelMs: this.tuning.levelMs });
    this.bots = new Map();      // playerId -> { difficulty, style }
    this.tokens = new Map();    // token secreto -> playerId
    this.timeouts = new Map();  // playerId -> turnos seguidos agotados
    this.connections = 0;       // sockets conectados (lo actualiza el servidor)
    this.emptySince = Date.now();
    this.ownerId = null;
    this.turnKey = null; this.turnTimer = null; this.dealTimer = null; this.rebuyTimer = null;
    this.dealAt = null; this.rebuyAt = null; this.turnAt = null; this.handledHand = 0;
    this.closed = false;
  }

  /* ---------- identidad ---------- */

  playerIdOf(token) { return this.tokens.get(token) || null; }
  player(id) { return this.state.players.find(p => p.id === id); }
  humans() { return this.state.players.filter(p => !this.bots.has(p.id)); }
  started() { return this.state.handNo > 0; }

  /* ---------- acciones de los jugadores (lanzan Error con mensaje en español) ---------- */

  sit(token, nick, seat) {
    if (this.playerIdOf(token)) throw new Error('Ya estás sentado.');
    const id = 'h' + rid();
    addPlayer(this.state, { id, nick: cleanNick(nick), seat });
    this.tokens.set(token, id);
    if (!this.ownerId) this.ownerId = id;
    this.changed();
  }

  addBots(token, count, difficulty) {
    this.requireSeated(token);
    if (this.started()) throw new Error('El torneo ya empezó.');
    if (!DIFFICULTIES.includes(difficulty)) throw new Error('Dificultad no válida.');
    const libres = [...Array(MAXP).keys()].filter(i => !this.state.players.some(p => p.seat === i));
    if (!Number.isInteger(count) || count < 1) throw new Error('Cantidad no válida.');
    if (count > libres.length) throw new Error('No hay tantos asientos libres.');
    const nuevos = makeBots(count, difficulty, this.state.players.map(p => p.nick));
    // reparte a los bots en asientos libres lo más separados posible
    nuevos.forEach((b, i) => {
      const seat = libres[Math.floor(i * libres.length / count)];
      const id = 'b' + rid();
      addPlayer(this.state, { id, nick: b.name, seat });
      this.bots.set(id, { difficulty: b.difficulty, style: b.style });
    });
    this.changed();
  }

  removeBot(token, seat) {
    this.requireSeated(token);
    if (this.started()) throw new Error('El torneo ya empezó.');
    const p = this.state.players.find(x => x.seat === seat && this.bots.has(x.id));
    if (!p) throw new Error('Ahí no hay un bot.');
    removePlayer(this.state, p.id);
    this.bots.delete(p.id);
    this.changed();
  }

  leave(token) {
    const id = this.requireSeated(token);
    if (this.started()) { resign(this.state, id); }
    else { removePlayer(this.state, id); this.tokens.delete(token); if (this.ownerId === id) this.ownerId = this.humans()[0]?.id || null; }
    this.changed();
  }

  start(token) {
    this.requireSeated(token);
    if (this.started()) throw new Error('El torneo ya empezó.');
    if (this.state.players.length < 2) throw new Error('Se necesitan al menos 2 jugadores. Puedes agregar bots.');
    startHand(this.state);
    this.changed();
  }

  act(token, type, amount) {
    const id = this.requireSeated(token);
    act(this.state, id, type, amount);
    this.timeouts.set(id, 0);
    this.changed();
  }

  rebuy(token) { rebuy(this.state, this.requireSeated(token)); this.changed(); }
  decline(token) { declineRebuy(this.state, this.requireSeated(token)); this.changed(); }
  resign(token) { resign(this.state, this.requireSeated(token)); this.changed(); }
  sitIn(token) { const id = this.requireSeated(token); sitIn(this.state, id); this.timeouts.set(id, 0); this.changed(); }

  requireSeated(token) {
    const id = this.playerIdOf(token);
    if (!id || !this.player(id)) throw new Error('No estás sentado en esta mesa.');
    return id;
  }

  /* ---------- lo que ve cada quien ---------- */

  snapshot(token) {
    const you = this.playerIdOf(token);
    const s = this.state;
    const view = viewFor(s, you);
    view.players.forEach(p => { p.isBot = this.bots.has(p.id); });
    const left = t => (t ? Math.max(0, t - Date.now()) : null);
    return {
      code: this.code, solo: this.solo, you, view, ownerId: this.ownerId,
      levelMinutes: this.levelMinutes, maxPlayers: MAXP,
      levelLeftMs: left(s.levelEndsAt), turnLeftMs: left(this.turnAt), dealLeftMs: left(this.dealAt), rebuyLeftMs: left(this.rebuyAt),
      nextBlinds: s.config.levels[Math.min(s.level + 1, s.config.levels.length - 1)],
      pending: pendingRebuys(s).map(p => p.id),
    };
  }

  /* ---------- relojes y bots ---------- */

  changed() {
    if (this.closed) return;
    this.runBots();
    this.schedule();
    this.onChange(this);
  }

  clearTimers() {
    for (const k of ['turnTimer', 'dealTimer', 'rebuyTimer']) { clearTimeout(this[k]); this[k] = null; }
    this.turnKey = null; this.turnAt = null; this.dealAt = null; this.rebuyAt = null;
  }

  close() { this.closed = true; this.clearTimers(); }

  // En práctica en solitario, si nadie está conectado la mesa se congela.
  paused() { return this.solo && this.connections === 0; }

  // Al terminar cada mano los bots deciden si recompran.
  runBots() {
    const s = this.state;
    if (s.phase !== 'showdown' || this.handledHand === s.handNo) return;
    this.handledHand = s.handNo;
    for (const p of pendingRebuys(s)) {
      if (!this.bots.has(p.id)) continue;
      if (p.rebuysLeft > 0 && botWantsRebuy()) rebuy(s, p.id); else declineRebuy(s, p.id);
    }
  }

  schedule() {
    const s = this.state;
    if (s.finished || this.paused()) { this.clearTimers(); return; }

    if (isBetting(s)) {
      clearTimeout(this.dealTimer); this.dealTimer = null; this.dealAt = null;
      clearTimeout(this.rebuyTimer); this.rebuyTimer = null; this.rebuyAt = null;
      const key = `${s.handNo}:${s.toAct}:${s.turnAt}`;
      if (key === this.turnKey) return;
      clearTimeout(this.turnTimer);
      this.turnKey = key;
      const id = s.toAct;
      if (this.bots.has(id)) {
        this.turnAt = null;
        this.turnTimer = setTimeout(() => this.botTurn(id, key), this.tuning.botDelay(this.bots.get(id).difficulty));
      } else {
        this.turnAt = Date.now() + this.tuning.turnLimitMs;
        this.turnTimer = setTimeout(() => this.turnExpired(id, key), this.tuning.turnLimitMs);
      }
      return;
    }

    // entre manos
    clearTimeout(this.turnTimer); this.turnTimer = null; this.turnKey = null; this.turnAt = null;
    if (s.phase !== 'showdown') return;
    const conFichas = s.players.filter(p => p.stack > 0).length;
    const pend = pendingRebuys(s);
    if (conFichas >= 2) {
      clearTimeout(this.rebuyTimer); this.rebuyTimer = null; this.rebuyAt = null;
      if (!this.dealTimer) {
        this.dealAt = Date.now() + this.tuning.dealDelayMs;
        this.dealTimer = setTimeout(() => this.deal(), this.tuning.dealDelayMs);
      }
    } else if (pend.length && !this.rebuyTimer) {
      // solo queda uno con fichas: los que se quedaron sin ellas deciden si recompran
      this.rebuyAt = Date.now() + this.tuning.rebuyWindowMs;
      this.rebuyTimer = setTimeout(() => {
        this.rebuyTimer = null; this.rebuyAt = null;
        for (const p of pendingRebuys(this.state)) { try { declineRebuy(this.state, p.id); } catch { /* ya decidió */ } }
        this.changed();
      }, this.tuning.rebuyWindowMs);
    }
  }

  deal() {
    this.dealTimer = null; this.dealAt = null;
    if (this.closed) return;
    try { startHand(this.state); } catch { /* no hay suficientes jugadores activos: se espera */ }
    this.changed();
  }

  botTurn(id, key) {
    if (this.closed || this.turnKey !== key || this.state.toAct !== id) return;
    const bot = this.bots.get(id);
    try {
      const jugada = decide(viewFor(this.state, id), id, { difficulty: bot.difficulty, style: bot.style });
      act(this.state, id, jugada.type, jugada.amount);
    } catch {
      try { autoAct(this.state); } catch { /* no debería pasar */ }
    }
    this.changed();
  }

  turnExpired(id, key) {
    if (this.closed || this.turnKey !== key || this.state.toAct !== id) return;
    const n = (this.timeouts.get(id) || 0) + 1;
    this.timeouts.set(id, n);
    try {
      if (n >= 2) resign(this.state, id); // dos turnos seguidos sin jugar: queda ausente
      else autoAct(this.state);
    } catch { /* ya no es su turno */ }
    this.changed();
  }
}
