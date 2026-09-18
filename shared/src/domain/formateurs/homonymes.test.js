import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resoudreHomonymes } from './homonymes.js';

/**
 * TEST DE CARACTÉRISATION (Phase 2 du plan).
 *
 * Rejoue les deux implémentations PHP concurrentes sur les groupes de
 * formateurs réels — 4 groupes, 79 formateurs, 2 établissements, 2 années —
 * et exige que le portage reproduise leurs sorties.
 *
 * La résolution d'homonymes est un traitement de GROUPE : le nom attribué à un
 * formateur dépend des autres présents. Un test nom par nom ne prouverait rien.
 *
 * Fixtures régénérables : `php outils/caracterisation/generer-fixtures-noms.php`
 */
const ici = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(ici, '__fixtures__/homonymes-groupes.json'), 'utf8')
);

describe('resoudreHomonymes — caractérisation sur données réelles', () => {
  it('dispose bien des groupes de production', () => {
    expect(fixture.groupes.length).toBeGreaterThanOrEqual(4);
  });

  it.each(fixture.groupes.map((g) => [`etab ${g.etablissementId} / ${g.anneeScolaire}`, g]))(
    'reproduit resolveNameConflicts et pb_resolveNameConflicts — %s',
    (_libelle, groupe) => {
      const entree = groupe.entrees.map((e) => ({
        nomComplet: e.nom_complet,
        matricule: e.matricule,
      }));

      const obtenu = resoudreHomonymes(entree);

      // Les deux implémentations PHP écrivaient dans deux champs différents
      // (`nom` et `nom_unique`) — d'où la double vérification.
      const attenduResolve = new Map(
        groupe.resolveNameConflicts.map((f) => [f.nom_complet, f.nom])
      );
      const attenduPb = new Map(
        groupe.pb_resolveNameConflicts.map((f) => [f.nom_complet, f.nom_unique])
      );

      const ecarts = [];
      for (const formateur of obtenu) {
        const reference = attenduResolve.get(formateur.nomComplet);
        const referencePb = attenduPb.get(formateur.nomComplet);

        if (formateur.nomUnique !== reference || formateur.nomUnique !== referencePb) {
          ecarts.push({
            nomComplet: formateur.nomComplet,
            obtenu: formateur.nomUnique,
            resolveNameConflicts: reference,
            pb_resolveNameConflicts: referencePb,
          });
        }
      }

      expect(ecarts).toEqual([]);
    }
  );

  it("conserve l'ordre et le nombre d'entrées", () => {
    const groupe = fixture.groupes[0];
    const entree = groupe.entrees.map((e) => ({ nomComplet: e.nom_complet }));
    const obtenu = resoudreHomonymes(entree);

    expect(obtenu).toHaveLength(entree.length);
    expect(obtenu.map((f) => f.nomComplet)).toEqual(entree.map((f) => f.nomComplet));
  });

  it('préserve les champs annexes, dont le matricule', () => {
    const obtenu = resoudreHomonymes([{ nomComplet: 'AHMED CHERKAOUI', matricule: '9863' }]);
    expect(obtenu[0].matricule).toBe('9863');
  });
});

describe('resoudreHomonymes — règles', () => {
  it("n'ajoute aucun préfixe quand le nom de base est unique", () => {
    const obtenu = resoudreHomonymes([
      { nomComplet: 'AHMED CHERKAOUI' },
      { nomComplet: 'FATIMA ALAMI' },
    ]);

    expect(obtenu.map((f) => f.nomUnique)).toEqual(['CHERKAOUI', 'ALAMI']);
  });

  it('distingue deux homonymes par les 2 premières lettres du prénom', () => {
    const obtenu = resoudreHomonymes([
      { nomComplet: 'AHMED CHERKAOUI' },
      { nomComplet: 'MOHAMED CHERKAOUI' },
    ]);

    expect(obtenu.map((f) => f.nomUnique)).toEqual(['AH CHERKAOUI', 'MO CHERKAOUI']);
  });

  it('élargit le préfixe tant que les prénoms se ressemblent', () => {
    const obtenu = resoudreHomonymes([
      { nomComplet: 'MOHAMED CHERKAOUI' },
      { nomComplet: 'MOUAD CHERKAOUI' },
    ]);

    // « MO » est ambigu, « MOH » et « MOU » séparent.
    expect(obtenu.map((f) => f.nomUnique)).toEqual(['MOH CHERKAOUI', 'MOU CHERKAOUI']);
  });

  it('termine même quand aucun préfixe ne sépare les prénoms', () => {
    // ⚠️ Ce cas fait BOUCLER INDÉFINIMENT l'implémentation PHP : le compteur de
    // longueur est incrémenté puis ramené à 4, et la condition de boucle reste
    // vraie. Ici la boucle est bornée — un doublon visible vaut mieux qu'un
    // serveur figé.
    const obtenu = resoudreHomonymes([
      { nomComplet: 'MOHAMMED ALAMI' },
      { nomComplet: 'MOHAMMED ALAMI' },
    ]);

    expect(obtenu).toHaveLength(2);
    expect(obtenu[0].nomUnique).toBe('MOHA ALAMI');
    expect(obtenu[1].nomUnique).toBe('MOHA ALAMI');
  });

  it('refuse un argument qui n\'est pas un tableau', () => {
    expect(() => resoudreHomonymes('AHMED')).toThrow(TypeError);
  });
});
