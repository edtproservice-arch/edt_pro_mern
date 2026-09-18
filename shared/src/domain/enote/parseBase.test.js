import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { construireBase } from './parseBase.js';
import { indexColonne, resoudreColonnes } from './colonnes.js';

/**
 * TEST DE CARACTÉRISATION — le garde-fou du module F4.
 *
 * Le plan l'exige explicitement : « rejouer les 24 imports e-note réels et
 * comparer octet à octet la structure produite avec celle de PHP ».
 *
 * Les 24 imports se ramènent à **13 fichiers distincts** — les 11 autres sont
 * des réimports du même contenu. Pour chacun, la fixture porte l'EMPREINTE
 * SHA-256 de la structure canonique produite par `pb_buildBaseStructureFromRows`.
 * Deux structures identiques ont la même empreinte ; la moindre différence la
 * change. La comparaison est donc bien exacte, sans stocker des mégaoctets.
 *
 * Quand une empreinte ne correspond plus, `base-detaillee.json` porte la
 * structure entière de 3 imports représentatifs pour localiser l'écart.
 *
 * Fixtures régénérables : `php outils/caracterisation/generer-fixtures-base.php`
 */
const ici = path.dirname(fileURLToPath(import.meta.url));
const lire = (nom) => JSON.parse(fs.readFileSync(path.join(ici, '__fixtures__', nom), 'utf8'));

const empreintes = lire('base-empreintes.json');
const detaillee = lire('base-detaillee.json');

/**
 * Reconstruit une ligne e-note complète à partir des 14 colonnes conservées.
 * Le parser ne lit que celles-là ; les 37 autres ne changent rien au résultat.
 */
function ligneComplete(valeurs) {
  const ligne = [];
  empreintes.colonnesLues.forEach((index, position) => {
    ligne[index] = valeurs[position];
  });
  return ligne;
}

/** Forme canonique : clés triées récursivement. ← `canoniser()` du générateur PHP. */
function canoniser(valeur) {
  if (Array.isArray(valeur)) return valeur.map(canoniser);
  if (valeur === null || typeof valeur !== 'object') return valeur;

  return Object.fromEntries(
    Object.keys(valeur)
      .sort()
      .map((cle) => [cle, canoniser(valeur[cle])])
  );
}

/**
 * Traduit la structure JavaScript vers les noms de champs de PHP, pour que les
 * empreintes soient comparables. Le portage a renommé en camelCase ; la
 * caractérisation compare le CONTENU, pas la convention de nommage.
 */
function versFormatPhp(structure) {
  return {
    formateurs: structure.formateurs.map((f) => ({
      matricule: f.matricule,
      nom_complet: f.nomComplet,
    })),
    formateurs_details: structure.formateursDetails.map((f) => ({
      nom_unique: f.nomUnique,
      nom_complet: f.nomComplet,
      email: f.email,
      matricule: f.matricule,
      masse_horaire: f.masseHoraire,
      est_nouveau: f.estNouveau,
    })),
    nouveaux_formateurs: structure.nouveauxFormateurs.map((f) => ({
      matricule: String(f.matricule),
      nom_complet: f.nomComplet,
      masse_horaire: f.masseHoraire,
    })),
    formateurs_sans_matricule: structure.formateursSansMatricule,
    groupes: structure.groupes,
    fusionGroupes: structure.fusionGroupes,
    affectations: structure.affectations.map((a) => ({
      formateur: a.formateur,
      groupe: a.groupe,
      module: a.module,
      type: a.type,
      s1_heures: a.s1Heures,
      s2_heures: a.s2Heures,
      est_regional: a.estRegional,
      filiere: a.filiere,
    })),
    groupeModes: structure.groupeModes,
  };
}

const empreinteDe = (structure) =>
  crypto.createHash('sha256').update(JSON.stringify(canoniser(structure))).digest('hex');

describe('construireBase — caractérisation sur les imports réels', () => {
  it('dispose du corpus de production', () => {
    expect(empreintes.total).toBeGreaterThanOrEqual(13);
  });

  it.each(
    empreintes.imports.map((imp) => [
      `#${imp.importId} — ${imp.effectifs.affectations} affectations`,
      imp,
    ])
  )('reproduit la structure PHP — %s', (_libelle, imp) => {
    const obtenu = construireBase(imp.entrees.map(ligneComplete));

    // Effectifs d'abord : en cas d'écart, le message dit tout de suite QUOI
    // diffère, avant que l'empreinte ne dise seulement QUE ça diffère.
    expect({
      formateurs: obtenu.formateurs.length,
      formateursDetails: obtenu.formateursDetails.length,
      nouveauxFormateurs: obtenu.nouveauxFormateurs.length,
      formateursSansMatricule: obtenu.formateursSansMatricule.length,
      groupes: obtenu.groupes.length,
      fusionGroupes: obtenu.fusionGroupes.length,
      affectations: obtenu.affectations.length,
      groupeModes: Object.keys(obtenu.groupeModes).length,
    }).toEqual(imp.effectifs);

    expect(empreinteDe(versFormatPhp(obtenu))).toBe(imp.empreinte);
  });
});

describe('construireBase — structures détaillées', () => {
  it.each(detaillee.imports.map((imp) => [`#${imp.importId}`, imp]))(
    'reproduit champ par champ — %s',
    (_libelle, imp) => {
      const entree = empreintes.imports.find((i) => i.importId === imp.importId);
      // Les 3 imports détaillés ne sont pas tous parmi les 13 distincts.
      if (!entree) return;

      const obtenu = versFormatPhp(construireBase(entree.entrees.map(ligneComplete)));

      expect(obtenu.groupes).toEqual(imp.structure.groupes);
      expect(obtenu.fusionGroupes).toEqual(imp.structure.fusionGroupes);
      expect(obtenu.formateurs).toEqual(imp.structure.formateurs);
      expect(obtenu.affectations).toEqual(imp.structure.affectations);
      expect(obtenu.formateurs_details).toEqual(imp.structure.formateurs_details);
    }
  );
});

describe('construireBase — règles', () => {
  const ligne = (valeurs) => ligneComplete(valeurs);

  /** Ordre des 14 colonnes conservées, cf. `colonnesLues` de la fixture. */
  const construire = ({
    codeFiliere = 'DEVOWFS_S',
    groupe = 'DEV101',
    fusion = '',
    mode = '',
    module = 'M101',
    regional = '',
    matriculeP = '9863',
    formateurP = 'AHMED CHERKAOUI',
    matriculeS = '',
    formateurS = '',
    partS1 = '30',
    partS2 = '30',
    mhp = '60',
    mhsyn = '0',
  } = {}) =>
    ligne([
      codeFiliere,
      groupe,
      fusion,
      mode,
      module,
      regional,
      matriculeP,
      formateurP,
      matriculeS,
      formateurS,
      partS1,
      partS2,
      mhp,
      mhsyn,
    ]);

  it('identifie un formateur par son matricule', () => {
    const base = construireBase([construire()]);
    expect(base.affectations[0].formateur).toBe('9863');
  });

  it('retombe sur le nom complet quand le matricule manque', () => {
    // ⚠️ Jamais une chaîne vide : l'affectation serait rejetée silencieusement.
    const base = construireBase([construire({ matriculeP: '' })]);
    expect(base.affectations[0].formateur).toBe('AHMED CHERKAOUI');
    expect(base.formateursSansMatricule).toEqual(['AHMED CHERKAOUI']);
  });

  it('ne compte qu\'une fois un cours synchrone donné à un groupe fusionné', () => {
    // e-note décrit ce cours sur CHAQUE ligne de groupe, avec à chaque fois la
    // masse horaire complète. Les additionner doublerait la charge prévue.
    const base = construireBase([
      construire({
        groupe: 'GM101',
        fusion: 'GM101 GM102',
        matriculeS: '10039',
        formateurS: 'SAMIR EL ACHOURI',
        mhsyn: '30',
      }),
      construire({
        groupe: 'GM102',
        fusion: 'GM101 GM102',
        matriculeS: '10039',
        formateurS: 'SAMIR EL ACHOURI',
        mhsyn: '30',
      }),
    ]);

    const synchrones = base.affectations.filter((a) => a.type === 'synchrone');
    expect(synchrones).toHaveLength(1);
    expect(synchrones[0].groupe).toBe('GM101 GM102');
  });

  it('déduit une adresse OFPPT des matricules numériques seulement', () => {
    const numerique = construireBase([construire({ matriculeP: '9863' })]);
    expect(numerique.formateursDetails[0].email).toBe('ahmed.cherkaoui@ofppt.ma');

    // Matricule alphanumérique = intervenant extérieur, sans adresse OFPPT.
    const externe = construireBase([construire({ matriculeP: 'PB134876' })]);
    expect(externe.formateursDetails[0].email).toBe('');
  });

  it('retire les accents de l\'adresse déduite', () => {
    const base = construireBase([construire({ formateurP: 'RACHÎD BENOÎT' })]);
    expect(base.formateursDetails[0].email).toBe('rachid.benoit@ofppt.ma');
  });

  it('déduit la masse horaire d\'un formateur inconnu de ses affectations', () => {
    const base = construireBase([construire({ partS1: '30', partS2: '30', mhp: '60' })]);
    expect(base.nouveauxFormateurs[0].masseHoraire).toBe(60);
  });

  it('conserve la masse horaire déjà saisie par l\'établissement', () => {
    const base = construireBase([construire()], {
      massesConnues: new Map([['9863', 910]]),
    });

    expect(base.formateursDetails[0].masseHoraire).toBe(910);
    expect(base.nouveauxFormateurs).toEqual([]);
  });

  it('marque les EFM régionaux', () => {
    const base = construireBase([construire({ regional: 'O' })]);
    expect(base.affectations[0].estRegional).toBe(true);
  });

  it('refuse autre chose qu\'un tableau', () => {
    expect(() => construireBase(null)).toThrow(TypeError);
  });

  it('repère les colonnes par leur NOM quand un en-tête est fourni', () => {
    // Certains fichiers arrivent avec des colonnes décalées : l'en-tête prime
    // alors sur les index fixes.
    const entete = [];
    entete[0] = 'Groupe';
    entete[1] = 'Code Filière';
    entete[2] = 'Code Module';
    entete[3] = 'Formateur Affecté Présentiel Actif';
    entete[4] = 'Mle Affecté Présentiel Actif';

    const ligneDecalee = ['DEV101', 'DEVOWFS_S', 'M101', 'AHMED CHERKAOUI', '9863'];

    const base = construireBase([ligneDecalee], { entete });

    expect(base.groupes).toEqual(['DEV101']);
    expect(base.affectations[0]).toMatchObject({ formateur: '9863', module: 'M101' });
  });

  it('ignore les lignes sans groupe et sans formateur', () => {
    const base = construireBase([
      construire({ groupe: '' }),
      construire({ formateurP: '', matriculeP: '' }),
    ]);

    // La deuxième ligne porte un groupe mais aucun formateur : le groupe est
    // retenu, l'affectation non.
    expect(base.groupes).toEqual(['DEV101']);
    expect(base.affectations).toEqual([]);
  });

  it("n'ajoute pas d'affectation quand le module est vide", () => {
    const base = construireBase([construire({ module: '' })]);
    expect(base.affectations).toEqual([]);
    expect(base.formateurs).toHaveLength(1);
  });

  it('renseigne le mode de formation du groupe', () => {
    const alterne = construireBase([construire({ mode: 'ALT' })]);
    expect(alterne.groupeModes.DEV101).toBe('Alterné');

    const residentiel = construireBase([construire({ mode: 'RES' })]);
    expect(residentiel.groupeModes.DEV101).toBe('Résidentiel');
  });
  describe('adresses des formateurs', () => {
    // Le canevas d'import porte une colonne « Email » facultative. L'adresse
    // déduite du nom n'est qu'un repli : plausible, jamais vérifiée. C'est à
    // l'adresse réelle que partiront les identifiants de compte.
    const unFormateur = () => [construire({ formateurP: 'AMMARI YOUSSEF', matriculeP: '9863' })];

    it("déduit une adresse quand rien n'est connu", () => {
      expect(construireBase(unFormateur()).formateursDetails[0].email).toBe(
        'ammari.youssef@ofppt.ma'
      );
    });

    it('préfère une adresse réelle connue par matricule', () => {
      const base = construireBase(unFormateur(), {
        emailsConnus: new Map([['9863', 'y.ammari@ofppt.ma']]),
      });
      expect(base.formateursDetails[0].email).toBe('y.ammari@ofppt.ma');
    });

    it('accepte aussi une adresse connue par nom complet', () => {
      const base = construireBase(unFormateur(), {
        emailsConnus: new Map([['AMMARI YOUSSEF', 'y.ammari@ofppt.ma']]),
      });
      expect(base.formateursDetails[0].email).toBe('y.ammari@ofppt.ma');
    });

    it("une cellule vide n'efface pas l'adresse déduite", () => {
      // La colonne est facultative : une cellule blanche ne dit rien, elle ne
      // doit pas vider le champ.
      const base = construireBase(unFormateur(), {
        emailsConnus: new Map([['9863', '   ']]),
      });
      expect(base.formateursDetails[0].email).toBe('ammari.youssef@ofppt.ma');
    });

    it("laisse l'adresse vide pour un matricule non numérique", () => {
      // Matricule alphanumérique = intervenant extérieur, sans adresse OFPPT.
      const base = construireBase([
        construire({ formateurP: 'AMMARI YOUSSEF', matriculeP: 'BX10245' }),
      ]);
      expect(base.formateursDetails[0].email).toBe('');
    });
  });
});

describe('resoudreColonnes', () => {
  it('retombe sur les index fixes quand la colonne est absente de l\'en-tête', () => {
    // Les colonnes S, X, AB, AJ, AK n'ont pas de nom exploitable : elles sont
    // toujours repérées par leur position.
    const colonnes = resoudreColonnes(['Groupe']);
    expect(colonnes.groupe).toBe(0);
    expect(colonnes.partS1).toBe(23);
  });

  it('refuse une colonne inconnue', () => {
    expect(() => indexColonne('inexistante')).toThrow(/Colonne inconnue/);
  });

});
