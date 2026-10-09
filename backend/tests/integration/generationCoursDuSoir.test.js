import { spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERIODES, ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

import { Base } from '../../src/models/Base.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Seance } from '../../src/models/Seance.js';
import { User } from '../../src/models/User.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';
import * as service from '../../src/modules/generation/generation.service.js';

/**
 * Le cours du soir (CDS) généré de bout en bout, avec le VRAI solveur
 * (2026-10-09, demande du porteur) : 4 h → deux soirées en semaine,
 * 5 h → le samedi en journée, et le soir du groupe régénéré est remplacé.
 */
const pythonDisponible = (() => {
  try {
    return spawnSync(process.env.PYTHON_BIN ?? 'python', ['--version']).status === 0;
  } catch {
    return false;
  }
})();

const ANNEE = 2026;
const SEMAINE = `${ANNEE}-W11`;
/** S9 : son samedi est férié — le cours de jour CDS doit se replier en semaine. */
const SEMAINE_SAMEDI_FERIE = `${ANNEE}-W9`;
const CDS = 'TSBECM301 (CDS)';
const AUTRE_CDS = 'TSGE301 (CDS)';

let etablissement;

beforeEach(async () => {
  oublierMemoire();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

  const directeur = await User.create({
    nomComplet: 'Directeur CDS',
    email: 'cds@edtpro.ma',
    motDePasse: 'MotDePasse2026',
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Casablanca-Settat',
    complexe: 'CF Soir',
    nom: 'ISTA Soir',
    anneeScolaire: ANNEE,
    espaces: ['A1', 'A2'],
  });

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [
      { matricule: '100', nomComplet: 'FORMATEUR SOIR', masseHoraire: 1000 },
      { matricule: '200', nomComplet: 'FORMATEUR SAMEDI', masseHoraire: 1000 },
      { matricule: '300', nomComplet: 'FORMATEUR AUTRE', masseHoraire: 1000 },
    ],
    groupes: [CDS, AUTRE_CDS],
    affectations: [
      { formateur: '100', groupe: CDS, module: 'M1', type: TYPES_COURS.PRESENTIEL, s1Heures: 60 },
      { formateur: '200', groupe: CDS, module: 'M2', type: TYPES_COURS.PRESENTIEL, s1Heures: 60 },
      { formateur: '300', groupe: AUTRE_CDS, module: 'M9', type: TYPES_COURS.PRESENTIEL, s1Heures: 60 },
    ],
  });
  await Chronogramme.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    groupe: CDS,
    planning: new Map([
      ['M1', [{ semaine: 'S11', heures: 4, type: 'P' }, { semaine: 'S9', heures: 4, type: 'P' }]],
      ['M2', [{ semaine: 'S11', heures: 5, type: 'P' }, { semaine: 'S9', heures: 5, type: 'P' }]],
    ]),
  });
});

const seanceDuSoir = (groupe, formateur, module, jour) => ({
  etablissementId: etablissement.id,
  anneeScolaire: ANNEE,
  semaine: SEMAINE,
  jour,
  date: new Date(`${ANNEE}-11-02T00:00:00.000Z`),
  seance: 'S5',
  periode: PERIODES.SOIR,
  formateurMatricule: formateur,
  groupe,
  module,
  salle: 'A1',
  statut: 'planifie',
});

(pythonDisponible ? describe : describe.skip)('Génération — cours du soir (CDS)', () => {
  it('2 h au soir en semaine, 2,5 h le samedi en journée', async () => {
    const rapport = await service.generer(etablissement.id, ANNEE, { semaines: [SEMAINE] });
    expect(rapport.semaines[0]).toMatchObject({ placees: 4, nonPlacees: [] });

    const posees = await Seance.find({ etablissementId: etablissement.id, semaine: SEMAINE }).lean();
    const m1 = posees.filter((s) => s.module === 'M1');
    const m2 = posees.filter((s) => s.module === 'M2');

    expect(m1).toHaveLength(2);
    expect(m1.every((s) => s.periode === PERIODES.SOIR && s.seance === 'S5')).toBe(true);
    expect(m1.some((s) => s.jour === 'Samedi')).toBe(false);

    expect(m2).toHaveLength(2);
    expect(m2.every((s) => (s.periode ?? PERIODES.JOUR) === PERIODES.JOUR && s.jour === 'Samedi')).toBe(true);
  });

  it('samedi férié : le cours de jour CDS se replie en semaine plutôt que de se perdre', async () => {
    const rapport = await service.generer(etablissement.id, ANNEE, { semaines: [SEMAINE_SAMEDI_FERIE] });
    expect(rapport.semaines[0]).toMatchObject({ placees: 4, nonPlacees: [] });

    const m2 = await Seance.find({
      etablissementId: etablissement.id,
      semaine: SEMAINE_SAMEDI_FERIE,
      module: 'M2',
    }).lean();
    expect(m2).toHaveLength(2);
    expect(m2.some((s) => s.jour === 'Samedi')).toBe(false);
  });

  it('remplace le soir du groupe régénéré, garde celui des autres groupes', async () => {
    await Seance.create([
      seanceDuSoir(CDS, '100', 'M1', 'Lundi'),
      seanceDuSoir(AUTRE_CDS, '300', 'M9', 'Mardi'),
    ]);

    const rapport = await service.generer(etablissement.id, ANNEE, { semaines: [SEMAINE] });
    expect(rapport.semaines[0].remplacees).toBe(1);

    const autre = await Seance.find({ etablissementId: etablissement.id, groupe: AUTRE_CDS }).lean();
    expect(autre).toHaveLength(1);
    expect(autre[0]).toMatchObject({ jour: 'Mardi', periode: PERIODES.SOIR });

    // Le CDS régénéré : exactement ses 2 soirées de M1, plus l'ancienne effacée.
    const soirCds = await Seance.find({
      etablissementId: etablissement.id,
      groupe: CDS,
      periode: PERIODES.SOIR,
    }).lean();
    expect(soirCds).toHaveLength(2);
  });

  it('la prévisualisation compte le soir qui sera remplacé', async () => {
    await Seance.create([seanceDuSoir(CDS, '100', 'M1', 'Lundi')]);
    const apercu = await service.previsualiser(etablissement.id, ANNEE, { semaines: [SEMAINE] });
    expect(apercu.semaines[0].remplacees).toBe(1);
  });
});
