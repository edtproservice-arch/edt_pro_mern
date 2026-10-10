import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Repartition } from '../../src/models/Repartition.js';
import { bus, EVENEMENTS } from '../../src/lib/bus.js';
import { anneeScolaireCourante } from 'shared/domain';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * ═══ UNE MASSE CHANGÉE DANS LA RÉPARTITION GAGNE LES ÉTABLISSEMENTS (2026-10-10) ═══
 * La masse affectée à un groupe est COPIÉE dans la base de l'établissement : la
 * changer dans le référentiel doit la reporter là où elle suivait le DRIF — et
 * seulement là.
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = anneeScolaireCourante();

let cookiesAdmin;
let ligne;
let etablissement;

const affectation = (surcharges) => ({
  formateur: '9863',
  groupe: 'GM101',
  module: 'M101',
  type: TYPES_COURS.PRESENTIEL,
  s1Heures: 30,
  s2Heures: 15,
  filiere: 'AE_TEST',
  ...surcharges,
});

async function base(anneeScolaire, affectations) {
  return Base.create({
    etablissementId: etablissement.id,
    anneeScolaire,
    formateurs: [{ matricule: '9863', nomComplet: 'BRAHIM LOURID' }],
    groupes: ['GM101', 'GM102', 'GM201'],
    groupeFilieres: { GM101: 'AE_TEST', GM102: 'AE_TEST', GM201: 'AE_TEST' },
    affectations,
  });
}

beforeEach(async () => {
  await User.create({
    nomComplet: 'ADMIN',
    email: 'admin@edtpro.ma',
    motDePasse: MOT_DE_PASSE,
    role: ROLES.ADMIN,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'admin@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookiesAdmin = connexion.headers['set-cookie'];

  const directeur = await User.create({
    nomComplet: 'DIRECTEUR',
    email: 'directeur@edtpro.ma',
    motDePasse: MOT_DE_PASSE,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: ANNEE,
  });

  ligne = await Repartition.create({
    secteur: 'Aéronautique',
    codeFiliereDrif: 'AE_TEST',
    codeFiliereCarte: 'AE_TEST',
    intituleFiliere: 'Filière de test',
    anneeFormation: 1,
    codeModule: 'M101',
    module: 'Anglais',
    mhpS1: 30,
    mhpS2: 15,
    mhsynS1: 10,
    mhsynS2: 0,
  });
});

const modifier = (corps) => request(app).patch(`/api/v2/admin/repartitions/${ligne.id}`).set('Cookie', cookiesAdmin).send(corps);

describe('propagation des masses de la répartition', () => {
  it('reporte la nouvelle masse là où elle suivait le DRIF, jamais là où elle était ajustée', async () => {
    await base(ANNEE, [
      affectation({}),
      // Ajustée par l'établissement (groupe alterné) : on n'y touche pas.
      affectation({ groupe: 'GM102', s1Heures: 20, s2Heures: 0 }),
      // Le synchrone suit SES colonnes.
      affectation({ type: TYPES_COURS.SYNCHRONE, s1Heures: 10, s2Heures: 0 }),
      // Une autre année de formation (GM201 → 2ᵉ année) : autre ligne de répartition.
      affectation({ groupe: 'GM201' }),
    ]);

    const annonces = [];
    const ecouter = (evenement) => annonces.push(evenement);
    bus.on(EVENEMENTS.REFERENTIEL_MODIFIE, ecouter);
    const reponse = await modifier({ mhpS1: 45, mhsynS1: 12 });
    bus.off(EVENEMENTS.REFERENTIEL_MODIFIE, ecouter);

    expect(reponse.status).toBe(200);
    expect(reponse.body.ligne.propagation).toEqual({ bases: 1, affectations: 2 });

    const apres = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: ANNEE }).lean();
    const heures = apres.affectations.map((a) => [a.groupe, a.type, a.s1Heures, a.s2Heures]);
    expect(heures).toEqual([
      ['GM101', TYPES_COURS.PRESENTIEL, 45, 15],
      ['GM102', TYPES_COURS.PRESENTIEL, 20, 0],
      ['GM101', TYPES_COURS.SYNCHRONE, 12, 0],
      ['GM201', TYPES_COURS.PRESENTIEL, 30, 15],
    ]);
    // La version augmente : une carte en cours de saisie sur l'ancienne sera refusée, pas écrasante.
    expect(apres.version).toBe(1);
    expect(annonces).toEqual([{ codeModule: 'M101' }]);
  });

  // Une année close garde ses masses : ses séances sont faites, son avancement arrêté.
  it('ne touche pas une année scolaire passée', async () => {
    await base(ANNEE - 1, [affectation({})]);
    const reponse = await modifier({ mhpS1: 45 });
    expect(reponse.body.ligne.propagation).toEqual({ bases: 0, affectations: 0 });
    const passee = await Base.findOne({ anneeScolaire: ANNEE - 1 }).lean();
    expect(passee.affectations[0].s1Heures).toBe(30);
  });

  // Changer le seul intitulé n'est pas changer une masse : aucune base n'est réécrite.
  it('ne réécrit rien quand les masses ne changent pas', async () => {
    await base(ANNEE, [affectation({})]);
    const reponse = await modifier({ module: 'Anglais technique' });
    expect(reponse.body.ligne.propagation).toEqual({ bases: 0, affectations: 0 });
    expect((await Base.findOne({ anneeScolaire: ANNEE }).lean()).version).toBe(0);
  });
});

/*
 * ═══ LES TOTAUX SE CALCULENT (2026-10-10) ═══ MHP totale = S1 + S2 ; MHD totale =
 * synchrone + asynchrone. Une modification d'UN semestre compte l'autre, déjà en base.
 */
describe('totaux de la répartition', () => {
  it('recalcule MHP et MHD totales à la modification, même partielle', async () => {
    const reponse = await modifier({ mhpS1: 40, mhpTotale: 999, mhasynS2: 5 });
    expect(reponse.status).toBe(200);
    expect(reponse.body.ligne).toMatchObject({ mhpTotale: 55, mhdTotale: 15 });
  });

  // Une ligne connue par son seul total (aucune masse semestrielle) le garde.
  it('garde le total saisi d’une ligne sans détail par semestre', async () => {
    await Repartition.updateOne({ _id: ligne.id }, { mhpS1: 0, mhpS2: 0, mhsynS1: 0, mhpTotale: 315 });
    const reponse = await modifier({ module: 'Stage' });
    expect(reponse.body.ligne).toMatchObject({ mhpTotale: 315, mhdTotale: 0 });
  });
});
