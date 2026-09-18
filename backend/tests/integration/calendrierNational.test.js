import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Seance } from '../../src/models/Seance.js';
import { CalendrierNational } from '../../src/models/CalendrierNational.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Calendrier national — vacances du réseau et dates de rentrée.
 * (demande du porteur, 2026-09-02.)
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;

/** Le réglage réel donné par le porteur pour 2026-2027. */
const RENTREES = [
  { anneeFormation: 1, date: '2026-09-11' },
  { anneeFormation: 2, date: '2026-09-07' },
];

let cookiesAdmin;
let cookiesDirecteur;
let etablissement;

async function creerCompte({ email, role }) {
  return User.create({
    nomComplet: `Compte ${email}`,
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
}

async function connecter(email) {
  const reponse = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: email, motDePasse: MOT_DE_PASSE });
  return reponse.headers['set-cookie'];
}

const enTete = (cookies) => ({
  Cookie: cookies,
  'X-Etablissement-Id': etablissement?.id ?? '',
  'X-Annee-Scolaire': String(ANNEE),
});

beforeEach(async () => {
  await creerCompte({ email: 'admin@edtpro.ma', role: ROLES.ADMIN });
  cookiesAdmin = await connecter('admin@edtpro.ma');

  const directeur = await creerCompte({ email: 'directeur@edtpro.ma', role: ROLES.DIRECTEUR });

  etablissement = await Etablissement.create({
    nom: 'ISTA Test',
    region: 'Fès-Meknès',
    complexe: 'CF Test',
    proprietaireId: directeur.id,
    anneeScolaire: ANNEE,
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();
  cookiesDirecteur = await connecter('directeur@edtpro.ma');
});

describe('Accès au calendrier national', () => {
  it('refuse l’écriture à un directeur, l’accepte pour l’admin', async () => {
    const refus = await request(app)
      .put(`/api/v2/admin/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesDirecteur)
      .send({ vacances: [], rentrees: RENTREES });

    expect(refus.status).toBe(403);

    const accepte = await request(app)
      .put(`/api/v2/admin/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesAdmin)
      .send({ vacances: [], rentrees: RENTREES });

    expect(accepte.status).toBe(200);
  });

  /*
   * ⚠️ LE DIRECTEUR DOIT POUVOIR LE LIRE : son calendrier s'en alimente par
   * défaut. Lui fermer la lecture reviendrait à lui cacher ses propres vacances.
   */
  it('laisse un directeur LIRE le calendrier national', async () => {
    await CalendrierNational.create({ anneeScolaire: ANNEE, vacances: [], rentrees: RENTREES });

    const reponse = await request(app)
      .get(`/api/v2/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesDirecteur);

    expect(reponse.status).toBe(200);
    expect(reponse.body.rentrees).toHaveLength(2);
  });

  it('refuse un visiteur non authentifié', async () => {
    expect((await request(app).get(`/api/v2/calendrier-national/${ANNEE}`)).status).toBe(401);
  });

  /*
   * ⚠️ UNE ANNÉE NON PARAMÉTRÉE N'EST PAS UNE ERREUR : elle rend des listes
   * vides, et RIEN n'est gelé — le comportement voulu tant que l'admin n'a rien
   * saisi.
   */
  it('rend des listes vides pour une année jamais paramétrée', async () => {
    const reponse = await request(app)
      .get(`/api/v2/calendrier-national/2030`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(200);
    expect(reponse.body.vacances).toEqual([]);
    expect(reponse.body.rentrees).toEqual([]);
  });
});

describe('Saisie du calendrier', () => {
  it('enregistre vacances et rentrées, puis les relit triées', async () => {
    const reponse = await request(app)
      .put(`/api/v2/admin/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesAdmin)
      .send({
        vacances: [{ intitule: 'Vacances d’automne', debut: '2026-10-25', fin: '2026-11-02' }],
        rentrees: [RENTREES[1], RENTREES[0]],
      });

    expect(reponse.body.vacances).toHaveLength(1);
    /* Triées par année de formation : 1ʳᵉ, puis 2ᵉ. */
    expect(reponse.body.rentrees.map((r) => r.anneeFormation)).toEqual([1, 2]);
  });

  /*
   * ⚠️ LE NOM EST LA CLÉ D'APPARIEMENT côté établissement : c'est par lui qu'un
   * directeur écarte une période. Deux périodes de même nom lui en feraient
   * retirer deux en croyant en retirer une.
   */
  it('refuse deux périodes de même nom', async () => {
    const reponse = await request(app)
      .put(`/api/v2/admin/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesAdmin)
      .send({
        vacances: [
          { intitule: 'Vacances', debut: '2026-10-25', fin: '2026-11-02' },
          { intitule: ' vacances ', debut: '2026-12-20', fin: '2027-01-04' },
        ],
        rentrees: [],
      });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('PERIODE_EN_DOUBLE');
  });

  it('refuse une période dont la fin précède le début', async () => {
    const reponse = await request(app)
      .put(`/api/v2/admin/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesAdmin)
      .send({
        vacances: [{ intitule: 'À l’envers', debut: '2026-11-02', fin: '2026-10-25' }],
        rentrees: [],
      });

    expect(reponse.status).toBe(400);
  });

  it('refuse deux rentrées pour la même année de formation', async () => {
    const reponse = await request(app)
      .put(`/api/v2/admin/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesAdmin)
      .send({
        vacances: [],
        rentrees: [
          { anneeFormation: 1, date: '2026-09-11' },
          { anneeFormation: 1, date: '2026-09-14' },
        ],
      });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('RENTREE_EN_DOUBLE');
  });

  /*
   * ⚠️ REMPLACEMENT ET NON FUSION : l'écran envoie la liste entière qu'il
   * affiche. Une fusion ferait réapparaître la période qu'on vient de retirer.
   */
  it('remplace la liste au lieu de la compléter', async () => {
    await CalendrierNational.create({
      anneeScolaire: ANNEE,
      // ⚠️ Écriture DIRECTE dans le modèle : lui parle « nom », pas « intitule ».
      vacances: [{ nom: 'Ancienne', debut: '2026-10-01', fin: '2026-10-05' }],
      rentrees: [],
    });

    const reponse = await request(app)
      .put(`/api/v2/admin/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesAdmin)
      .send({
        vacances: [{ intitule: 'Nouvelle', debut: '2026-11-01', fin: '2026-11-05' }],
        rentrees: [],
      });

    expect(reponse.body.vacances.map((v) => v.intitule)).toEqual(['Nouvelle']);
  });
});

describe('Le gel de la rentrée', () => {
  beforeEach(async () => {
    await CalendrierNational.create({
      anneeScolaire: ANNEE,
      // ⚠️ Écriture DIRECTE dans le modèle : « nom ».
      vacances: [{ nom: 'Vacances du réseau', debut: '2026-10-25', fin: '2026-11-02' }],
      rentrees: RENTREES,
    });

    await Base.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      formateurs: [{ nomComplet: 'AISSI ABDELHADI', nomUnique: 'AISSI', matricule: '15688' }],
      groupes: ['DEVOWFS101', 'DEVOWFS201'],
      affectations: [
        {
          groupe: 'DEVOWFS101',
          module: 'M101',
          formateur: '15688',
          type: 'presentiel',
          s1Heures: 30,
          s2Heures: 0,
        },
        {
          groupe: 'DEVOWFS201',
          module: 'M201',
          formateur: '15688',
          type: 'presentiel',
          s1Heures: 30,
          s2Heures: 0,
        },
      ],
    });
  });

  const poser = (groupe, module, jour, semaine) =>
    request(app)
      .put(`/api/v2/seances/${semaine}/case`)
      .set(enTete(cookiesDirecteur))
      .send({
        formateurMatricule: '15688',
        groupe,
        module,
        salle: 'Salle 1',
        jour,
        seance: 'S1',
        periode: 'jour',
      });

  /*
   * ═══ L'EXEMPLE DU PORTEUR ═══
   * En 2026-2027, les 2ᵉ années rentrent le 7 septembre, les 1ʳᵉ le 11. La
   * semaine 2 va du lundi 7 au samedi 12.
   */
  it('refuse une séance posée avant la rentrée du groupe, et NOMME la date', async () => {
    const reponse = await poser('DEVOWFS101', 'M101', 'Mardi', '2026-W2');

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('AVANT_RENTREE');
    expect(reponse.body.message).toContain('2026-09-11');
    expect(await Seance.countDocuments()).toBe(0);
  });

  /*
   * ⚠️ LE MÊME JOUR, LA 2ᵉ ANNÉE TRAVAILLE : le gel porte sur une ANNÉE DE
   * FORMATION, pas sur l'établissement. C'est toute la différence avec des
   * vacances.
   */
  it('laisse la 2ᵉ année travailler le même jour', async () => {
    const reponse = await poser('DEVOWFS201', 'M201', 'Mardi', '2026-W2');

    expect(reponse.status).toBe(200);
    expect(await Seance.countDocuments()).toBe(1);
  });

  it('laisse la 1ʳᵉ année travailler à partir de sa rentrée', async () => {
    /* Le vendredi 11 septembre, jour de la rentrée des 1ʳᵉ années. */
    const reponse = await poser('DEVOWFS101', 'M101', 'Vendredi', '2026-W2');

    expect(reponse.status).toBe(200);
  });

  /*
   * ⚠️ SANS RÉGLAGE, RIEN N'EST GELÉ : l'application se comporte comme avant
   * tant que l'administrateur n'a pas paramétré la rentrée.
   */
  it('ne gèle rien quand aucune rentrée n’est paramétrée', async () => {
    await CalendrierNational.deleteMany({});

    const reponse = await poser('DEVOWFS101', 'M101', 'Mardi', '2026-W2');
    expect(reponse.status).toBe(200);
  });

  /*
   * ⚠️ LE JOUR PORTE LES ANNÉES GELÉES, PAS UN DRAPEAU : la grille ferme les
   * seules cases dont le groupe en relève. Une ligne de formateur ne peut pas
   * être gelée — le même enseignant a ses 2ᵉ années le même jour.
   */
  it('annonce dans la semaine quelles années sont encore gelées', async () => {
    const reponse = await request(app)
      .get('/api/v2/seances/2026-W2')
      .set(enTete(cookiesDirecteur));

    const mardi = reponse.body.jours.find((j) => j.jour === 'Mardi');

    expect(mardi.rentreesGelees).toEqual([{ anneeFormation: 1, date: '2026-09-11' }]);

    const vendredi = reponse.body.jours.find((j) => j.jour === 'Vendredi');
    expect(vendredi.rentreesGelees).toEqual([]);
  });

  /*
   * ═══ ⚠️ LES VACANCES NATIONALES S'APPLIQUENT PAR DÉFAUT ═══
   * Sans cette lecture, un établissement poserait des séances pendant les
   * vacances du réseau sans que rien ne le signale.
   */
  it('ferme la semaine des vacances nationales, sans saisie du directeur', async () => {
    const reponse = await request(app)
      .get('/api/v2/seances/2026-W9')
      .set(enTete(cookiesDirecteur));

    /* La semaine du 26 octobre tombe dans les vacances du réseau. */
    const jours = reponse.body.jours.filter((j) => j.vacances);
    expect(jours.length).toBeGreaterThan(0);
  });

  /*
   * ⚠️ « PAR DÉFAUT » NE VEUT PAS DIRE « IMPOSÉ » : l'établissement peut écarter
   * une période nationale qui ne le concerne pas.
   */
  it('laisse l’établissement écarter une période nationale', async () => {
    await Etablissement.updateOne(
      { _id: etablissement.id },
      { $set: { 'calendrier.vacancesEcartees': ['Vacances du réseau'] } }
    );

    const reponse = await request(app)
      .get('/api/v2/seances/2026-W9')
      .set(enTete(cookiesDirecteur));

    expect(reponse.body.jours.every((j) => !j.vacances)).toBe(true);
  });
});


/**
 * ═══ LES JOURS FÉRIÉS, POUR QUI N'A PAS D'ÉTABLISSEMENT ═══
 * (2026-09-03, signalé par le porteur : « les jours fériés n'affichent pas ».)
 *
 * L'écran d'administration réutilise le calendrier de la configuration, qui
 * interrogeait `/calendrier/jours-feries` — un chemin réservé aux DIRECTEURS.
 * Un administrateur n'a pas d'établissement : la requête revenait en 403, et la
 * page l'annonçait comme une panne de l'API.
 */
describe('Jours fériés nationaux', () => {
  /*
   * ⚠️ LE LIBELLÉ SE LIT DANS LA RÉPONSE, il ne se recopie pas. Ma première
   * version l'écrivait avec une apostrophe TYPOGRAPHIQUE là où la source en
   * porte une droite : le test échouait sur sa propre fixture. Or c'est
   * précisément ce libellé qui sert de CLÉ à `fusionnerJoursFeries` — un
   * caractère d'écart, et l'ajustement d'un établissement ne s'applique plus.
   */
  const FERIE = { date: '2026-11-18' };

  it('refuse toujours la route d’ÉTABLISSEMENT à un administrateur', async () => {
    // C'est la cause du défaut : ce n'est pas l'API qui manquait, c'est le droit.
    const reponse = await request(app)
      .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(403);
  });

  it('sert les fériés NATIONAUX à l’administrateur', async () => {
    const reponse = await request(app)
      .get(`/api/v2/calendrier-national/${ANNEE}/jours-feries`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(200);
    expect(Array.isArray(reponse.body.joursFeries)).toBe(true);
    expect(reponse.body.joursFeries.length).toBeGreaterThan(0);
  });

  it('exige tout de même une session', async () => {
    const reponse = await request(app).get(`/api/v2/calendrier-national/${ANNEE}/jours-feries`);
    expect(reponse.status).toBe(401);
  });

  /*
   * ⚠️ N'EST PAS CAPTÉE PAR `/:annee`. Express retient la première route qui
   * correspond : déclarée après, celle-ci ne serait jamais atteinte et l'on
   * recevrait le calendrier au lieu des fériés.
   */
  it('n’est pas captée par la route du calendrier', async () => {
    const reponse = await request(app)
      .get(`/api/v2/calendrier-national/${ANNEE}/jours-feries`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.body.joursFeries).toBeDefined();
    expect(reponse.body.rentrees).toBeUndefined();
  });

  /*
   * ⚠️⚠️ LA DIFFÉRENCE ENTRE LES DEUX PORTES EST L'AJUSTEMENT. Celui-ci
   * appartient à un ÉTABLISSEMENT : la route nationale ne doit pas l'appliquer,
   * sinon la correction d'un EFP s'afficherait chez tous les autres.
   */
  it('IGNORE les ajustements d’un établissement, que la route du directeur applique', async () => {
    const avant = await request(app)
      .get(`/api/v2/calendrier-national/${ANNEE}/jours-feries`)
      .set('Cookie', cookiesAdmin);
    const libelle = avant.body.joursFeries.find((f) => f.date === FERIE.date)?.intitule;
    expect(libelle).toBeTruthy();

    await Etablissement.updateOne(
      { _id: etablissement.id },
      {
        $set: {
          'calendrier.ajustementsFeries': [{ libelle, date: '2026-11-19', supprime: false }],
        },
      }
    );

    const [national, propre] = await Promise.all([
      request(app)
        .get(`/api/v2/calendrier-national/${ANNEE}/jours-feries`)
        .set('Cookie', cookiesAdmin),
      request(app)
        .get(`/api/v2/calendrier/jours-feries?annee=${ANNEE}`)
        .set(enTete(cookiesDirecteur)),
    ]);

    const dateDe = (corps) => corps.joursFeries.find((f) => f.intitule === libelle)?.date;

    expect(dateDe(national.body)).toBe(FERIE.date);
    expect(dateDe(propre.body)).toBe('2026-11-19');
  });
});


/**
 * ═══ ⚠️⚠️ LE CONTRAT DU CALENDRIER PARTAGÉ ═══
 * (2026-09-03, signalé par le porteur : la page répondait 400 et affichait
 * « Non enregistré ».)
 *
 * `EtapeCalendrier` — le même composant pour l'assistant, les Paramètres et
 * l'administration — émet `{ intitule, debut, fin }`. Le schéma exigeait `nom` :
 * toute période saisie depuis l'écran d'administration était REFUSÉE.
 *
 * ⚠️ MES TESTS NE POUVAIENT PAS LE VOIR : ils envoyaient `nom`, c'est-à-dire ce
 * que le schéma attendait, au lieu de ce que le CLIENT produit. C'est la leçon
 * déjà consignée pour `completionModules` — une fixture écrite à la main décrit
 * ce qu'on CROIT que la donnée contient. Ce test part donc de la forme réelle.
 */
describe('Contrat du calendrier partagé', () => {
  /** Exactement ce que `EtapeCalendrier` remonte à son parent. */
  const DEPUIS_L_ECRAN = {
    vacances: [{ intitule: 'V test', debut: '2026-10-19', fin: '2026-10-25' }],
    rentrees: [{ anneeFormation: 1, date: '2026-09-11' }],
  };

  it('ACCEPTE une période telle que l’écran la produit', async () => {
    const reponse = await request(app)
      .put(`/api/v2/admin/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesAdmin)
      .send(DEPUIS_L_ECRAN);

    expect(reponse.status).toBe(200);
    expect(reponse.body.vacances).toEqual([
      { intitule: 'V test', debut: '2026-10-19', fin: '2026-10-25' },
    ]);
  });

  /*
   * ⚠️ L'ALLER-RETOUR EST LE VRAI GARDE-FOU : une écriture acceptée qui se
   * relirait sous un autre nom de champ afficherait une période SANS INTITULÉ,
   * et l'écran ne le dirait pas — il rendrait une ligne vide.
   */
  it('la RELIT sous le même nom de champ', async () => {
    await request(app)
      .put(`/api/v2/admin/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesAdmin)
      .send(DEPUIS_L_ECRAN)
      .expect(200);

    const relu = await request(app)
      .get(`/api/v2/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesAdmin);

    expect(relu.body.vacances[0].intitule).toBe('V test');
  });

  /*
   * ⚠️⚠️ LE MODÈLE, LUI, GARDE `nom` — et c'est ce qui compte : c'est par ce
   * champ que `fusionnerVacances` apparie, donc par lui qu'un établissement
   * ÉCARTE une période. Une traduction qui ne l'écrirait pas casserait
   * l'écartement sans la moindre erreur.
   */
  it('écrit `nom` en base, pour que l’écartement continue de s’apparier', async () => {
    await request(app)
      .put(`/api/v2/admin/calendrier-national/${ANNEE}`)
      .set('Cookie', cookiesAdmin)
      .send(DEPUIS_L_ECRAN)
      .expect(200);

    const enBase = await CalendrierNational.findOne({ anneeScolaire: ANNEE }).lean();
    expect(enBase.vacances[0].nom).toBe('V test');

    // Et le directeur la voit, sous le vocabulaire de son propre calendrier.
    const chezLeDirecteur = await request(app)
      .get('/api/v2/calendrier')
      .set(enTete(cookiesDirecteur));

    expect(chezLeDirecteur.body.nationales).toEqual([
      { intitule: 'V test', debut: '2026-10-19', fin: '2026-10-25' },
    ]);
  });
});
