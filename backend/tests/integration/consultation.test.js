import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Seance } from '../../src/models/Seance.js';
import { Stagiaire } from '../../src/models/Stagiaire.js';
import { Repartition } from '../../src/models/Repartition.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Sessions consultatives — formateur & stagiaire (F14).
 * ← emploiFormateur.html, emploiStagiaire.html, avancementFormateur.html,
 *   avancementStagiaire.html, affectationFormateur.html
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const SEMAINE = '2026-W3';

let etablissement;
let cookiesFormateur;
let cookiesStagiaire;
let cookiesDirecteur;

beforeEach(async () => {
  // ⚠️ `avancement()` interroge le calendrier des jours fériés, qui tente un
  // appel réseau réel (agendamaroc.com) s'il n'est pas stubé — même piège déjà
  // consigné dans `seances.test.js` et `avancement.test.js`.
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
    espaces: ['A12'],
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  const formateur = await User.create({
    nomComplet: 'BRAHIM LOURID',
    email: 'formateur@edtpro.ma',
    identifiant: '9863',
    motDePasse: MOT_DE_PASSE,
    role: ROLES.FORMATEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    etablissementIds: [etablissement.id],
  });

  const stagiaire = await User.create({
    nomComplet: 'YASSINE ALAOUI',
    email: 'stagiaire@edtpro.ma',
    identifiant: 'CEF001',
    motDePasse: MOT_DE_PASSE,
    role: ROLES.STAGIAIRE,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    etablissementIds: [etablissement.id],
  });

  await Stagiaire.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    matricule: 'CEF001',
    nom: 'ALAOUI',
    prenom: 'Yassine',
    groupes: ['GM101'],
    groupePrincipal: 'GM101',
  });

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [
      { matricule: '9863', nomComplet: 'BRAHIM LOURID' },
      { matricule: '4211', nomComplet: 'AHMED CHERKAOUI' },
    ],
    groupes: ['GM101', 'GM102'],
    affectations: [
      { formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
      { formateur: '4211', groupe: 'GM102', module: 'M102', type: TYPES_COURS.PRESENTIEL, s1Heures: 20 },
    ],
  });

  await Repartition.create({
    codeFiliereDrif: 'GM_GM_TS',
    secteur: 'Génie Mécanique',
    niveauFormation: 'TS',
    filiere: 'Génie Mécanique',
    anneeFormation: 1,
    codeModule: 'M101',
    module: 'Résistance des matériaux',
    creneau: 'CDJ',
  });

  // Le formateur 9863 : Lundi S1 sur GM101 — la sienne.
  await Seance.create({
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
    type: TYPES_COURS.PRESENTIEL,
  });
  // Le formateur 4211 : Mardi S1 sur GM102 — celle d'un COLLÈGUE.
  await Seance.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    semaine: SEMAINE,
    jour: 'Mardi',
    seance: 'S1',
    date: new Date('2026-09-15T00:00:00'),
    formateurMatricule: '4211',
    groupe: 'GM102',
    module: 'M102',
    salle: 'A12',
    type: TYPES_COURS.PRESENTIEL,
  });

  const connexion = async (email) =>
    (await request(app).post('/api/v2/auth/connexion').send({ identifiant: email, motDePasse: MOT_DE_PASSE }))
      .headers['set-cookie'];

  cookiesDirecteur = await connexion('directeur@edtpro.ma');
  cookiesFormateur = await connexion('formateur@edtpro.ma');
  cookiesStagiaire = await connexion('stagiaire@edtpro.ma');
});

describe('accès réservé au formateur et au stagiaire', () => {
  it('refuse un directeur (403)', async () => {
    const reponse = await request(app)
      .get('/api/v2/consultation/emploi/semaines')
      .set('Cookie', cookiesDirecteur);
    expect(reponse.status).toBe(403);
  });
});

describe('GET /consultation/emploi/:semaine — formateur', () => {
  it('ne rend que SES propres séances, jamais celles d’un collègue', async () => {
    const reponse = await request(app)
      .get(`/api/v2/consultation/emploi/${SEMAINE}`)
      .set('Cookie', cookiesFormateur);

    expect(reponse.status).toBe(200);
    expect(reponse.body.seances).toHaveLength(1);
    expect(reponse.body.seances[0].formateurMatricule).toBe('9863');
    expect(reponse.body.seances[0].groupe).toBe('GM101');
  });

  it('rend l’intitulé complet des modules qu’il porte, jamais ceux d’un collègue', async () => {
    const reponse = await request(app)
      .get(`/api/v2/consultation/emploi/${SEMAINE}`)
      .set('Cookie', cookiesFormateur);

    expect(reponse.body.modules).toEqual({ M101: 'Résistance des matériaux' });
  });
});

describe('GET /consultation/emploi/:semaine — stagiaire', () => {
  it('ne rend que les séances de SON groupe', async () => {
    const reponse = await request(app)
      .get(`/api/v2/consultation/emploi/${SEMAINE}`)
      .set('Cookie', cookiesStagiaire);

    expect(reponse.status).toBe(200);
    expect(reponse.body.seances).toHaveLength(1);
    expect(reponse.body.seances[0].groupe).toBe('GM101');
  });

  it('rend l’intitulé complet du module de SON groupe', async () => {
    const reponse = await request(app)
      .get(`/api/v2/consultation/emploi/${SEMAINE}`)
      .set('Cookie', cookiesStagiaire);

    expect(reponse.body.modules).toEqual({ M101: 'Résistance des matériaux' });
  });

  it('rend aussi une séance mutualisée dont son groupe fait partie', async () => {
    await Seance.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      semaine: SEMAINE,
      jour: 'Mercredi',
      seance: 'S1',
      date: new Date('2026-09-16T00:00:00'),
      formateurMatricule: '9863',
      groupe: 'GM101 GM102',
      module: 'M101',
      salle: 'TEAMS',
      type: TYPES_COURS.SYNCHRONE,
    });

    const reponse = await request(app)
      .get(`/api/v2/consultation/emploi/${SEMAINE}`)
      .set('Cookie', cookiesStagiaire);

    expect(reponse.body.seances.map((s) => s.groupe)).toContain('GM101 GM102');
  });
});

describe('GET /consultation/groupes', () => {
  it('rend les groupes du stagiaire connecté', async () => {
    const reponse = await request(app).get('/api/v2/consultation/groupes').set('Cookie', cookiesStagiaire);

    expect(reponse.status).toBe(200);
    expect(reponse.body.groupes).toEqual(['GM101']);
    expect(reponse.body.groupePrincipal).toBe('GM101');
  });

  /*
   * Une base Konosys par année (2026-09-14) : celle de l'année consultée fait
   * foi ; à défaut, la plus récente où le stagiaire figure — sans quoi une
   * rentrée pas encore importée lui rendrait « aucune fiche ».
   */
  it("prend la base de l'année consultée, et la plus récente à défaut", async () => {
    await Stagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE + 1,
      matricule: 'CEF001',
      groupes: ['GM201'],
      groupePrincipal: 'GM201',
    });

    const suivante = await request(app)
      .get('/api/v2/consultation/groupes')
      .set('Cookie', cookiesStagiaire)
      .set('X-Annee-Scolaire', String(ANNEE + 1));
    expect(suivante.body.groupes).toEqual(['GM201']);

    const enCours = await request(app).get('/api/v2/consultation/groupes').set('Cookie', cookiesStagiaire);
    expect(enCours.body.groupes).toEqual(['GM101']);

    const sansBase = await request(app)
      .get('/api/v2/consultation/groupes')
      .set('Cookie', cookiesStagiaire)
      .set('X-Annee-Scolaire', String(ANNEE + 2));
    expect(sansBase.body.groupes).toEqual(['GM201']);
  });

  it('refuse un formateur (403) — il n’est INSCRIT à aucun groupe', async () => {
    const reponse = await request(app).get('/api/v2/consultation/groupes').set('Cookie', cookiesFormateur);
    expect(reponse.status).toBe(403);
  });
});

describe('GET /consultation/affectations — formateur seul', () => {
  it('rend SES affectations, avec l’intitulé résolu', async () => {
    const reponse = await request(app)
      .get('/api/v2/consultation/affectations')
      .set('Cookie', cookiesFormateur);

    expect(reponse.status).toBe(200);
    expect(reponse.body.affectations).toEqual([
      expect.objectContaining({
        groupe: 'GM101',
        module: 'M101',
        intitule: 'Résistance des matériaux',
        heuresS1: 30,
        // Le présentiel et le synchrone se lisent sur la même ligne, comme sur
        // « Programme » — et le semestre s'en DÉDUIT.
        presentiel: 30,
        synchrone: 0,
        semestre: 'S1',
      }),
    ]);
  });

  /*
   * ═══ ⚠️ LE POINT QUI COMPTE : LA FUSION N'EST PAS ÉCLATÉE ═══
   * Une affectation synchrone porte le libellé de l'ENSEMBLE. Côté stagiaire,
   * `programmeStagiaire` l'éclate — le groupe reçoit bien ces heures. Côté
   * formateur, il ne la donne QU'UNE FOIS : l'éclater ferait deux lignes, donc
   * une charge synchrone doublée dans les totaux de l'écran. C'est le défaut
   * déjà corrigé quatre fois ailleurs.
   */
  it('garde le libellé d’ensemble d’une séance mutualisée — une seule ligne', async () => {
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      {
        $push: {
          affectations: {
            formateur: '9863',
            groupe: 'GM101 GM102',
            module: 'M110',
            type: TYPES_COURS.SYNCHRONE,
            s1Heures: 10,
            s2Heures: 5,
          },
        },
      }
    );

    const reponse = await request(app)
      .get('/api/v2/consultation/affectations')
      .set('Cookie', cookiesFormateur);

    const mutualisee = reponse.body.affectations.filter((a) => a.module === 'M110');
    expect(mutualisee).toHaveLength(1);
    expect(mutualisee[0]).toMatchObject({
      groupe: 'GM101 GM102',
      synchrone: 15,
      presentiel: 0,
      // 10 h en S1 et 5 h en S2 : le module s'étale sur l'année.
      semestre: 'A',
    });
  });

  it('réunit le présentiel et le synchrone du même module sur UNE ligne', async () => {
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      {
        $push: {
          affectations: {
            formateur: '9863',
            groupe: 'GM101',
            module: 'M101',
            type: TYPES_COURS.SYNCHRONE,
            s1Heures: 8,
          },
        },
      }
    );

    const reponse = await request(app)
      .get('/api/v2/consultation/affectations')
      .set('Cookie', cookiesFormateur);

    const lignes = reponse.body.affectations.filter((a) => a.module === 'M101');
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ presentiel: 30, synchrone: 8 });
  });

  it('refuse un stagiaire (403)', async () => {
    const reponse = await request(app)
      .get('/api/v2/consultation/affectations')
      .set('Cookie', cookiesStagiaire);
    expect(reponse.status).toBe(403);
  });
});

describe('GET /consultation/programme — stagiaire seul', () => {
  it('rend les modules de SON groupe, intitulé et formateur résolus', async () => {
    const reponse = await request(app)
      .get('/api/v2/consultation/programme')
      .set('Cookie', cookiesStagiaire);

    expect(reponse.status).toBe(200);
    expect(reponse.body.groupes).toEqual(['GM101']);
    expect(reponse.body.modules).toHaveLength(1);
    expect(reponse.body.modules[0]).toMatchObject({
      groupe: 'GM101',
      module: 'M101',
      // ⚠️ Le champ lisible de `Repartition` s'appelle `module`, pas `intitule`.
      intitule: 'Résistance des matériaux',
      // Le NOM, pas le matricule « 9863 » que porte l'affectation.
      formateurPresentiel: 'BRAHIM LOURID',
      presentiel: 30,
      synchrone: 0,
      // 30 h en S1, rien en S2 : le semestre se déduit des masses.
      semestre: 'S1',
    });

    // Le module d'un AUTRE groupe n'a rien à faire dans son programme.
    expect(reponse.body.modules.map((m) => m.module)).not.toContain('M102');
  });

  /*
   * ⚠️ LE CAS QUI CASSE SI `separerFusion` DISPARAÎT : une affectation synchrone
   * porte le libellé de l'ENSEMBLE (« GM101 GM102 »). Comparée telle quelle à
   * « GM101 », elle ne correspondrait à rien — et TOUS les modules à distance
   * disparaîtraient du programme, sans la moindre erreur.
   */
  it('retient un module SYNCHRONE mutualisé, dont son groupe fait partie', async () => {
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      {
        $push: {
          affectations: {
            formateur: '4211',
            groupe: 'GM101 GM102',
            module: 'M108',
            type: TYPES_COURS.SYNCHRONE,
            s1Heures: 10,
            s2Heures: 5,
          },
        },
      }
    );

    const reponse = await request(app)
      .get('/api/v2/consultation/programme')
      .set('Cookie', cookiesStagiaire);

    const mutualise = reponse.body.modules.find((m) => m.module === 'M108');
    expect(mutualise).toMatchObject({
      groupe: 'GM101',
      formateurSynchrone: 'AHMED CHERKAOUI',
      synchrone: 15,
      presentiel: 0,
      // Des heures des deux côtés : le module est ANNUEL.
      semestre: 'A',
    });
    // Aucun intitulé au référentiel : la page affichera le code seul, sans mentir.
    expect(mutualise.intitule).toBe('');
  });

  it('refuse un formateur (403) — « Mes affectations » est SA question', async () => {
    const reponse = await request(app)
      .get('/api/v2/consultation/programme')
      .set('Cookie', cookiesFormateur);

    expect(reponse.status).toBe(403);
  });
});

describe('GET /consultation/avancement — formateur', () => {
  it('ne rend que ses propres lignes, jamais celles d’un collègue', async () => {
    const reponse = await request(app)
      .get('/api/v2/consultation/avancement')
      .set('Cookie', cookiesFormateur);

    expect(reponse.status).toBe(200);
    const groupes = reponse.body.faces.edtpro.map((l) => l.groupe);
    expect(groupes).toContain('GM101');
    expect(groupes).not.toContain('GM102');
    // Sa seule masse statutaire, jamais celle d'un collègue.
    expect(Object.keys(reponse.body.statutaires)).not.toContain('AHMED CHERKAOUI');
  });
});

describe('GET /consultation/avancement — stagiaire', () => {
  it('ne rend que les lignes de son groupe', async () => {
    const reponse = await request(app)
      .get('/api/v2/consultation/avancement')
      .set('Cookie', cookiesStagiaire);

    expect(reponse.status).toBe(200);
    const groupes = reponse.body.faces.edtpro.map((l) => l.groupe);
    expect(groupes).toEqual(['GM101']);
    expect(reponse.body.statutaires).toEqual({});
  });
});

/**
 * ═══ LE RÉALISÉ eDTpro DES SESSIONS = LES SÉANCES TERMINÉES ═══ (2026-09-12.)
 * La séance du formateur est le lundi 14/09 en S1 (08:30-11:00). À 10:00 elle
 * n'a pas encore eu lieu en entier : elle ne compte pas — là où la borne de fin
 * de semaine de la page du directeur l'aurait déjà comptée. À 11:00, elle compte.
 *
 * ⚠️ LA SESSION SE REFAIT SOUS L'HORLOGE FEINTE (jeton de quinze minutes), et
 * `shouldAdvanceTime` garde vivantes les minuteries de mongodb-memory-server —
 * les deux pièges déjà consignés dans `avancement.test.js`.
 */
async function avancementDuFormateurA(date) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(date);
  try {
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: 'formateur@edtpro.ma', motDePasse: MOT_DE_PASSE });
    return await request(app)
      .get('/api/v2/consultation/avancement')
      .set('Cookie', connexion.headers['set-cookie']);
  } finally {
    vi.useRealTimers();
  }
}

const realiseDe = (reponse) =>
  reponse.body.faces.edtpro.reduce((somme, l) => somme + (l.realisePresentiel ?? 0), 0);

describe('GET /consultation/avancement — séances terminées seulement', () => {
  it('ne compte pas une séance du jour dont l’horaire n’est pas échu', async () => {
    const reponse = await avancementDuFormateurA(new Date(2026, 8, 14, 10, 0));
    expect(reponse.status).toBe(200);
    expect(realiseDe(reponse)).toBe(0);
    expect(reponse.body.seancesTermineesAu).toEqual({ date: '2026-09-14', heure: '10:00' });
  });

  it('la compte dès la fin de son horaire officiel', async () => {
    const reponse = await avancementDuFormateurA(new Date(2026, 8, 14, 11, 0));
    expect(realiseDe(reponse)).toBe(2.5);
  });

  it('rend AUSSI la face e-note, filtrée à la personne', async () => {
    const reponse = await avancementDuFormateurA(new Date(2026, 8, 14, 11, 0));
    expect(Array.isArray(reponse.body.faces.enote)).toBe(true);
  });
});

/**
 * ═══ CONNEXION : E-MAIL OU MATRICULE (formateur), E-MAIL OU CEF (stagiaire) ═══
 * (2026-09-12, demande du porteur.) `connecter` interroge DÉJÀ
 * `email OU identifiant` (← `login.php:73`) : ces tests figent que les DEUX
 * portes s'ouvrent pour les deux rôles, et sur le MÊME compte.
 */
describe('POST /auth/connexion — e-mail ou identifiant', () => {
  const connecter = (identifiant) =>
    request(app).post('/api/v2/auth/connexion').send({ identifiant, motDePasse: MOT_DE_PASSE });

  it('un formateur entre avec son MATRICULE ou son e-mail', async () => {
    const parMatricule = await connecter('9863');
    const parEmail = await connecter('formateur@edtpro.ma');
    expect(parMatricule.status).toBe(200);
    expect(parEmail.status).toBe(200);
    expect(parMatricule.body.utilisateur.id).toBe(parEmail.body.utilisateur.id);
  });

  it('un stagiaire entre avec son CEF ou son e-mail', async () => {
    const parCef = await connecter('CEF001');
    const parEmail = await connecter('stagiaire@edtpro.ma');
    expect(parCef.status).toBe(200);
    expect(parEmail.status).toBe(200);
    expect(parCef.body.utilisateur.id).toBe(parEmail.body.utilisateur.id);
  });

  it('tolère les espaces autour et les majuscules de l’e-mail', async () => {
    expect((await connecter('  9863 ')).status).toBe(200);
    expect((await connecter(' Formateur@EDTPRO.ma ')).status).toBe(200);
  });

  it('refuse un matricule inconnu avec le message commun', async () => {
    const reponse = await connecter('0000');
    expect(reponse.status).toBe(401);
    expect(reponse.body.code ?? reponse.body.erreur?.code).toBe('IDENTIFIANTS_INVALIDES');
  });
});

/**
 * ═══ PAS DE CODE « NOUVEL APPAREIL » POUR FORMATEUR ET STAGIAIRE ═══
 * (2026-09-12, décision du porteur.) Leur adresse est déduite ou fabriquée, le
 * code partait dans le vide. Directeur, gestionnaire et admin le gardent.
 */
describe('POST /auth/connexion — vérification d’appareil selon le rôle', () => {
  const PC = { nom: 'Windows PC', navigateur: 'Chrome', os: 'Windows', type: 'desktop' };
  const TELEPHONE = { nom: 'Android', navigateur: 'Chrome', os: 'Android', type: 'mobile' };
  const connecter = (identifiant, appareil) =>
    request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant, motDePasse: MOT_DE_PASSE, appareil });

  it.each([
    ['formateur', '9863'],
    ['stagiaire', 'CEF001'],
  ])('un %s entre directement depuis un second appareil', async (_role, identifiant) => {
    expect((await connecter(identifiant, PC)).body.action).toBe('connecte');

    const depuisTelephone = await connecter(identifiant, TELEPHONE);
    expect(depuisTelephone.status).toBe(200);
    expect(depuisTelephone.body.action).toBe('connecte');
    expect(depuisTelephone.headers['set-cookie']?.join(';')).toMatch(/edt_access=/);
  });

  it('un directeur reçoit toujours le code depuis un second appareil', async () => {
    // Sa première session est ouverte par le `beforeEach`, sans appareil déclaré :
    // ce même appareil par défaut reste reconnu, le téléphone ne l'est pas.
    expect((await connecter('directeur@edtpro.ma')).body.action).toBe('connecte');

    const depuisTelephone = await connecter('directeur@edtpro.ma', TELEPHONE);
    expect(depuisTelephone.status).toBe(200);
    expect(depuisTelephone.body.action).toBe('verification_appareil');
    expect(depuisTelephone.headers['set-cookie']?.join(';') ?? '').not.toMatch(/edt_access=/);
  });
});
