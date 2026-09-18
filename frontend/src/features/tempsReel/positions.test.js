import { describe, it, expect } from 'vitest';
import { englober, etiquetteCurseur, fractionDansCase, memeVue, pointDansConteneur, rognerBoite } from './positions';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe('englober', () => {
  it('réunit les trois lignes d’une case en un seul rectangle', () => {
    expect(englober([rect(10, 100, 30, 20), rect(10, 120, 30, 20), rect(10, 140, 30, 20)])).toEqual({
      left: 10,
      top: 100,
      width: 30,
      height: 60,
    });
  });

  it('rend null sans rien à englober', () => {
    expect(englober([])).toBeNull();
  });
});

describe('fractionDansCase', () => {
  const boite = { left: 100, top: 200, width: 40, height: 60 };

  it('donne la position relative à la case', () => {
    expect(fractionDansCase(boite, 110, 230)).toEqual({ x: 0.25, y: 0.5 });
  });

  // Le serveur refuse ce qui sort de [0, 1] : on borne avant d'envoyer.
  it('borne un pointeur qui déborde', () => {
    expect(fractionDansCase(boite, 50, 900)).toEqual({ x: 0, y: 1 });
  });

  it('rend le centre d’une case sans largeur', () => {
    expect(fractionDansCase({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('pointDansConteneur', () => {
  // ⚠️ Chaque écran reprojette sur SA grille : la même fraction tombe au même
  // endroit de la case, quelle que soit la taille de celle-ci.
  it('reprojette la fraction dans le repère du conteneur', () => {
    const boite = { left: 300, top: 400, width: 80, height: 40 };
    expect(pointDansConteneur(boite, { left: 200, top: 300 }, { x: 0.5, y: 0.25 })).toEqual({
      left: 140,
      top: 110,
    });
  });

  it('rend null si la case n’existe pas chez soi', () => {
    expect(pointDansConteneur(null, { left: 0, top: 0 }, { x: 0, y: 0 })).toBeNull();
  });
});

describe('memeVue', () => {
  const vue = { semaine: '2026-W3', periode: 'jour', axe: 'formateur' };

  it('n’affiche que les curseurs de la même semaine, période et axe', () => {
    expect(memeVue({ ...vue, cle: 'x' }, vue)).toBe(true);
    expect(memeVue({ ...vue, semaine: '2026-W4' }, vue)).toBe(false);
    expect(memeVue({ ...vue, periode: 'soir' }, vue)).toBe(false);
    // La clé porte le matricule sur un axe, le groupe sur l'autre.
    expect(memeVue({ ...vue, axe: 'groupe' }, vue)).toBe(false);
    expect(memeVue(null, vue)).toBe(false);
  });
});

describe('etiquetteCurseur', () => {
  it('garde le prénom et l’initiale du nom', () => {
    expect(etiquetteCurseur('ZINEB EL OMARI')).toBe('Zineb O.');
    expect(etiquetteCurseur('MOUAD')).toBe('MOUAD');
    expect(etiquetteCurseur('')).toBe('?');
  });
});

/*
 * Chronogramme (2026-09-13) : une semaine glissée sous les colonnes collantes
 * (module à gauche, masses à droite) n'est plus visible — le cadre « X modifie »
 * ne doit pas se dessiner PAR-DESSUS ces colonnes.
 */
describe('rognerBoite', () => {
  const zone = { left: 100, right: 300, top: 0, bottom: 200 };

  it('rend la part visible d’une case à cheval sur le bord', () => {
    expect(rognerBoite({ left: 280, top: 10, width: 40, height: 20 }, zone)).toEqual({
      left: 280,
      top: 10,
      width: 20,
      height: 20,
    });
  });

  it('rend null pour une case entièrement cachée', () => {
    expect(rognerBoite({ left: 300, top: 10, width: 40, height: 20 }, zone)).toBeNull();
    expect(rognerBoite({ left: 40, top: 10, width: 60, height: 20 }, zone)).toBeNull();
  });

  it('rend la case entière sans zone, et null sans case', () => {
    const boite = { left: 1, top: 2, width: 3, height: 4 };
    expect(rognerBoite(boite, null)).toBe(boite);
    expect(rognerBoite(null, zone)).toBeNull();
  });
});
