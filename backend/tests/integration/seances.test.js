import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Seance } from '../../src/models/Seance.js';
import { Repartition } from '../../src/models/Repartition.js';
import { CalendrierNational } from '../../src/models/CalendrierNational.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Emploi du temps hebdomadaire (F5) — sous-livraison LECTURE SEULE.
 * ← api/data/get_timetable.php + get_all_timetables.php
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const SEMAINE = '2026-W3';

let etablissement;
let cookies;

beforeEach(async () => {
  oublierMemoire();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

  const directeur = await User.create({
    nomComplet: 'Directeur Test',
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
    espaces: ['B02', 'A12'],
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [
      { matricule: '9863', nomComplet: 'BRAHIM LOURID' },
      { matricule: '4211', nomComplet: 'AHMED CHERKAOUI' },
      // Sans matricule : il ne peut pas porter de séance, l'index l'exige.
      { matricule: '', nomComplet: 'SANS MATRICULE' },
    ],
    groupes: ['GM102', 'GM101', 'GE101 (CDS)'],
    /*
     * Assez d'affectations pour éprouver les conflits : deux formateurs, deux
     * groupes, deux modules. Le serveur refuse ce qui n'est pas affecté, donc
     * une fixture trop maigre ferait échouer les tests de conflit sur un tout
     * autre motif — et ce sont eux qui comptent ici.
     */
    affectations: [
      { formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
      { formateur: '9863', groupe: 'GM102', module: 'M102', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
      { formateur: '4211', groupe: 'GM101', module: 'M102', type: TYPES_COURS.PRESENTIEL, s1Heures: 20 },
      { formateur: '4211', groupe: 'GM102', module: 'M102', type: TYPES_COURS.PRESENTIEL, s1Heures: 20 },
    ],
  });

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];
});

const poser = (surcharges = {}) =>
  Seance.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    semaine: SEMAINE,
    jour: 'Lundi',
    seance: 'S1',
    date: new Date('2026-09-14T00:00:00'),
    formateurMatricule: '9863',
    groupe: 'GM101',
    module: 'M101',
    salle: 'A12',
    ...surcharges,
  });

describe('GET /seances/contexte', () => {
  it('rend formateurs, groupes et salles, TRIÉS', async () => {
    const reponse = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.formateurs).toEqual([
      { matricule: '4211', nom: 'AHMED CHERKAOUI' },
      { matricule: '9863', nom: 'BRAHIM LOURID' },
    ]);
    expect(reponse.body.groupes).toEqual(['GE101 (CDS)', 'GM101', 'GM102']);
    expect(reponse.body.salles).toEqual(['A12', 'B02']);
  });

  /*
   * ═══ ⚠️ L'IDENTITÉ DES GROUPES — filière, niveau, année ═══
   * C'est ce qui rend possibles les filtres de la page Édition. Le NIVEAU ne se
   * lit ni dans le nom du groupe ni dans la base : il vient de la répartition
   * DRIF, que le serveur interroge — l'envoyer au client, ce sont 13 359 lignes.
   */
  it('rend filière, niveau et année de chaque groupe', async () => {
    /* La table persistée est la PREMIÈRE source de `filieresParGroupe` — les
       affectations du montage n'en portent aucune, ce que vérifie le test
       suivant. */
    await Base.updateOne({}, { $set: { groupeFilieres: { GM101: 'GM_GM_TS' } } });
    await Repartition.create({
      codeFiliereDrif: 'GM_GM_TS',
      secteur: 'Génie Mécanique',
      niveauFormation: 'TS',
      filiere: 'Génie Mécanique',
      anneeFormation: 1,
      codeModule: 'M101',
      module: 'Module 101',
    });

    const reponse = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.groupesIdentites.GM101).toEqual({
      filiere: 'GM_GM_TS',
      filiereLibelle: 'Génie Mécanique',
      niveau: 'TS',
      annee: 1,
    });
  });

  /*
   * ⚠️ CE QUI RESTE INCONNU RESTE VIDE, jamais deviné. Un groupe dont la filière
   * n'est pas résolue ne doit pas hériter d'un niveau : il sortira des listes dès
   * qu'une facette sera cochée — ce qui se voit — au lieu d'apparaître sous un
   * niveau qui n'est pas le sien.
   */
  it('⚠️ n’invente NI niveau NI libellé pour une filière hors référentiel', async () => {
    const reponse = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);

    expect(reponse.body.groupesIdentites.GM101).toMatchObject({ niveau: '', filiereLibelle: '' });
    // L'année, elle, se lit dans le NOM — elle reste connue.
    expect(reponse.body.groupesIdentites.GM101.annee).toBe(1);
  });

  it('⚠️ REND les affectations, pas seulement les listes', async () => {
    /*
     * Sans elles, l'écran n'a rien pour bâtir ses listes de groupes et de
     * modules : le panneau de saisie s'ouvre avec des listes VIDES, et rien ne
     * dit pourquoi. Sélectionner un champ ne suffit pas — il faut le renvoyer.
     */
    const reponse = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);

    expect(reponse.body.affectations).toHaveLength(4);
    expect(reponse.body.affectations[0]).toMatchObject({
      formateur: '9863',
      groupe: 'GM101',
      module: 'M101',
    });
  });

  it('⚠️ ÉCARTE un formateur SANS matricule', async () => {
    /*
     * Le matricule est l'identifiant : `Seance.formateurMatricule` est requis et
     * l'index unique le porte. Proposer une ligne pour quelqu'un qui ne peut
     * porter aucune séance fabriquerait une ligne à jamais vide.
     */
    const reponse = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);
    expect(reponse.body.formateurs.some((f) => f.nom === 'SANS MATRICULE')).toBe(false);
  });

  it('reconnaît les groupes du SOIR à leur nom', async () => {
    // Le suffixe « (CDS) » est posé par le renommage e-note : c'est la seule
    // marque que la base en garde.
    const reponse = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);
    expect(reponse.body.groupesSoir).toEqual(['GE101 (CDS)']);
  });

  it('refuse quand aucune base n’existe pour l’année', async () => {
    await Base.deleteMany({});
    const reponse = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);
    expect(reponse.status).toBe(404);
  });
});

describe('GET /seances/:semaine', () => {
  it('rend les séances de la semaine', async () => {
    await poser();

    const reponse = await request(app).get(`/api/v2/seances/${SEMAINE}`).set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.seances).toHaveLength(1);
    expect(reponse.body.seances[0]).toMatchObject({
      jour: 'Lundi',
      seance: 'S1',
      periode: 'jour',
      formateurMatricule: '9863',
      groupe: 'GM101',
      salle: 'A12',
    });
    // `id` en clair : l'écran en aura besoin dès l'édition.
    expect(reponse.body.seances[0].id).toBeTypeOf('string');
  });

  it('⚠️ rend le JOUR et le SOIR dans la MÊME réponse', async () => {
    /*
     * Le S5 du soir et celui du jour sont deux séances que l'index unique
     * sépare. Les demander en deux requêtes ferait lire la même semaine deux
     * fois, et laisserait les deux grilles se désynchroniser le jour où l'une
     * seule est rafraîchie.
     */
    await poser({ seance: 'S5', periode: 'jour', module: 'JOUR' });
    await poser({ seance: 'S5', periode: 'soir', module: 'SOIR', groupe: 'GE101 (CDS)' });

    const reponse = await request(app).get(`/api/v2/seances/${SEMAINE}`).set('Cookie', cookies);

    expect(reponse.body.seances).toHaveLength(2);
    expect(reponse.body.seances.map((s) => s.periode).sort()).toEqual(['jour', 'soir']);
  });

  it('rend les 6 JOURS avec leur date', async () => {
    const reponse = await request(app).get(`/api/v2/seances/${SEMAINE}`).set('Cookie', cookies);

    expect(reponse.body.jours).toHaveLength(6);
    expect(reponse.body.jours[0].jour).toBe('Lundi');
    // Chaîne « AAAA-MM-JJ » : une `Date` à minuit UTC relue au Maroc rend la veille.
    expect(reponse.body.jours[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('marque les jours de VACANCES', async () => {
    const jours = (await request(app).get(`/api/v2/seances/${SEMAINE}`).set('Cookie', cookies)).body
      .jours;

    await Etablissement.updateOne(
      { _id: etablissement.id },
      { $set: { 'calendrier.vacances': [{ debut: jours[1].date, fin: jours[2].date }] } }
    );

    const reponse = await request(app).get(`/api/v2/seances/${SEMAINE}`).set('Cookie', cookies);

    // Le jour, pas la semaine : un férié isolé ferme le mardi sans rien changer
    // au reste, et la grille grise la seule colonne concernée.
    expect(reponse.body.jours.map((j) => j.vacances)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('accepte le zéro de remplissage laissé par l’existant', async () => {
    /*
     * `emplois_du_temps` contient « 2026-W039 » à côté des « 2026-W39 ».
     * `normaliserValeurSemaine` ramène les deux à la même clé — sans quoi la
     * grille de cette semaine reviendrait vide.
     */
    await poser({ semaine: '2026-W3' });

    const reponse = await request(app).get('/api/v2/seances/2026-W003').set('Cookie', cookies);
    expect(reponse.body.semaine).toBe(SEMAINE);
    expect(reponse.body.seances).toHaveLength(1);
  });

  it('rend une semaine VIDE sans erreur', async () => {
    // État attendu : une semaine non encore saisie n'est pas une anomalie.
    const reponse = await request(app).get('/api/v2/seances/2026-W40').set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.seances).toEqual([]);
  });

  it('refuse une valeur de semaine illisible', async () => {
    const reponse = await request(app).get('/api/v2/seances/lundi').set('Cookie', cookies);
    expect(reponse.status).toBe(400);
  });
});

describe('GET /seances/semaines', () => {
  it('compte les séances de chaque semaine', async () => {
    await poser();
    await poser({ seance: 'S2' });
    await poser({ semaine: '2026-W4', jour: 'Mardi' });

    const reponse = await request(app).get('/api/v2/seances/semaines').set('Cookie', cookies);

    expect(reponse.body.semaines).toEqual([
      { semaine: '2026-W3', seances: 2 },
      { semaine: '2026-W4', seances: 1 },
    ]);
    /*
     * ⚠️ La semaine par défaut appartient à l'ANNÉE ACTIVE, pas au calendrier.
     * En août 2026 on est encore, au calendrier, dans l'année 2025-2026 :
     * ouvrir sur « aujourd'hui » présenterait une semaine incapable de porter
     * la moindre séance de 2026-2027, et la grille reviendrait vide.
     */
    expect(reponse.body.courante).toMatch(/^\d{4}-W\d+$/);
    expect(reponse.body.courante.startsWith(String(ANNEE))).toBe(true);
  });

  it('n’est PAS captée par la route d’une semaine', async () => {
    // « semaines » et « contexte » ressemblent à une valeur de semaine :
    // déclarées après `/:semaine`, elles seraient captées par elle.
    const reponse = await request(app).get('/api/v2/seances/semaines').set('Cookie', cookies);
    expect(reponse.status).toBe(200);
    expect(reponse.body).toHaveProperty('semaines');
  });
});

describe('PUT /seances/:semaine/case — poser une séance', () => {
  const poserPar = (corps) =>
    request(app)
      .put(`/api/v2/seances/${SEMAINE}/case`)
      .set('Cookie', cookies)
      .send({
        jour: 'Lundi',
        seance: 'S1',
        periode: 'jour',
        formateurMatricule: '9863',
        groupe: 'GM101',
        module: 'M101',
        salle: 'A12',
        ...corps,
      });

  it('pose une séance sur un créneau libre', async () => {
    const reponse = await poserPar();

    expect(reponse.status).toBe(200);
    expect(reponse.body.seance).toMatchObject({
      jour: 'Lundi',
      seance: 'S1',
      groupe: 'GM101',
      module: 'M101',
      salle: 'A12',
      statut: 'planifie',
    });

    // La DATE est calculée à l'écriture : la recalculer à chaque lecture ferait
    // dépendre l'affichage du fuseau du navigateur.
    expect(await Seance.countDocuments({})).toBe(1);
    expect((await Seance.findOne({})).date).toBeInstanceOf(Date);
  });

  it('REMPLACE la séance DÉSIGNÉE par son identifiant', async () => {
    /*
     * ⚠️ C'est l'`id` qui dit « je remplace celle-ci ». L'écran l'a sous la main
     * — il affiche la séance dans la case — et sans lui la pose est une
     * CRÉATION, ce qui doit buter sur l'occupant du créneau.
     */
    const posee = (await poserPar()).body.seance;
    const reponse = await poserPar({ id: posee.id, salle: 'B02' });

    expect(reponse.status).toBe(200);
    expect(await Seance.countDocuments({})).toBe(1);
    expect((await Seance.findOne({})).salle).toBe('B02');
  });

  it('⚠️ SANS identifiant, une pose sur une case occupée est REFUSÉE', async () => {
    // Sinon la création écraserait silencieusement ce qui était là.
    await poserPar();
    const reponse = await poserPar({ salle: 'B02' });
    expect(reponse.status).toBe(409);
  });

  it('⚠️ REFUSE un formateur DÉJÀ OCCUPÉ, et ne le DÉPLACE pas', async () => {
    /*
     * LE DÉFAUT QUE CE TEST FIGE, et qui motive tout le mécanisme d'identifiant.
     * En vue par GROUPE, choisir quelqu'un déjà occupé ailleurs au même moment
     * DÉPLAÇAIT sa séance en silence : le groupe qu'il quittait se retrouvait
     * sans cours, sans que rien ne le dise.
     */
    await poserPar();
    const reponse = await poserPar({ groupe: 'GM102', module: 'M102', salle: 'B02' });

    expect(reponse.status).toBe(409);
    expect(reponse.body.details.map((d) => d.type)).toContain('formateur');

    // Et surtout : la séance d'origine n'a pas bougé.
    expect(await Seance.countDocuments({})).toBe(1);
    expect((await Seance.findOne({})).groupe).toBe('GM101');
  });

  it('⚠️ REFUSE un GROUPE déjà en cours', async () => {
    await poserPar();
    const reponse = await poserPar({ formateurMatricule: '4211', module: 'M102', salle: 'B02' });

    expect(reponse.status).toBe(409);
    expect(reponse.body.details.map((d) => d.type)).toContain('groupe');
  });

  it('⚠️ REFUSE une SALLE occupée', async () => {
    await poserPar();
    const reponse = await poserPar({
      formateurMatricule: '4211',
      groupe: 'GM102',
      module: 'M102',
      salle: 'A12',
    });

    expect(reponse.status).toBe(409);
    expect(reponse.body.details.map((d) => d.type)).toContain('salle');
  });

  it('⚠️ N’OPPOSE PAS deux séances TEAMS', async () => {
    // « TEAMS » n'est pas un local : dix groupes peuvent l'employer en même
    // temps. Le traiter comme une salle ferait refuser toutes les séances à
    // distance de la semaine à partir de la deuxième.
    await poserPar({ salle: 'TEAMS' });
    const reponse = await poserPar({
      formateurMatricule: '4211',
      groupe: 'GM102',
      module: 'M102',
      salle: 'TEAMS',
    });

    expect(reponse.status).toBe(200);
    expect(await Seance.countDocuments({})).toBe(2);
  });

  it('rapporte TOUS les conflits d’un coup', async () => {
    // Un seul message enverrait corriger la salle, puis découvrir le groupe :
    // deux allers-retours pour une seule saisie.
    await poserPar();
    // Exactement la même case, sans identifiant : formateur, groupe et salle
    // butent tous les trois.
    const reponse = await poserPar();

    expect(reponse.body.details.map((d) => d.type).sort()).toEqual([
      'formateur',
      'groupe',
      'salle',
    ]);
  });

  it('n’oppose PAS un AUTRE créneau', async () => {
    await poserPar();
    const reponse = await poserPar({ seance: 'S2' });
    expect(reponse.status).toBe(200);
  });

  it('⚠️ REFUSE un groupe auquel le formateur n’est PAS affecté', async () => {
    /*
     * Sans ce contrôle, une saisie poserait un cours que personne n'a été
     * affecté à donner — et l'avancement compterait des heures que le
     * chronogramme n'a jamais prévues. L'écran ne propose que les bonnes
     * options ; le serveur ne s'y fie pas pour autant.
     */
    const reponse = await poserPar({ groupe: 'GE101 (CDS)', module: 'M101' });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('AFFECTATION_ABSENTE');
  });

  it('REFUSE un module qui n’est pas celui de ce groupe', async () => {
    const reponse = await poserPar({ module: 'M999' });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('MODULE_NON_AFFECTE');
  });

  it('refuse un jour ou un créneau hors des valeurs connues', async () => {
    expect((await poserPar({ jour: 'Dimanche' })).status).toBe(400);
    expect((await poserPar({ seance: 'S9' })).status).toBe(400);
  });
});

describe('DELETE /seances/:semaine/case — vider', () => {
  const creneau = {
    jour: 'Lundi',
    seance: 'S1',
    periode: 'jour',
    formateurMatricule: '9863',
  };

  it('supprime la séance du créneau', async () => {
    await poser();

    const reponse = await request(app)
      .delete(`/api/v2/seances/${SEMAINE}/case`)
      .set('Cookie', cookies)
      .send(creneau);

    expect(reponse.status).toBe(200);
    expect(reponse.body.supprimee).toBe(true);
    /*
     * ⚠️ SUPPRESSION, pas mise à blanc : une séance sans groupe resterait à
     * occuper son créneau dans l'index unique, empêchant d'en poser une autre —
     * le trou serait invisible et indéblocable.
     */
    expect(await Seance.countDocuments({})).toBe(0);
  });

  it('vider une case DÉJÀ vide n’est pas une erreur', async () => {
    // C'est l'état voulu : répondre en erreur ferait clignoter un message pour
    // une action qui a exactement l'effet demandé.
    const reponse = await request(app)
      .delete(`/api/v2/seances/${SEMAINE}/case`)
      .set('Cookie', cookies)
      .send(creneau);

    expect(reponse.status).toBe(200);
    expect(reponse.body.supprimee).toBe(false);
  });

  it('ne touche PAS la séance d’un autre formateur', async () => {
    await poser();
    await poser({ formateurMatricule: '4211', groupe: 'GM102' });

    await request(app)
      .delete(`/api/v2/seances/${SEMAINE}/case`)
      .set('Cookie', cookies)
      .send(creneau);

    expect(await Seance.countDocuments({})).toBe(1);
    expect((await Seance.findOne({})).formateurMatricule).toBe('4211');
  });
});

describe('Indicateurs de la grille', () => {
  it('rend le semestre, l’EFM et la masse prévue de chaque affectation', async () => {
    const reponse = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);

    // Sans ces colonnes, la grille est sans repère : on poserait des séances
    // sans savoir si le module est déjà couvert.
    expect(reponse.body.affectations[0]).toMatchObject({
      s1Heures: 30,
      s2Heures: 0,
      estRegional: false,
    });
  });

  it('⚠️ compte les heures posées sur TOUTE L’ANNÉE, pas sur la semaine', async () => {
    /*
     * Rapporté à la seule semaine affichée, le taux d'avancement tomberait à
     * 2 % partout et ne dirait plus rien.
     */
    await poser();
    await poser({ semaine: '2026-W20', jour: 'Mardi', date: new Date('2026-01-20T00:00:00') });

    const reponse = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);
    // ⚠️ Deux compteurs, un par TYPE : la salle dit lequel se remplit.
    expect(reponse.body.posees['GM101||M101']).toEqual({ presentiel: 5, synchrone: 0 });
  });

  it('n’y compte PAS une séance absente', async () => {
    await poser({ statut: 'absent' });
    const reponse = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);
    expect(reponse.body.posees['GM101||M101']).toBeUndefined();
  });
});

describe('GET /seances/module — la fiche au survol', () => {
  const fiche = (query) =>
    request(app).get('/api/v2/seances/module').query(query).set('Cookie', cookies);

  it('rend l’avancement SEMAINE PAR SEMAINE, dans l’ordre des numéros', async () => {
    await poser({ semaine: '2026-W10', jour: 'Mardi' });
    await poser({ semaine: '2026-W2', jour: 'Mercredi' });
    await poser({ semaine: '2026-W2', seance: 'S2', jour: 'Mercredi' });

    const reponse = await fiche({ groupe: 'GM101', module: 'M101' });

    expect(reponse.status).toBe(200);
    /*
     * ⚠️ DEUX BLOCS, un par type de séance. Les fixtures posent en salle « A12 » :
     * tout se range en présentiel, et la masse à distance reste vide.
     */
    expect(reponse.body.presentiel).toMatchObject({ prevu: 30, pose: 7.5, taux: 25 });
    expect(reponse.body.presentiel.semaines).toEqual([
      { semaine: '2026-W2', numero: 2, heures: 5, cumul: 5, taux: 17 },
      { semaine: '2026-W10', numero: 10, heures: 2.5, cumul: 7.5, taux: 25 },
    ]);
    expect(reponse.body.synchrone).toMatchObject({ prevu: 0, pose: 0, taux: null });
  });

  it('rend le SEMESTRE et l’EFM régional du module', async () => {
    const reponse = await fiche({ groupe: 'GM101', module: 'M101' });

    expect(reponse.body).toMatchObject({ semestre: '1', estRegional: false });
  });

  /*
   * ⚠️ L'INTITULÉ N'EST PAS DANS LA BASE : `Base.affectations` ne garde que le
   * CODE. Sans répartition DRIF, la carte ne peut donc afficher que le code — et
   * elle le DIT, plutôt que de laisser un titre vide.
   */
  it('rend `intitule: null` quand le module est hors répartition', async () => {
    const reponse = await fiche({ groupe: 'GM101', module: 'M101' });

    expect(reponse.body.intitule).toBeNull();
  });

  it('refuse une requête sans groupe ni module', async () => {
    expect((await fiche({ groupe: 'GM101' })).status).toBe(400);
  });

  /*
   * ⚠️ `/module` SE DÉCLARE AVANT `/:semaine`. Placée après, elle serait captée
   * par la route de semaine, qui chercherait une semaine nommée « module » et
   * répondrait 400 sur une route pourtant écrite.
   */
  it('n’est pas captée par la route de semaine', async () => {
    const reponse = await fiche({ groupe: 'GM101', module: 'M101' });

    expect(reponse.status).toBe(200);
    expect(reponse.body.presentiel).toHaveProperty('semaines');
  });
});

describe('⚠️ QUOTA — on ne pose pas plus d’heures que la carte n’en prévoit', () => {
  /*
   * La fixture donne 30 h à M101 pour GM101, en PRÉSENTIEL : soit 12 séances de
   * 2,5 h. La treizième doit être refusée — à la main comme à l'import.
   */
  const poserVia = (surcharges = {}) =>
    request(app)
      .put(`/api/v2/seances/${SEMAINE}/case`)
      .set('Cookie', cookies)
      .send({
        jour: 'Lundi',
        seance: 'S1',
        periode: 'jour',
        formateurMatricule: '9863',
        groupe: 'GM101',
        module: 'M101',
        salle: 'A12',
        ...surcharges,
      });

  const remplir = async (heures) => {
    const seances = [];
    for (let i = 0; i < heures / 2.5; i += 1) {
      seances.push({
        etablissementId: etablissement.id,
        anneeScolaire: ANNEE,
        semaine: `2026-W${i + 20}`,
        jour: 'Lundi',
        seance: 'S1',
        date: new Date('2026-09-14T00:00:00'),
        formateurMatricule: '9863',
        groupe: 'GM101',
        module: 'M101',
        salle: 'A12',
      });
    }
    await Seance.insertMany(seances);
  };

  it('refuse la séance qui ferait dépasser la masse prévue', async () => {
    await remplir(30);

    const reponse = await poserVia();

    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('QUOTA_DEPASSE');
    expect(reponse.body.details[0].message).toMatch(/30 h en présentiel déjà posées sur 30 h prévues/);
  });

  it('accepte tant qu’il reste de la place', async () => {
    await remplir(27.5);
    expect((await poserVia()).status).toBe(200);
  });

  /*
   * ⚠️ CHAQUE TYPE A SON QUOTA. Le présentiel plein n'empêche pas de poser une
   * séance à distance : ce sont deux masses distinctes dans la carte.
   */
  it('un présentiel saturé n’interdit PAS une séance à distance', async () => {
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      {
        $push: {
          affectations: {
            formateur: '9863',
            groupe: 'GM101',
            module: 'M101',
            type: TYPES_COURS.SYNCHRONE,
            s1Heures: 10,
          },
        },
      }
    );
    await remplir(30);

    expect((await poserVia({ salle: 'TEAMS' })).status).toBe(200);
  });

  /*
   * ⚠️ UNE MASSE À ZÉRO N'EST PAS UN QUOTA DE ZÉRO : c'est une masse NON
   * DÉCLARÉE. Bloquer là rendrait insaisissable tout module que la carte n'a pas
   * chiffré.
   */
  it('ne bloque pas quand aucune masse n’est déclarée', async () => {
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      { $set: { 'affectations.0.s1Heures': 0, 'affectations.0.s2Heures': 0 } }
    );

    expect((await poserVia()).status).toBe(200);
  });

  it('⚠️ la séance REMPLACÉE ne se compte pas deux fois', async () => {
    await remplir(27.5);
    const posee = await poserVia();
    // Corriger la salle d'une séance déjà posée ne consomme pas d'heures de plus.
    const corrigee = await poserVia({ id: posee.body.seance.id, salle: 'B02' });

    expect(corrigee.status).toBe(200);
  });

  it('⚠️ L’IMPORT AUSSI est borné — les séances en trop sont NOMMÉES', async () => {
    /*
      ⚠️ LA SEMAINE SOURCE COMPTE DÉJÀ dans le total de l'année : la copier
      AJOUTE ses heures, elle ne les déplace pas. 17,5 h ailleurs + 10 h dans la
      source = 27,5 h sur 30 : il reste la place d'UNE séance.
    */
    for (const creneau of ['S1', 'S2', 'S3', 'S4']) {
      await poser({ semaine: '2026-W40', seance: creneau });
    }
    await remplir(17.5);

    const reponse = await request(app)
      .post(`/api/v2/seances/${SEMAINE}/importer`)
      .set('Cookie', cookies)
      .send({ depuis: '2026-W40' });

    expect(reponse.status).toBe(200);
    expect(reponse.body.importees).toBe(1);
    expect(reponse.body.refusees).toHaveLength(3);
    expect(reponse.body.refusees[0].motif).toMatch(/30 h en présentiel prévues/);
  });
});

describe('⚠️ Stages et formations dans la semaine', () => {
  /*
   * Les vacances ferment l'ÉTABLISSEMENT, un stage ferme UN GROUPE, une
   * formation UNE PERSONNE. La grille doit pouvoir verrouiller la seule ligne
   * concernée : il lui faut donc, jour par jour, QUI manque.
   */
  beforeEach(async () => {
    await Etablissement.updateOne(
      { _id: etablissement.id },
      {
        $set: {
          stages: [{ groupe: 'GM102', debut: '2026-09-15', fin: '2026-09-16' }],
          formations: [
            {
              matriculeFormateur: '9863',
              nomFormateur: 'BRAHIM LOURID',
              debut: '2026-09-16',
              fin: '2026-09-17',
            },
          ],
        },
      }
    );
  });

  it('rend le groupe en stage et le formateur en formation, JOUR PAR JOUR', async () => {
    const reponse = await request(app).get('/api/v2/seances/2026-W3').set('Cookie', cookies);
    const parJour = Object.fromEntries(reponse.body.jours.map((j) => [j.date, j]));

    // Le 14 : personne ne manque encore.
    expect(parJour['2026-09-14'].stages).toEqual([]);
    expect(parJour['2026-09-14'].formations).toEqual([]);

    // Le 15 : le groupe part en stage, le formateur est encore là.
    expect(parJour['2026-09-15'].stages.map((s) => s.groupe)).toEqual(['GM102']);
    expect(parJour['2026-09-15'].formations).toEqual([]);

    // Le 16 : les deux.
    expect(parJour['2026-09-16'].stages.map((s) => s.groupe)).toEqual(['GM102']);
    expect(parJour['2026-09-16'].formations.map((f) => f.matricule)).toEqual(['9863']);

    // Le 17 : le stage est fini, la formation continue.
    expect(parJour['2026-09-17'].stages).toEqual([]);
    expect(parJour['2026-09-17'].formations.map((f) => f.matricule)).toEqual(['9863']);
  });
});

/**
 * Groupes FQ : un groupe virtuel occupe les groupes réels qui le composent.
 * ← fq_group_mappings + findConflict() de emploi.html
 */
describe('Conflits — composition des groupes FQ', () => {
  const composer = async () => {
    /*
     * « APIL101 (FQ) » réunit les stagiaires de GM101 et GM102, et son formateur
     * doit y être affecté : le serveur refuse une séance non affectée.
     */
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      {
        $push: {
          groupes: 'APIL101 (FQ)',
          affectations: {
            formateur: '4211',
            groupe: 'APIL101 (FQ)',
            module: 'M102',
            type: TYPES_COURS.PRESENTIEL,
            s1Heures: 30,
          },
        },
      }
    );

    await Etablissement.updateOne(
      { _id: etablissement.id },
      {
        $set: {
          groupesFq: [
            { groupeFq: 'APIL101 (FQ)', groupeConstituant: 'GM101' },
            { groupeFq: 'APIL101 (FQ)', groupeConstituant: 'GM102' },
          ],
        },
      }
    );
  };

  const ecrire = (corps) =>
    request(app)
      .put(`/api/v2/seances/${SEMAINE}/case`)
      .set('Cookie', cookies)
      .send({ jour: 'Lundi', seance: 'S1', periode: 'jour', ...corps });

  it('⚠️ le contexte REND la composition — sans elle, l’écran et le serveur divergeraient', async () => {
    await composer();

    const reponse = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);

    expect(reponse.body.groupesFq).toEqual([
      { groupeFq: 'APIL101 (FQ)', groupeConstituant: 'GM101' },
      { groupeFq: 'APIL101 (FQ)', groupeConstituant: 'GM102' },
    ]);
  });

  it('un cours sur le groupe FQ est refusé si un constituant a déjà cours', async () => {
    await composer();
    await poser({ formateurMatricule: '9863', groupe: 'GM101', module: 'M101', salle: 'A12' });

    const reponse = await ecrire({
      formateurMatricule: '4211',
      groupe: 'APIL101 (FQ)',
      module: 'M102',
      salle: 'B02',
    });

    expect(reponse.status).toBe(409);
    expect(reponse.body.details.map((d) => d.type)).toContain('groupe');
  });

  /*
   * ⚠️⚠️ DEUX CONSTITUANTS RESTENT LIBRES ENTRE EUX. Ce sont deux classes
   * distinctes : les rendre solidaires interdirait d'aligner GM101 et GM102
   * toute l'année. C'est la divergence assumée avec `findConflict()`, qui
   * élargit les deux sens et refuse ce cas.
   */
  it('⚠️ mais deux constituants du même FQ peuvent avoir cours en même temps', async () => {
    await composer();
    await poser({ formateurMatricule: '9863', groupe: 'GM101', module: 'M101', salle: 'A12' });

    const reponse = await ecrire({
      formateurMatricule: '4211',
      groupe: 'GM102',
      module: 'M102',
      salle: 'B02',
    });

    expect(reponse.status).toBe(200);
  });

  it('sans composition déclarée, le FQ n’entraîne personne', async () => {
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      {
        $push: {
          groupes: 'APIL101 (FQ)',
          affectations: {
            formateur: '4211',
            groupe: 'APIL101 (FQ)',
            module: 'M102',
            type: TYPES_COURS.PRESENTIEL,
            s1Heures: 30,
          },
        },
      }
    );

    await poser({ formateurMatricule: '9863', groupe: 'GM101', module: 'M101', salle: 'A12' });

    const reponse = await ecrire({
      formateurMatricule: '4211',
      groupe: 'APIL101 (FQ)',
      module: 'M102',
      salle: 'B02',
    });

    expect(reponse.status).toBe(200);
  });
});

describe('PUT /etablissements/courant/groupes-fq', () => {
  const enregistrer = (groupesFq) =>
    request(app)
      .put('/api/v2/etablissements/courant/groupes-fq')
      .set('Cookie', cookies)
      .send({ groupesFq });

  it('enregistre la composition, et l’établissement la rend', async () => {
    const reponse = await enregistrer([
      { groupeFq: 'APIL101 (FQ)', groupeConstituant: 'GM101' },
      { groupeFq: 'APIL101 (FQ)', groupeConstituant: 'GM102' },
    ]);

    expect(reponse.status).toBe(200);

    /*
     * ⚠️ LE PRÉSENTATEUR DOIT LA RENDRE : sans elle, l'écran s'ouvrirait vide
     * et le premier enregistrement effacerait tout — `PUT` remplace la liste.
     * C'est le cinquième champ où ce piège se présente.
     */
    const courant = await request(app)
      .get('/api/v2/etablissements/courant')
      .set('Cookie', cookies);

    expect(courant.body.etablissement.groupesFq).toHaveLength(2);
  });

  it('⚠️ un groupe ne peut pas se composer de lui-même', async () => {
    const reponse = await enregistrer([
      { groupeFq: 'APIL101 (FQ)', groupeConstituant: 'APIL101 (FQ)' },
    ]);

    expect(reponse.status).toBe(400);
  });

  it('⚠️ un couple envoyé deux fois n’est gardé qu’une', async () => {
    const reponse = await enregistrer([
      { groupeFq: 'APIL101 (FQ)', groupeConstituant: 'GM101' },
      { groupeFq: 'APIL101 (FQ)', groupeConstituant: 'GM101' },
    ]);

    expect(reponse.body.groupesFq).toHaveLength(1);
  });

  /*
   * ⚠️ UN GROUPE PEUT COMPOSER PLUSIEURS FQ (décision du porteur) : c'est ce
   * que la table de l'existant tolère, on ne le restreint pas.
   */
  it('⚠️ un même groupe peut composer deux FQ', async () => {
    const reponse = await enregistrer([
      { groupeFq: 'APIL101 (FQ)', groupeConstituant: 'GM101' },
      { groupeFq: 'BURE201 (FQ)', groupeConstituant: 'GM101' },
    ]);

    expect(reponse.status).toBe(200);
    expect(reponse.body.groupesFq).toHaveLength(2);
  });

  it('remplace la liste entière, comme les stages', async () => {
    await enregistrer([{ groupeFq: 'APIL101 (FQ)', groupeConstituant: 'GM101' }]);
    const reponse = await enregistrer([{ groupeFq: 'BURE201 (FQ)', groupeConstituant: 'GM102' }]);

    expect(reponse.body.groupesFq).toEqual([
      { groupeFq: 'BURE201 (FQ)', groupeConstituant: 'GM102' },
    ]);
  });
});

/**
 * EFM régional : planification d'un examen et de sa surveillance.
 * ← save_efm_regional.php
 */
describe('POST /seances/:semaine/efm', () => {
  const regionaliser = () =>
    Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      { $set: { 'affectations.0.estRegional': true } }
    );

  const planifier = (corps) =>
    request(app)
      .post(`/api/v2/seances/${SEMAINE}/efm`)
      .set('Cookie', cookies)
      .send({
        groupe: 'GM101',
        module: 'M101',
        salle: 'B02',
        jour: 'Mardi',
        creneaux: ['S1', 'S2'],
        surveillants: ['4211'],
        ...corps,
      });

  it('pose une surveillance par surveillant ET par créneau', async () => {
    await regionaliser();

    const reponse = await planifier();

    expect(reponse.status).toBe(200);
    expect(reponse.body.posees).toBe(2);

    const posees = await Seance.find({ estEfm: true }).lean();
    expect(posees).toHaveLength(2);
    expect(posees.map((s) => s.seance).sort()).toEqual(['S1', 'S2']);
    expect(new Set(posees.map((s) => s.formateurMatricule))).toEqual(new Set(['4211']));
  });

  /*
   * ⚠️⚠️ LE SURVEILLANT N'EST PAS AFFECTÉ AU MODULE, et c'est normal : il
   * surveille, il n'enseigne pas. `poser` refuserait cette séance
   * (`AFFECTATION_ABSENTE`) — la route EFM ne passe pas par ce contrôle.
   */
  it('⚠️ le surveillant n’a pas besoin d’être affecté au module', async () => {
    await regionaliser();

    // 7777 n'a AUCUNE affectation dans la base.
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      { $push: { formateurs: { matricule: '7777', nomComplet: 'SURVEILLANT PUR' } } }
    );

    expect((await planifier({ surveillants: ['7777'] })).status).toBe(200);
  });

  /*
   * ⚠️ LE TITULAIRE NE SURVEILLE PAS SON PROPRE EXAMEN. L'écran désactive sa
   * case ; le serveur le refuse, sinon un appel direct passerait outre.
   */
  it('⚠️ refuse le titulaire du module comme surveillant', async () => {
    await regionaliser();

    const reponse = await planifier({ surveillants: ['9863'] });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('TITULAIRE_SURVEILLANT');
    expect(await Seance.countDocuments({ estEfm: true })).toBe(0);
  });

  it('⚠️ refuse un module qui n’est PAS régional pour ce groupe', async () => {
    // Aucune affectation régionale : la base est laissée telle quelle.
    const reponse = await planifier();

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('MODULE_NON_REGIONAL');
  });

  /*
   * ⚠️⚠️ L'EXISTANT ÉCRASAIT ce qui occupait le créneau, sans un mot :
   * l'écran affichait « Occupé » et enregistrait quand même. Ici on refuse, et on
   * NOMME ce qui bloque.
   */
  it('⚠️ refuse quand un surveillant a déjà cours sur le créneau', async () => {
    await regionaliser();
    await poser({ formateurMatricule: '4211', groupe: 'GM102', module: 'M102', jour: 'Mardi', seance: 'S1', salle: 'A12' });

    const reponse = await planifier();

    expect(reponse.status).toBe(409);
    expect(reponse.body.details.some((d) => d.type === 'formateur')).toBe(true);
    // ⚠️ RIEN N'EST ÉCRIT : la transaction ne part même pas.
    expect(await Seance.countDocuments({ estEfm: true })).toBe(0);
  });

  it('⚠️ refuse quand la salle est déjà prise', async () => {
    await regionaliser();
    await poser({ formateurMatricule: '9863', groupe: 'GM101', module: 'M101', jour: 'Mardi', seance: 'S1', salle: 'B02' });

    const reponse = await planifier();

    expect(reponse.status).toBe(409);
    expect(reponse.body.details.some((d) => d.type === 'salle')).toBe(true);
  });

  /*
   * ⚠️ LES SÉANCES DE L'EXAMEN NE SE REFUSENT PAS ENTRE ELLES. Elles
   * partagent groupe et salle : comparées les unes aux autres, deux surveillants
   * sur le même créneau se bloqueraient mutuellement.
   */
  it('⚠️ plusieurs surveillants sur le MÊME créneau passent', async () => {
    await regionaliser();
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      { $push: { formateurs: { matricule: '7777', nomComplet: 'SURVEILLANT PUR' } } }
    );

    const reponse = await planifier({ creneaux: ['S1'], surveillants: ['4211', '7777'] });

    expect(reponse.status).toBe(200);
    expect(reponse.body.posees).toBe(2);
  });

  /*
   * ⚠️ UNE SURVEILLANCE N'EST PAS UN COURS : elle ne doit pas faire avancer le
   * module. L'existant, qui posait une séance ordinaire, la comptait.
   */
  it('⚠️ les heures de surveillance ne comptent PAS dans l’avancement', async () => {
    await regionaliser();
    await planifier();

    const contexte = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);
    expect(contexte.body.posees['GM101||M101']).toBeUndefined();
  });

  it('refuse un examen sans créneau ni surveillant', async () => {
    await regionaliser();

    expect((await planifier({ creneaux: [] })).status).toBe(400);
    expect((await planifier({ surveillants: [] })).status).toBe(400);
  });

  /*
   * ⚠️ S5 EST LE CRÉNEAU DU SOIR : un examen posé là serait écrit en
   * `periode: jour` et n'apparaîtrait sur aucune des deux grilles.
   */
  it('⚠️ refuse le créneau du soir', async () => {
    await regionaliser();
    expect((await planifier({ creneaux: ['S5'] })).status).toBe(400);
  });
});

describe('GET /seances/modules-regionaux', () => {
  it('ne rend que les modules régionaux du groupe', async () => {
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      { $set: { 'affectations.0.estRegional': true } }
    );

    const reponse = await request(app)
      .get('/api/v2/seances/modules-regionaux?groupe=GM101')
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.modules).toHaveLength(1);
    expect(reponse.body.modules[0]).toMatchObject({ module: 'M101', titulaires: ['9863'] });
  });

  /*
   * ⚠️ UN MODULE HORS RÉFÉRENTIEL N'EST PAS UNE ERREUR : la carte permet
   * d'en saisir. On rend `null`, et l'écran affiche alors le seul code plutôt
   * qu'un intitulé vide qu'on prendrait pour un défaut.
   */
  it('⚠️ rend un intitulé `null` pour un module hors répartition DRIF', async () => {
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      { $set: { 'affectations.0.estRegional': true } }
    );

    const reponse = await request(app)
      .get('/api/v2/seances/modules-regionaux?groupe=GM101')
      .set('Cookie', cookies);

    expect(reponse.body.modules[0].intitule).toBeNull();
  });

  it('⚠️ n’est pas captée par la route de semaine', async () => {
    const reponse = await request(app)
      .get('/api/v2/seances/modules-regionaux?groupe=GM101')
      .set('Cookie', cookies);

    // `/:semaine` répondrait 400 sur le motif de semaine.
    expect(reponse.status).toBe(200);
  });
});


/**
 * ═══ LE GEL DE RENTRÉE SUR LES TROIS CHEMINS D'ÉCRITURE ═══
 * (2026-09-03, signalé par le porteur : la saisie répondait 400 sans que la
 * grille ait rien gelé, et deux routes ne contrôlaient rien du tout.)
 *
 * S3 = lundi 14 septembre → samedi 19. GM101 et GM102 sont des 1ʳᵉ années.
 */
describe('Rentrée — les trois chemins d’écriture', () => {
  const gelerJusquAu = (date) =>
    CalendrierNational.create({
      anneeScolaire: ANNEE,
      vacances: [],
      rentrees: [{ anneeFormation: 1, date }],
    });

  /*
   * ⚠️⚠️ `details` EST UNE LISTE, JAMAIS UN OBJET. Un objet y faisait TOMBER
   * toute la page de l'emploi du temps sur « details?.map is not a function ».
   * Ce test fige la FORME, pas seulement le refus.
   */
  it('refuse la saisie et rend `details` sous forme de LISTE', async () => {
    await gelerJusquAu('2026-09-21');

    const reponse = await request(app)
      .put(`/api/v2/seances/${SEMAINE}/case`)
      .set('Cookie', cookies)
      .send({
        jour: 'Lundi',
        seance: 'S1',
        formateurMatricule: '9863',
        groupe: 'GM101',
        module: 'M101',
        salle: 'A12',
      });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('AVANT_RENTREE');
    expect(Array.isArray(reponse.body.details)).toBe(true);
    expect(reponse.body.details[0]).toMatchObject({ groupe: 'GM101', rentree: '2026-09-21' });
    expect(reponse.body.details[0].message).toContain('2026-09-21');
    expect(await Seance.countDocuments({})).toBe(0);
  });

  it('laisse passer la saisie à partir de la rentrée', async () => {
    // Le lundi 14 EST la rentrée : « avant » veut dire strictement avant.
    await gelerJusquAu('2026-09-14');

    const reponse = await request(app)
      .put(`/api/v2/seances/${SEMAINE}/case`)
      .set('Cookie', cookies)
      .send({
        jour: 'Lundi',
        seance: 'S1',
        formateurMatricule: '9863',
        groupe: 'GM101',
        module: 'M101',
        salle: 'A12',
      });

    expect(reponse.status).toBe(200);
  });

  /*
   * ⚠️ L'IMPORT EST LE CHEMIN LE PLUS DANGEREUX : vingt séances d'un coup, dont
   * aucune ne passe par la saisie. Il ne contrôlait rien.
   */
  it('ÉCARTE les séances gelées à l’import d’une semaine, sans rejeter le reste', async () => {
    await poser({ semaine: '2026-W20', jour: 'Lundi', seance: 'S1', groupe: 'GM101' });
    await poser({ semaine: '2026-W20', jour: 'Mardi', seance: 'S1', groupe: 'GM101' });
    // Le vendredi 18 est APRÈS la rentrée du 16 : celle-là doit passer.
    await poser({ semaine: '2026-W20', jour: 'Vendredi', seance: 'S1', groupe: 'GM101' });
    await gelerJusquAu('2026-09-16');

    const reponse = await request(app)
      .post(`/api/v2/seances/${SEMAINE}/importer`)
      .set('Cookie', cookies)
      .send({ depuis: '2026-W20' });

    expect(reponse.status).toBe(200);
    expect(reponse.body.importees).toBe(1);
    expect(reponse.body.refusees).toHaveLength(2);
    expect(reponse.body.refusees[0].motif).toContain('2026-09-16');

    const posees = await Seance.find({ semaine: SEMAINE }).lean();
    expect(posees.map((s) => s.jour)).toEqual(['Vendredi']);
  });

  it('refuse l’import quand AUCUNE séance ne peut être copiée', async () => {
    await poser({ semaine: '2026-W20', jour: 'Lundi', seance: 'S1', groupe: 'GM101' });
    await gelerJusquAu('2026-09-21');

    const reponse = await request(app)
      .post(`/api/v2/seances/${SEMAINE}/importer`)
      .set('Cookie', cookies)
      .send({ depuis: '2026-W20' });

    expect(reponse.status).toBe(409);
    expect(await Seance.countDocuments({ semaine: SEMAINE })).toBe(0);
  });

  /*
   * ⚠️ UN EXAMEN EST UN ACTE UNIQUE : on refuse TOUT, sans écarter au cas par
   * cas — en placer la moitié n'aurait aucun sens.
   */
  it('refuse un EFM planifié avant la rentrée du groupe', async () => {
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      { $set: { 'affectations.0.estRegional': true } }
    );
    await gelerJusquAu('2026-09-21');

    const reponse = await request(app)
      .post(`/api/v2/seances/${SEMAINE}/efm`)
      .set('Cookie', cookies)
      .send({
        date: '2026-09-14',
        jour: 'Lundi',
        groupe: 'GM101',
        module: 'M101',
        salle: 'A12',
        creneaux: ['S1'],
        surveillants: ['4211'],
      });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('AVANT_RENTREE');
    expect(Array.isArray(reponse.body.details)).toBe(true);
    expect(await Seance.countDocuments({})).toBe(0);
  });

  it('ne gèle RIEN tant qu’aucune rentrée n’est paramétrée', async () => {
    const reponse = await request(app)
      .put(`/api/v2/seances/${SEMAINE}/case`)
      .set('Cookie', cookies)
      .send({
        jour: 'Lundi',
        seance: 'S1',
        formateurMatricule: '9863',
        groupe: 'GM101',
        module: 'M101',
        salle: 'A12',
      });

    expect(reponse.status).toBe(200);
  });
});

/*
 * ═══ PUBLICATION DE LA SEMAINE ═══ ← `publish_timetable.php` +
 * `get_published_week.php` (2026-09-06, demande du porteur).
 *
 * Ce que la publication FAIT : elle désigne la semaine qui s'ouvre par défaut
 * chez le gestionnaire, le formateur et le stagiaire. Elle ne masque rien —
 * c'est déjà la sémantique de l'ancien EDT Pro, et le porteur l'a confirmée.
 */
describe('PUT / DELETE /seances/publication', () => {
  const publier = (semaine) =>
    request(app).put('/api/v2/seances/publication').set('Cookie', cookies).send({ semaine });

  it('publie une semaine et la rend dans le contexte', async () => {
    const reponse = await publier(SEMAINE);
    expect(reponse.status).toBe(200);
    expect(reponse.body.publication.semaine).toBe(SEMAINE);

    const contexte = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);
    expect(contexte.body.publication.semaine).toBe(SEMAINE);
  });

  /*
   * ⚠️ UNE SEULE PUBLICATION PAR ANNÉE : publier à nouveau REMPLACE, il ne
   * s'en accumule pas deux. C'est ce que faisait la transaction de l'existant
   * (dépublier tout, puis publier) — ici c'est l'unicité de l'entrée.
   */
  it('remplace la précédente au lieu d’en ajouter une seconde', async () => {
    await publier(SEMAINE);
    await publier('2026-W20');

    const etab = await Etablissement.findById(etablissement.id).lean();
    const pourLAnnee = etab.publications.filter((p) => p.anneeScolaire === ANNEE);
    expect(pourLAnnee).toHaveLength(1);
    expect(pourLAnnee[0].semaine).toBe('2026-W20');
  });

  /*
   * ⚠️⚠️ LE DÉFAUT DE L'EXISTANT QU'ON NE REPRODUIT PAS : `semaine_publiee`
   * était UNE colonne pour toutes les années — publier dans l'une effaçait la
   * publication de l'autre, sans que rien ne le dise.
   */
  it('⚠️ ne touche PAS la publication d’une autre année scolaire', async () => {
    await Etablissement.updateOne(
      { _id: etablissement.id },
      { $push: { publications: { anneeScolaire: 2025, semaine: '2025-W10', publieeLe: new Date() } } }
    );

    await publier(SEMAINE);

    const etab = await Etablissement.findById(etablissement.id).lean();
    expect(etab.publications.find((p) => p.anneeScolaire === 2025).semaine).toBe('2025-W10');
    expect(etab.publications.find((p) => p.anneeScolaire === ANNEE).semaine).toBe(SEMAINE);
  });

  /*
   * ⚠️ LE ZÉRO DE REMPLISSAGE EXISTE EN PRODUCTION (« 2026-W039 ») : l'ancien a
   * payé deux correctifs pour l'avoir laissé passer. On normalise à l'écriture.
   */
  it('normalise la valeur de semaine reçue', async () => {
    const reponse = await publier('2026-W039');
    expect(reponse.status).toBe(200);
    expect(reponse.body.publication.semaine).toBe('2026-W39');
  });

  it('refuse une semaine illisible', async () => {
    const reponse = await publier('la semaine prochaine');
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('SEMAINE_INVALIDE');
  });

  /*
   * ⚠️ ON NE CRÉE AUCUNE SÉANCE. `publish_timetable.php` INSÉRAIT une ligne
   * vide (`donnees_json = '{}'`) quand la semaine n'avait jamais été saisie :
   * il publiait ce qui n'existait pas. La publication ne décrit qu'un CHOIX.
   */
  it('ne crée aucune donnée pour une semaine jamais saisie', async () => {
    await publier('2026-W30');
    expect(await Seance.countDocuments({ semaine: '2026-W30' })).toBe(0);
  });

  it('dépublie, et seulement pour l’année courante', async () => {
    await Etablissement.updateOne(
      { _id: etablissement.id },
      { $push: { publications: { anneeScolaire: 2025, semaine: '2025-W10', publieeLe: new Date() } } }
    );
    await publier(SEMAINE);

    const reponse = await request(app)
      .delete('/api/v2/seances/publication')
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    const etab = await Etablissement.findById(etablissement.id).lean();
    expect(etab.publications.find((p) => p.anneeScolaire === ANNEE)).toBeUndefined();
    expect(etab.publications.find((p) => p.anneeScolaire === 2025).semaine).toBe('2025-W10');
  });

  /*
   * ═══ ⚠️ LE DIRECTEUR SEUL — et le routeur admet AUSSI le gestionnaire ═══
   * (décision du porteur, conforme à l'existant.) Sans le `requireRole` posé
   * PAR ROUTE, un gestionnaire publierait.
   */
  it('⚠️ refuse la publication à un gestionnaire', async () => {
    const gestionnaire = await User.create({
      nomComplet: 'Gestionnaire Test',
      email: 'gestionnaire@edtpro.ma',
      motDePasse: MOT_DE_PASSE,
      role: ROLES.GESTIONNAIRE,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
      etablissementIds: [etablissement.id],
    });

    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: 'gestionnaire@edtpro.ma', motDePasse: MOT_DE_PASSE });

    const reponse = await request(app)
      .put('/api/v2/seances/publication')
      .set('Cookie', connexion.headers['set-cookie'])
      .send({ semaine: SEMAINE });

    expect(reponse.status).toBe(403);
    expect(gestionnaire.role).toBe(ROLES.GESTIONNAIRE);
  });

  /*
   * ═══ ⚠️⚠️ LE DIRECTEUR N'EST PAS DÉPLACÉ PAR SA PROPRE PUBLICATION ═══
   * Il PRÉPARE ; le gestionnaire, lui, CONSULTE. Ouvrir le directeur sur la
   * semaine qu'il vient de publier lui ferait perdre le fil de sa saisie.
   */
  /*
   * ⚠️ LA DERNIÈRE SEMAINE DE L'ANNÉE (W52), pas une semaine du milieu : depuis
   * le 2026-09-14 une publication ne l'emporte que si elle est PLUS TARDIVE que
   * la semaine du jour. Une W20 aurait fait échouer ce test une fois la vraie
   * date passée mi-janvier ; aucune date réelle ne dépasse la W52.
   */
  it('⚠️ ouvre le GESTIONNAIRE sur la semaine publiée, pas le DIRECTEUR', async () => {
    await publier('2026-W52');

    const chezLeDirecteur = await request(app)
      .get('/api/v2/seances/semaines')
      .set('Cookie', cookies);
    expect(chezLeDirecteur.body.courante).not.toBe('2026-W52');
    // Il la voit tout de même — c'est une information, pas une contrainte.
    expect(chezLeDirecteur.body.publication.semaine).toBe('2026-W52');

    await User.create({
      nomComplet: 'Gestionnaire Vue',
      email: 'gestionnaire2@edtpro.ma',
      motDePasse: MOT_DE_PASSE,
      role: ROLES.GESTIONNAIRE,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
      etablissementIds: [etablissement.id],
    });
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: 'gestionnaire2@edtpro.ma', motDePasse: MOT_DE_PASSE });

    const chezLeGestionnaire = await request(app)
      .get('/api/v2/seances/semaines')
      .set('Cookie', connexion.headers['set-cookie']);
    expect(chezLeGestionnaire.body.courante).toBe('2026-W52');
  });
});

describe('POST /seances/:semaine/lot — un geste entier en une requête', () => {
  /*
   * ⚠️ POURQUOI CE LOT EXISTE : hébergé, chaque requête paie la latence
   * d'Internet, et coller trente cases en faisait soixante. Le lot ne change
   * AUCUNE règle — chaque opération traverse `poser` / `vider` — : ces tests
   * figent surtout qu'il ne les affaiblit pas.
   */
  const lot = (operations) =>
    request(app).post(`/api/v2/seances/${SEMAINE}/lot`).set('Cookie', cookies).send({ operations });

  const seance = (surcharges = {}) => ({
    jour: 'Lundi',
    seance: 'S1',
    periode: 'jour',
    formateurMatricule: '9863',
    groupe: 'GM101',
    module: 'M101',
    salle: 'A12',
    ...surcharges,
  });

  it('pose plusieurs cases d’un seul aller-retour', async () => {
    const reponse = await lot([
      { type: 'poser', cle: 'a', seance: seance({ seance: 'S1' }) },
      { type: 'poser', cle: 'b', seance: seance({ seance: 'S2' }) },
      { type: 'poser', cle: 'c', seance: seance({ jour: 'Mardi' }) },
    ]);

    expect(reponse.status).toBe(200);
    expect(reponse.body.resultats.map((r) => [r.cle, r.ok])).toEqual([
      ['a', true],
      ['b', true],
      ['c', true],
    ]);
    expect(await Seance.countDocuments({})).toBe(3);
  });

  it('⚠️ UN REFUS N’ARRÊTE PAS LE LOT, et il est NOMMÉ', async () => {
    await poser(); // Lundi S1, formateur 9863, GM101
    const reponse = await lot([
      { type: 'poser', cle: 'ok1', seance: seance({ seance: 'S2' }) },
      // Même formateur, même créneau que la séance déjà posée → conflit.
      { type: 'poser', cle: 'refusee', seance: seance({ groupe: 'GM102', module: 'M102', salle: 'B02' }) },
      { type: 'poser', cle: 'ok2', seance: seance({ jour: 'Mardi' }) },
    ]);

    expect(reponse.status).toBe(200);
    const [a, b, c] = reponse.body.resultats;
    expect(a.ok).toBe(true);
    expect(c.ok).toBe(true);
    expect(b).toMatchObject({ cle: 'refusee', ok: false });
    expect(b.erreur.code).toBe('CRENEAU_OCCUPE');
    expect(b.erreur.details.map((d) => d.type)).toContain('formateur');
    // Les deux autres sont bien entrées : la séance d'origine + deux nouvelles.
    expect(await Seance.countDocuments({})).toBe(3);
  });

  it('⚠️ un DÉPLACEMENT avec `id` déplace en place, sans doublon ni faux dépassement de quota', async () => {
    /*
     * Le module M101 est prévu pour 30 h. On le pose jusqu'à 100 % : un
     * déplacement ne change aucune heure au total, et ne doit donc pas être
     * pris pour un ajout.
     */
    const jours = ['Lundi', 'Mardi', 'Mercredi'];
    const creneaux = ['S1', 'S2', 'S3', 'S4'];
    let posees = 0;
    for (const jour of jours) {
      for (const creneau of creneaux) {
        if (posees === 12) break; // 12 × 2,5 h = 30 h
        await poser({ jour, seance: creneau, date: new Date('2026-09-14T00:00:00') });
        posees += 1;
      }
    }
    const origine = await Seance.findOne({ jour: 'Lundi', seance: 'S1' });

    const reponse = await lot([
      {
        type: 'deplacer',
        cle: 'vers',
        seance: seance({ id: origine.id, jour: 'Jeudi', seance: 'S1' }),
        source: { jour: 'Lundi', seance: 'S1', periode: 'jour', formateurMatricule: '9863' },
      },
    ]);

    expect(reponse.body.resultats[0]).toMatchObject({ cle: 'vers', ok: true });
    expect(await Seance.countDocuments({})).toBe(12);
    expect(await Seance.findOne({ jour: 'Lundi', seance: 'S1' })).toBeNull();
    expect((await Seance.findById(origine.id)).jour).toBe('Jeudi');
  });

  it('⚠️ un déplacement bloqué par la SEULE salle est posé SANS salle', async () => {
    const origine = await poser({ salle: 'B02' }); // Lundi S1
    await poser({
      seance: 'S2',
      formateurMatricule: '4211',
      groupe: 'GM102',
      module: 'M102',
      salle: 'B02',
    });

    const reponse = await lot([
      {
        type: 'deplacer',
        cle: 'vers',
        seance: seance({ id: origine.id, seance: 'S2', salle: 'B02' }),
        source: { jour: 'Lundi', seance: 'S1', periode: 'jour', formateurMatricule: '9863' },
      },
    ]);

    expect(reponse.body.resultats[0]).toMatchObject({ ok: true, salleRetiree: true });
    const deplacee = await Seance.findById(origine.id);
    expect(deplacee.seance).toBe('S2');
    expect(deplacee.salle).toBe('');
  });

  it('⚠️ mais JAMAIS si le formateur ou le groupe sont pris : le déplacement reste refusé', async () => {
    const origine = await poser({ salle: 'B02' }); // 9863 / GM101, Lundi S1
    await poser({
      seance: 'S2',
      formateurMatricule: '9863', // le même formateur, ailleurs au même créneau
      groupe: 'GM102',
      module: 'M102',
      salle: 'B02',
    });

    const reponse = await lot([
      {
        type: 'deplacer',
        cle: 'vers',
        seance: seance({ id: origine.id, seance: 'S2', salle: 'B02' }),
        source: { jour: 'Lundi', seance: 'S1', periode: 'jour', formateurMatricule: '9863' },
      },
    ]);

    expect(reponse.body.resultats[0].ok).toBe(false);
    // Et la séance n'a pas quitté sa place : la pose a échoué, le vidage n'a pas eu lieu.
    expect((await Seance.findById(origine.id)).seance).toBe('S1');
  });

  it('vide des cases, et vider une case déjà vide n’est pas une erreur', async () => {
    await poser();
    const reponse = await lot([
      {
        type: 'vider',
        cle: 'a',
        creneau: { jour: 'Lundi', seance: 'S1', periode: 'jour', formateurMatricule: '9863' },
      },
      {
        type: 'vider',
        cle: 'b',
        creneau: { jour: 'Lundi', seance: 'S1', periode: 'jour', formateurMatricule: '9863' },
      },
    ]);

    expect(reponse.body.resultats).toEqual([
      { cle: 'a', ok: true, inchangee: false },
      { cle: 'b', ok: true, inchangee: true },
    ]);
    expect(await Seance.countDocuments({})).toBe(0);
  });

  it('rejette un lot vide ou une opération incomplète', async () => {
    expect((await lot([])).status).toBe(400);
    expect((await lot([{ type: 'poser', cle: 'a' }])).status).toBe(400);
    expect((await lot([{ type: 'deplacer', cle: 'a', seance: seance() }])).status).toBe(400);
  });

  it('exige d’être connecté', async () => {
    const reponse = await request(app)
      .post(`/api/v2/seances/${SEMAINE}/lot`)
      .send({ operations: [{ type: 'poser', seance: seance() }] });
    expect(reponse.status).toBe(401);
  });
});
