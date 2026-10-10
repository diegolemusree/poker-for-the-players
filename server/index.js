// Servidor: Express para los archivos del cliente y Socket.IO para jugar en tiempo real.
// Aquí no hay reglas de póker: todo pasa por Room y el motor, y cada jugador solo recibe su vista.

import { createServer } from 'node:http';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { Server } from 'socket.io';
import { Room, cleanNick } from './room.js';
import { DIFFICULTIES } from './bots.js';
import { MAXP } from './engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const EMPTY_TTL = 30 * 60 * 1000;

function iguales(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

// `clientMiddleware` sirve el cliente: Vite en desarrollo, `dist/` en producción. Sin él (pruebas), los archivos tal cual.
export function createApp({ accessCode = process.env.ACCESS_CODE || '', tuning = {}, emptyTtlMs = EMPTY_TTL, clientMiddleware } = {}) {
  const app = express();
  const http = createServer(app);
  const io = new Server(http, { maxHttpBufferSize: 1e4 });
  const rooms = new Map();

  app.disable('x-powered-by');
  app.get('/api/config', (_req, res) => res.json({ accessRequired: !!accessCode }));
  app.use(express.static(path.join(ROOT, 'public')));
  app.use(clientMiddleware || express.static(path.join(ROOT, 'client')));

  // Código de acceso del grupo: se valida aquí, en el servidor.
  io.use((socket, next) => {
    const { token, accessCode: given } = socket.handshake.auth || {};
    if (typeof token !== 'string' || token.length < 16 || token.length > 100) return next(new Error('Sesión no válida.'));
    if (accessCode && !iguales(given, accessCode)) return next(new Error('Código de acceso incorrecto.'));
    next();
  });

  function newCode() {
    for (;;) {
      const c = Array.from({ length: 5 }, () => LETRAS[randomInt(LETRAS.length)]).join('');
      if (!rooms.has(c)) return c;
    }
  }

  function broadcast(room) {
    for (const sock of io.sockets.adapter.rooms.get(room.code) || []) {
      const s = io.sockets.sockets.get(sock);
      if (s) s.emit('state', room.snapshot(s.handshake.auth.token));
    }
  }

  function makeRoom(opts) {
    const room = new Room({ ...opts, code: newCode() }, tuning, broadcast);
    rooms.set(room.code, room);
    return room;
  }

  io.on('connection', (socket) => {
    const token = socket.handshake.auth.token;
    let room = null;

    const enter = (r) => {
      if (room === r) return;
      leaveRoom();
      room = r;
      socket.join(r.code);
      r.connections++;
      r.emptySince = null;
      r.changed(); // reanuda una práctica congelada y avisa a todos
    };
    const leaveRoom = () => {
      if (!room) return;
      socket.leave(room.code);
      room.connections = Math.max(0, room.connections - 1);
      if (room.connections === 0) room.emptySince = Date.now();
      const r = room; room = null;
      r.changed();
    };

    // Todas las acciones pasan por aquí: validan tipos y devuelven errores en español.
    const handle = (fn) => (data, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      try {
        const out = fn(data && typeof data === 'object' ? data : {}) || {};
        reply({ ok: true, ...out });
      } catch (e) {
        reply({ error: e && e.message ? e.message : 'Algo salió mal.' });
      }
    };
    const need = () => { if (!room) throw new Error('Primero entra a una mesa.'); return room; };

    socket.on('room:create', handle((d) => {
      const solo = !!d.solo;
      const n = Number(d.bots);
      if (solo && (!Number.isInteger(n) || n < 1 || n >= MAXP)) throw new Error(`Elige de 1 a ${MAXP - 1} rivales.`);
      if (solo && !DIFFICULTIES.includes(d.difficulty)) throw new Error('Dificultad no válida.');
      const r = makeRoom({ solo, levelMinutes: d.levelMinutes });
      enter(r);
      r.sit(token, cleanNick(d.nick), 0);
      if (solo) {
        r.addBots(token, n, d.difficulty);
        r.start(token);
      }
      return { code: r.code };
    }));

    socket.on('room:join', handle((d) => {
      const code = String(d.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) throw new Error('Esa mesa no existe o ya se cerró. Puedes crear una nueva.');
      if (r.solo && !r.playerIdOf(token)) throw new Error('Esa mesa es privada.');
      enter(r);
      return { code: r.code };
    }));

    socket.on('sit', handle((d) => { need().sit(token, d.nick, d.seat); }));
    socket.on('bots:add', handle((d) => { need().addBots(token, Number(d.count) || 1, d.difficulty); }));
    socket.on('bots:remove', handle((d) => { need().removeBot(token, d.seat); }));
    socket.on('start', handle(() => { need().start(token); }));
    socket.on('act', handle((d) => { need().act(token, String(d.type), d.amount); }));
    socket.on('rebuy', handle(() => { need().rebuy(token); }));
    socket.on('decline', handle(() => { need().decline(token); }));
    socket.on('resign', handle(() => { need().resign(token); }));
    socket.on('sitin', handle(() => { need().sitIn(token); }));
    socket.on('leave', handle(() => { need().leave(token); }));
    socket.on('room:exit', handle(() => { leaveRoom(); }));
    socket.on('disconnect', leaveRoom);
  });

  // Mesas vacías se borran de memoria tras 30 minutos.
  const sweeper = setInterval(() => {
    for (const [code, r] of rooms) {
      if (r.connections === 0 && r.emptySince && Date.now() - r.emptySince > emptyTtlMs) { r.close(); rooms.delete(code); }
    }
  }, 30000);
  sweeper.unref();

  return {
    app, http, io, rooms,
    listen: (port = 3000, host) => new Promise(res => http.listen(port, host, () => res(http.address().port))),
    close: () => new Promise(res => { clearInterval(sweeper); rooms.forEach(r => r.close()); io.close(() => res()); }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
  let clientMiddleware;
  if (prod) {
    if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) { console.error('Falta dist/. Corre "npm run build" antes de "npm start".'); process.exit(1); }
    clientMiddleware = express.static(path.join(ROOT, 'dist'));
  } else {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({ configFile: path.join(ROOT, 'vite.config.js'), server: { middlewareMode: true }, appType: 'spa' });
    clientMiddleware = vite.middlewares;
  }
  const srv = createApp({ clientMiddleware });
  srv.listen(port).then(p => {
    console.log(`Poker for the Players en http://localhost:${p}${prod ? '' : ' (desarrollo, con Vite)'}`);
    if (!process.env.ACCESS_CODE) console.log('(sin ACCESS_CODE: no se pide código de acceso)');
  });
}
