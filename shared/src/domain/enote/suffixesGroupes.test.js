import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construireGroupes, prefixeFiliere, renommerGroupe, retirerSuffixe } from './suffixesGroupes.js';

/**
 * TEST DE CARACTÉRISATION (Phase 2 du plan).
 *
 * Rejoue `pb_buildBaseStructureFromRows()` sur les **24 imports e-note réels**
 * de production, et exige que le portage produise exactement les mêmes listes
 * de groupes.
 *
 * C'est le garde-fou demandé par le plan pour F4 : « rejouer les 24 imports
 * e-note réels et comparer octet à octet la structure produite avec celle de
 * PHP ». Un nom de groupe qui change casse toutes les séances qui le
 * référencent.
 *
 * Fixtures régénérables : `php outils/caracterisation/generer-fixtures-groupes.php`
 */
const ici = path.dirname(fileURLToPath(import.meta.url));
const lire = (nom) =>
  JSON.parse(fs.readFileSync(path.join(ici, '__fixtures__', nom), 'utf8'));

const unitaires = lire('suffixes-unitaires.json');
const imports = lire('renommage-imports.json');

describe('retirerSuffixe — caractérisation', () => {
  it('dispose du corpus de production', () => {
    expect(unitaires.total).toBeGreaterThanOrEqual(130);
  });

  it('reproduit pb_stripSuffixeGroupe sur les 139 noms', () => {
    const ecarts = unitaires.cas
      .map((cas) => ({
        entree: cas.entree,
        attendu: cas.pb_stripSuffixeGroupe,
        obtenu: retirerSuffixe(cas.entree),
      }))
      .filter((c) => c.attendu !== c.obtenu);

    expect(ecarts).toEqual([]);
  });
});

describe('construireGroupes — caractérisation sur les 24 imports réels', () => {
  it('dispose de tous les imports', () => {
    expect(imports.total).toBe(24);
  });

  it.each(imports.imports.map((i) => [`import #${i.importId} — ${i.fichier}`, i]))(
    'reproduit la liste des groupes — %s',
    (_libelle, imp) => {
      const obtenu = construireGroupes(imp.entrees);

      expect(obtenu.groupes).toEqual(imp.groupes);
      expect(obtenu.fusionGroupes).toEqual(imp.fusionGroupes);
      expect(obtenu.groupeModes).toEqual(imp.groupeModes);
    }
  );
});

describe('retirerSuffixe — règles', () => {
  it('retire un suffixe généré', () => {
    expect(retirerSuffixe('ACADA101 (FQ)')).toBe('ACADA101');
    expect(retirerSuffixe('GEOCF201 (CDS)')).toBe('GEOCF201');
  });

  it('retire les suffixes accumulés par des réimports successifs', () => {
    // Sans cela : « ACADA101 (FQ) (FQ) », groupe introuvable, séances perdues.
    expect(retirerSuffixe('ACADA101 (FQ) (FQ)')).toBe('ACADA101');
    expect(retirerSuffixe('ACADA101 (FQ) (FQ) (FQ)')).toBe('ACADA101');
  });

  it('ne touche pas aux parenthèses qui ne sont pas de notre fait', () => {
    // Minuscules, ou trop long : ce n'est pas un suffixe généré.
    expect(retirerSuffixe('GROUPE (bis)')).toBe('GROUPE (bis)');
    expect(retirerSuffixe('GROUPE (TRESLONGSUFFIXE)')).toBe('GROUPE (TRESLONGSUFFIXE)');
  });

  it('ne vide jamais un nom', () => {
    expect(retirerSuffixe('(FQ)')).toBe('(FQ)');
  });
});

describe('renommerGroupe — règles', () => {
  const sansAmbiguite = new Map();

  it('suffixe CDS et FQ selon la fin du code filière', () => {
    expect(renommerGroupe('GEOCF201', 'TSGEO_CDS', sansAmbiguite)).toBe('GEOCF201 (CDS)');
    expect(renommerGroupe('ACADA101', 'ACAD_FQ', sansAmbiguite)).toBe('ACADA101 (FQ)');
  });

  it('CDS prime sur FQ quand les deux motifs pourraient s\'appliquer', () => {
    // L'ordre des tests est celui de l'existant : CDS d'abord.
    expect(renommerGroupe('X101', 'TRUC_FQCDS', sansAmbiguite)).toBe('X101 (CDS)');
  });

  it('ajoute le préfixe de filière quand le nom est porté par plusieurs filières', () => {
    const ambigu = new Map([['DEV101', new Set(['DEVOWFS_S', 'DEVDATA_S'])]]);
    expect(renommerGroupe('DEV101', 'DEVOWFS_S', ambigu)).toBe('DEV101 (DEVOWFS)');
  });

  it("n'ajoute rien quand une seule filière porte le nom", () => {
    const unique = new Map([['DEV101', new Set(['DEVOWFS_S'])]]);
    expect(renommerGroupe('DEV101', 'DEVOWFS_S', unique)).toBe('DEV101');
  });

  it('repart du nom brut, même déjà suffixé', () => {
    // Réimport d'une carte exportée : le suffixe ne doit pas doubler.
    expect(renommerGroupe('ACADA101 (FQ)', 'ACAD_FQ', sansAmbiguite)).toBe('ACADA101 (FQ)');
  });
});

describe('prefixeFiliere', () => {
  it('prend ce qui précède le premier souligné', () => {
    expect(prefixeFiliere('DEVOWFS_S_2A')).toBe('DEVOWFS');
    expect(prefixeFiliere('GEOCF')).toBe('GEOCF');
    expect(prefixeFiliere('')).toBe('');
  });
});

describe('construireGroupes — garde-fous', () => {
  it("refuse autre chose qu'un tableau", () => {
    expect(() => construireGroupes(null)).toThrow(TypeError);
  });

  it('ignore les lignes sans groupe', () => {
    const resultat = construireGroupes([
      { groupe: '', codeFiliere: 'X_FQ' },
      { groupe: 'EM101', codeFiliere: 'EM_S' },
    ]);
    expect(resultat.groupes).toEqual(['EM101']);
  });

  it('ne renomme pas les groupes fusionnés', () => {
    const resultat = construireGroupes([
      { groupe: 'GM101', codeFiliere: 'GM_FQ', fusion: 'GM101 GM102' },
    ]);
    expect(resultat.groupes).toEqual(['GM101 (FQ)']);
    expect(resultat.fusionGroupes).toEqual(['GM101 GM102']);
  });
});
