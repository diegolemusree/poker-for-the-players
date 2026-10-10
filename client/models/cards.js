// Cartas 3D: una caja delgada con la cara dibujada por código en un canvas (índices grandes para leer de lejos).
// Las figuras J, Q y K son criaturas inventadas, con ojos de párpado caído. El reverso lleva el logo de Poker for the Players.

import * as THREE from 'three';
import { toon, INK } from '../scene/toon.js';

export const CARD_W = 0.115, CARD_H = 0.165;
const T = 0.003;
const GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED = '#a8352a', PAPER = '#efe4c8';

let anisotropy = 1;
export function setAnisotropy(n) { anisotropy = n; }

const geo = new THREE.BoxGeometry(CARD_W, T, CARD_H);
const edge = toon('#e3d6b8');

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
  const skin = { J: '#8a9a52', Q: '#c08a7a', K: '#c9963f' }[rank];
  g.lineWidth = 5; g.strokeStyle = INK;
  g.fillStyle = skin;
  g.beginPath(); g.ellipse(x, y + 14, 62, 70, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  const eyes = rank === 'J' ? [[0, 0, 22]] : rank === 'Q' ? [[-24, 6, 13], [24, 6, 13], [0, -22, 11]] : [[-22, 2, 14], [22, 2, 14]];
  for (const [ex, ey, r] of eyes) {
    g.fillStyle = PAPER; g.beginPath(); g.arc(x + ex, y + ey, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(x + ex + r * .15, y + ey + r * .3, r * .22, 0, Math.PI * 2); g.fill();
    g.fillStyle = skin; g.beginPath(); g.arc(x + ex, y + ey, r, Math.PI * 1.06, Math.PI * 1.94); g.closePath(); g.fill(); g.stroke();
  }
  g.beginPath(); g.moveTo(x - 18, y + 46); g.lineTo(x + 14, y + 42); g.stroke();
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
  g.fillStyle = PAPER; roundRect(g, 4, 4, 248, 360, 26); g.fill();
  g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
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
  g.fillStyle = '#2f3f5c'; roundRect(g, 4, 4, 248, 360, 26); g.fill();
  g.save(); g.clip();
  g.strokeStyle = '#3d4f6e'; g.lineWidth = 12;
  for (let i = -400; i < 400; i += 34) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 368, 368); g.stroke(); }
  g.restore();
  g.lineWidth = 6; g.strokeStyle = INK; roundRect(g, 4, 4, 248, 360, 26); g.stroke();
  g.lineWidth = 6; g.strokeStyle = PAPER; roundRect(g, 18, 18, 220, 332, 18); g.stroke();
  // logo: ojo de párpado caído con las iniciales
  g.fillStyle = '#c99a35'; g.strokeStyle = INK; g.lineWidth = 6;
  g.beginPath(); g.ellipse(128, 184, 86, 112, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = INK; g.textAlign = 'center';
  g.font = '900 56px "Arial Rounded MT Bold", "Arial Black", sans-serif';
  g.fillText('P4P', 128, 168);
  g.font = '900 20px "Arial Rounded MT Bold", Arial, sans-serif';
  g.fillText('POKER FOR', 128, 214); g.fillText('THE PLAYERS', 128, 238);
  g.fillStyle = PAPER; g.beginPath(); g.arc(128, 112, 15, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = INK; g.beginPath(); g.arc(130, 116, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c99a35'; g.beginPath(); g.arc(128, 112, 15, Math.PI * 1.05, Math.PI * 1.95); g.closePath(); g.fill(); g.stroke();
  backMat = toon('#ffffff', { map: texture(c) });
  return backMat;
}

// Carta reutilizable: setCard(code) la pone boca arriba; setCard(null) boca abajo.
export function makeCard() {
  const m = new THREE.Mesh(geo, [edge, edge, backMaterial(), backMaterial(), edge, edge]);
  m.userData.code = undefined;
  return m;
}
export function setCard(m, code) {
  if (m.userData.code === code) return;
  m.userData.code = code;
  m.material = [edge, edge, code ? faceMaterial(code) : backMaterial(), backMaterial(), edge, edge];
}
