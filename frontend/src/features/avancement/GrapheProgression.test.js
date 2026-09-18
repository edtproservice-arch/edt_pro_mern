import { describe, it, expect } from 'vitest';
import { cadrer } from './GrapheProgression';

/**
 * La fenêtre de l'accueil : la semaine précédente, celle en cours, la suivante.
 * (Demande du porteur, 2026-09-01.)
 *
 * Elle n'était pinnée par aucun test alors qu'elle porte tout le sens du bloc —
 * et le seul cas observable sur les données réelles est celui du BORD (S1), qui
 * ne prouve justement pas le centrage.
 */
const annee = Array.from({ length: 39 }, (_, index) => ({
  libelle: `S${index + 1}`,
  numero: index + 1,
}));

const libelles = (points) => points.map((point) => point.libelle);

describe('cadrer — la fenêtre autour de la semaine en cours', () => {
  it('centre sur la semaine en cours : la précédente, elle, la suivante', () => {
    expect(libelles(cadrer(annee, annee[11], 3))).toEqual(['S11', 'S12', 'S13']);
  });

  /*
   * ⚠️ ELLE GARDE SA LARGEUR AUX BORDS, elle ne se rogne pas. Un simple
   * « n semaines de part et d'autre » rendrait une demi-fenêtre en S1 — c'est-à-
   * dire à la rentrée, quand on regarde cet écran le plus souvent.
   */
  it('décale la fenêtre au premier bord plutôt que de la rogner', () => {
    expect(libelles(cadrer(annee, annee[0], 3))).toEqual(['S1', 'S2', 'S3']);
  });

  it('décale de même au dernier bord', () => {
    expect(libelles(cadrer(annee, annee[38], 3))).toEqual(['S37', 'S38', 'S39']);
  });

  /*
   * ⚠️ SANS SEMAINE COURANTE, ON MONTRE LE DÉBUT plutôt que rien : le bloc
   * s'affiche quand même, à un cadrage près.
   */
  it('retombe sur le début de l’année quand la semaine en cours est inconnue', () => {
    expect(libelles(cadrer(annee, null, 3))).toEqual(['S1', 'S2', 'S3']);
  });

  it('rend tout quand l’année tient dans la fenêtre', () => {
    const court = annee.slice(0, 2);
    expect(cadrer(court, court[0], 3)).toBe(court);
  });
});
