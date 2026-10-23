// Una mesa de torneo: guarda el estado del motor, quién es quién, el personaje de cada jugador, los bots y los relojes.
// No sabe de Socket.IO: avisa de cambios con el callback `onChange` que le da el servidor.

import { randomBytes } from 'node:crypto';
import {
  MAXP, TURN_LIMIT, RESULT_MS, RESULT_FOLD_MS, createState, addPlayer, removePlayer, startHand, act, autoAct, resign, sitIn,
  rebuy, declineRebuy, pendingRebuys, viewFor, isBetting,
} from './engine.js';
import { decide, makeBots, botDelay, botWantsRebuy, DIFFICULTIES, CAST } from './bots.js';

export const LEVEL_CHOICES = [2, 5, 10, 15, 20, 30];
// Cuántos se sientan: el máximo de la mesa, o tantos como personajes haya si son menos (cada quien lleva uno distinto).
export const CAPACITY = Math.min(MAXP, CAST.length);
// Quien se desconecta antes de que empiece el torneo conserva su asiento y su personaje este tiempo (recargar,
// bloquear el celular o irse a WhatsApp a pasar el código no lo saca); si no vuelve, se le levanta.
export const RELEASE_MS = 5 * 60 * 1000;

const rid = () => randomBytes(5).toString('hex');
// Error con un código, para que el cliente sepa qué hacer (por ejemplo, dejar abierto el selector de personaje).
const fail = (code, message) => Object.assign(new Error(message), { code });

export function cleanNick(nick) {
  const n = String(nick ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return n || 'Jugador';
}

export class Room {
  // opts: { code, solo, levelMinutes, cast } (cast: los personajes en uso, los de personajes.json; las pruebas pueden
  // pasar otros); tuning: tiempos (se cambian en las pruebas)
  constructor(opts, tuning = {}, onChange = () => {}) {
    this.code = opts.code;
    this.solo = !!opts.solo;
    this.cast = opts.cast || CAST;
    this.capacity = Math.min(MAXP, this.cast.length);
    this.levelMinutes = LEVEL_CHOICES.includes(opts.levelMinutes) ? opts.levelMinutes : (this.solo ? 5 : 15);
    this.tuning = {
      turnLimitMs: TURN_LIMIT, resultMs: RESULT_MS, resultFoldMs: RESULT_FOLD_MS, rebuyWindowMs: 60000, releaseMs: RELEASE_MS,
      botDelay: botDelay, levelMs: this.levelMinutes * 60000, ...tuning,
    };
    this.onChange = onChange;
    this.state = createState({ levelMs: this.tuning.levelMs });
    this.bots = new Map();      // playerId -> { difficulty, style }
    this.chars = new Map();     // playerId -> personaje (el humano lo elige al sentarse; cada bot trae el suyo)
    this.tokens = new Map();    // token secreto -> playerId
    this.timeouts = new Map();  // playerId -> turnos seguidos agotados
    this.connections = 0;       // sockets conectados (los avisa el servidor con connect y disconnect)
    this.online = new Map();    // token -> cuántos sockets suyos están conectados a esta mesa
    this.releases = new Map();  // token -> reloj para levantar a quien se desconectó antes de empezar
    this.emptySince = Date.now();
    this.ownerId = null;
    this.turnKey = null; this.turnTimer = null; this.dealTimer = null; this.rebuyTimer = null;
    this.dealAt = null; this.rebuyAt = null; this.turnAt = null; this.handledHand = 0;
    this.readyHand = 0; this.readyIds = new Set(); // quién tocó Listo en el resultado de la mano readyHand
    this.closed = false;
  }

  /* ---------- identidad ---------- */

  playerIdOf(token) { return this.tokens.get(token) || null; }
  player(id) { return this.state.players.find(p => p.id === id); }
  humans() { return this.state.players.filter(p => !this.bots.has(p.id)); }
  started() { return this.state.handNo > 0; }
  sillasOf(charId) { return this.cast.find(c => c.id === charId)?.sillas || 1; }
  // Quién tiene un personaje (null si está libre).
  holderOf(charId) { return this.state.players.find(p => this.chars.get(p.id) === charId) || null; }

  /* ---------- acciones de los jugadores (lanzan Error con mensaje en español) ---------- */

  // Elegir personaje es sentarse, en el siguiente asiento libre. Es síncrono, igual que el servidor que lo llama (sin
  // await de por medio): si dos eligen el mismo personaje al mismo tiempo, gana el primero que llega y al otro se le
  // pide que elija otro.
  sit(token, nick, character) {
    if (this.playerIdOf(token)) throw new Error('Ya estás sentado.');
    if (this.started()) throw new Error('El torneo ya empezó, no se pueden sentar más jugadores.');
    if (this.state.players.length >= this.capacity) throw fail('llena', 'La mesa está llena. Puedes quedarte a mirar.');
    const look = this.cast.find(c => c.id === character);
    if (!look) throw fail('personaje', 'Elige un personaje.');
    const holder = this.holderOf(look.id);
    if (holder) throw fail('ocupado', `${holder.nick} ya eligió a ${look.name}. Elige otro personaje.`);
    const seat = [...Array(MAXP).keys()].find(i => !this.state.players.some(p => p.seat === i));
    const id = 'h' + rid();
    addPlayer(this.state, { id, nick: cleanNick(nick), seat });
    this.tokens.set(token, id);
    this.chars.set(id, look.id);
    if (!this.ownerId) this.ownerId = id;
    this.changed();
  }

  // Solo en práctica (la sala privada es de humanos): cada bot con un personaje que nadie usa, al azar.
  addBots(token, count, difficulty) {
    this.requireSeated(token);
    if (!this.solo) throw new Error('La sala privada es solo para humanos.');
    if (this.started()) throw new Error('El torneo ya empezó.');
    if (!DIFFICULTIES.includes(difficulty)) throw new Error('Dificultad no válida.');
    const libres = [...Array(MAXP).keys()].filter(i => !this.state.players.some(p => p.seat === i));
    if (!Number.isInteger(count) || count < 1) throw new Error('Cantidad no válida.');
    if (count > Math.min(libres.length, this.capacity - this.state.players.length)) throw new Error('No hay tantos asientos libres.');
    const nuevos = makeBots(count, difficulty, this.state.players.map(p => p.nick), Math.random, [...this.chars.values()], this.cast);
    // reparte a los bots en asientos libres lo más separados posible
    nuevos.forEach((b, i) => {
      const seat = libres[Math.floor(i * libres.length / count)];
      const id = 'b' + rid();
      addPlayer(this.state, { id, nick: b.name, seat });
      this.bots.set(id, { difficulty: b.difficulty, style: b.style });
      if (b.character) this.chars.set(id, b.character);
    });
    this.changed();
  }

  // Levantarse: antes de empezar deja libres su asiento y su personaje; ya empezado, queda ausente con los dos.
  leave(token) {
    const id = this.requireSeated(token);
    if (this.started()) { resign(this.state, id); }
    else {
      removePlayer(this.state, id);
      this.tokens.delete(token); this.chars.delete(id); this.stopRelease(token);
      if (this.ownerId === id) this.ownerId = this.humans()[0]?.id || null;
    }
    this.changed();
  }

  // "Salir de la mesa": antes de empezar también lo levanta (su personaje queda libre); ya empezado, conserva su lugar.
  exit(token) {
    if (!this.started() && this.player(this.playerIdOf(token))) this.leave(token);
  }

  start(token) {
    this.requireSeated(token);
    if (this.started()) throw new Error('El torneo ya empezó.');
    if (this.state.players.length < 2) throw new Error('Se necesitan al menos 2 jugadores: pásales el link a tus amigos.');
    startHand(this.state);
    for (const t of [...this.releases.keys()]) this.stopRelease(t); // ya empezado, nadie pierde su lugar
    this.changed();
  }

  act(token, type, amount) {
    const id = this.requireSeated(token);
    act(this.state, id, type, amount);
    this.timeouts.set(id, 0);
    this.changed();
  }

  // Listo en el resultado de la mano `hand` (si llega tarde, ya no cuenta para la siguiente).
  ready(token, hand) {
    const id = this.requireSeated(token);
    const s = this.state;
    if (s.phase !== 'showdown' || s.finished || hand !== s.handNo) return;
    if (this.readyHand !== s.handNo) { this.readyHand = s.handNo; this.readyIds = new Set(); }
    this.readyIds.add(id);
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

  /* ---------- conexiones (las avisa el servidor) ---------- */

  connect(token) {
    this.connections++;
    this.online.set(token, (this.online.get(token) || 0) + 1);
    this.stopRelease(token);
  }

  // Si se va el último socket de alguien sentado antes de que empiece el torneo, se le guarda el lugar `releaseMs`:
  // si vuelve con su token, lo recupera; si no, se le levanta y su personaje queda libre. Ya empezado, conserva su
  // lugar como siempre (el reloj juega por él).
  disconnect(token) {
    this.connections = Math.max(0, this.connections - 1);
    const n = (this.online.get(token) || 0) - 1;
    if (n > 0) { this.online.set(token, n); return; }
    this.online.delete(token);
    if (this.closed || this.started() || !this.player(this.playerIdOf(token))) return;
    this.stopRelease(token);
    this.releases.set(token, setTimeout(() => {
      this.releases.delete(token);
      if (this.closed || this.started() || this.online.has(token) || !this.player(this.playerIdOf(token))) return;
      this.leave(token);
    }, this.tuning.releaseMs));
  }

  stopRelease(token) { clearTimeout(this.releases.get(token)); this.releases.delete(token); }

  /* ---------- lo que ve cada quien ---------- */

  snapshot(token) {
    const you = this.playerIdOf(token);
    const s = this.state;
    const view = viewFor(s, you);
    view.players.forEach(p => { p.isBot = this.bots.has(p.id); p.character = this.chars.get(p.id) || null; });
    const left = t => (t ? Math.max(0, t - Date.now()) : null);
    // resultado de la mano: quién ya tocó Listo, a quién se espera y si mi Listo cuenta
    const showing = s.phase === 'showdown' && !s.finished;
    const ready = showing ? this.readyNow() : new Set(), need = this.needReady();
    return {
      code: this.code, solo: this.solo, you, view, ownerId: this.ownerId,
      levelMinutes: this.levelMinutes, maxPlayers: MAXP, capacity: this.capacity,
      // los personajes en uso, en el orden de personajes.json, y quién tiene cada uno (para el selector)
      cast: this.cast.map(c => ({ id: c.id, name: c.name, holder: this.holderOf(c.id)?.id || null })),
      levelLeftMs: left(s.levelEndsAt), turnLeftMs: left(this.turnAt), dealLeftMs: left(this.dealAt), rebuyLeftMs: left(this.rebuyAt),
      nextBlinds: s.config.levels[Math.min(s.level + 1, s.config.levels.length - 1)],
      pending: pendingRebuys(s).map(p => p.id),
      resultMs: s.results && s.results.fold ? this.tuning.resultFoldMs : this.tuning.resultMs,
      readyIds: [...ready],
      waitIds: showing ? need.filter(p => !ready.has(p.id)).map(p => p.id) : [],
      canReady: showing && !!you && (need.length === 0 || need.some(p => p.id === you)),
    };
  }

  // Los demás jugadores, del que le queda más al centro del fondo a quien creó la mesa al que menos. Cada quien ve la
  // mesa girada desde su asiento: los demás se acomodan en su pantalla en el orden de juego desde él (como
  // seatPlan en client/stage/config.js), y el del centro es el de en medio (con un número par, primero el de la
  // izquierda de los dos de en medio).
  byCenter() {
    const owner = this.player(this.ownerId);
    if (!owner) return [];
    const rel = p => (p.seat - owner.seat + MAXP) % MAXP;
    const others = this.state.players.filter(p => p !== owner).sort((a, b) => rel(a) - rel(b));
    const mid = (others.length - 1) / 2;
    return others.map((p, i) => ({ p, i, d: Math.abs(i - mid) })).sort((a, b) => a.d - b.d || a.i - b.i).map(x => x.p);
  }

  // Don Tentáculos ocupa dos sillas y necesita más espacio: en práctica, cuando sale entre los bots (al azar, como
  // cualquiera), se sienta al centro del fondo del jugador; si ahí hay otro bot, cambian de silla (cada uno conserva
  // su nombre, su personaje y su dificultad). Si el jugador lo eligió, el centro es para el bot que ahí quede. Solo
  // se puede para uno (cada quien ve la mesa girada desde su asiento): en la sala privada, que es solo de humanos,
  // nadie se mueve. Ya empezado el torneo, los asientos no cambian.
  arrange() {
    if (this.started()) return;
    const grande = this.state.players.find(p => this.bots.has(p.id) && this.sillasOf(this.chars.get(p.id)) > 1);
    if (!grande) return;
    const lugar = this.byCenter().find(p => this.bots.has(p.id));
    if (!lugar || lugar === grande) return;
    [grande.seat, lugar.seat] = [lugar.seat, grande.seat];
  }

  /* ---------- Listo: pasar a la siguiente mano ---------- */

  // A quién se espera: a los humanos que siguen en el torneo y no están ausentes. Los bots, los eliminados
  // y los espectadores no cuentan; si alguien se desconectó, decide el reloj.
  needReady() { return this.humans().filter(p => !p.out && !p.sittingOut); }
  readyNow() { return this.readyHand === this.state.handNo ? this.readyIds : new Set(); }
  // ¿Ya tocaron Listo todos los que cuentan? Si no cuenta nadie (en práctica ya quedaste fuera y ves
  // a los bots), basta el Listo de cualquiera que esté sentado. Sin ningún Listo, decide el reloj.
  allReady() {
    const ready = this.readyNow(), need = this.needReady();
    return need.length ? need.every(p => ready.has(p.id)) : ready.size > 0;
  }

  /* ---------- relojes y bots ---------- */

  changed() {
    if (this.closed) return;
    this.arrange();
    this.runBots();
    this.schedule();
    this.onChange(this);
  }

  clearTimers() {
    for (const k of ['turnTimer', 'dealTimer', 'rebuyTimer']) { clearTimeout(this[k]); this[k] = null; }
    this.turnKey = null; this.turnAt = null; this.dealAt = null; this.rebuyAt = null;
  }

  close() {
    this.closed = true;
    this.clearTimers();
    for (const t of [...this.releases.keys()]) this.stopRelease(t);
  }

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
      if (this.allReady()) { // todos tocaron Listo: se reparte ya (en cuanto termine este aviso de cambios)
        if (!this.dealTimer || this.dealAt > Date.now()) {
          clearTimeout(this.dealTimer);
          this.dealAt = Date.now();
          this.dealTimer = setTimeout(() => this.deal(), 0);
        }
      } else if (!this.dealTimer) { // el resultado se ve un rato (menos si todos se retiraron)
        const ms = s.results && s.results.fold ? this.tuning.resultFoldMs : this.tuning.resultMs;
        this.dealAt = Date.now() + ms;
        this.dealTimer = setTimeout(() => this.deal(), ms);
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
    try { startHand(this.state); } catch {
      // no hay suficientes jugadores activos: se espera otra vuelta del reloj (los Listo ya no cuentan)
      this.readyHand = 0;
    }
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
