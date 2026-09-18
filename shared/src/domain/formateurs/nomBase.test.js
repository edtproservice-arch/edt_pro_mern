import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nomBase, prenom } from './nomBase.js';

/**
 * TEST DE CARACTÉRISATION (Phase 2 du plan).
 *
 * Rejoue l'implémentation PHP de production sur ses propres données — les
 * 156 noms de formateurs présents dans les imports e-note réels — et exige que
 * le portage produise EXACTEMENT les mêmes sorties.
 *
 * C'est le garde-fou du module F4, classé en risque critique : un import qui
 * produit des identifiants différents casse rétroactivement tous les emplois du
 * temps déjà saisis. Ce test échoue si quelqu'un « améliore » la règle sans
 * mesurer l'effet sur les données existantes.
 *
 * Fixtures régénérables : `php outils/caracterisation/generer-fixtures-noms.php`
 */
const ici = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(ici, '__fixtures__/noms-unitaires.json'), 'utf8')
);

/**
 * Divergences ASSUMÉES par rapport à `getBaseName`. Il n'y en a aucune : la
 * règle retenue est précisément celle de `getBaseName`. Le tableau existe pour
 * qu'une divergence future soit déclarée ici, jamais découverte en production.
 */
const DIVERGENCES_ACCEPTEES = new Map();

describe('nomBase — caractérisation sur données réelles', () => {
  it('dispose bien du corpus de production', () => {
    expect(fixture.cas.length).toBeGreaterThanOrEqual(150);
  });

  it('reproduit getBaseName sur les 156 noms, sans exception', () => {
    const ecarts = [];

    for (const cas of fixture.cas) {
      const attendu = DIVERGENCES_ACCEPTEES.get(cas.entree) ?? cas.getBaseName;
      const obtenu = nomBase(cas.entree);
      if (obtenu !== attendu) {
        ecarts.push({ entree: cas.entree, attendu, obtenu });
      }
    }

    expect(ecarts).toEqual([]);
  });
});

describe('nomBase — règles', () => {
  it('renvoie une chaîne vide pour une entrée vide', () => {
    expect(nomBase('')).toBe('');
    expect(nomBase('   ')).toBe('');
    expect(nomBase(null)).toBe('');
    expect(nomBase(undefined)).toBe('');
  });

  it('met en majuscules et normalise les espaces', () => {
    // La variante du navigateur ne le faisait pas : « TAIA Ahmed » y devenait
    // « Ahmed », qui ne correspondait plus à la valeur stockée.
    expect(nomBase('TAIA Ahmed')).toBe('AHMED');
    expect(nomBase('  DALLI   AMINE  ')).toBe('AMINE');
  });

  it('garde la particule courte quand le nom fait exactement 3 mots', () => {
    expect(nomBase('ABDESSAMAD AIT TALEB')).toBe('AIT TALEB');
    expect(nomBase('ZINEB EL OMARI')).toBe('EL OMARI');
    expect(nomBase('AHMED BEN ALI')).toBe('BEN ALI');
  });

  it('ne garde que le 3e mot si le 2e est long', () => {
    expect(nomBase('FATIMA ZAHRA ELALAMI')).toBe('ELALAMI');
  });

  it('prend le dernier mot au-delà de 3 mots — y compris avec une particule', () => {
    // Divergence tranchée : PHP getFormattedName renvoyait « EL CADI » ici.
    expect(nomBase('AIT EL CADI AYOUB')).toBe('AYOUB');
  });

  it('refuse un argument qui n\'est pas une chaîne', () => {
    // Garde-fou n°2 du §5bis : le domaine valide ses entrées plutôt que de
    // produire un identifiant silencieusement faux.
    expect(() => nomBase(42)).toThrow(TypeError);
    expect(() => nomBase({ nom: 'X' })).toThrow(TypeError);
  });
});

describe('prenom', () => {
  it('prend le premier mot, en majuscules', () => {
    expect(prenom('abdessamad ait taleb')).toBe('ABDESSAMAD');
    expect(prenom('')).toBe('');
  });
});
