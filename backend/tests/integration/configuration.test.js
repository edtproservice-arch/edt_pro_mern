import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { JoursFeriesNationaux } from '../../src/models/JoursFeriesNationaux.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';
import { Base } from '../../src/models/Base.js';
import { CalendrierNational } from '../../src/models/CalendrierNational.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Parcours de configuration initiale (F3).
 * ← api/setup/complete_setup.php + public/setup.html
 *
 * Ce qui est vérifié ici et n'existait pas en PHP : chaque étape écrit la
 * sienne. `complete_setup.php` n'écrivait qu'à la toute fin, en un appel — une
 * fermeture d'onglet à l'étape 3 perdait l'import.
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;

let directeur;
let etablissement;
let cookies;

async function classeurEnote(formateurs) {
  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet('Avancement');

  const entete = new Array(51).fill('');
  entete[8] = 'Groupe';
  feuille.addRow(entete);

  formateurs.forEach(({ matricule, nom }, index) => {
    const ligne = new Array(51).fill('');
    ligne[4] = 'DEVOWFS_S';
    ligne[8] = `DEV10${index + 1}`;
    ligne[15] = 'RES';
    ligne[16] = `M10${index + 1}`;
    ligne[19] = matricule;
    ligne[20] = nom;
    ligne[23] = '30';
    ligne[27] = '30';
    ligne[35] = '60';
    feuille.addRow(ligne);
  });

  return Buffer.from(await classeur.xlsx.writeBuffer());
}

beforeEach(async () => {
  // Le cache mémoire vit dans le processus, pas dans la base : sans ce
  // nettoyage, un test sert la valeur retenue par le précédent.
  oublierMemoire();

  directeur = await User.create({
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
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Étape 2 — corrections des formateurs', () => {
  beforeEach(async () => {
    const fichier = await classeurEnote([
      { matricule: '9863', nom: 'AHMED CHERKAOUI' },
      { matricule: '', nom: 'FATIMA ZAHRA BENALI' },
    ]);

    await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', fichier, 'base.xlsx');
  });

  it('applique adresse, matricule et masse horaire en un seul appel', async () => {
    const reponse = await request(app)
      .patch('/api/v2/base/formateurs')
      .set('Cookie', cookies)
      .send({
        formateurs: [
          { nomComplet: 'AHMED CHERKAOUI', email: 'a.cherkaoui@ofppt.ma', masseHoraire: 720 },
          // Le matricule manquant est précisément ce que cet écran sert à saisir.
          { nomComplet: 'FATIMA ZAHRA BENALI', matricule: '10241' },
        ],
      });

    expect(reponse.status).toBe(200);
    expect(reponse.body.corriges).toBe(2);

    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: ANNEE });
    const ahmed = base.formateurs.find((f) => f.nomComplet === 'AHMED CHERKAOUI');
    const fatima = base.formateurs.find((f) => f.nomComplet === 'FATIMA ZAHRA BENALI');

    expect(ahmed.email).toBe('a.cherkaoui@ofppt.ma');
    expect(ahmed.masseHoraire).toBe(720);
    expect(fatima.matricule).toBe('10241');
  });

  it("n'applique rien quand un seul formateur du lot est inconnu", async () => {
    const reponse = await request(app)
      .patch('/api/v2/base/formateurs')
      .set('Cookie', cookies)
      .send({
        formateurs: [
          { nomComplet: 'AHMED CHERKAOUI', masseHoraire: 500 },
          { nomComplet: 'INCONNU AU BATAILLON', masseHoraire: 500 },
        ],
      });

    expect(reponse.status).toBe(404);

    // Le lot est refusé en bloc : une application partielle laisserait le
    // directeur croire ses deux corrections enregistrées.
    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: ANNEE });
    expect(base.formateurs.find((f) => f.nomComplet === 'AHMED CHERKAOUI').masseHoraire).toBe(60);
  });

  it('refuse une adresse mal formée', async () => {
    const reponse = await request(app)
      .patch('/api/v2/base/formateurs')
      .set('Cookie', cookies)
      .send({ formateurs: [{ nomComplet: 'AHMED CHERKAOUI', email: 'pas-une-adresse' }] });

    expect(reponse.status).toBe(400);
  });
});

describe('Étape 3 — calendrier', () => {
  /** Réponse d'api.aladhan.com pour un mois, réduite à ce que le service lit. */
  function moisAladhan(jours) {
    return {
      ok: true,
      json: async () => ({
        code: 200,
        data: jours.map(({ date, fetes }) => ({
          gregorian: { date },
          hijri: { holidays: fetes },
        })),
      }),
    };
  }

  it("compose les fériés civils et religieux, et met le résultat en cache", async () => {
    const appels = vi.fn(async (url) =>
      // Une seule des 24 requêtes porte une fête, les autres sont vides.
      String(url).endsWith('/3/2027')
        ? moisAladhan([{ date: '20-03-2027', fetes: ['Eid-ul-Fitr'] }])
        : moisAladhan([])
    );
    vi.stubGlobal('fetch', appels);

    const reponse = await request(app)
      .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    // 2 appels à agendamaroc — qui ne rend rien d'exploitable ici — puis le
    // repli : 12 mois × 2 années civiles sur aladhan.
    expect(appels).toHaveBeenCalledTimes(26);

    const libelles = reponse.body.joursFeries.map((j) => j.intitule);
    expect(libelles).toContain('Fête du Trône');
    expect(libelles).toContain('Aïd Al Fitr');
    // La fête compte deux jours : le second est déduit, comme en PHP.
    expect(reponse.body.joursFeries).toContainEqual(
      expect.objectContaining({ date: '2027-03-21', intitule: 'Aïd Al Fitr (2e jour)' })
    );

    // Second appel : le cache répond, l'API n'est plus sollicitée.
    await request(app).get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`).set('Cookie', cookies);
    expect(appels).toHaveBeenCalledTimes(26);
  });

  /*
   * Les fériés doivent tomber DANS l'année scolaire, pas dans les deux années
   * civiles qu'elle chevauche.
   *
   * Le filtre portait sur `2026-01-01` -> `2027-12-31` : l'ecran affichait
   * 34 dates au lieu de 17, dont janvier à août 2026 — antérieures à la
   * rentrée — et septembre à décembre 2027, postérieures à la sortie.
   */
  /*
   * agendamaroc.com est la source PRINCIPALE : un appel par année civile, avec
   * les intitulés officiels (fr + ar) et `variable`, qui distingue enfin une
   * estimation lunaire d'une date fixe.
   */
  it("prend les fériés officiels, avec l'arabe et le drapeau d'estimation", async () => {
    const reponseApi = (annee) => ({
      ok: true,
      json: async () => ({
        year: annee,
        holidays: [
          { date: `${annee}-01-01`, name_fr: "Jour de l'An", name_ar: 'AR-NOUVEL-AN',
            type: 'national', variable: false },
          { date: `${annee}-03-20`, name_fr: 'Aid al-Fitr', name_ar: 'AR-AID',
            type: 'religieux', variable: true },
        ],
      }),
    });

    const appels = vi.fn(async (url) => reponseApi(String(url).includes('year=2027') ? 2027 : 2026));
    vi.stubGlobal('fetch', appels);

    const reponse = await request(app)
      .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    // Une requête par année civile, contre 24 avec aladhan.
    expect(appels).toHaveBeenCalledTimes(2);

    const parIntitule = new Map(reponse.body.joursFeries.map((j) => [j.intitule, j]));

    // L'arabe accompagne le français.
    expect(parIntitule.get("Jour de l'An")).toMatchObject({
      intituleAr: 'AR-NOUVEL-AN',
      type: 'national',
    });

    /*
     * LE point : une date FIXE n'est pas une estimation. `estime` valait
     * `origine === 'api'`, donc vrai partout — « Nouvel An (estimé) » —, ce qui
     * privait la mention de tout sens.
     */
    expect(parIntitule.get("Jour de l'An").estime).toBe(false);
    expect(parIntitule.get('Aid al-Fitr')).toMatchObject({ estime: true, intituleAr: 'AR-AID' });
  });

  it("retombe sur l'ancienne chaîne quand l'API refuse l'année", async () => {
    // agendamaroc ne sert que 2026-2028 et répond 200 avec `{error}` ailleurs :
    // le statut HTTP ne suffit pas à valider la réponse.
    const appels = vi.fn(async (url) =>
      String(url).includes('agendamaroc')
        ? { ok: true, json: async () => ({ error: 'Year not supported' }) }
        : moisAladhan([])
    );
    vi.stubGlobal('fetch', appels);

    const reponse = await request(app)
      .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    // Les fériés civils codés prennent le relais, sans arabe mais complets.
    const libelles = reponse.body.joursFeries.map((j) => j.intitule);
    expect(libelles).toContain('Fête du Trône');
  });

  /*
   * Un cache écrit par une version antérieure de la règle doit être RECONSTRUIT,
   * même s'il est frais.
   *
   * Sans ce garde-fou, le correctif du filtre — deux années civiles au lieu de
   * l'année scolaire — n'atteignait pas les documents déjà écrits : ils
   * continuaient de rendre 34 dates pendant 30 jours.
   */
  it("ignore un cache produit par une version antérieure de la règle", async () => {
    await JoursFeriesNationaux.create({
      anneeScolaire: ANNEE,
      jours: [{ date: `${ANNEE}-01-01`, libelle: 'PERIME' }],
      complet: true,
      recupereLe: new Date(),
      version: 0,
    });

    const appels = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        year: 2026,
        holidays: [
          { date: '2026-11-18', name_fr: 'FRAIS', name_ar: 'AR', type: 'national', variable: false },
        ],
      }),
    }));
    vi.stubGlobal('fetch', appels);

    const reponse = await request(app)
      .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
      .set('Cookie', cookies);

    const libelles = reponse.body.joursFeries.map((j) => j.intitule);
    expect(libelles).not.toContain('PERIME');
    expect(libelles).toContain('FRAIS');

    // Et le document est réécrit à la version courante.
    const enBase = await JoursFeriesNationaux.findOne({ anneeScolaire: ANNEE });
    expect(enBase.version).toBe(1);
  });

  it("ne retient que les fériés de l'année scolaire", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => moisAladhan([])));

    const reponse = await request(app)
      .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
      .set('Cookie', cookies);

    const dates = reponse.body.joursFeries.map((j) => j.date);

    // 2026-2027 s'ouvre le lundi de la semaine du 1er septembre 2026.
    expect(dates.every((date) => date >= '2026-08-31' && date <= '2027-08-29')).toBe(true);

    // Le 1er janvier de CHAQUE année civile existe, mais un seul est dans
    // l'année scolaire.
    expect(dates).toContain('2027-01-01');
    expect(dates).not.toContain('2026-01-01');

    // La Fête du Trône du 30 juillet : celle de 2027, pas celle de 2026.
    expect(dates).toContain('2027-07-30');
    expect(dates).not.toContain('2026-07-30');
  });

  it("réessaie un mois tombé plutôt que d'amputer l'année", async () => {
    let premiereTentative = true;
    const appels = vi.fn(async (url) => {
      if (String(url).endsWith('/3/2027')) {
        // Premier appel en échec, comme observé sur l'API réelle : sans
        // reprise, l'Aïd Al Fitr disparaît du calendrier.
        if (premiereTentative) {
          premiereTentative = false;
          throw new Error('coupure passagère');
        }
        return moisAladhan([{ date: '20-03-2027', fetes: ['Eid-ul-Fitr'] }]);
      }
      return moisAladhan([]);
    });
    vi.stubGlobal('fetch', appels);

    const reponse = await request(app)
      .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
      .set('Cookie', cookies);

    expect(reponse.body.joursFeries.map((j) => j.intitule)).toContain('Aïd Al Fitr');
    expect(reponse.body.complet).toBe(true);
  });

  it("conserve un cache complet quand une récupération revient amputée", async () => {
    await JoursFeriesNationaux.create({
      anneeScolaire: ANNEE,
      jours: [{ date: '2027-03-20', libelle: 'Aïd Al Fitr' }],
      complet: true,
      recupereLe: new Date('2020-01-01'), // périmé : une récupération sera tentée
      version: 1,
    });

    // Un seul mois reste muet, y compris à la reprise. Le remplacer par une
    // année sans l'Aïd la figerait 30 jours — c'est le défaut mesuré.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/3/2027')) throw new Error('injoignable');
      return moisAladhan([]);
    }));

    const reponse = await request(app)
      .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
      .set('Cookie', cookies);

    expect(reponse.body.joursFeries).toHaveLength(1);
    expect(reponse.body.joursFeries[0].intitule).toBe('Aïd Al Fitr');

    const cache = await JoursFeriesNationaux.findOne({ anneeScolaire: ANNEE });
    expect(cache.jours).toHaveLength(1); // rien n'a été écrasé
  });

  it("sert le cache périmé plutôt qu'une liste amputée quand l'API est en panne", async () => {
    await JoursFeriesNationaux.create({
      anneeScolaire: ANNEE,
      jours: [{ date: '2027-03-20', libelle: 'Aïd Al Fitr' }],
      complet: true,
      recupereLe: new Date('2020-01-01'), // largement périmé
      version: 1,
    });

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('réseau injoignable');
    }));

    const reponse = await request(app)
      .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.joursFeries).toHaveLength(1);
    expect(reponse.body.joursFeries[0].intitule).toBe('Aïd Al Fitr');
  });

  it('conserve un ajustement de date au rafraîchissement des estimations', async () => {
    // L'API annonce l'Aïd le 20 ; elle continuera de l'annoncer ainsi au
    // prochain appel. C'est tout l'enjeu : sa correction ne doit pas être
    // écrasée par une source qui, elle, ne la connaît pas.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).includes('agendamaroc')
          ? {
              ok: true,
              json: async () => ({
                year: 2027,
                holidays: [
                  { date: '2027-03-20', name_fr: 'Aïd Al Fitr', name_ar: 'AR',
                    type: 'religieux', variable: true },
                ],
              }),
            }
          : moisAladhan([])
      )
    );

    // L'établissement décale la fête d'un jour, comme l'annonce officielle.
    await request(app)
      .put('/api/v2/calendrier')
      .set('Cookie', cookies)
      .send({ ajustementsFeries: [{ libelle: 'Aïd Al Fitr', date: '2027-03-21' }] });

    const reponse = await request(app)
      .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
      .set('Cookie', cookies);

    const aid = reponse.body.joursFeries.find((j) => j.intitule === 'Aïd Al Fitr');

    expect(aid).toMatchObject({
      // Le 21 retenu, pas le 20 que l'API vient de renvoyer.
      date: '2027-03-21',
      // Une date corrigée par l'établissement n'est plus une estimation :
      // c'est une décision.
      estime: false,
      origine: 'ajuste',
    });
  });

  it('enregistre les vacances et remet une période saisie à l\'envers dans le bon sens', async () => {
    const reponse = await request(app)
      .put('/api/v2/calendrier')
      .set('Cookie', cookies)
      .send({
        vacances: [
          { intitule: 'Toussaint', debut: '2026-10-25', fin: '2026-11-01' },
          { intitule: 'Inversée', debut: '2027-01-10', fin: '2027-01-03' },
        ],
      });

    expect(reponse.status).toBe(200);
    expect(reponse.body.vacances).toEqual([
      { intitule: 'Toussaint', debut: '2026-10-25', fin: '2026-11-01' },
      { intitule: 'Inversée', debut: '2027-01-03', fin: '2027-01-10' },
    ]);
  });

  /*
   * ═══ LES VACANCES DU RÉSEAU, ET LE DROIT D'EN ÉCARTER UNE ═══
   * (demande du porteur, 2026-09-02.)
   */
  it('rend les périodes NATIONALES à côté des siennes', async () => {
    await CalendrierNational.create({
      anneeScolaire: ANNEE,
      vacances: [{ nom: 'Toussaint nationale', debut: '2026-10-26', fin: '2026-11-01' }],
      rentrees: [],
    });

    const reponse = await request(app).get('/api/v2/calendrier').set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.nationales).toEqual([
      { intitule: 'Toussaint nationale', debut: '2026-10-26', fin: '2026-11-01' },
    ]);
    expect(reponse.body.ecartees).toEqual([]);
  });

  /*
   * ⚠️⚠️ LE REMPLACEMENT DU CALENDRIER EST COMPLET : tout champ non réécrit est
   * PERDU. Sans reprise explicite, une simple modification de vacances
   * remettrait à l'écran toutes les périodes nationales que l'établissement
   * avait mises de côté — sans que rien ne le signale.
   */
  it('CONSERVE les périodes écartées quand l’appelant ne les mentionne pas', async () => {
    await request(app)
      .put('/api/v2/calendrier')
      .set('Cookie', cookies)
      .send({ vacancesEcartees: ['Toussaint nationale'] })
      .expect(200);

    const reponse = await request(app)
      .put('/api/v2/calendrier')
      .set('Cookie', cookies)
      .send({ vacances: [{ intitule: 'Mes vacances', debut: '2027-02-01', fin: '2027-02-07' }] });

    expect(reponse.status).toBe(200);
    expect(reponse.body.ecartees).toEqual(['Toussaint nationale']);
  });

  it('EFFACE les périodes écartées sur un tableau vide — c’est un choix explicite', async () => {
    await request(app)
      .put('/api/v2/calendrier')
      .set('Cookie', cookies)
      .send({ vacancesEcartees: ['Toussaint nationale'] })
      .expect(200);

    const reponse = await request(app)
      .put('/api/v2/calendrier')
      .set('Cookie', cookies)
      .send({ vacancesEcartees: [] });

    expect(reponse.body.ecartees).toEqual([]);
  });

  it('refuse un ajustement sans date qui ne supprime rien', async () => {
    const reponse = await request(app)
      .put('/api/v2/calendrier')
      .set('Cookie', cookies)
      .send({ ajustementsFeries: [{ libelle: 'Aïd Al Fitr' }] });

    expect(reponse.status).toBe(400);
  });

  /*
   * ═══ ⚠️⚠️ LA LECTURE S'OUVRE AUX SESSIONS CONSULTATIVES — corrigé le
   * 2026-09-04, signalé par le porteur (403 en console sur « Mon emploi du
   * temps » d'un formateur réel) ═══
   *
   * `SelecteurSemaine.jsx` — partagé entre la grille du directeur et les
   * sessions formateur/stagiaire (F14) — interroge CES DEUX ROUTES pour
   * colorer son calendrier de choix, quel que soit qui le regarde. Restreintes
   * au directeur et au gestionnaire, elles répondaient 403 en silence dès
   * qu'un formateur ouvrait le sélecteur — aucun test existant ne pouvait le
   * voir, ce composant n'ayant jamais été appelé par un rôle restreint avant
   * F14.
   */
  it('reste lisible par un formateur et un stagiaire, mais pas modifiable', async () => {
    const formateur = await User.create({
      nomComplet: 'BRAHIM LOURID',
      email: 'formateur-lecture@edtpro.ma',
      identifiant: '9863',
      motDePasse: MOT_DE_PASSE,
      role: ROLES.FORMATEUR,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
      etablissementIds: [etablissement.id],
    });

    const stagiaire = await User.create({
      nomComplet: 'YASSINE ALAOUI',
      email: 'stagiaire-lecture@edtpro.ma',
      identifiant: 'CEF001',
      motDePasse: MOT_DE_PASSE,
      role: ROLES.STAGIAIRE,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
      etablissementIds: [etablissement.id],
    });

    const seConnecter = async (email) =>
      (
        await request(app)
          .post('/api/v2/auth/connexion')
          .send({ identifiant: email, motDePasse: MOT_DE_PASSE })
      ).headers['set-cookie'];

    const cookiesFormateur = await seConnecter('formateur-lecture@edtpro.ma');
    const cookiesStagiaire = await seConnecter('stagiaire-lecture@edtpro.ma');

    for (const jeton of [cookiesFormateur, cookiesStagiaire]) {
      const feries = await request(app)
        .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
        .set('Cookie', jeton);
      expect(feries.status).toBe(200);

      const calendrier = await request(app).get('/api/v2/calendrier').set('Cookie', jeton);
      expect(calendrier.status).toBe(200);

      // L'écriture, elle, reste hors de portée des deux rôles.
      const ecriture = await request(app)
        .put('/api/v2/calendrier')
        .set('Cookie', jeton)
        .send({ vacances: [] });
      expect(ecriture.status).toBe(403);
    }

    void formateur;
    void stagiaire;
  });
});

describe('Étape 4 et clôture', () => {
  it('remplace la liste des espaces et écarte les doublons de casse', async () => {
    const reponse = await request(app)
      .put('/api/v2/etablissements/courant/espaces')
      .set('Cookie', cookies)
      .send({ espaces: ['Salle 1', 'salle 1', 'TEAMS'] });

    expect(reponse.status).toBe(200);
    expect(reponse.body.espaces).toEqual(['Salle 1', 'TEAMS']);

    // Remplacement, pas ajout : une salle retirée de l'écran disparaît.
    await request(app)
      .put('/api/v2/etablissements/courant/espaces')
      .set('Cookie', cookies)
      .send({ espaces: ['TEAMS'] });

    const relu = await Etablissement.findById(etablissement.id);
    expect(relu.espaces).toEqual(['TEAMS']);
  });

  it('marque la configuration terminée, de façon idempotente', async () => {
    expect((await User.findById(directeur.id)).configurationTerminee).toBe(false);

    for (let essai = 0; essai < 2; essai += 1) {
      const reponse = await request(app)
        .post('/api/v2/etablissements/courant/configuration-terminee')
        .set('Cookie', cookies);
      expect(reponse.status).toBe(200);
    }

    expect((await User.findById(directeur.id)).configurationTerminee).toBe(true);
  });

  it("fait adopter à l'établissement l'année qu'il vient de configurer", async () => {
    /*
     * `etablissement.anneeScolaire` était posé à l'inscription et plus jamais
     * revu. Un directeur inscrit en mai (donc sur l'année en cours) qui
     * configure en juin travaille sur la SUIVANTE — et l'assistant le laisse
     * désormais choisir. Sans reprise, `resolveTenant` retombait sur l'année de
     * l'inscription dès qu'aucun en-tête n'était envoyé : l'établissement
     * s'ouvrait sur une année vide, sa base étant rangée sous l'autre.
     */
    expect((await Etablissement.findById(etablissement.id)).anneeScolaire).toBe(ANNEE);

    const reponse = await request(app)
      .post('/api/v2/etablissements/courant/configuration-terminee')
      .set('Cookie', cookies)
      .set('X-Annee-Scolaire', String(ANNEE + 1));

    expect(reponse.status).toBe(200);
    expect(reponse.body.anneeScolaire).toBe(ANNEE + 1);
    expect((await Etablissement.findById(etablissement.id)).anneeScolaire).toBe(ANNEE + 1);

    // Et le sélecteur de la barre latérale propose bien cette année-là : il
    // encadre la référence de l'établissement, qui vient de bouger.
    const contexte = await request(app)
      .get('/api/v2/etablissements/courant')
      .set('Cookie', cookies);

    expect(contexte.body.anneesDisponibles).toContain(ANNEE + 1);
  });

  it("refuse la configuration d'un établissement dont le compte n'est pas membre", async () => {
    const autre = await User.create({
      nomComplet: 'Autre Directeur',
      email: 'autre@edtpro.ma',
      motDePasse: MOT_DE_PASSE,
      role: ROLES.DIRECTEUR,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
    });

    const etablissementVoisin = await Etablissement.create({
      proprietaireId: autre.id,
      region: 'Casablanca-Settat',
      complexe: 'CF Voisin',
      nom: 'ISTA Voisin',
      anneeScolaire: ANNEE,
    });

    const reponse = await request(app)
      .put('/api/v2/etablissements/courant/espaces')
      .set('Cookie', cookies)
      .set('X-Etablissement-Id', etablissementVoisin.id)
      .send({ espaces: ['Salle pirate'] });

    expect(reponse.status).toBe(403);
    expect((await Etablissement.findById(etablissementVoisin.id)).espaces).toEqual([]);
  });
});

describe('Étape 5 — nom abrégé', () => {
  /*
   * `etablissements.nom_abrege` était modélisé depuis le début mais aucun écran
   * ne le renseignait : les documents imprimés retombaient sur le nom officiel
   * et débordaient de leur cadre.
   */
  it("enregistre le nom abrégé et le rend avec l'établissement", async () => {
    const reponse = await request(app)
      .patch('/api/v2/etablissements/courant/nom-abrege')
      .set('Cookie', cookies)
      .send({ nomAbrege: '  ISTA NTIC  ' });

    expect(reponse.status).toBe(200);
    // Les espaces de bord sont retirés : ils passeraient dans les en-têtes.
    expect(reponse.body.nomAbrege).toBe('ISTA NTIC');

    const courant = await request(app)
      .get('/api/v2/etablissements/courant')
      .set('Cookie', cookies);
    expect(courant.body.etablissement.nomAbrege).toBe('ISTA NTIC');
  });

  it('refuse un nom trop court ou trop long', async () => {
    const envoyer = (nomAbrege) =>
      request(app)
        .patch('/api/v2/etablissements/courant/nom-abrege')
        .set('Cookie', cookies)
        .send({ nomAbrege });

    expect((await envoyer('A')).status).toBe(400);
    expect((await envoyer('   ')).status).toBe(400);
    // 31 caractères : au-delà ce n'est plus une abréviation.
    expect((await envoyer('X'.repeat(31))).status).toBe(400);
    expect((await envoyer('X'.repeat(30))).status).toBe(200);
  });

  it('reste réservé au directeur', async () => {
    const reponse = await request(app)
      .patch('/api/v2/etablissements/courant/nom-abrege')
      .send({ nomAbrege: 'ISTA' });

    expect(reponse.status).toBe(401);
  });
});

describe('Stages et formations', () => {
  const envoyer = (chemin, corps) =>
    request(app).put(`/api/v2/etablissements/courant/${chemin}`).set('Cookie', cookies).send(corps);

  it('enregistre les périodes de stage, par groupe', async () => {
    const reponse = await envoyer('stages', {
      stages: [
        { groupe: 'DEVOWFS201', debut: '2027-02-01', fin: '2027-02-28' },
        { groupe: 'DEVOWFS202', debut: '2027-03-01', fin: '2027-03-15' },
      ],
    });

    expect(reponse.status).toBe(200);
    expect(reponse.body.stages).toHaveLength(2);

    const courant = await request(app)
      .get('/api/v2/etablissements/courant')
      .set('Cookie', cookies);
    expect(courant.body.etablissement.stages[0].groupe).toBe('DEVOWFS201');
  });

  it("remet une période saisie à l'envers dans le bon sens", async () => {
    // Les dates sont des CHAÎNES : leur ordre alphabétique EST leur ordre
    // chronologique. Une période inversée passerait les contrôles et ne rendrait
    // jamais personne indisponible — un stage invisible.
    const reponse = await envoyer('stages', {
      stages: [{ groupe: 'DEVOWFS201', debut: '2027-03-15', fin: '2027-03-01' }],
    });

    expect(reponse.body.stages[0]).toMatchObject({ debut: '2027-03-01', fin: '2027-03-15' });
  });

  it('remplace la liste entière', async () => {
    await envoyer('stages', { stages: [{ groupe: 'A101', debut: '2027-01-01', fin: '2027-01-05' }] });
    const reponse = await envoyer('stages', { stages: [] });

    expect(reponse.body.stages).toEqual([]);
  });

  it('enregistre les formations, avec le nom du formateur', async () => {
    const reponse = await envoyer('formations', {
      formations: [
        {
          matriculeFormateur: '9863',
          nomFormateur: 'AHMED CHERKAOUI',
          debut: '2027-04-05',
          fin: '2027-04-09',
        },
      ],
    });

    expect(reponse.status).toBe(200);
    expect(reponse.body.formations[0]).toMatchObject({
      matriculeFormateur: '9863',
      nomFormateur: 'AHMED CHERKAOUI',
    });
  });

  it('exige le MATRICULE du formateur, pas son nom', async () => {
    /*
     * La table MySQL laissait `nom_formateur` nullable, et une ligne au nom vide
     * rendait TOUS les formateurs indisponibles sur sa période. L'appariement se
     * fait donc sur le matricule, qui devient obligatoire.
     */
    const sansMatricule = await envoyer('formations', {
      formations: [{ nomFormateur: 'AHMED CHERKAOUI', debut: '2027-04-05', fin: '2027-04-09' }],
    });
    expect(sansMatricule.status).toBe(400);

    const sansNom = await envoyer('formations', {
      formations: [{ matriculeFormateur: '9863', debut: '2027-04-05', fin: '2027-04-09' }],
    });
    expect(sansNom.status).toBe(200);
  });

  it('refuse une date mal formée', async () => {
    const reponse = await envoyer('stages', {
      stages: [{ groupe: 'A101', debut: '01/02/2027', fin: '2027-02-28' }],
    });

    expect(reponse.status).toBe(400);
  });

  it('refuse sans session', async () => {
    const reponse = await request(app)
      .put('/api/v2/etablissements/courant/stages')
      .send({ stages: [] });

    expect(reponse.status).toBe(401);
  });
});
