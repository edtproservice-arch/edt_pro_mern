import { describe, it, expect } from 'vitest';
import {
  espacesEmpruntes,
  estEspacePropre,
  estPartage,
  libelleEspaceEmprunte,
  mesPieces,
  occupantsDeLaPiece,
  piecesPartagees,
} from './espacesMutualises.js';

/**
 * Espaces mutualisés (2026-09-21) : « Salle 4 » de A est prêtée à B et C.
 */
const A = {
  id: 'A',
  nom: 'ISTA NTIC',
  espacesMutualises: [
    { espace: 'Salle 4', etablissementId: 'B' },
    { espace: 'Salle 4', etablissementId: 'C' },
    { espace: 'Labo', etablissementId: 'B' },
  ],
};

describe('libelleEspaceEmprunte', () => {
  it('dit d’où vient la salle', () => {
    expect(libelleEspaceEmprunte('Salle 4', 'ISTA NTIC')).toBe('Salle 4 (ISTA NTIC)');
  });
});

describe('piecesPartagees', () => {
  it('le propriétaire voit toutes ses pièces prêtées', () => {
    const pieces = piecesPartagees([A], 'A');
    expect(pieces.map((p) => p.espace)).toEqual(['Salle 4', 'Labo']);
  });

  it('un emprunteur ne voit que ce qu’on lui prête', () => {
    expect(piecesPartagees([A], 'C').map((p) => p.espace)).toEqual(['Salle 4']);
    expect(piecesPartagees([A], 'Z')).toEqual([]);
  });

  it('chaque occupant désigne la pièce sous son nom', () => {
    const [piece] = piecesPartagees([A], 'B');
    expect(piece.occupations).toEqual([
      { etablissementId: 'A', nom: 'ISTA NTIC', salle: 'Salle 4' },
      { etablissementId: 'B', nom: null, salle: 'Salle 4 (ISTA NTIC)' },
      { etablissementId: 'C', nom: null, salle: 'Salle 4 (ISTA NTIC)' },
    ]);
  });
});

describe('occupantsDeLaPiece', () => {
  const pieces = piecesPartagees([A], 'B');

  it('⚠️ une salle empruntée retrouve le propriétaire ET les autres emprunteurs', () => {
    const { autres } = occupantsDeLaPiece(pieces, 'B', 'Salle 4 (ISTA NTIC)');
    expect(autres.map((o) => o.etablissementId)).toEqual(['A', 'C']);
  });

  it('la salle du propriétaire retrouve ses emprunteurs', () => {
    const { autres } = occupantsDeLaPiece(piecesPartagees([A], 'A'), 'A', 'salle 4');
    expect(autres.map((o) => [o.etablissementId, o.salle])).toEqual([
      ['B', 'Salle 4 (ISTA NTIC)'],
      ['C', 'Salle 4 (ISTA NTIC)'],
    ]);
  });

  it('⚠️ « Salle 4 » de B n’est PAS la « Salle 4 » de A', () => {
    expect(occupantsDeLaPiece(pieces, 'B', 'Salle 4')).toBeNull();
  });

  it('ni TEAMS ni une salle vide ne se partagent', () => {
    expect(occupantsDeLaPiece(pieces, 'B', 'TEAMS')).toBeNull();
    expect(occupantsDeLaPiece(pieces, 'B', '')).toBeNull();
  });
});

/*
 * ═══ ⚠️ `mesPieces` ═══ (2026-09-25, demande du porteur : « en select espace il
 * faut figé » — fermer l'option d'une salle mutualisée déjà occupée ailleurs).
 * C'est la version « toutes mes pièces à la fois » d'`occupantsDeLaPiece`, pour
 * balayer la semaine entière plutôt qu'une case déjà connue.
 */
describe('mesPieces', () => {
  it('rend ma pièce, avec MON libellé et mes AUTRES occupants — propriétaire comme emprunteur', () => {
    // B emprunte les DEUX pièces de A (« Salle 4 » ET « Labo »).
    const pieces = piecesPartagees([A], 'B');
    expect(mesPieces(pieces, 'B')).toEqual([
      {
        maSalle: 'Salle 4 (ISTA NTIC)',
        autres: [
          { etablissementId: 'A', nom: 'ISTA NTIC', salle: 'Salle 4' },
          { etablissementId: 'C', nom: null, salle: 'Salle 4 (ISTA NTIC)' },
        ],
      },
      {
        maSalle: 'Labo (ISTA NTIC)',
        autres: [{ etablissementId: 'A', nom: 'ISTA NTIC', salle: 'Labo' }],
      },
    ]);

    expect(mesPieces(piecesPartagees([A], 'A'), 'A')).toEqual([
      {
        maSalle: 'Salle 4',
        autres: [
          { etablissementId: 'B', nom: null, salle: 'Salle 4 (ISTA NTIC)' },
          { etablissementId: 'C', nom: null, salle: 'Salle 4 (ISTA NTIC)' },
        ],
      },
      {
        maSalle: 'Labo',
        autres: [{ etablissementId: 'B', nom: null, salle: 'Labo (ISTA NTIC)' }],
      },
    ]);
  });

  it('rien pour un établissement sans la moindre pièce partagée', () => {
    expect(mesPieces(piecesPartagees([A], 'B'), 'Z')).toEqual([]);
  });
});

describe('espacesEmpruntes et aides', () => {
  it('liste ce qu’on prête à moi, pas ce que je prête', () => {
    expect(espacesEmpruntes(piecesPartagees([A], 'B'), 'B').map((e) => e.salle)).toEqual([
      'Salle 4 (ISTA NTIC)',
      'Labo (ISTA NTIC)',
    ]);
    expect(espacesEmpruntes(piecesPartagees([A], 'A'), 'A')).toEqual([]);
  });

  it('sans tenir compte de la casse', () => {
    expect(estPartage(A.espacesMutualises, 'SALLE 4')).toBe(true);
    expect(estPartage(A.espacesMutualises, 'Salle 9')).toBe(false);
    expect(estEspacePropre(['Salle 4'], 'salle 4')).toBe(true);
  });
});
