// "Tu mano": nombre en español de lo mejor que tienes con tus cartas y las de la mesa.
// Usa el mismo evaluador del servidor (es un módulo puro) y los mismos nombres que el resultado de la mano.

import { bestFive, describeHand, PLURAL, rankName } from '../../server/hands.js';

const RV = r => '23456789TJQKA'.indexOf(r) + 2;

export function handLabel(hole, board) {
  if (!hole || hole.length < 2 || hole.some(c => !c)) return '';
  if (hole.length + (board || []).length < 5) {
    const [a, b] = hole.map(c => RV(c[0])).sort((x, y) => y - x);
    if (a === b) return `Par de ${PLURAL[a]}`;
    return `${rankName(a)}-${rankName(b)}${hole[0][1] === hole[1][1] ? ' del mismo palo' : ''}`;
  }
  const { score, cards } = bestFive(hole, board);
  return describeHand(score, cards);
}

// Las cartas que se resaltan al final de la mano: las 5 de la mano ganadora (las de la mesa y las propias
// que usó). Es la de quien gana el bote principal, la mejor de la mesa; con empate, las de todos los que
// empatan. Si todos se retiraron no hay ninguna (el ganador no enseña).
export function winningCards(results) {
  if (!results || results.fold || !results.best || !results.pots || !results.pots.length) return new Set();
  return new Set(results.pots[0].winners.flatMap(id => results.best[id] || []));
}
