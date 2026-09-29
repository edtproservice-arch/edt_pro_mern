/**
 * Le corpus d'entraînement de la génération (F6 · étape d).
 *
 * ⚠️ DEUX DÉFAUTS SILENCIEUX SONT POSSIBLES ICI, ET AUCUN NE LÈVE.
 *    — Un champ oublié par la pseudonymisation laisse un matricule EN CLAIR
 *      dans un corpus destiné à sortir de la production. Rien ne le signale :
 *      la trace s'écrit, elle est simplement compromise.
 *    — Un écart mal calculé rend un signal d'apprentissage faux, et un modèle
 *      entraîné dessus apprendrait le contraire de ce qu'il faut.
 *
 * Les deux modules testés sont PURS : aucune base, aucun solveur.
 */

import { describe, expect, it } from 'vitest';

import { ecartGrille } from '../../src/modules/generation/ecart.js';
import {
  idTache,
  nouveauSel,
  pseudonyme,
  pseudonymiserTrace,
} from '../../src/modules/generation/pseudonyme.js';

const SEL = 'sel-de-test-0123456789abcdef';

describe('pseudonyme', () => {
  it('rend la même valeur pour la même entrée — c’est ce qui rend un formateur suivable d’une semaine à l’autre', () => {
    expect(pseudonyme(SEL, 'formateur', '18494')).toBe(pseudonyme(SEL, 'formateur', '18494'));
  });

  it('change avec le sel — sans quoi le corpus d’un établissement serait déchiffrable avec celui d’un autre', () => {
    expect(pseudonyme(SEL, 'formateur', '18494')).not.toBe(
      pseudonyme(nouveauSel(), 'formateur', '18494')
    );
  });

  it('sépare les types : un groupe et une salle de même libellé ne se confondent pas', () => {
    expect(pseudonyme(SEL, 'groupe', 'A12')).not.toBe(pseudonyme(SEL, 'salle', 'A12'));
  });

  it('n’invente rien pour une valeur absente', () => {
    expect(pseudonyme(SEL, 'formateur', '')).toBe('');
    expect(pseudonyme(SEL, 'formateur', null)).toBe('');
    expect(pseudonyme(SEL, 'salle', '   ')).toBe('');
  });

  it('garde TEAMS et ABSENT en clair : ce sont des valeurs de protocole, pas des salles', () => {
    expect(pseudonyme(SEL, 'salle', 'TEAMS')).toBe('TEAMS');
    expect(pseudonyme(SEL, 'salle', 'ABSENT')).toBe('ABSENT');
  });

  it('ne rend jamais la valeur d’origine pour une vraie salle', () => {
    expect(pseudonyme(SEL, 'salle', 'Salle 1')).not.toBe('Salle 1');
  });
});

/* ── Un problème minuscule, mais qui porte TOUS les champs qui nomment. ── */
const tachesNode = [
  {
    id: 'GM101||M107||18494||presentiel',
    formateurMatricule: '18494',
    groupeLibelle: 'GM101',
    groupes: ['GM101'],
    module: 'M107',
    type: 'presentiel',
    heures: 5,
    seancesRequises: 2,
    estRegional: true,
    semestre: 1,
    priorite: 3,
  },
  {
    id: 'GM101 GM102||EGTS102||15688||synchrone',
    formateurMatricule: '15688',
    groupeLibelle: 'GM101 GM102',
    groupes: ['GM101', 'GM102'],
    module: 'EGTS102',
    type: 'synchrone',
    heures: 2.5,
    seancesRequises: 1,
    estRegional: false,
    semestre: 2,
    priorite: 7,
  },
];

const problemeNode = {
  graine: 42,
  creneaux: [{ id: 0, jour: 'Lundi', rang: 0, duree: 2.5 }],
  salles: [{ nom: 'Salle 1', reelle: true }, { nom: 'TEAMS', reelle: false }],
  taches: [
    {
      id: 'GM101||M107||18494||presentiel',
      formateur: '18494',
      groupes: ['GM101'],
      seancesRequises: 2,
      sallesPossibles: ['Salle 1'],
      /*
       * ⚠️ PRÉSENT DANS LA FIXTURE À DESSEIN (2026-09-23). Le test de propriété
       *    ci-dessous ne peut attraper un champ oublié que si la fixture le
       *    porte : sans cette ligne, il aurait été vert sur une trace qui
       *    laissait « Salle 1 » en clair. Un champ ajouté au contrat se
       *    déclare AUSSI ici, sinon le garde-fou ne garde rien.
       */
      sallesPreferees: ['Salle 1'],
    },
    {
      id: 'GM101 GM102||EGTS102||15688||synchrone',
      formateur: '15688',
      groupes: ['GM101', 'GM102'],
      seancesRequises: 1,
      sallesPossibles: ['TEAMS'],
    },
  ],
  incompatibilites: { GM101: ['ACADA101 (FQ)'] },
  occupation: [{ creneauId: 0, formateur: '18688', groupes: ['SMP201'], salle: 'Salle 3' }],
};

const solutionNode = {
  placements: [{ tacheId: 'GM101||M107||18494||presentiel', creneauId: 0, salle: 'Salle 1' }],
  nonPlacees: [
    {
      tacheId: 'GM101 GM102||EGTS102||15688||synchrone',
      manquantes: 1,
      cause: 'formateur_occupe',
      groupe: 'GM101 GM102',
      formateur: '15688',
    },
  ],
  rapport: { moteur: 'glouton', version: '1.0.0', graine: 42 },
};

describe('pseudonymiserTrace', () => {
  const trace = pseudonymiserTrace(SEL, {
    probleme: problemeNode,
    taches: tachesNode,
    solution: solutionNode,
  });
  const texte = JSON.stringify(trace);

  /*
   * ⚠️ LE TEST QUI COMPTE. Il ne vérifie pas un champ mais une PROPRIÉTÉ : plus
   *    aucune valeur nommante ne subsiste, où qu'elle soit. Un champ ajouté au
   *    contrat et oublié par la pseudonymisation le fera tomber — ce qu'une
   *    assertion champ par champ ne ferait jamais.
   */
  it('ne laisse AUCUN matricule, groupe ni salle en clair, nulle part', () => {
    for (const nomme of ['18494', '15688', '18688', 'GM101', 'GM102', 'SMP201', 'ACADA101', 'Salle 1', 'Salle 3']) {
      expect(texte).not.toContain(nomme);
    }
  });

  it('garde les salles préférées SOUS-ENSEMBLE des possibles après réécriture', () => {
    /*
     * ⚠️ PSEUDONYMISER LES DEUX LISTES AVEC DES SELS DIFFÉRENTS LES AURAIT
     *    DISSOCIÉES, et `lecture.py` refuse une préférence hors des possibles :
     *    la trace serait devenue impossible à rejouer — un corpus muet, sans
     *    qu'aucun test ne le signale.
     */
    const tache = trace.probleme.taches[0];
    for (const salle of tache.sallesPreferees) {
      expect(tache.sallesPossibles).toContain(salle);
    }
    expect(tache.sallesPreferees).toHaveLength(1);
  });

  it('garde le module en clair : c’est un code du référentiel national, pas une donnée d’établissement', () => {
    expect(texte).toContain('M107');
    expect(texte).toContain('EGTS102');
  });

  it('garde TEAMS lisible, pour que le corpus distingue encore le distanciel', () => {
    expect(trace.probleme.salles.find((s) => s.nom === 'TEAMS')).toBeTruthy();
  });

  it('réécrit les identifiants de tâche DE FAÇON COHÉRENTE entre le problème et la solution', () => {
    const idsProbleme = trace.probleme.taches.map((t) => t.id);
    expect(idsProbleme).toContain(trace.solution.placements[0].tacheId);
    expect(idsProbleme).toContain(trace.solution.nonPlacees[0].tacheId);
    expect(idsProbleme).toContain(trace.taches[0].id);
  });

  it('pseudonymise les DEUX côtés des incompatibilités — une clé oubliée laisserait un groupe en clair', () => {
    const [clef, valeurs] = Object.entries(trace.probleme.incompatibilites)[0];
    expect(clef.startsWith('g_')).toBe(true);
    expect(valeurs[0].startsWith('g_')).toBe(true);
  });

  it('pseudonymise l’occupation, qui nomme un formateur et une salle bien réels', () => {
    const occ = trace.probleme.occupation[0];
    expect(occ.formateur.startsWith('f_')).toBe(true);
    expect(occ.groupes[0].startsWith('g_')).toBe(true);
    expect(occ.salle.startsWith('s_')).toBe(true);
  });

  it('conserve le module et le type sur le descripteur enrichi — le contrat Python ne les porte pas', () => {
    expect(trace.taches[0]).toMatchObject({ module: 'M107', type: 'presentiel', semestre: 1 });
  });

  it('donne le même identifiant que `idTache` : c’est par lui que la grille retenue se rattachera', () => {
    expect(trace.taches[0].id).toBe(idTache(SEL, tachesNode[0]));
  });
});

/* ── L'écart ─────────────────────────────────────────────────────────────── */

const creneaux = [
  { id: 0, jour: 'Lundi', rang: 0 },
  { id: 1, jour: 'Lundi', rang: 1 },
  { id: 2, jour: 'Mardi', rang: 0 },
];
const T = 'tache-1';

describe('ecartGrille', () => {
  it('compte tout conservé quand la grille n’a pas bougé', () => {
    const ecart = ecartGrille({
      creneaux,
      placements: [{ tacheId: T, creneauId: 0, salle: 's_aaa' }],
      seances: [{ tacheId: T, jour: 'Lundi', seance: 'S1', salle: 's_aaa' }],
    });
    expect(ecart).toMatchObject({ conservees: 1, deplacees: 0, retirees: 0, ajoutees: 0 });
    expect(ecart.fidelite).toBe(1);
  });

  it('distingue un changement de SALLE d’un déplacement : le créneau, lui, a tenu', () => {
    const ecart = ecartGrille({
      creneaux,
      placements: [{ tacheId: T, creneauId: 0, salle: 's_aaa' }],
      seances: [{ tacheId: T, jour: 'Lundi', seance: 'S1', salle: 's_bbb' }],
    });
    expect(ecart).toMatchObject({ conservees: 0, changementSalle: 1, deplacees: 0 });
  });

  it('voit un déplacement quand la séance se retrouve sur un autre créneau', () => {
    const ecart = ecartGrille({
      creneaux,
      placements: [{ tacheId: T, creneauId: 0, salle: 's_aaa' }],
      seances: [{ tacheId: T, jour: 'Mardi', seance: 'S1', salle: 's_aaa' }],
    });
    expect(ecart).toMatchObject({ deplacees: 1, retirees: 0, ajoutees: 0 });
    expect(ecart.details[0]).toMatchObject({ type: 'deplacee', de: 0, vers: 2 });
  });

  it('compte une RETIRÉE quand le directeur a supprimé la séance', () => {
    const ecart = ecartGrille({
      creneaux,
      placements: [{ tacheId: T, creneauId: 0, salle: 's_aaa' }],
      seances: [],
    });
    expect(ecart).toMatchObject({ retirees: 1, deplacees: 0, ajoutees: 0 });
  });

  it('compte une AJOUTÉE quand une séance apparaît sans avoir été proposée', () => {
    const ecart = ecartGrille({
      creneaux,
      placements: [],
      seances: [{ tacheId: T, jour: 'Lundi', seance: 'S1', salle: 's_aaa' }],
    });
    expect(ecart).toMatchObject({ ajoutees: 1, retirees: 0 });
    expect(ecart.fidelite).toBeNull();
  });

  /*
   * ⚠️ LE CAS QUI SÉPARE UN COMPTE JUSTE D'UN COMPTE FAUX. Une tâche porte
   *    plusieurs séances : il faut comparer des MULTI-ENSEMBLES, pas des
   *    ensembles. Une seule conservée et une déplacée, jamais « deux
   *    conservées » ni « une retirée plus une ajoutée ».
   */
  it('compare les séances d’une même tâche une à une, pas en bloc', () => {
    const ecart = ecartGrille({
      creneaux,
      placements: [
        { tacheId: T, creneauId: 0, salle: 's_aaa' },
        { tacheId: T, creneauId: 1, salle: 's_aaa' },
      ],
      seances: [
        { tacheId: T, jour: 'Lundi', seance: 'S1', salle: 's_aaa' },
        { tacheId: T, jour: 'Mardi', seance: 'S1', salle: 's_aaa' },
      ],
    });
    expect(ecart).toMatchObject({ conservees: 1, deplacees: 1, retirees: 0, ajoutees: 0 });
    expect(ecart.fidelite).toBe(0.5);
  });

  /*
   * ⚠️ UNE SÉANCE QUE LE SOLVEUR N'A JAMAIS PU PROPOSER N'EST PAS « AJOUTÉE ».
   *    Le créneau du soir ne fait pas partie de la grille générée : la compter
   *    reviendrait à reprocher au solveur de ne pas avoir placé ce qu'on ne lui
   *    avait pas demandé — et à faire baisser sa fidélité sans raison.
   */
  it('écarte ce qui n’appartenait pas à la grille générée', () => {
    const ecart = ecartGrille({
      creneaux,
      placements: [{ tacheId: T, creneauId: 0, salle: 's_aaa' }],
      seances: [
        { tacheId: T, jour: 'Lundi', seance: 'S1', salle: 's_aaa' },
        { tacheId: T, jour: 'Lundi', seance: 'S5', salle: 's_aaa' },
      ],
    });
    expect(ecart).toMatchObject({ conservees: 1, ajoutees: 0, retenues: 1 });
  });
});
