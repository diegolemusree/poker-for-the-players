// Caras y reversos de las cartas dibujados por código en canvas (se hacen una vez y se reusan).
// Números rotulados con letra gordita (Chewy) y palos dibujados a mano con contorno de tinta,
// grandes para leer de lejos. Las figuras J, Q y K son criaturas inventadas con ojos de párpado caído.
// El reverso lleva el logo de Poker for the Players.

import { SUIT_PATH } from '../ui/suits.js';
import { BARAJA_NUEVA } from '../ui/palos.js';
import { cardImage as cartaNueva } from './baraja.js';
import { INK } from './table.js';

export const CARD_PX = [256, 368];
const RED = '#a8352a', PAPER = '#efe4c8', NUM = '"Chewy", "Marker Felt", "Comic Sans MS", cursive';

const paths = {};
// Dibuja un palo centrado en (x, y) de `size` px: primero el trazo grueso y encima el relleno,
// así solo queda la orilla de afuera (sin líneas internas en el trébol).
export function drawSuit(g, suit, x, y, size, fill, line = size * 0.09) {
  paths[suit] = paths[suit] || new Path2D(SUIT_PATH[suit]);
  g.save();
  g.translate(x - size / 2, y - size / 2);
  g.scale(size / 100, size / 100);
  g.lineJoin = 'round';
  g.lineWidth = (line * 2 * 100) / size; g.strokeStyle = INK; g.stroke(paths[suit]);
  g.fillStyle = fill; g.fill(paths[suit]);
  g.restore();
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
// texto rotulado: contorno de tinta grueso y relleno encima
function inked(g, text, x, y, size, fill, line) {
  g.font = `${size}px ${NUM}`;
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.lineJoin = 'round'; g.lineWidth = line; g.strokeStyle = INK;
  g.strokeText(text, x, y);
  g.fillStyle = fill; g.fillText(text, x, y);
}
function paperBase(g, W, H) {
  g.fillStyle = PAPER; roundRect(g, 0, 0, W, H, 30); g.fill();
  g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = INK; roundRect(g, 5, 5, W - 10, H - 10, 26); g.stroke();
}

// Criatura de figura: J un blob de un ojo, Q una dama de tres ojos con tiara, K un rey con antenas y corona.
function figure(g, rank, x, y, col) {
  const skin = { J: '#8a9a52', Q: '#c08a7a', K: '#c9963f' }[rank];
  g.lineWidth = 6; g.strokeStyle = INK; g.lineJoin = 'round'; g.lineCap = 'round';
  g.fillStyle = skin;
  g.beginPath(); g.ellipse(x, y + 14, 62, 70, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  const eyes = rank === 'J' ? [[0, 0, 24]] : rank === 'Q' ? [[-24, 6, 14], [24, 6, 14], [0, -22, 11]] : [[-22, 2, 15], [22, 2, 15]];
  for (const [ex, ey, r] of eyes) {
    g.fillStyle = '#fbf6e6'; g.beginPath(); g.arc(x + ex, y + ey, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(x + ex + r * .15, y + ey + r * .3, r * .22, 0, Math.PI * 2); g.fill();
    g.fillStyle = skin; g.beginPath(); g.arc(x + ex, y + ey, r, Math.PI * 1.06, Math.PI * 1.94); g.closePath(); g.fill(); g.stroke();
  }
  g.beginPath(); g.moveTo(x - 18, y + 46); g.quadraticCurveTo(x, y + 40, x + 16, y + 44); g.stroke();
  g.fillStyle = col;
  if (rank === 'K') { // corona de picos redondos
    g.beginPath(); g.moveTo(x - 46, y - 40); g.quadraticCurveTo(x - 50, y - 70, x - 44, y - 88); g.quadraticCurveTo(x - 30, y - 64, x - 20, y - 64);
    g.quadraticCurveTo(x - 6, y - 92, x, y - 98); g.quadraticCurveTo(x + 6, y - 92, x + 20, y - 64); g.quadraticCurveTo(x + 30, y - 64, x + 44, y - 88);
    g.quadraticCurveTo(x + 50, y - 70, x + 46, y - 40); g.closePath(); g.fill(); g.stroke();
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x + s * 50, y - 20); g.quadraticCurveTo(x + s * 70, y - 40, x + s * 80, y - 70); g.stroke(); g.beginPath(); g.arc(x + s * 82, y - 74, 9, 0, Math.PI * 2); g.fill(); g.stroke(); }
  } else if (rank === 'Q') { // tiara
    g.beginPath(); g.moveTo(x - 38, y - 46); g.quadraticCurveTo(x, y - 104, x + 38, y - 46); g.quadraticCurveTo(x, y - 64, x - 38, y - 46); g.fill(); g.stroke();
  } else { // gorrito con borla
    g.beginPath(); g.moveTo(x - 36, y - 44); g.quadraticCurveTo(x - 8, y - 70, x + 4, y - 96); g.quadraticCurveTo(x + 20, y - 66, x + 36, y - 44); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.arc(x + 4, y - 98, 9, 0, Math.PI * 2); g.fill(); g.stroke();
  }
}

const faces = new Map();
// Cara de una carta ('Ah', 'Td'...) o el reverso (code = null).
export function cardImage(code) {
  if (BARAJA_NUEVA) return cartaNueva(code);   // la baraja nueva, en revisión (?baraja=nueva)
  const key = code || 'back';
  if (faces.has(key)) return faces.get(key);
  const [W, H] = CARD_PX;
  const [c, g] = canvas(W, H);
  if (code) {
    const rank = code[0] === 'T' ? '10' : code[0], suit = code[1];
    const col = 'hd'.includes(suit) ? RED : INK;
    const suitFill = 'hd'.includes(suit) ? RED : '#2b2622';
    paperBase(g, W, H);
    const corner = () => {
      inked(g, rank, 58, 104, rank === '10' ? 84 : 98, col === INK ? '#2b2622' : col, 8);
      drawSuit(g, suit, 58, 146, 56, suitFill, 4);
    };
    corner();
    g.save(); g.translate(W, H); g.rotate(Math.PI); corner(); g.restore();
    if ('JQK'.includes(rank)) figure(g, rank, 158, 200, suitFill);
    else drawSuit(g, suit, 160, 206, 128, suitFill, 6);
  } else {
    g.fillStyle = '#2f3f5c'; roundRect(g, 0, 0, W, H, 30); g.fill();
    g.save(); roundRect(g, 0, 0, W, H, 30); g.clip();
    g.fillStyle = '#3d4f6e';
    for (let y = 24; y < H; y += 44) for (let x = (y / 44) % 2 ? 24 : 46; x < W; x += 44) { g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
    g.restore();
    g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = INK; roundRect(g, 5, 5, W - 10, H - 10, 26); g.stroke();
    g.lineWidth = 6; g.strokeStyle = PAPER; roundRect(g, 20, 20, W - 40, H - 40, 18); g.stroke();
    // logo: ojo gigante de párpado caído y las letras rotuladas
    g.fillStyle = '#fbf6e6'; g.strokeStyle = INK; g.lineWidth = 7;
    g.beginPath(); g.arc(128, 150, 56, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(136, 166, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e0b552'; g.beginPath(); g.arc(128, 150, 56, Math.PI * 1.04, Math.PI * 1.96); g.closePath(); g.fill(); g.stroke();
    inked(g, 'P4P', 128, 270, 66, '#e0b552', 10);
    g.font = `24px ${NUM}`; g.fillStyle = PAPER; g.textAlign = 'center';
    g.fillText('POKER FOR THE PLAYERS', 128, 304);
  }
  faces.set(key, c);
  return c;
}
