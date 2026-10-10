// Cartas 3D: una caja delgada con la cara dibujada por código en un canvas (índices grandes para leer de lejos).
// Las figuras J, Q y K son criaturas inventadas del casino. El reverso lleva el logo de Poker for the Players.

import * as THREE from 'three';
import { toon, outline } from '../scene/toon.js';

export const CARD_W = 0.115, CARD_H = 0.165;
const T = 0.003;
const GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED = '#e0263a', INK = '#1b1530';

let anisotropy = 1;
export function setAnisotropy(n) { anisotropy = n; }

const geo = new THREE.BoxGeometry(CARD_W, T, CARD_H);
const edge = toon('#f3ead2');

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

// Criatura de figura: J un blob de un ojo, Q una dama de tres ojos con tiara, K un rey con antenas y corona.
function figure(g, rank, x, y, col) {
  const skin = { J: '#7be36a', Q: '#ff7fc8', K: '#ffae3b' }[rank];
  g.lineWidth = 7; g.strokeStyle = INK;
  g.fillStyle = skin;
  g.beginPath(); g.ellipse(x, y + 14, 62, 70, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  const eyes = rank === 'J' ? [[0, 0, 22]] : rank === 'Q' ? [[-24, 6, 13], [24, 6, 13], [0, -22, 11]] : [[-22, 2, 14], [22, 2, 14]];
  for (const [ex, ey, r] of eyes) {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x + ex, y + ey, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(x + ex + r * .25, y + ey + r * .2, r * .45, 0, Math.PI * 2); g.fill();
  }
  g.beginPath(); g.arc(x, y + 40, 22, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  g.fillStyle = col;
  if (rank === 'K') { // corona
    g.beginPath(); g.moveTo(x - 46, y - 42); g.lineTo(x - 46, y - 88); g.lineTo(x - 22, y - 62); g.lineTo(x, y - 96);
    g.lineTo(x + 22, y - 62); g.lineTo(x + 46, y - 88); g.lineTo(x + 46, y - 42); g.closePath(); g.fill(); g.stroke();
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x + s * 50, y - 20); g.lineTo(x + s * 80, y - 70); g.stroke(); g.beginPath(); g.arc(x + s * 82, y - 74, 8, 0, Math.PI * 2); g.fill(); g.stroke(); }
  } else if (rank === 'Q') { // tiara
    g.beginPath(); g.moveTo(x - 38, y - 46); g.quadraticCurveTo(x, y - 100, x + 38, y - 46); g.quadraticCurveTo(x, y - 66, x - 38, y - 46); g.fill(); g.stroke();
  } else { // gorrito
    g.beginPath(); g.moveTo(x - 34, y - 46); g.lineTo(x, y - 98); g.lineTo(x + 34, y - 46); g.closePath(); g.fill(); g.stroke();
  }
}

const faceMats = new Map();
function faceMaterial(code) {
  if (faceMats.has(code)) return faceMats.get(code);
  const [c, g] = canvas(256, 368);
  const rank = code[0] === 'T' ? '10' : code[0], suit = code[1];
  const col = 'hd'.includes(suit) ? RED : INK;
  g.fillStyle = '#fffaf0'; roundRect(g, 4, 4, 248, 360, 26); g.fill();
  g.lineWidth = 8; g.strokeStyle = INK; g.stroke();
  const corner = (x, y) => {
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = `900 ${rank === '10' ? 92 : 104}px "Arial Rounded MT Bold", "Arial Black", Arial, sans-serif`;
    g.fillText(rank, x, y + 90);
    g.font = '72px "Apple Symbols", "Segoe UI Symbol", sans-serif';
    g.fillText(GLYPH[suit], x, y + 160);
  };
  corner(62, 12);
  g.save(); g.translate(256, 368); g.rotate(Math.PI); corner(62, 12); g.restore();
  if ('JQK'.includes(rank)) figure(g, rank, 160, 200, col);
  else { g.fillStyle = col; g.textAlign = 'center'; g.font = '150px "Apple Symbols", "Segoe UI Symbol", sans-serif'; g.fillText(GLYPH[suit], 158, 250); }
  const m = toon('#ffffff', { map: texture(c) });
  faceMats.set(code, m);
  return m;
}

let backMat = null;
function backMaterial() {
  if (backMat) return backMat;
  const [c, g] = canvas(256, 368);
  g.fillStyle = '#5b2bb5'; roundRect(g, 4, 4, 248, 360, 26); g.fill();
  g.save(); g.clip();
  g.strokeStyle = '#7d4fe0'; g.lineWidth = 14;
  for (let i = -400; i < 400; i += 34) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 368, 368); g.stroke(); }
  g.restore();
  g.lineWidth = 8; g.strokeStyle = '#fffaf0'; roundRect(g, 18, 18, 220, 332, 18); g.stroke();
  // logo: ojo alienígena con las iniciales
  g.fillStyle = '#b6ff3b'; g.strokeStyle = '#1b1530'; g.lineWidth = 8;
  g.beginPath(); g.ellipse(128, 184, 86, 112, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#1b1530'; g.textAlign = 'center';
  g.font = '900 56px "Arial Rounded MT Bold", "Arial Black", sans-serif';
  g.fillText('P4P', 128, 168);
  g.font = '900 20px "Arial Rounded MT Bold", Arial, sans-serif';
  g.fillText('POKER FOR', 128, 214); g.fillText('THE PLAYERS', 128, 238);
  g.fillStyle = '#ff3df2'; g.beginPath(); g.arc(128, 110, 14, 0, Math.PI * 2); g.fill();
  backMat = toon('#ffffff', { map: texture(c) });
  return backMat;
}

// Carta reutilizable: setCard(code) la pone boca arriba; setCard(null) boca abajo.
export function makeCard() {
  const m = new THREE.Mesh(geo, [edge, edge, backMaterial(), backMaterial(), edge, edge]);
  outline(m, 'small');
  m.castShadow = true;
  m.userData.code = undefined;
  return m;
}
export function setCard(m, code) {
  if (m.userData.code === code) return;
  m.userData.code = code;
  m.material = [edge, edge, code ? faceMaterial(code) : backMaterial(), backMaterial(), edge, edge];
}
