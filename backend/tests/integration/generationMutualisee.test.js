import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

import { Base } from '../../src/models/Base.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Seance } from '../../src/models/Seance.js';
import { User } from '../../src/models/User.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';

/*
 * Le solveur est intercepté : ce qui est jugé ici est ce que Node lui ENVOIE,
 * pas la grille qu'il rend — et la suite reste sans dépendance à Python.
 */
const { problemesEnvoyes } = vi.hoisted(() => ({ problemesEnvoyes: [] }));
vi.mock('../../src/modules/generation/solveur.client.js', async (original) => ({
  ...(await original()),
  resoudre: vi.fn(async (probleme) => {
    problemesEnvoyes.push(probleme);
    return { placements: [], nonPlacees: [], rapport: {} };
  }),
}));

const service = await import('../../src/modules/generation/generation.service.js');

/**
 * La génération voit les cours des formateurs dans leurs AUTRES établissements
 * (2026-09-27, constaté sur données réelles : ABDELGHANI LAASSAL, aussi à CFP
 * MGD HASSANIA, recevait des séances sur des créneaux où il a cours là-bas —
 * `poser()` les refusait, et elles étaient perdues).
 */
const ANNEE = 2026;
const SEMAINE = `${ANNEE}-W9`;
const MATRICULE = '15688';
const CRENEAUX = ['S1', 'S2', 'S3', 'S4'];

let ici;
let ailleurs;

async function etablissementAvecDirecteur(email, nom, complexe) {
  const directeur = await User.create({
    nomComplet: `Directeur ${nom}`,
    email,
    motDePasse: 'MotDePasse2026',
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
  const etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Casablanca-Settat',
    complexe,
    nom,
    anneeScolaire: ANNEE,
    espaces: ['A12'],
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();
  return etablissement;
}

beforeEach(async () => {
  problemesEnvoyes.length = 0;
  oublierMemoire();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

  ici = await etablissementAvecDirecteur('ici@edtpro.ma', 'ISTA Ici', 'CF Ici');
  ailleurs = await etablissementAvecDirecteur('ailleurs@edtpro.ma', 'CFP Ailleurs', 'CF Ailleurs');

  await Base.create({
    etablissementId: ici.id,
    anneeScolaire: ANNEE,
    formateurs: [{ matricule: MATRICULE, nomComplet: 'ABDELGHANI LAASSAL', masseHoraire: 1000 }],
    groupes: ['GM103'],
    affectations: [
      { formateur: MATRICULE, groupe: 'GM103', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 60 },
    ],
  });
  await Base.create({
    etablissementId: ailleurs.id,
    anneeScolaire: ANNEE,
    formateurs: [{ matricule: MATRICULE, nomComplet: 'ABDELGHANI LAASSAL', masseHoraire: 1000 }],
    groupes: ['AA101'],
  });
  await Chronogramme.create({
    etablissementId: ici.id,
    anneeScolaire: ANNEE,
    groupe: 'GM103',
    planning: new Map([['M101', [{ semaine: 'S9', heures: 2.5, type: 'P' }]]]),
  });

  // Là-bas : lundi, les quatre créneaux.
  await Seance.create(
    CRENEAUX.map((seance) => ({
      etablissementId: ailleurs.id,
      anneeScolaire: ANNEE,
      semaine: SEMAINE,
      jour: 'Lundi',
      date: new Date(`${ANNEE}-11-02T00:00:00.000Z`),
      seance,
      formateurMatricule: MATRICULE,
      groupe: 'AA101',
      module: 'M1',
      salle: 'X1',
      statut: 'planifie',
    }))
  );
});

/** Les créneaux (jour||séance) que le problème donne pour occupés par ce formateur. */
function occupesPourLeFormateur(probleme) {
  const parId = new Map(probleme.creneaux.map((c) => [c.id, `${c.jour}||${CRENEAUX[c.rang]}`]));
  return probleme.occupation
    .filter((o) => o.formateur === MATRICULE)
    .map((o) => parId.get(o.creneauId))
    .sort();
}

describe('Génération — les cours du formateur ailleurs occupent ses créneaux', () => {
  it('le problème envoyé au solveur les porte, formateur seul', async () => {
    await service.generer(ici.id, ANNEE, { semaines: [SEMAINE] });

    expect(problemesEnvoyes).toHaveLength(1);
    const [probleme] = problemesEnvoyes;
    expect(occupesPourLeFormateur(probleme)).toEqual(
      CRENEAUX.map((s) => `Lundi||${s}`).sort()
    );
    /*
     * ⚠️ NI GROUPE NI SALLE : « AA101 » et « X1 » sont ceux de l'AUTRE
     *    établissement. Les transmettre bloquerait ici un groupe ou une salle
     *    homonymes qui n'ont rien à voir.
     */
    for (const occupation of probleme.occupation) {
      expect(occupation.groupes ?? []).toEqual([]);
      expect(occupation.salle ?? null).toBeNull();
    }
  });

  it('la simulation des relances les voit aussi, sans quoi elle promettrait des refus', async () => {
    await service.simuler(ici.id, ANNEE, { semaines: [SEMAINE] });

    expect(problemesEnvoyes.length).toBeGreaterThan(0);
    for (const probleme of problemesEnvoyes) {
      expect(occupesPourLeFormateur(probleme)).toEqual(CRENEAUX.map((s) => `Lundi||${s}`).sort());
    }
  });

  it('un formateur qui n’enseigne qu’ici n’ajoute rien', async () => {
    await Base.updateOne({ etablissementId: ailleurs.id }, { $set: { formateurs: [] } });

    await service.generer(ici.id, ANNEE, { semaines: [SEMAINE] });

    expect(problemesEnvoyes[0].occupation).toEqual([]);
  });

  it('ignore les autres semaines de l’autre établissement', async () => {
    await Seance.updateMany({ etablissementId: ailleurs.id }, { $set: { semaine: `${ANNEE}-W10` } });

    await service.generer(ici.id, ANNEE, { semaines: [SEMAINE] });

    expect(problemesEnvoyes[0].occupation).toEqual([]);
  });
});


describe('Simulation des relances — le même problème que la génération (2026-09-27)', () => {
  /*
   * ⚠️ La simulation appelait `tachesDeLaSemaine` sans `sallesAffectations` :
   *    elle ignorait la salle déclarée pour un module, et chiffrait ce qu'une
   *    relance rapporterait sur un problème que la génération ne pose pas.
   */
  beforeEach(async () => {
    await Etablissement.updateOne({ _id: ici.id }, { $set: { espaces: ['A12', 'B1'] } });
    await Base.updateOne(
      { etablissementId: ici.id },
      { $set: { sallesAffectations: { 'GM103||M101': ['B1'] } } }
    );
  });

  it('porte la salle déclarée du module, comme la génération', async () => {
    await service.simuler(ici.id, ANNEE, { semaines: [SEMAINE] });
    /*
     * Quatre résolutions, dans l'ordre de `simuler` : la base, puis
     * « ignorer les indisponibilités », « toutes les salles », « les deux ».
     * ⚠️ Les deux dernières lèvent la préférence EXPRÈS — c'est ce qu'elles
     *    mesurent ; les deux premières doivent la garder.
     */
    expect(problemesEnvoyes.map((p) => p.taches.map((t) => t.sallesPreferees))).toEqual([
      [['B1']],
      [['B1']],
      [[]],
      [[]],
    ]);

    problemesEnvoyes.length = 0;
    await service.generer(ici.id, ANNEE, { semaines: [SEMAINE] });
    expect(problemesEnvoyes[0].taches.map((t) => t.sallesPreferees)).toEqual([['B1']]);
  });
});

describe('Semaines figées — vacances (2026-10-03, demande du porteur)', () => {
  /** Met S9 en vacances, aux dates que la génération elle-même lui donne. */
  async function mettreS9EnVacances() {
    const { semainesChronogramme } = await import('shared/domain');
    const { obtenir } = await import('../../src/modules/calendrierNational/calendrierNational.service.js');
    const { rentrees } = await obtenir(ANNEE);
    const s9 = semainesChronogramme(ANNEE, { rentrees }).find((s) => s.numero === 9);
    await Etablissement.updateOne(
      { _id: ici.id },
      { $set: { 'calendrier.vacances': [{ libelle: 'Vacances test', debut: s9.debut, fin: s9.fin }] } }
    );
  }

  it('la route les liste, avec leur motif', async () => {
    await mettreS9EnVacances();
    const figees = await service.semainesFigees(ici.id, ANNEE);
    expect(figees).toContainEqual({ numero: 9, motif: 'vacances' });
  });

  it('⚠️ la génération ne la touche pas : ni solveur, ni effacement', async () => {
    await mettreS9EnVacances();
    await Seance.create({
      etablissementId: ici.id,
      anneeScolaire: ANNEE,
      semaine: SEMAINE,
      jour: 'Mardi',
      date: new Date(`${ANNEE}-11-03T00:00:00.000Z`),
      seance: 'S1',
      formateurMatricule: MATRICULE,
      groupe: 'GM103',
      module: 'M101',
      salle: 'A12',
      statut: 'planifie',
    });

    const rapport = await service.generer(ici.id, ANNEE, { semaines: [SEMAINE] });

    expect(problemesEnvoyes).toHaveLength(0);
    expect(rapport.semaines[0]).toMatchObject({ semaine: SEMAINE, figee: true, motif: 'vacances' });
    expect(await Seance.countDocuments({ etablissementId: ici.id, semaine: SEMAINE })).toBe(1);
  });
});
