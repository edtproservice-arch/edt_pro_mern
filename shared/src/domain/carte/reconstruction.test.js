import { describe, it, expect } from 'vitest';
import { modulesInactifs } from './lignesEnote.js';
import { TYPES_COURS } from '../../constants/index.js';
import { carteVersLignesEnote } from './lignesEnote.js';
import { construireBase } from '../enote/parseBase.js';
import {
  anneeDuNomGroupe,
  ensemblesAReconstruire,
  reconstruireFormateurs,
  filieresParGroupe,
  reconstruireGroupes,
} from './reconstruction.js';

const referentiel = new Map([
  [
    'DEVOWFS_S||2',
    {
      filiere: {
        code: 'DEVOWFS_S',
        intitule: 'Développement Full Stack',
        secteur: 'Digital',
        niveau: 'TS',
        typeFormation: 'Diplômante',
        creneau: 'CDJ',
      },
      modules: [
        { code: 'M201', nom: 'Programmation', mhpS1: 30, mhpS2: 30, mhsynS1: 0, mhsynS2: 0, metier: 'Développement' },
        { code: 'M202', nom: 'Réseaux', mhpS1: 20, mhpS2: 20, mhsynS1: 10, mhsynS2: 0, metier: 'Infrastructure' },
        { code: 'M203', nom: 'Anglais', mhpS1: 10, mhpS2: 10, mhsynS1: 0, mhsynS2: 0, metier: 'Langues' },
      ],
    },
  ],
]);

const base = {
  formateurs: [
    { nomComplet: 'AHMED CHERKAOUI', matricule: '9863', email: 'a@ofppt.ma', masseHoraire: 720 },
  ],
  groupes: ['DEVOWFS201', 'DEVOWFS202'],
  groupeModes: { DEVOWFS201: 'Résidentiel', DEVOWFS202: 'Alterné' },
  affectations: [
    {
      formateur: '9863',
      groupe: 'DEVOWFS201',
      module: 'M201',
      type: TYPES_COURS.PRESENTIEL,
      s1Heures: 30,
      s2Heures: 30,
      filiere: 'DEVOWFS_S',
    },
  ],
};

describe('anneeDuNomGroupe', () => {
  it('lit le premier chiffre du numéro de groupe', () => {
    expect(anneeDuNomGroupe('DEVOWFS201')).toBe(2);
    expect(anneeDuNomGroupe('GE101')).toBe(1);
    expect(anneeDuNomGroupe('ACADA3012')).toBe(3);
  });

  it('retombe sur la première année quand le nom ne dit rien', () => {
    expect(anneeDuNomGroupe('GROUPE')).toBe(1);
    expect(anneeDuNomGroupe('')).toBe(1);
    expect(anneeDuNomGroupe(null)).toBe(1);
  });
});

describe('ensemblesAReconstruire', () => {
  it('déduit les ensembles des affectations et des noms de groupes', () => {
    const { ensembles } = ensemblesAReconstruire(base);
    expect(ensembles).toEqual([{ codeFiliere: 'DEVOWFS_S', anneeFormation: 2 }]);
  });

  it('signale un groupe dont la filière reste introuvable', () => {
    // Sans code filière, on ne peut pas aller chercher ses modules : le dire
    // vaut mieux que de rendre un groupe vide sans explication.
    const { groupesSansFiliere } = ensemblesAReconstruire({
      ...base,
      groupes: [...base.groupes, 'ORPHELIN101'],
    });

    expect(groupesSansFiliere).toEqual(['ORPHELIN101']);
  });

  it('ne prend pas le suffixe d’un nom de groupe pour une fusion', () => {
    // « ACADA101 (FQ) » est UN groupe, pas deux. Découper sur les espaces
    // enregistrait la filière sous « ACADA101 » et « (FQ) » — deux clés
    // inexistantes — et le vrai groupe ressortait « sans filière », donc vide.
    const { ensembles, groupesSansFiliere } = ensemblesAReconstruire({
      groupes: ['ACADA101 (FQ)', 'ACADI101 (FQ)'],
      affectations: [
        { groupe: 'ACADA101 (FQ)', module: 'M101', filiere: 'GM_ACADA_FQ', formateur: '9863' },
        { groupe: 'ACADI101 (FQ)', module: 'M101', filiere: 'GM_ACADI_FQ', formateur: '9863' },
      ],
    });

    expect(groupesSansFiliere).toEqual([]);
    expect(ensembles).toEqual([
      { codeFiliere: 'GM_ACADA_FQ', anneeFormation: 1 },
      { codeFiliere: 'GM_ACADI_FQ', anneeFormation: 1 },
    ]);
  });

  it('sépare toujours une vraie fusion, suffixes compris', () => {
    // Deux groupes suffixés dans un même libellé synchrone : chacun doit
    // hériter de la filière, sans perdre son suffixe.
    const { ensembles, groupesSansFiliere } = ensemblesAReconstruire({
      groupes: ['GE101 (CDS) (GE)', 'GE102 (CDS) (GE)'],
      affectations: [
        {
          groupe: 'GE101 (CDS) (GE) GE102 (CDS) (GE)',
          module: 'M201',
          filiere: 'GE_GE_TS',
          formateur: '9863',
          type: 'synchrone',
        },
      ],
    });

    expect(groupesSansFiliere).toEqual([]);
    expect(ensembles).toEqual([{ codeFiliere: 'GE_GE_TS', anneeFormation: 1 }]);
  });

  it('rattache un groupe sans affectation à la filière de son voisin', () => {
    // « DEVOWFS202 » n'a aucune affectation, mais partage préfixe et année avec
    // « DEVOWFS201 » : sans ce rattrapage, le second groupe d'une promotion
    // revenait vide tant qu'on ne l'avait pas affecté.
    const { ensembles, groupesSansFiliere } = ensemblesAReconstruire(base);

    expect(ensembles).toEqual([{ codeFiliere: 'DEVOWFS_S', anneeFormation: 2 }]);
    expect(groupesSansFiliere).toEqual([]);
  });
});

describe('reconstruireGroupes', () => {
  it('rend un groupe par nom, avec sa filière et son mode', () => {
    const groupes = reconstruireGroupes(base, referentiel);

    expect(groupes.map((g) => g.nom)).toEqual(['DEVOWFS201', 'DEVOWFS202']);
    expect(groupes[0]).toMatchObject({
      codeFiliere: 'DEVOWFS_S',
      intituleFiliere: 'Développement Full Stack',
      anneeFormation: 2,
      niveau: 'TS',
      mode: 'Résidentiel',
    });
    expect(groupes[1].mode).toBe('Alterné');
  });

  /*
   * LE point de la reconstruction : `Base.affectations` ne contient que les
   * lignes POURVUES d'un formateur. Sans le complément par la répartition, la
   * carte reviendrait intégralement affectée et les modules restants auraient
   * disparu — l'inverse de ce qu'on vient y chercher.
   */
  it('rétablit les modules qui n\'ont PAS de formateur', () => {
    const [groupe] = reconstruireGroupes(base, referentiel);

    expect(groupe.modules.map((m) => m.code)).toEqual(['M201', 'M202', 'M203']);
    expect(groupe.modules.find((m) => m.code === 'M201').formateurPresentiel).toBe('AHMED CHERKAOUI');
    expect(groupe.modules.find((m) => m.code === 'M202').formateurPresentiel).toBe('');
  });

  /*
   * ⚠️ `affectations[].formateur` porte l'IDENTIFIANT — le matricule quand il
   * existe —, pas le nom. Le poser tel quel affichait « 9863 » dans les
   * sélecteurs, et surtout le RÉENREGISTREMENT écrivait ce matricule dans la
   * colonne « Formateur » du format e-note : le parseur recréait des formateurs
   * NOMMÉS par leur matricule, et sans matricule.
   */
  it("rend le NOM du formateur, pas son matricule", () => {
    const [groupe] = reconstruireGroupes(base, referentiel);
    const module = groupe.modules.find((m) => m.code === 'M201');

    expect(module.formateurPresentiel).toBe('AHMED CHERKAOUI');
  });

  it("garde l'identifiant quand il EST déjà le nom complet", () => {
    // Un formateur sans matricule est identifié par son nom : il n'y a rien à
    // traduire.
    const [groupe] = reconstruireGroupes(
      {
        ...base,
        formateurs: [{ nomComplet: 'FATIMA BENALI', matricule: '', masseHoraire: 0 }],
        affectations: [
          {
            formateur: 'FATIMA BENALI',
            groupe: 'DEVOWFS201',
            module: 'M201',
            type: TYPES_COURS.PRESENTIEL,
            filiere: 'DEVOWFS_S',
          },
        ],
      },
      referentiel
    );

    expect(groupe.modules.find((m) => m.code === 'M201').formateurPresentiel).toBe('FATIMA BENALI');
  });

  it('traduit aussi le formateur synchrone', () => {
    const [groupe] = reconstruireGroupes(
      {
        ...base,
        affectations: [
          {
            formateur: '9863',
            groupe: 'DEVOWFS201',
            module: 'M202',
            type: TYPES_COURS.SYNCHRONE,
            filiere: 'DEVOWFS_S',
          },
        ],
      },
      referentiel
    );

    expect(groupe.modules.find((m) => m.code === 'M202').formateurSynchrone).toBe('AHMED CHERKAOUI');
  });

  it('récupère le métier et les masses depuis la répartition', () => {
    // Ni l'un ni l'autre ne sont stockés dans la base : sans ce croisement, le
    // bilan par métier se réduirait à une ligne « Non renseigné ».
    const [groupe] = reconstruireGroupes(base, referentiel);
    const module = groupe.modules.find((m) => m.code === 'M202');

    expect(module).toMatchObject({ metier: 'Infrastructure', mhpS1: 20, mhsynS1: 10 });
  });

  it('éclate un libellé fusionné sur chacun de ses groupes', () => {
    const groupes = reconstruireGroupes(
      {
        ...base,
        affectations: [
          {
            formateur: '9863',
            groupe: 'DEVOWFS201 DEVOWFS202',
            module: 'M202',
            type: TYPES_COURS.SYNCHRONE,
            s1Heures: 10,
            s2Heures: 0,
            filiere: 'DEVOWFS_S',
          },
        ],
      },
      referentiel
    );

    for (const groupe of groupes) {
      const module = groupe.modules.find((m) => m.code === 'M202');
      expect(module.formateurSynchrone).toBe('AHMED CHERKAOUI');
      // Le libellé fusionné est conservé : c'est lui que relit l'import.
      expect(module.groupeFusion).toBe('DEVOWFS201 DEVOWFS202');
    }
  });

  it('ne perd pas une affectation dont le module a quitté la répartition', () => {
    const [groupe] = reconstruireGroupes(
      {
        ...base,
        affectations: [
          {
            formateur: '9863',
            groupe: 'DEVOWFS201',
            module: 'M999',
            type: TYPES_COURS.PRESENTIEL,
            s1Heures: 15,
            s2Heures: 5,
            filiere: 'DEVOWFS_S',
          },
        ],
      },
      referentiel
    );

    const retabli = groupe.modules.find((m) => m.code === 'M999');
    expect(retabli).toMatchObject({ formateurPresentiel: 'AHMED CHERKAOUI', mhpS1: 15, mhpS2: 5 });
  });

  it('rend un groupe vide plutôt que rien quand la filière est introuvable', () => {
    // Aucune affectation nulle part : plus rien ne dit à quelle filière ces
    // groupes appartiennent.
    const groupes = reconstruireGroupes({ ...base, affectations: [] }, referentiel);

    expect(groupes).toHaveLength(2);
    expect(groupes[0].modules).toEqual([]);
    expect(groupes[0].codeFiliere).toBe('');
  });

  it("garnit AUSSI le groupe qui n'a encore aucune affectation", () => {
    const groupes = reconstruireGroupes(base, referentiel);
    const second = groupes.find((g) => g.nom === 'DEVOWFS202');

    expect(second.codeFiliere).toBe('DEVOWFS_S');
    expect(second.modules.map((m) => m.code)).toEqual(['M201', 'M202', 'M203']);
    expect(second.modules.every((m) => m.formateurPresentiel === '')).toBe(true);
  });

  it('accepte une base vide', () => {
    expect(reconstruireGroupes(null)).toEqual([]);
    expect(reconstruireGroupes({})).toEqual([]);
  });
});

describe('reconstruireFormateurs', () => {
  it('rend la forme attendue par l\'écran', () => {
    expect(reconstruireFormateurs(base)).toEqual([
      { nom: 'AHMED CHERKAOUI', matricule: '9863', email: 'a@ofppt.ma', masseHoraire: 720 },
    ]);
  });

  it('accepte une base sans formateur', () => {
    expect(reconstruireFormateurs({})).toEqual([]);
  });
});

describe('aller-retour base → carte → base', () => {
  /*
   * LE garde-fou de la reconstruction.
   *
   * Recharger une carte puis la réenregistrer sans y toucher doit redonner la
   * MÊME base. C'est ce test qui aurait attrapé du premier coup le défaut des
   * matricules pris pour des noms : l'aller-retour produisait des formateurs
   * nommés « 9863 », et sans matricule.
   */
  it('redonne les mêmes formateurs et les mêmes affectations', () => {
    const groupes = reconstruireGroupes(base, referentiel);
    const formateurs = reconstruireFormateurs(base);

    const lignes = carteVersLignesEnote({ groupes, formateurs }, 2026);
    const reconstruite = construireBase(lignes);

    // Les formateurs gardent leur nom ET leur matricule.
    expect(reconstruite.formateursDetails.map((f) => [f.nomComplet, f.matricule])).toEqual([
      ['AHMED CHERKAOUI', '9863'],
    ]);

    // L'affectation d'origine se retrouve, identifiée par le matricule.
    expect(reconstruite.affectations).toContainEqual(
      expect.objectContaining({ formateur: '9863', groupe: 'DEVOWFS201', module: 'M201' })
    );

    // Et les deux groupes sont toujours là.
    expect(reconstruite.groupes.sort()).toEqual(['DEVOWFS201', 'DEVOWFS202']);
  });
});

describe('reconstruireGroupes — modules désactivés', () => {
  const actif = (groupes, nomGroupe, code) =>
    groupes.find((g) => g.nom === nomGroupe).modules.find((m) => m.code === code).actif;

  it('⚠️ REND INACTIF un module que la base dit désactivé', () => {
    /*
     * LE DÉFAUT QUE CE TEST FIGE. Un module inactif ne produit AUCUNE ligne
     * e-note — c'est ce qui le retire du bilan et de la charge. Mais la carte se
     * reconstruit en croisant la base avec la répartition DRIF, et le
     * référentiel, lui, connaît toujours le module : il revenait donc ACTIF au
     * rechargement, indiscernable d'un module simplement pas encore affecté, et
     * le commutateur paraissait sans effet.
     */
    const groupes = reconstruireGroupes(
      { ...base, modulesInactifs: { DEVOWFS201: ['M202'] } },
      referentiel
    );

    expect(actif(groupes, 'DEVOWFS201', 'M202')).toBe(false);
    // Les autres modules du même groupe ne bougent pas.
    expect(actif(groupes, 'DEVOWFS201', 'M201')).toBeUndefined();
  });

  it('ne désactive QUE le groupe nommé', () => {
    // Deux groupes d'une même promotion partagent leurs modules : désactiver
    // chez l'un ne doit rien fermer chez l'autre.
    const groupes = reconstruireGroupes(
      { ...base, modulesInactifs: { DEVOWFS201: ['M202'] } },
      referentiel
    );

    expect(actif(groupes, 'DEVOWFS202', 'M202')).toBeUndefined();
  });

  it('n’écrit PAS `actif: true` sur les modules ordinaires', () => {
    /*
     * `actif` absent vaut actif partout ailleurs — bilan, lignes e-note. Le
     * poser à `true` ferait diverger les deux formes, et un module « actif:true »
     * cesserait d'être reconnu par un test d'absence.
     */
    const groupes = reconstruireGroupes(base, referentiel);
    expect(groupes.every((g) => g.modules.every((m) => m.actif === undefined))).toBe(true);
  });

  it('accepte une Map, comme le document Mongoose', () => {
    // Le serveur manipule un document hydraté — donc une Map — quand le
    // navigateur reçoit du JSON. Une seule des deux lectures aurait marché.
    const groupes = reconstruireGroupes(
      { ...base, modulesInactifs: new Map([['DEVOWFS201', ['M202']]]) },
      referentiel
    );

    expect(actif(groupes, 'DEVOWFS201', 'M202')).toBe(false);
  });

  it('ALLER-RETOUR : désactiver, enregistrer, recharger — le module reste inactif', () => {
    // Le parcours réel, de bout en bout : c'est lui qui était cassé.
    const groupes = reconstruireGroupes(
      { ...base, modulesInactifs: { DEVOWFS201: ['M202'] } },
      referentiel
    );

    const carte = { groupes, formateurs: [] };
    expect(modulesInactifs(carte)).toEqual({ DEVOWFS201: ['M202'] });
  });
});

describe('filieresParGroupe — table persistée', () => {
  it('⚠️ garde la filière d’un groupe SANS AUCUNE affectation', () => {
    /*
     * LE DÉFAUT QUE CE TEST FIGE. La filière se déduisait des seules
     * affectations, avec un rattrapage par un groupe VOISIN de même préfixe. Un
     * groupe seul dans sa filière, dont tous les modules sont désactivés ou pas
     * encore affectés, n'en avait donc plus : la répartition ne pouvait plus
     * être interrogée, et l'ensemble DISPARAISSAIT de l'écran alors que le
     * groupe existait toujours en base.
     */
    const orpheline = {
      groupes: ['ACADA101 (FQ)'],
      affectations: [],
      groupeFilieres: { 'ACADA101 (FQ)': 'GM_ACADA_FQ' },
    };

    expect(filieresParGroupe(orpheline).get('ACADA101 (FQ)')).toBe('GM_ACADA_FQ');
    expect(ensemblesAReconstruire(orpheline).groupesSansFiliere).toEqual([]);
  });

  it('les affectations restent une source, pour les bases d’avant', () => {
    // Une base enregistrée avant ce champ n'en a pas : la déduction doit
    // continuer de fonctionner, sinon toutes les cartes existantes se videraient.
    expect(filieresParGroupe(base).get('DEVOWFS201')).toBe('DEVOWFS_S');
  });

  it('accepte une Map, comme le document Mongoose', () => {
    const avecMap = {
      groupes: ['GE101'],
      affectations: [],
      groupeFilieres: new Map([['GE101', 'GE_GE_TS']]),
    };
    expect(filieresParGroupe(avecMap).get('GE101')).toBe('GE_GE_TS');
  });
});
