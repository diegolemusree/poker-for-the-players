// "Tu mano": nombre en español de lo mejor que tienes con tus cartas y las de la mesa.
// Usa el mismo evaluador del servidor (es un módulo puro).

import { score5, cmp, handName } from '../../server/hands.js';

const PLURAL = { 14: 'ases', 13: 'reyes', 12: 'reinas', 11: 'jotas', 10: 'dieces', 9: 'nueves', 8: 'ochos', 7: 'sietes', 6: 'seises', 5: 'cincos', 4: 'cuatros', 3: 'treses', 2: 'doses' };
const NAME = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' };
const RV = r => '23456789TJQKA'.indexOf(r) + 2;
const nm = v => NAME[v] || String(v);

function best(cards) {
  let top = null;
  const pick = (start, chosen) => {
    if (chosen.length === 5) { const s = score5(chosen); if (!top || cmp(s, top) > 0) top = s; return; }
    for (let i = start; i < cards.length; i++) pick(i + 1, [...chosen, cards[i]]);
  };
  pick(0, []);
  return top;
}

export function handLabel(hole, board) {
  if (!hole || hole.length < 2 || hole.some(c => !c)) return '';
  const all = [...hole, ...(board || [])];
  if (all.length < 5) {
    const [a, b] = hole.map(c => RV(c[0])).sort((x, y) => y - x);
    if (a === b) return `Par de ${PLURAL[a]}`;
    return `${nm(a)}-${nm(b)}${hole[0][1] === hole[1][1] ? ' del mismo palo' : ''}`;
  }
  const s = best(all);
  const k = s[0];
  if (k === 1) return `Par de ${PLURAL[s[1]]}`;
  if (k === 2) return `Doble par: ${PLURAL[s[1]]} y ${PLURAL[s[2]]}`;
  if (k === 3) return `Trío de ${PLURAL[s[1]]}`;
  if (k === 7) return `Póker de ${PLURAL[s[1]]}`;
  if (k === 0) return `Carta alta: ${nm(s[1])}`;
  return handName(s);
}
