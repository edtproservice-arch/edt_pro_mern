import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Seance } from '../../src/models/Seance.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Espaces MUTUALISÉS (2026-09-21) : « Salle 4 » de l'établissement A est prêtée à B.
 * Les deux ne doivent jamais y poser deux cours au même créneau.
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const SEMAINE = '2026-W3';
const NOM_A = 'ISTA Alpha';

let A;
let B;
let C;
let cookiesA;
let cookiesB;

async function directeurEtEtablissement({ email, nom, complexe = 'CF Commun', espaces = [], statut = STATUTS_COMPTE.APPROUVE }) {
  const directeur = await User.create({
    nomComplet: `Directeur ${nom}`,
    email,
    motDePasse: MOT_DE_PASSE,
    role: ROLES.DIRECTEUR,
    statut,
    estVerifie: true,
  });
  const etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe,
    nom,
    anneeScolaire: ANNEE,
    espaces,
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [
      { matricule: `${nom}-1`, nomComplet: 'FORMATEUR UN' },
      { matricule: `${nom}-2`, nomComplet: 'FORMATEUR DEUX' },
    ],
    groupes: ['GM101', 'GM102'],
    affectations: [
      { formateur: `${nom}-1`, groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
      { formateur: `${nom}-2`, groupe: 'GM102', module: 'M102', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
    ],
  });

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: email, motDePasse: MOT_DE_PASSE });
  return { etablissement, cookies: connexion.headers['set-cookie'] };
}

beforeEach(async () => {
  oublierMemoire();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

  const a = await directeurEtEtablissement({ email: 'a@edtpro.ma', nom: NOM_A, espaces: ['Salle 4', 'Labo', 'TEAMS'] });
  const b = await directeurEtEtablissement({ email: 'b@edtpro.ma', nom: 'ISTA Beta', espaces: ['Salle 4', 'B02'] });
  const c = await directeurEtEtablissement({ email: 'c@edtpro.ma', nom: 'ISTA Gamma', complexe: 'CF Autre', espaces: ['G1'] });
  A = a.etablissement;
  B = b.etablissement;
  C = c.etablissement;
  cookiesA = a.cookies;
  cookiesB = b.cookies;
});

const enTete = (cookies, etablissement) => ({ Cookie: cookies, 'X-Etablissement-Id': etablissement.id });

const partager = (espace, etablissements, cookies = cookiesA, etablissement = A) =>
  request(app)
    .put('/api/v2/espaces-mutualises')
    .set(enTete(cookies, etablissement))
    .send({ espace, etablissementIds: etablissements.map((e) => e.id) });

const poserPar = (cookies, etablissement, corps) =>
  request(app)
    .put(`/api/v2/seances/${SEMAINE}/case`)
    .set(enTete(cookies, etablissement))
    .send({
      jour: 'Lundi',
      seance: 'S1',
      periode: 'jour',
      formateurMatricule: `${etablissement.nom}-1`,
      groupe: 'GM101',
      module: 'M101',
      ...corps,
    });

const LIBELLE = `Salle 4 (${NOM_A})`;

describe('Partager un espace', () => {
  it('refuse un espace qui n’existe pas, TEAMS, et soi-même', async () => {
    expect((await partager('Salle 99', [B])).status).toBe(400);
    expect((await partager('TEAMS', [B])).status).toBe(400);
    expect((await partager('Salle 4', [A])).status).toBe(400);
  });

  it('enregistre le partage et le rend des deux côtés', async () => {
    const reponse = await partager('Salle 4', [B]);
    expect(reponse.status).toBe(200);
    expect(reponse.body.miens.find((m) => m.espace === 'Salle 4').avec.map((e) => e.nom)).toEqual(['ISTA Beta']);
    // TEAMS n'est pas une salle : il n'est pas proposé au partage.
    expect(reponse.body.miens.map((m) => m.espace)).not.toContain('TEAMS');

    const cote = await request(app).get('/api/v2/espaces-mutualises').set(enTete(cookiesB, B));
    expect(cote.body.empruntes).toEqual([
      expect.objectContaining({ espace: 'Salle 4', libelle: LIBELLE, proprietaire: expect.objectContaining({ nom: NOM_A }) }),
    ]);
  });

  it('⚠️ propose tous les établissements avec compte, le même complexe d’abord', async () => {
    // Beta est dans le complexe de A, Gamma dans un autre : les deux sont proposés, Beta en tête.
    const tous = await request(app).get('/api/v2/espaces-mutualises/annuaire').set(enTete(cookiesA, A));
    expect(tous.body.etablissements.map((e) => e.nom)).toEqual(['ISTA Beta', 'ISTA Gamma']);

    const recherche = await request(app)
      .get('/api/v2/espaces-mutualises/annuaire?recherche=gamma')
      .set(enTete(cookiesA, A));
    expect(recherche.body.etablissements.map((e) => e.nom)).toEqual(['ISTA Gamma']);
  });

  it('⚠️ un établissement présent en plusieurs comptes n’est listé qu’UNE fois, et le mien jamais', async () => {
    // Un second compte pour ISTA Beta, et un second compte pour MON établissement (ISTA Alpha).
    const doublonB = await directeurEtEtablissement({ email: 'b2@edtpro.ma', nom: 'ISTA Beta' });
    await directeurEtEtablissement({ email: 'a2@edtpro.ma', nom: NOM_A });

    const liste = await request(app).get('/api/v2/espaces-mutualises/annuaire').set(enTete(cookiesA, A));
    // Beta (une seule ligne malgré ses deux comptes) et Gamma — jamais Alpha, qui est le mien.
    expect(liste.body.etablissements.map((e) => e.nom)).toEqual(['ISTA Beta', 'ISTA Gamma']);
    const [beta] = liste.body.etablissements;
    expect(beta.nom).toBe('ISTA Beta');
    expect(beta.etablissementIds.sort()).toEqual([B.id, doublonB.etablissement.id].sort());

    // Choisir cette ligne partage avec les deux comptes, et l'état les regroupe en une seule.
    const reponse = await request(app)
      .put('/api/v2/espaces-mutualises')
      .set(enTete(cookiesA, A))
      .send({ espace: 'Salle 4', etablissementIds: beta.etablissementIds });
    expect(reponse.status).toBe(200);
    const salle4 = reponse.body.miens.find((m) => m.espace === 'Salle 4');
    expect(salle4.avec).toHaveLength(1);
    expect(salle4.avec[0].etablissementIds).toHaveLength(2);
  });

  it('⚠️ n’affiche que les établissements qui ont un compte actif — et refuse les autres', async () => {
    const bloque = await directeurEtEtablissement({ email: 'x@edtpro.ma', nom: 'ISTA Bloque', statut: STATUTS_COMPTE.BLOQUE });
    await directeurEtEtablissement({ email: 'y@edtpro.ma', nom: 'ISTA Attente', statut: STATUTS_COMPTE.EN_ATTENTE });
    // Un établissement dont le compte n'existe plus du tout.
    await Etablissement.create({
      proprietaireId: '64b000000000000000000001',
      region: 'Fès-Meknès',
      complexe: 'CF Commun',
      nom: 'ISTA Orphelin',
      anneeScolaire: ANNEE,
    });

    const liste = await request(app).get('/api/v2/espaces-mutualises/annuaire').set(enTete(cookiesA, A));
    expect(liste.body.etablissements.map((e) => e.nom)).toEqual(['ISTA Beta', 'ISTA Gamma']);

    const refus = await partager('Salle 4', [bloque.etablissement]);
    expect(refus.status).toBe(400);
    expect(refus.body.code).toBe('ETABLISSEMENT_INCONNU');
  });

  it('⚠️ un établissement ne peut pas partager les espaces d’un autre', async () => {
    // B tente d'agir sur SES espaces seulement : « Labo » n'est pas à lui.
    expect((await partager('Labo', [A], cookiesB, B)).status).toBe(400);
  });
});

describe('Utiliser un espace emprunté', () => {
  it('apparaît dans la liste des salles de l’emploi du temps de l’emprunteur', async () => {
    await partager('Salle 4', [B]);
    const contexte = await request(app).get('/api/v2/seances/contexte').set(enTete(cookiesB, B));

    expect(contexte.body.salles).toContain(LIBELLE);
    // Sa propre « Salle 4 » reste distincte.
    expect(contexte.body.salles).toContain('Salle 4');
  });

  it('⚠️ B ne peut pas poser dans la salle de A quand A l’occupe', async () => {
    await partager('Salle 4', [B]);
    expect((await poserPar(cookiesA, A, { salle: 'Salle 4' })).status).toBe(200);

    const refus = await poserPar(cookiesB, B, { salle: LIBELLE });
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('CRENEAU_OCCUPE');
    expect(refus.body.details).toEqual([
      expect.objectContaining({ type: 'salle', message: expect.stringContaining('GM101') }),
    ]);
    expect(refus.body.details[0].message).toContain(NOM_A);
  });

  it('⚠️ et A ne peut pas poser dans sa salle quand B l’occupe', async () => {
    await partager('Salle 4', [B]);
    expect((await poserPar(cookiesB, B, { salle: LIBELLE })).status).toBe(200);

    const refus = await poserPar(cookiesA, A, { salle: 'Salle 4' });
    expect(refus.status).toBe(409);
    expect(refus.body.details[0].type).toBe('salle');
    expect(refus.body.details[0].message).toContain('ISTA Beta');
  });

  it('accepte un autre créneau, ou la salle propre de B qui porte le même nom', async () => {
    await partager('Salle 4', [B]);
    await poserPar(cookiesA, A, { salle: 'Salle 4' });

    // Autre créneau : libre.
    expect((await poserPar(cookiesB, B, { salle: LIBELLE, seance: 'S2' })).status).toBe(200);
    // « Salle 4 » de B n'est pas celle de A : libre au même créneau que A.
    expect(
      (await poserPar(cookiesB, B, { salle: 'Salle 4', formateurMatricule: 'ISTA Beta-2', groupe: 'GM102', module: 'M102' })).status
    ).toBe(200);
  });

  it('sans partage, une salle du même nom dans deux établissements ne se gêne pas', async () => {
    await poserPar(cookiesA, A, { salle: 'Salle 4' });
    expect((await poserPar(cookiesB, B, { salle: 'Salle 4' })).status).toBe(200);
  });

  it('dans un lot, le refus est nommé et n’arrête pas les autres cases', async () => {
    await partager('Salle 4', [B]);
    await poserPar(cookiesA, A, { salle: 'Salle 4' });

    const reponse = await request(app)
      .post(`/api/v2/seances/${SEMAINE}/lot`)
      .set(enTete(cookiesB, B))
      .send({
        operations: [
          {
            type: 'poser',
            cle: 'refusee',
            seance: { jour: 'Lundi', seance: 'S1', periode: 'jour', formateurMatricule: 'ISTA Beta-1', groupe: 'GM101', module: 'M101', salle: LIBELLE },
          },
          {
            type: 'poser',
            cle: 'ok',
            seance: { jour: 'Mardi', seance: 'S1', periode: 'jour', formateurMatricule: 'ISTA Beta-1', groupe: 'GM101', module: 'M101', salle: LIBELLE },
          },
        ],
      });

    const [refusee, ok] = reponse.body.resultats;
    expect(refusee).toMatchObject({ ok: false });
    expect(refusee.erreur.code).toBe('CRENEAU_OCCUPE');
    expect(ok.ok).toBe(true);
  });
});

describe('Le libellé porte le nom ABRÉGÉ', () => {
  it('⚠️ « Salle 4 (ALPHA) » et non le nom officiel, quand le nom abrégé existe', async () => {
    await Etablissement.updateOne({ _id: A.id }, { $set: { nomAbrege: 'ALPHA' } });
    await partager('Salle 4', [B]);

    const contexte = await request(app).get('/api/v2/seances/contexte').set(enTete(cookiesB, B));
    expect(contexte.body.salles).toContain('Salle 4 (ALPHA)');
    expect(contexte.body.salles).not.toContain(LIBELLE);
  });

  it('⚠️ changer le nom abrégé réécrit les séances des emprunteurs, et le chevauchement reste vu', async () => {
    await Etablissement.updateOne({ _id: A.id }, { $set: { nomAbrege: 'ALPHA' } });
    await partager('Salle 4', [B]);
    expect((await poserPar(cookiesB, B, { salle: 'Salle 4 (ALPHA)' })).status).toBe(200);

    const changement = await request(app)
      .patch('/api/v2/etablissements/courant/nom-abrege')
      .set(enTete(cookiesA, A))
      .send({ nomAbrege: 'ALPHA2' });
    expect(changement.status).toBe(200);

    const seance = await Seance.findOne({ etablissementId: B.id });
    expect(seance.salle).toBe('Salle 4 (ALPHA2)');

    // La pièce est toujours reconnue : A ne peut pas y poser au même créneau.
    const refus = await poserPar(cookiesA, A, { salle: 'Salle 4' });
    expect(refus.status).toBe(409);
    expect(refus.body.details[0].type).toBe('salle');
  });
});

describe('Arrêter ou modifier un partage', () => {
  it('⚠️ refuse d’arrêter un partage que l’autre établissement utilise', async () => {
    await partager('Salle 4', [B]);
    await poserPar(cookiesB, B, { salle: LIBELLE });

    const refus = await partager('Salle 4', []);
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('ESPACE_UTILISE');
    expect(refus.body.message).toContain('ISTA Beta');
  });

  it('arrête un partage inutilisé, et l’espace disparaît de la liste de l’autre', async () => {
    await partager('Salle 4', [B]);
    expect((await partager('Salle 4', [])).status).toBe(200);

    const contexte = await request(app).get('/api/v2/seances/contexte').set(enTete(cookiesB, B));
    expect(contexte.body.salles).not.toContain(LIBELLE);
  });

  it('⚠️ refuse de retirer ou renommer un espace tant qu’il est mutualisé', async () => {
    await partager('Salle 4', [B]);

    const refus = await request(app)
      .put('/api/v2/etablissements/courant/espaces')
      .set(enTete(cookiesA, A))
      .send({ espaces: ['Labo', 'TEAMS'] });

    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('ESPACE_MUTUALISE');
    expect((await Etablissement.findById(A.id)).espaces).toContain('Salle 4');

    // Les autres modifications de la liste restent libres.
    const accepte = await request(app)
      .put('/api/v2/etablissements/courant/espaces')
      .set(enTete(cookiesA, A))
      .send({ espaces: ['Salle 4', 'Labo', 'TEAMS', 'Salle 5'] });
    expect(accepte.status).toBe(200);
  });

  it('refuse à un compte sans droit', async () => {
    const refus = await request(app).get('/api/v2/espaces-mutualises').set({ Cookie: cookiesA, 'X-Etablissement-Id': B.id });
    expect(refus.status).toBe(403);
    expect(await Seance.countDocuments()).toBe(0);
  });
});

describe('Formateurs mutualisés — détectés tout seuls', () => {
  /** Un même formateur (même matricule) affecté chez A et chez B. */
  async function affecterPartout(matricule = 'MUT-1') {
    for (const [etablissement, groupe] of [[A, 'GM101'], [B, 'GM102']]) {
      await Base.updateOne(
        { etablissementId: etablissement.id, anneeScolaire: ANNEE },
        {
          $push: {
            formateurs: { matricule, nomComplet: 'FORMATEUR PARTAGE' },
            affectations: { formateur: matricule, groupe, module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
          },
        }
      );
    }
  }

  const poserMut = (cookies, etablissement, corps) =>
    poserPar(cookies, etablissement, { formateurMatricule: 'MUT-1', groupe: etablissement === A ? 'GM101' : 'GM102', module: 'M101', ...corps });

  it('⚠️ le repère chez les deux établissements, sans rien déclarer', async () => {
    await affecterPartout();

    const chezA = await request(app).get('/api/v2/formateurs-mutualises').set(enTete(cookiesA, A));
    expect(chezA.status).toBe(200);
    expect(chezA.body.formateurs).toEqual([
      expect.objectContaining({ matricule: 'MUT-1', nom: 'FORMATEUR PARTAGE', avec: [expect.objectContaining({ nom: 'ISTA Beta' })] }),
    ]);

    const chezB = await request(app).get('/api/v2/formateurs-mutualises').set(enTete(cookiesB, B));
    expect(chezB.body.formateurs[0].avec[0].nom).toBe(NOM_A);
  });

  it('⚠️ être dans la LISTE des formateurs des deux établissements suffit, sans module affecté', async () => {
    // Même matricule dans la liste de chacun, mais aucune affectation de module, ni chez A ni chez B.
    for (const etablissement of [A, B]) {
      await Base.updateOne(
        { etablissementId: etablissement.id, anneeScolaire: ANNEE },
        { $push: { formateurs: { matricule: 'LISTE-1', nomComplet: 'FORMATEUR EN LISTE' } } }
      );
    }

    const chezA = await request(app).get('/api/v2/formateurs-mutualises').set(enTete(cookiesA, A));
    expect(chezA.body.formateurs).toEqual([
      expect.objectContaining({ matricule: 'LISTE-1', avec: [expect.objectContaining({ nom: 'ISTA Beta' })] }),
    ]);
  });

  it('un formateur qui n’enseigne que dans un établissement n’est pas mutualisé', async () => {
    const seul = await request(app).get('/api/v2/formateurs-mutualises').set(enTete(cookiesA, A));
    expect(seul.body.formateurs).toEqual([]);
  });

  it('⚠️ refuse de le placer dans deux établissements au même créneau — dans les deux sens', async () => {
    await affecterPartout();
    expect((await poserMut(cookiesA, A, {})).status).toBe(200);

    const refus = await poserMut(cookiesB, B, {});
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('CRENEAU_OCCUPE');
    expect(refus.body.details).toEqual([
      expect.objectContaining({ type: 'formateur', message: expect.stringContaining(NOM_A) }),
    ]);

    // Autre créneau : libre. Et dans l'autre sens, sur le créneau de B.
    expect((await poserMut(cookiesB, B, { seance: 'S2' })).status).toBe(200);
    const refusA = await poserMut(cookiesA, A, { seance: 'S2' });
    expect(refusA.status).toBe(409);
    expect(refusA.body.details[0].message).toContain('ISTA Beta');
  });

  it('⚠️ la semaine dit où le formateur enseigne ailleurs, pour FIGER ces cases', async () => {
    await affecterPartout();
    await poserMut(cookiesA, A, {});

    const chezB = await request(app).get(`/api/v2/seances/${SEMAINE}`).set(enTete(cookiesB, B));
    expect(chezB.status).toBe(200);
    const lundi = chezB.body.jours.find((j) => j.jour === 'Lundi');
    expect(lundi.formateursAilleurs).toEqual([
      { matricule: 'MUT-1', seance: 'S1', periode: 'jour', par: NOM_A, groupe: 'GM101' },
    ]);
    // Les autres jours n'ont rien, et A ne se voit pas lui-même.
    expect(chezB.body.jours.find((j) => j.jour === 'Mardi').formateursAilleurs).toEqual([]);
    const chezA = await request(app).get(`/api/v2/seances/${SEMAINE}`).set(enTete(cookiesA, A));
    expect(chezA.body.jours.find((j) => j.jour === 'Lundi').formateursAilleurs).toEqual([]);
  });

  it('sans formateur commun, la semaine ne dit rien d’ailleurs', async () => {
    await poserPar(cookiesA, A, {});
    const chezB = await request(app).get(`/api/v2/seances/${SEMAINE}`).set(enTete(cookiesB, B));
    expect(chezB.body.jours.every((j) => j.formateursAilleurs.length === 0)).toBe(true);
  });

  it('un formateur affecté dans un seul établissement ne subit aucun contrôle croisé', async () => {
    // Même matricule posé chez A puis chez B, mais B n'a aucune affectation pour lui.
    await Base.updateOne(
      { etablissementId: A.id, anneeScolaire: ANNEE },
      { $push: { formateurs: { matricule: 'SOLO-1', nomComplet: 'SOLO' }, affectations: { formateur: 'SOLO-1', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 } } }
    );
    expect((await poserPar(cookiesA, A, { formateurMatricule: 'SOLO-1' })).status).toBe(200);
    expect((await poserPar(cookiesB, B, {})).status).toBe(200);
  });

  it('⚠️ ignore un établissement sans compte actif (et mon propre doublon de compte)', async () => {
    await affecterPartout();
    // Le compte de B est bloqué : son établissement ne compte plus.
    const proprietaire = await Etablissement.findById(B.id).select('proprietaireId');
    await User.updateOne({ _id: proprietaire.proprietaireId }, { $set: { statut: STATUTS_COMPTE.BLOQUE } });

    const liste = await request(app).get('/api/v2/formateurs-mutualises').set(enTete(cookiesA, A));
    expect(liste.body.formateurs).toEqual([]);
  });
});
