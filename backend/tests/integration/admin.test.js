import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

const { envois } = vi.hoisted(() => ({ envois: [] }));
vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async (m) => {
    envois.push(m);
    return { envoye: true };
  }),
}));

const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';

async function creerCompte({ email, role, statut, estVerifie = true }) {
  return User.create({
    nomComplet: `Compte ${email}`,
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut,
    estVerifie,
  });
}

async function connecter(email) {
  const reponse = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: email, motDePasse: MOT_DE_PASSE });
  return reponse.headers['set-cookie'];
}

beforeEach(() => {
  envois.length = 0;
});

describe('Contrôle d\'accès du module admin', () => {
  it('refuse un directeur, même approuvé', async () => {
    await creerCompte({
      email: 'directeur@edtpro.ma',
      role: ROLES.DIRECTEUR,
      statut: STATUTS_COMPTE.APPROUVE,
    });
    const cookies = await connecter('directeur@edtpro.ma');

    const reponse = await request(app).get('/api/v2/admin/utilisateurs').set('Cookie', cookies);

    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('ROLE_INSUFFISANT');
  });

  it('refuse un visiteur non authentifié', async () => {
    const reponse = await request(app).get('/api/v2/admin/utilisateurs');
    expect(reponse.status).toBe(401);
  });
});

describe('Approbation des directeurs', () => {
  let cookiesAdmin;
  let directeur;

  beforeEach(async () => {
    await creerCompte({
      email: 'admin@edtpro.ma',
      role: ROLES.ADMIN,
      statut: STATUTS_COMPTE.APPROUVE,
    });
    cookiesAdmin = await connecter('admin@edtpro.ma');

    directeur = await creerCompte({
      email: 'nouveau@edtpro.ma',
      role: ROLES.DIRECTEUR,
      statut: STATUTS_COMPTE.EN_ATTENTE,
    });
  });

  it('approuve un compte et le notifie', async () => {
    const reponse = await request(app)
      .patch(`/api/v2/admin/utilisateurs/${directeur.id}/statut`)
      .set('Cookie', cookiesAdmin)
      .send({ statut: STATUTS_COMPTE.APPROUVE });

    expect(reponse.status).toBe(200);
    expect(reponse.body.utilisateur.statut).toBe(STATUTS_COMPTE.APPROUVE);
    expect(envois.at(-1).destinataire).toBe('nouveau@edtpro.ma');

    // Le compte peut désormais se connecter.
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: 'nouveau@edtpro.ma', motDePasse: MOT_DE_PASSE });
    expect(connexion.body.action).toBe('connecte');
  });

  it("pose une date de fin quand l'approbation est un essai", async () => {
    const reponse = await request(app)
      .patch(`/api/v2/admin/utilisateurs/${directeur.id}/statut`)
      .set('Cookie', cookiesAdmin)
      .send({ statut: STATUTS_COMPTE.APPROUVE, essaiJours: 30 });

    const fin = new Date(reponse.body.utilisateur.essai.dateFin);
    const joursRestants = Math.round((fin - Date.now()) / 86_400_000);
    expect(joursRestants).toBe(30);
  });

  it('un blocage révoque immédiatement les sessions ouvertes', async () => {
    await request(app)
      .patch(`/api/v2/admin/utilisateurs/${directeur.id}/statut`)
      .set('Cookie', cookiesAdmin)
      .send({ statut: STATUTS_COMPTE.APPROUVE });

    const cookiesDirecteur = await connecter('nouveau@edtpro.ma');
    expect(await RefreshToken.countDocuments({ utilisateurId: directeur.id })).toBe(1);

    await request(app)
      .patch(`/api/v2/admin/utilisateurs/${directeur.id}/statut`)
      .set('Cookie', cookiesAdmin)
      .send({ statut: STATUTS_COMPTE.BLOQUE });

    expect(await RefreshToken.countDocuments({ utilisateurId: directeur.id })).toBe(0);

    // L'access token encore valide ne doit plus donner accès.
    const apres = await request(app).get('/api/v2/auth/moi').set('Cookie', cookiesDirecteur);
    expect(apres.status).toBe(401);
    expect(apres.body.code).toBe('COMPTE_BLOQUE');
  });

  it("empêche l'admin de modifier son propre statut", async () => {
    const moi = await User.findOne({ email: 'admin@edtpro.ma' });

    const reponse = await request(app)
      .patch(`/api/v2/admin/utilisateurs/${moi.id}/statut`)
      .set('Cookie', cookiesAdmin)
      .send({ statut: STATUTS_COMPTE.BLOQUE });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('AUTO_MODIFICATION');
  });

  it('filtre la liste par statut et pagine', async () => {
    const reponse = await request(app)
      .get('/api/v2/admin/utilisateurs?statut=pending&parPage=10')
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(200);
    expect(reponse.body.utilisateurs).toHaveLength(1);
    expect(reponse.body.utilisateurs[0].email).toBe('nouveau@edtpro.ma');
    // La projection admin ne doit jamais laisser fuiter le hash.
    expect(JSON.stringify(reponse.body)).not.toContain('$2');
  });

  it('réinitialise un mot de passe sans le renvoyer dans la réponse', async () => {
    const reponse = await request(app)
      .post(`/api/v2/admin/utilisateurs/${directeur.id}/mot-de-passe`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(200);
    expect(reponse.body.motDePasse).toBeUndefined();

    /*
     * Il est parti par e-mail, et l'ancien ne fonctionne plus.
     *
     * ⚠️ ON VÉRIFIE QU'IL EST SEUL SUR SON PARAGRAPHE, plus qu'il est précédé
     * d'une étiquette (2026-09-02) : c'est cette forme qui le fait ressortir
     * dans le gabarit HTML et qui le rend sélectionnable d'un geste en texte
     * brut. Collé à sa phrase, il se recopiait avec la ponctuation.
     */
    expect(envois.at(-1).texte).toMatch(/\n\nAa1[A-Za-z0-9_-]+\n\n/);
    const ancien = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: 'nouveau@edtpro.ma', motDePasse: MOT_DE_PASSE });
    expect(ancien.status).toBe(401);
  });

  /*
   * ═══ ⚠️⚠️ L'ÉCRAN N'ARBITRE QUE DES DIRECTEURS ═══
   * (défaut signalé par le porteur, 2026-09-02.) La liste ET les compteurs
   * portaient sur TOUS les comptes : un établissement de 17 formateurs
   * affichait « 20 approuvés » sur un écran intitulé « Gestion des directeurs ».
   * Or formateurs, stagiaires et gestionnaires sont créés PAR un directeur —
   * ils n'ont aucune demande d'accès à approuver ici.
   */
  it('ne compte et ne liste que les directeurs', async () => {
    await creerCompte({
      email: 'formateur@ofppt.ma',
      role: ROLES.FORMATEUR,
      statut: STATUTS_COMPTE.APPROUVE,
    });

    const liste = await request(app)
      .get(`/api/v2/admin/utilisateurs?role=${ROLES.DIRECTEUR}&statut=${STATUTS_COMPTE.APPROUVE}`)
      .set('Cookie', cookiesAdmin);

    expect(liste.status).toBe(200);
    expect(liste.body.utilisateurs.every((u) => u.role === ROLES.DIRECTEUR)).toBe(true);
    expect(liste.body.utilisateurs.some((u) => u.email === 'formateur@ofppt.ma')).toBe(false);

    const stats = await request(app).get('/api/v2/admin/statistiques').set('Cookie', cookiesAdmin);

    /*
     * ⚠️ LE COMPTEUR DOIT S'ACCORDER À LA LISTE : deux nombres qui décrivent la
     * même chose et se contredisent sur le même écran, c'est le défaut d'origine.
     */
    expect(stats.body.statistiques.parStatutDirecteurs[STATUTS_COMPTE.APPROUVE] ?? 0).toBe(
      liste.body.total
    );
    // Le décompte GLOBAL par rôle, lui, voit toujours tout le monde.
    expect(stats.body.statistiques.parRole[ROLES.FORMATEUR]).toBe(1);
  });

  /*
   * ═══ LA PAGE « STATISTIQUES » COMPTE TOUT LE MONDE ═══
   * (demande du porteur, 2026-09-02.) C'est ce qui la distingue de l'écran
   * « Directeurs » : elle montre les formateurs et les gestionnaires, qu'on ne
   * voit nulle part ailleurs.
   */
  it('croise les rôles et les statuts, marges comprises', async () => {
    await creerCompte({
      email: 'formateur@ofppt.ma',
      role: ROLES.FORMATEUR,
      statut: STATUTS_COMPTE.APPROUVE,
    });
    await creerCompte({
      email: 'bloque@ofppt.ma',
      role: ROLES.FORMATEUR,
      statut: STATUTS_COMPTE.BLOQUE,
    });

    const { body } = await request(app)
      .get('/api/v2/admin/statistiques')
      .set('Cookie', cookiesAdmin);

    const stats = body.statistiques;
    const cellule = (role, statut) =>
      stats.parRoleEtStatut.find((l) => l.role === role && l.statut === statut)?.total ?? 0;

    /* Le croisement dit ce qu'aucune des deux marges ne dit : un formateur
       bloqué existe, et il est le seul. */
    expect(cellule(ROLES.FORMATEUR, STATUTS_COMPTE.BLOQUE)).toBe(1);
    expect(cellule(ROLES.FORMATEUR, STATUTS_COMPTE.APPROUVE)).toBe(1);

    /*
     * ⚠️ LES MARGES SE DÉDUISENT DU CROISEMENT, elles ne sont pas comptées à
     * part : trois agrégations séparées, ce sont trois vérités qui peuvent
     * diverger — le défaut qu'on vient de corriger juste au-dessus.
     */
    expect(stats.parRole[ROLES.FORMATEUR]).toBe(2);
    expect(stats.parStatut[STATUTS_COMPTE.BLOQUE]).toBe(1);
    expect(stats.total).toBe(stats.parRoleEtStatut.reduce((n, l) => n + l.total, 0));
    expect(stats.total).toBe(
      Object.values(stats.parStatut).reduce((n, v) => n + v, 0)
    );

    /* Et le décompte des DIRECTEURS reste à part : aucun formateur dedans. */
    expect(Object.values(stats.parStatutDirecteurs).reduce((n, v) => n + v, 0)).toBeLessThan(
      stats.total
    );
  });

  /*
   * ═══ LES CHIFFRES D'ACTIVITÉ, REPRIS DE `get_user_stats.php` ═══
   * (demande du porteur, 2026-09-02 : « voir l'ancienne logique ».)
   */
  it('compte les comptes actifs, désactivés et jamais connectés', async () => {
    const desactive = await creerCompte({
      email: 'desactive@ofppt.ma',
      role: ROLES.FORMATEUR,
      statut: STATUTS_COMPTE.APPROUVE,
    });
    desactive.estActif = false;
    await desactive.save();

    const { body } = await request(app)
      .get('/api/v2/admin/statistiques')
      .set('Cookie', cookiesAdmin);

    const stats = body.statistiques;

    expect(stats.desactives).toBe(1);
    /* Actifs et désactivés se déduisent l'un de l'autre : leur somme EST le
       total, et deux comptages séparés pourraient s'en écarter. */
    expect(stats.actifs + stats.desactives).toBe(stats.total);
    /*
     * ⚠️ L'ADMIN S'EST CONNECTÉ pour obtenir son cookie — il est donc le SEUL à
     * ne pas être « jamais connecté », et le seul de la liste des dernières
     * connexions. C'est ce qui prouve que le champ suit bien les connexions et
     * ne compte pas simplement les comptes.
     */
    expect(stats.jamaisConnectes).toBe(stats.total - 1);
    expect(stats.dernieresConnexions).toHaveLength(1);
    expect(stats.dernieresConnexions[0].role).toBe(ROLES.ADMIN);
    expect(stats.dernieresConnexions[0].derniereConnexion).toBeTruthy();
  });

  /*
   * ═══ ⚠️ LA SÉRIE COMPTE TOUJOURS DOUZE MOIS, TROUS COMPRIS ═══
   * L'agrégation ne rend que les mois où quelqu'un s'est inscrit ; tracée telle
   * quelle, la courbe relierait juillet à octobre comme s'ils se suivaient.
   */
  it('rend douze mois consécutifs, les mois vides à zéro', async () => {
    const { body } = await request(app)
      .get('/api/v2/admin/statistiques')
      .set('Cookie', cookiesAdmin);

    const serie = body.statistiques.inscriptionsParMois;

    expect(serie).toHaveLength(12);
    expect(serie.every((m) => /^\d{4}-\d{2}$/.test(m.mois))).toBe(true);
    expect(serie.every((m) => Number.isInteger(m.total))).toBe(true);

    /* Ils se suivent, sans saut : c'est ce qui rend la courbe lisible. */
    const mois = serie.map((m) => m.mois);
    expect([...mois].sort()).toEqual(mois);

    /* Tous les comptes du test viennent d'être créés : la série les porte. */
    expect(serie.reduce((n, m) => n + m.total, 0)).toBe(body.statistiques.total);
  });

  /*
   * ═══ LE BATTEMENT DE CŒUR ═══ ← api/auth/heartbeat.php.
   * Il alimente les deux seuls indicateurs sans autre source : le temps passé et
   * « en ligne ».
   */
  describe('battement de cœur', () => {
    it('met en ligne et crédite le temps réellement écoulé', async () => {
      /* Le premier battement ne crédite rien : il n'y a pas de durée à compter,
         seulement un instant à poser. */
      const premier = await request(app)
        .post('/api/v2/auth/activite')
        .set('Cookie', cookiesAdmin);

      expect(premier.status).toBe(200);

      const apres = await request(app)
        .get('/api/v2/admin/statistiques')
        .set('Cookie', cookiesAdmin);

      expect(apres.body.statistiques.enLigne).toBe(1);

      /*
       * ⚠️⚠️ L'INCRÉMENT EST MESURÉ, PAS SUPPOSÉ. L'existant ajoutait 30 s à
       * CHAQUE appel : trois onglets ouverts comptaient trois fois le même
       * temps, et un rechargement en ajoutait un de plus. Deux battements
       * consécutifs ne peuvent donc créditer que la poignée de millisecondes qui
       * les sépare — c'est-à-dire zéro seconde entière.
       */
      const second = await request(app)
        .post('/api/v2/auth/activite')
        .set('Cookie', cookiesAdmin);

      expect(second.body.ajout).toBe(0);
    });

    it('refuse un battement sans session', async () => {
      const reponse = await request(app).post('/api/v2/auth/activite');
      expect(reponse.status).toBe(401);
    });
  });

  /*
   * ⚠️ « HORS LIGNE » COMPREND CEUX QUI N'ONT JAMAIS EU D'ACTIVITÉ : sinon la
   * somme des deux filtres ne ferait pas le total, et on chercherait longtemps
   * les manquants.
   */
  it('partage le parc entre en ligne et hors ligne, sans perte', async () => {
    await request(app).post('/api/v2/auth/activite').set('Cookie', cookiesAdmin);

    const compter = async (activite) => {
      const { body } = await request(app)
        .get(`/api/v2/admin/utilisateurs?activite=${activite}`)
        .set('Cookie', cookiesAdmin);
      return body.total;
    };

    const enLigne = await compter('en_ligne');
    const horsLigne = await compter('hors_ligne');

    const { body } = await request(app).get('/api/v2/admin/statistiques').set('Cookie', cookiesAdmin);

    expect(enLigne).toBe(1);
    expect(enLigne + horsLigne).toBe(body.statistiques.total);
  });

  /*
   * ═══ LE FILTRE PAR ÉTABLISSEMENT ═══ (demande du porteur, 2026-09-02.)
   *
   * ⚠️ `etablissementIds` EST UN TABLEAU : Mongo compare alors chaque élément,
   * et un compte rattaché à DEUX établissements doit ressortir sous l'un comme
   * sous l'autre. C'est le comportement voulu — il y travaille bien — et c'est
   * exactement ce qu'un filtre écrit à la main sur une chaîne aurait raté.
   */
  it('filtre les comptes par établissement, et compte ceux de chacun', async () => {
    const proprietaire = await creerCompte({
      email: 'proprio@edtpro.ma',
      role: ROLES.DIRECTEUR,
      statut: STATUTS_COMPTE.APPROUVE,
    });

    const [premier, second] = await Etablissement.create([
      {
        nom: 'ISTA Alpha',
        proprietaireId: proprietaire.id,
        anneeScolaire: 2026,
        region: 'Casablanca-Settat',
        complexe: 'CFP Alpha',
      },
      {
        nom: 'ISTA Beta',
        proprietaireId: proprietaire.id,
        anneeScolaire: 2026,
        region: 'Casablanca-Settat',
        complexe: 'CFP Beta',
      },
    ]);

    const chezPremier = await creerCompte({
      email: 'alpha@ofppt.ma',
      role: ROLES.FORMATEUR,
      statut: STATUTS_COMPTE.APPROUVE,
    });
    chezPremier.etablissementIds = [premier.id];
    await chezPremier.save();

    /* Le directeur en gère DEUX : il doit apparaître des deux côtés. */
    proprietaire.etablissementIds = [premier.id, second.id];
    await proprietaire.save();

    const liste = await request(app)
      .get(`/api/v2/admin/utilisateurs?etablissement=${premier.id}`)
      .set('Cookie', cookiesAdmin);

    expect(liste.status).toBe(200);
    expect(liste.body.utilisateurs.map((u) => u.email).sort()).toEqual([
      'alpha@ofppt.ma',
      'proprio@edtpro.ma',
    ]);

    const autre = await request(app)
      .get(`/api/v2/admin/utilisateurs?etablissement=${second.id}`)
      .set('Cookie', cookiesAdmin);

    expect(autre.body.utilisateurs.map((u) => u.email)).toEqual(['proprio@edtpro.ma']);

    /*
     * ⚠️ LA LISTE DU FILTRE DIT COMBIEN DE COMPTES PORTE CHAQUE ÉTABLISSEMENT :
     * sans ce nombre, on choisit au hasard, on obtient une liste vide, et c'est
     * le filtre qu'on soupçonne. Le compte doit donc s'accorder à ce que le
     * filtre rend réellement.
     */
    const etablissements = await request(app)
      .get('/api/v2/admin/etablissements')
      .set('Cookie', cookiesAdmin);

    expect(etablissements.status).toBe(200);
    const parNom = Object.fromEntries(
      etablissements.body.etablissements.map((e) => [e.nom, e.comptes])
    );
    expect(parNom['ISTA Alpha']).toBe(2);
    expect(parNom['ISTA Beta']).toBe(1);

    /*
     * ⚠️ UN ÉTABLISSEMENT SANS AUCUN COMPTE N'EST PAS PROPOSÉ (demande du
     * porteur, 2026-09-02) : sur le parc réel, sept des huit sont dans ce cas —
     * des cartes créées puis abandonnées. Les offrir, c'est proposer des choix
     * qui rendent tous une liste vide, et faire douter du filtre.
     */
    const [vide] = await Etablissement.create([
      {
        nom: 'ISTA Sans Personne',
        proprietaireId: proprietaire.id,
        anneeScolaire: 2026,
        region: 'Casablanca-Settat',
        complexe: 'CFP Gamma',
      },
    ]);

    const apres = await request(app)
      .get('/api/v2/admin/etablissements')
      .set('Cookie', cookiesAdmin);

    expect(apres.body.etablissements.map((e) => e.nom)).not.toContain('ISTA Sans Personne');
    expect(apres.body.etablissements.every((e) => e.comptes > 0)).toBe(true);
    /* Et il existe bien : c'est l'affichage qui l'écarte, pas la base. */
    expect(await Etablissement.countDocuments({ _id: vide.id })).toBe(1);
  });

  /* ⚠️ UN IDENTIFIANT MAL FORMÉ EST REFUSÉ, pas ignoré : ignoré, la liste
     rendrait TOUT LE MONDE en prétendant filtrer sur un établissement. */
  it('refuse un identifiant d’établissement invalide', async () => {
    const reponse = await request(app)
      .get('/api/v2/admin/utilisateurs?etablissement=pas-un-identifiant')
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(400);
  });
});
