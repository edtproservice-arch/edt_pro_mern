import { describe, it, expect } from 'vitest';
import { capacite, decouper, lignesDe, lignesForcees, tailleCommune } from './etiquettes';

/* La largeur réelle d'une colonne de l'axe, moins ses gouttières. */
const LARGEUR = 54;

describe('capacite', () => {
  it('compte les caractères qui tiennent dans une largeur', () => {
    expect(capacite(54, 10)).toBe(8);
    expect(capacite(54, 7)).toBe(11);
  });

  /* ⚠️ JAMAIS ZÉRO : une capacité nulle boucle sans fin dans `lignesForcees`. */
  it('ne descend jamais sous un caractère', () => {
    expect(capacite(2, 20)).toBe(1);
  });
});

describe('lignesDe', () => {
  it('garde un nom court sur une seule ligne', () => {
    expect(lignesDe('M101', { largeur: LARGEUR, taille: 10 })).toEqual(['M101']);
  });

  it('coupe aux espaces quand la ligne est pleine', () => {
    expect(lignesDe('ABDELGHANI LAASAL', { largeur: LARGEUR, taille: 8 })).toEqual([
      'ABDELGHANI',
      'LAASAL',
    ]);
  });

  /*
   * ═══ ⚠️ ON NE CASSE PAS UN MOT : on rend `null` pour que l'appelant rétrécisse.
   * « ABDELGHA / NI / LAASAL » est illisible ; le même nom à 7 px ne l'est pas.
   */
  it('refuse plutôt que de couper dans un mot', () => {
    expect(lignesDe('ABDELGHANI LAASAL', { largeur: LARGEUR, taille: 10 })).toBeNull();
  });

  it('refuse au-delà du nombre de lignes permis', () => {
    expect(
      lignesDe('UN DEUX TROIS QUATRE CINQ', { largeur: LARGEUR, taille: 10, lignesMax: 2 })
    ).toBeNull();
  });

  it('rend une liste vide pour un texte absent', () => {
    expect(lignesDe('', { largeur: LARGEUR, taille: 10 })).toEqual([]);
    expect(lignesDe(null, { largeur: LARGEUR, taille: 10 })).toEqual([]);
  });
});

describe('tailleCommune', () => {
  /*
   * ⚠️ UNE SEULE TAILLE POUR TOUT L'AXE : « M101 » en 10 px à côté
   * d'« ABDELGHANI LAASAL » en 8 px se lit comme un défaut d'affichage.
   */
  it('retient la plus grande taille où TOUS les noms tiennent', () => {
    const taille = tailleCommune(['M101', 'ABDELGHANI LAASAL'], { largeur: LARGEUR });

    expect(taille).toBe(8);
    expect(lignesDe('ABDELGHANI LAASAL', { largeur: LARGEUR, taille })).not.toBeNull();
  });

  it('garde la taille maximale quand tout est court', () => {
    expect(tailleCommune(['M101', 'M102'], { largeur: LARGEUR })).toBe(10);
  });

  it('ignore les entrées vides plutôt que de rétrécir pour rien', () => {
    expect(tailleCommune(['M101', '', null], { largeur: LARGEUR })).toBe(10);
  });

  it('retombe sur la taille minimale quand rien ne tient', () => {
    expect(tailleCommune(['SUPERCALIFRAGILISTICEXPIALIDOCIOUS'], { largeur: LARGEUR })).toBe(7);
  });
});

describe('lignesForcees', () => {
  /*
   * ⚠️ L'ELLIPSE EST INDISPENSABLE : sans elle, un nom tronqué se lit comme un
   * nom complet.
   */
  it('coupe et signale la troncature', () => {
    const lignes = lignesForcees('SUPERCALIFRAGILISTICEXPIALIDOCIOUS', {
      largeur: LARGEUR,
      taille: 7,
      lignesMax: 2,
    });

    expect(lignes).toHaveLength(2);
    expect(lignes[1].endsWith('…')).toBe(true);
  });

  it('ne tronque pas ce qui tenait déjà', () => {
    expect(lignesForcees('COURT', { largeur: LARGEUR, taille: 7, lignesMax: 2 })).toEqual([
      'COURT',
    ]);
  });
});

describe('decouper', () => {
  it('préfère la répartition propre au repli tronqué', () => {
    expect(decouper('ABDELGHANI LAASAL', { largeur: LARGEUR, taille: 8 })).toEqual([
      'ABDELGHANI',
      'LAASAL',
    ]);
  });

  it('rend toujours quelque chose, même quand rien ne tient', () => {
    const lignes = decouper('ABDELGHANI LAASAL', { largeur: LARGEUR, taille: 10 });

    expect(lignes.length).toBeGreaterThan(0);
  });
});
