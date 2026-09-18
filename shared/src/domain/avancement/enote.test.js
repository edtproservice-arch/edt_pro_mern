import { describe, it, expect } from 'vitest';
import { lireAvancementEnote, nombre } from './enote.js';
import { ENTETES_ENOTE } from '../enote/index.js';

/**
 * Une ligne e-note aux 51 colonnes, avec ce qu'on veut y mettre.
 * Les index sont ceux du format réel, figés par `colonnes.test.js`.
 */
const ligne = (valeurs) => {
  const cellules = Array.from({ length: ENTETES_ENOTE.length }, () => '');
  for (const [index, valeur] of Object.entries(valeurs)) cellules[index] = valeur;
  return cellules;
};

const importe = (lignes) => ({ entete: ENTETES_ENOTE, lignes });

/** Le cas de référence : une séance synchrone mutualisée sur deux groupes. */
const LIGNE_COMPLETE = {
  8: 'GM101',
  12: 'GM101 GM102',
  16: 'M101',
  20: 'BRAHIM LOURID',
  22: 'ZINEB EL OMARI',
  35: '30',
  36: '10',
  38: '12,5',
  39: '5',
};

describe('lireAvancementEnote', () => {
  it('lit les colonnes du format e-note', () => {
    const [lue] = lireAvancementEnote(importe([ligne(LIGNE_COMPLETE)]));

    expect(lue).toMatchObject({
      groupe: 'GM101',
      fusionGroupe: 'GM101 GM102',
      module: 'M101',
      formateurPresentiel: 'BRAHIM LOURID',
      // ⚠️ Le présentiel et le synchrone peuvent être assurés par DEUX personnes.
      formateurSynchrone: 'ZINEB EL OMARI',
      prevuPresentiel: 30,
      prevuSynchrone: 10,
      realiseSynchrone: 5,
      estRegional: false,
    });
  });

  /*
   * ⚠️ « 12,5 » À LA VIRGULE : `Number()` rendrait `NaN`, et la masse du module
   * disparaîtrait de l'agrégat sans que rien ne le signale. C'est ce que
   * `parseNumber()` traitait déjà côté PHP.
   */
  it('lit une décimale écrite à la virgule', () => {
    const [lue] = lireAvancementEnote(importe([ligne(LIGNE_COMPLETE)]));
    expect(lue.realisePresentiel).toBe(12.5);
  });

  /*
   * ⚠️ LES FICHIERS PORTENT DES LIGNES DE SOUS-TOTAL ET DES SÉPARATEURS : sans
   * groupe ni module, ce ne sont pas des affectations. Les compter gonflerait le
   * prévu sans rien réaliser — et le taux global tomberait sans cause visible.
   */
  it('écarte une ligne sans groupe ni module', () => {
    const lues = lireAvancementEnote(
      importe([ligne({ 35: '999' }), ligne({ 8: 'GM101', 16: 'M101', 35: '30' })])
    );

    expect(lues).toHaveLength(1);
    expect(lues[0].groupe).toBe('GM101');
  });

  it('écarte une ligne qui n’a QUE le groupe, ou QUE le module', () => {
    const lues = lireAvancementEnote(
      importe([ligne({ 8: 'GM101' }), ligne({ 16: 'M101' })])
    );
    expect(lues).toEqual([]);
  });

  it('reconnaît l’EFM régional, quelle que soit la casse', () => {
    const lues = lireAvancementEnote(
      importe([
        ligne({ ...LIGNE_COMPLETE, 18: 'o' }),
        ligne({ ...LIGNE_COMPLETE, 8: 'GM102', 18: 'N' }),
      ])
    );

    expect(lues.map((l) => l.estRegional)).toEqual([true, false]);
  });

  /*
   * ⚠️ « AUCUN IMPORT » N'EST PAS UNE ERREUR : c'est l'état d'un établissement
   * qui n'a rien déposé. Rendre une liste vide laisse l'écran l'annoncer, là où
   * une exception ferait passer la face entière pour cassée.
   */
  it('rend une liste vide plutôt que de lever, sans import', () => {
    expect(lireAvancementEnote(undefined)).toEqual([]);
    expect(lireAvancementEnote(null)).toEqual([]);
    expect(lireAvancementEnote({})).toEqual([]);
  });

  /*
   * ⚠️ SANS EN-TÊTE, ON RETOMBE SUR LES INDEX DOCUMENTÉS. Un fichier dont la
   * ligne de titre a été retirée reste lisible — c'est déjà le repli de
   * `resoudreColonnes`, et le perdre ici rendrait la face vide sans motif.
   */
  it('lit encore quand l’en-tête manque', () => {
    const [lue] = lireAvancementEnote({ lignes: [ligne(LIGNE_COMPLETE)] });
    expect(lue).toMatchObject({ groupe: 'GM101', module: 'M101', prevuPresentiel: 30 });
  });
});

describe('nombre', () => {
  it('accepte les deux séparateurs décimaux', () => {
    expect(nombre('12,5')).toBe(12.5);
    expect(nombre('12.5')).toBe(12.5);
  });

  // Les fichiers réels portent des espaces fines dans les milliers.
  it('ignore les espaces', () => {
    expect(nombre('1 410')).toBe(1410);
  });

  it('laisse passer un nombre déjà typé', () => {
    expect(nombre(30)).toBe(30);
    expect(nombre(0)).toBe(0);
  });

  /*
   * ⚠️ ZÉRO, JAMAIS `NaN` : une cellule vide ou fautive doit se retirer du
   * calcul, pas le contaminer — un seul `NaN` rend le total entier illisible.
   */
  it('rend zéro sur une valeur illisible', () => {
    for (const valeur of ['', '  ', 'n/a', null, undefined, Number.NaN, Infinity]) {
      expect(nombre(valeur)).toBe(0);
    }
  });
});
