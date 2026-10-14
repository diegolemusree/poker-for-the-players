// Evaluador de manos de poker. Las cartas son cadenas de 2 letras: rango + palo, p. ej. 'Ah', 'Td'.

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';
export const HAND_NAMES = ['Carta alta', 'Par', 'Doble par', 'Trío', 'Escalera', 'Color', 'Full', 'Póker', 'Escalera de color'];

const RV = r => RANKS.indexOf(r) + 2;

// Puntaje de exactamente 5 cartas: [categoría, desempates...]. Mayor es mejor.
export function score5(cs) {
  const v = cs.map(c => RV(c[0])).sort((a, b) => b - a);
  const flush = cs.every(c => c[1] === cs[0][1]);
  let sh = 0;
  if (new Set(v).size === 5) {
    if (v[0] - v[4] === 4) sh = v[0];
    else if (v[0] === 14 && v[1] === 5) sh = 5; // escalera baja A-2-3-4-5
  }
  const cnt = {};
  v.forEach(x => { cnt[x] = (cnt[x] || 0) + 1; });
  const g = Object.entries(cnt).map(([r, c]) => [+r, c]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ord = g.map(x => x[0]);
  if (sh && flush) return [8, sh];
  if (g[0][1] === 4) return [7, ...ord];
  if (g[0][1] === 3 && g[1][1] === 2) return [6, ...ord];
  if (flush) return [5, ...v];
  if (sh) return [4, sh];
  if (g[0][1] === 3) return [3, ...ord];
  if (g[0][1] === 2 && g[1][1] === 2) return [2, ...ord];
  if (g[0][1] === 2) return [1, ...ord];
  return [0, ...v];
}

// Compara dos puntajes: >0 si gana a, <0 si gana b, 0 si empatan.
export function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Mejor mano de 5 entre 5 a 7 cartas.
export function bestHand(cs) {
  if (cs.length <= 5) return score5(cs);
  let best = null;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const s = score5(cs.filter((_, k) => k !== i && k !== j));
      if (!best || cmp(s, best) > 0) best = s;
    }
  }
  return best;
}

export const handName = s => (s[0] === 8 && s[1] === 14) ? 'Escalera real' : HAND_NAMES[s[0]];

// Las 5 cartas de la mejor mano con las 2 propias (`hole`) y las de la mesa, y su puntaje. Entre varias
// iguales se queda con la que usa más cartas propias: son las que se resaltan como "las que usó".
// (Para comparar manos sin saber cuáles son, bestHand es más rápida: la usan los bots.)
export function bestFive(hole, board) {
  const all = [...hole, ...board];
  let best = null, bestCards = null, bestOwn = -1;
  const pick = (start, chosen) => {
    if (chosen.length === Math.min(5, all.length)) {
      const s = score5(chosen.map(i => all[i]));
      const own = chosen.filter(i => i < hole.length).length;
      const c = best ? cmp(s, best) : 1;
      if (c > 0 || (c === 0 && own > bestOwn)) { best = s; bestCards = chosen.map(i => all[i]); bestOwn = own; }
      return;
    }
    for (let i = start; i < all.length; i++) pick(i + 1, [...chosen, i]);
  };
  pick(0, []);
  return { score: best, cards: bestCards };
}

export const PLURAL = { 14: 'ases', 13: 'reyes', 12: 'reinas', 11: 'jotas', 10: 'dieces', 9: 'nueves', 8: 'ochos', 7: 'sietes', 6: 'seises', 5: 'cincos', 4: 'cuatros', 3: 'treses', 2: 'doses' };
const RANK_NAME = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J' };
export const SUIT_NAMES = { s: 'picas', h: 'corazones', d: 'diamantes', c: 'tréboles' };
export const rankName = v => RANK_NAME[v] || String(v);
// "del 5 al 9"; la escalera baja es "del A al 5"
const span = high => `del ${high === 5 ? 'A' : rankName(high - 4)} al ${rankName(high)}`;

// Nombre de una mano para decírselo a los jugadores: "Color de corazones", "Full de reyes y doses",
// "Escalera del 5 al 9". `five`: sus 5 cartas (de ahí sale el palo).
export function describeHand(s, five) {
  const suit = five && five[0] ? SUIT_NAMES[five[0][1]] : '';
  switch (s[0]) {
    case 8: return s[1] === 14 ? `Escalera real de ${suit}` : `Escalera de color ${span(s[1])}`;
    case 7: return `Póker de ${PLURAL[s[1]]}`;
    case 6: return `Full de ${PLURAL[s[1]]} y ${PLURAL[s[2]]}`;
    case 5: return `Color de ${suit}`;
    case 4: return `Escalera ${span(s[1])}`;
    case 3: return `Trío de ${PLURAL[s[1]]}`;
    case 2: return `Doble par: ${PLURAL[s[1]]} y ${PLURAL[s[2]]}`;
    case 1: return `Par de ${PLURAL[s[1]]}`;
    default: return `Carta alta: ${rankName(s[1])}`;
  }
}
