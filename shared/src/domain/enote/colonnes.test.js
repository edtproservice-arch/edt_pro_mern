import { describe, it, expect } from 'vitest';
import { COLONNES, ENTETES_ENOTE, indexColonne, resoudreColonnes } from './colonnes.js';
import { NB_COLONNES } from '../carte/lignesEnote.js';

describe('indexColonne', () => {
  it("retient l'index documenté quand l'en-tête est absent", () => {
    // Certains fichiers arrivent sans ligne d'en-tête : la position est alors
    // la seule prise.
    expect(indexColonne('groupe')).toBe(8);
    expect(indexColonne('codeFiliere', [])).toBe(4);
  });

  it("préfère la position réelle quand l'en-tête la donne", () => {
    const entete = ['Groupe', 'Code Filière'];
    expect(indexColonne('groupe', entete)).toBe(0);
    expect(indexColonne('codeFiliere', entete)).toBe(1);
  });

  it("retombe sur l'index quand le nom est absent de l'en-tête", () => {
    expect(indexColonne('groupe', ['Autre chose'])).toBe(8);
  });

  it('garde la position pour les colonnes sans nom connu', () => {
    // Colonne S (EFM régional) : repérée uniquement par sa position, son
    // intitulé variant d'un fichier à l'autre.
    expect(COLONNES.efmRegional.nom).toBeNull();
    expect(indexColonne('efmRegional', ENTETES_ENOTE)).toBe(18);
  });

  it('refuse un champ inconnu plutôt que de rendre une position fausse', () => {
    expect(() => indexColonne('inexistant')).toThrow(/inexistant/);
  });
});

describe('resoudreColonnes', () => {
  it('résout tous les champs en une fois', () => {
    const table = resoudreColonnes();
    expect(Object.keys(table)).toEqual(Object.keys(COLONNES));
    expect(table.masseHorairePresentiel).toBe(35);
  });
});

describe('ENTETES_ENOTE', () => {
  it('compte les 51 colonnes du fichier e-note', () => {
    expect(ENTETES_ENOTE).toHaveLength(NB_COLONNES);
  });

  /*
   * LE test qui compte : un fichier exporté doit rester réimportable.
   * `indexColonne()` cherche la colonne par son NOM avant sa position. Si un
   * libellé dérive, l'import retombe sur l'index — sans erreur, donc sans
   * qu'on le voie, jusqu'au jour où l'ordre des colonnes change.
   */
  it('place chaque colonne nommée à son index documenté', () => {
    for (const [champ, colonne] of Object.entries(COLONNES)) {
      if (!colonne.nom) continue;
      expect(indexColonne(champ, ENTETES_ENOTE)).toBe(colonne.index);
    }
  });

  it('conserve la double espace de « MH Totale  DRIF »', () => {
    // Coquille de l'outil e-note. La corriger casserait l'appariement par nom
    // sur les fichiers d'origine, qui la portent.
    expect(ENTETES_ENOTE[34]).toBe('MH Totale  DRIF');
  });

  it('ne porte aucun libellé vide', () => {
    // Un intitulé vide ferait apparier n'importe quelle colonne sans nom.
    expect(ENTETES_ENOTE.filter((nom) => String(nom).trim() === '')).toEqual([]);
  });
});
