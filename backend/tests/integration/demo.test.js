import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { anneeScolaireCourante, dateDuJour, enJour, semaineDansAnnee } from 'shared/domain';
import { createApp } from '../../src/app.js';
import { AbsenceStagiaire, Base, Etablissement, Message, Seance, Stagiaire, User } from '../../src/models/index.js';
import { construireModele } from '../../scripts/creer-modele-demo.js';
import { effacerBacsExpires } from '../../src/modules/demo/demo.service.js';
import { envoyer } from '../../src/modules/messagerie/messagerie.service.js';
import { listerEtablissements, listerUtilisateurs } from '../../src/modules/admin/admin.service.js';
import { envoyerEmail } from '../../src/config/mailer.js';
import { executerEnDemo } from '../../src/lib/contexteDemo.js';

/**
 * La démo publique (2026-11-01) : un bac à sable par visiteur, copié de l'établissement modèle.
 * Ce qui compte : la copie est complète et à jour, elle ne se mêle à RIEN d'autre, rien n'en
 * sort (e-mails, messages vers de vrais comptes, actions fermées), et elle disparaît après 24 h.
 */
/*
 * Les fériés viennent d'une API externe : ici, un seul, connu — le mercredi de la semaine en
 * cours —, pour vérifier que la copie n'y place aucune séance (2026-11-02).
 */
const feries = vi.hoisted(() => ({ jours: [] }));
vi.mock('../../src/modules/calendrier/joursFeries.service.js', async (original) => ({
  ...(await original()),
  obtenirNationaux: async () => ({ jours: feries.jours, complet: true, recupereLe: new Date() }),
}));

const app = createApp();
const ANNEE = anneeScolaireCourante();
const MERCREDI = dateDuJour(`${ANNEE}-W${Math.max(1, semaineDansAnnee(ANNEE, new Date()).numero)}`, 'Mercredi');
feries.jours = [{ date: enJour(MERCREDI), libelle: 'Férié de test' }];

const essayer = (role) => request(app).post('/api/v2/demo').send({ role });
const cookiesDe = (reponse) => reponse.headers['set-cookie'];

beforeEach(async () => {
  await construireModele();
});

describe('le modèle', () => {
  it('est un établissement fictif complet, avec ses comptes de démo (direction, 6 formateurs, stagiaire)', async () => {
    const modele = await Etablissement.findOne({ modeleDemo: true }).lean();
    expect(modele).toBeTruthy();
    expect(modele.demoSemaineReference).toMatch(/^\d{4}-W\d+$/);
    const comptes = await User.find({ etablissementIds: modele._id }).lean();
    const roles = comptes.map((c) => c.role);
    expect(roles.filter((r) => r === ROLES.DIRECTEUR)).toHaveLength(1);
    expect(roles.filter((r) => r === ROLES.FORMATEUR)).toHaveLength(6);
    expect(roles.filter((r) => r === ROLES.STAGIAIRE)).toHaveLength(1);
    expect(comptes.every((c) => c.demo && c.email.endsWith('@demo.invalid'))).toBe(true);
    expect(await Seance.countDocuments({ etablissementId: modele._id })).toBeGreaterThan(100);
    expect(await Stagiaire.countDocuments({ etablissementId: modele._id })).toBe(24);
    expect(await AbsenceStagiaire.countDocuments({ etablissementId: modele._id })).toBeGreaterThan(0);
  });

  it('se reconstruit sans doublon', async () => {
    await construireModele();
    expect(await Etablissement.countDocuments({ modeleDemo: true })).toBe(1);
    expect(await User.countDocuments({ email: 'modele-directeur@demo.invalid' })).toBe(1);
  });
});

describe('la messagerie du modèle', () => {
  it('porte le chronogramme d’une formatrice, renvoyé au directeur pour validation', async () => {
    const reponse = await essayer(ROLES.DIRECTEUR);
    const directeurId = reponse.body.utilisateur.id ?? reponse.body.utilisateur._id;
    const recus = await Message.find({ destinataireId: directeurId }).lean();
    expect(recus.length).toBeGreaterThanOrEqual(6);
    const chronogramme = recus.find((m) => m.chronogrammeFormateur);
    expect(chronogramme?.sujet).toBe('Chronogramme rempli — à valider');
  });
});

describe('changer de rôle dans sa démo', () => {
  it('ouvre le compte demandé DANS LA MÊME COPIE, sans en créer une nouvelle', async () => {
    const direction = await essayer(ROLES.DIRECTEUR);
    const copie = direction.body.utilisateur.etablissementIds[0];
    const avant = await Etablissement.countDocuments({ demo: true });

    for (const role of [ROLES.FORMATEUR, ROLES.STAGIAIRE, ROLES.DIRECTEUR]) {
      const reponse = await request(app).post('/api/v2/demo').set('Cookie', cookiesDe(direction)).send({ role });
      expect(reponse.status).toBe(200);
      expect(reponse.body.utilisateur.role).toBe(role);
      expect(reponse.body.utilisateur.etablissementIds[0]).toBe(copie);
    }
    expect(await Etablissement.countDocuments({ demo: true })).toBe(avant);
  });
});

describe('POST /api/v2/demo', () => {
  it('crée une copie et y connecte le visiteur avec le rôle choisi', async () => {
    const reponse = await essayer(ROLES.DIRECTEUR);
    expect(reponse.status).toBe(201);
    expect(reponse.body.utilisateur).toMatchObject({ role: ROLES.DIRECTEUR, demo: true, configurationTerminee: true });

    const copie = await Etablissement.findById(reponse.body.utilisateur.etablissementIds[0]).lean();
    expect(copie).toMatchObject({ demo: true, modeleDemo: false });
    expect(copie.complexe).toMatch(/^Démo [0-9A-F]{6}$/);
    expect(copie.demoExpireLe.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);

    // Rien le jour férié : ses séances sont déplacées dans la semaine (au pire retirées).
    const modele = await Etablissement.findOne({ modeleDemo: true }).lean();
    const auFerie = await Seance.countDocuments({ etablissementId: modele._id, date: MERCREDI });
    expect(auFerie).toBeGreaterThan(0);
    expect(await Seance.countDocuments({ etablissementId: copie._id, date: MERCREDI })).toBe(0);
    const total = await Seance.countDocuments({ etablissementId: modele._id });
    const copiees = await Seance.countDocuments({ etablissementId: copie._id });
    expect(copiees).toBeLessThanOrEqual(total);
    expect(copiees).toBeGreaterThan(total - auFerie); // au moins une a trouvé un autre créneau

    const moi = await request(app).get('/api/v2/auth/moi').set('Cookie', cookiesDe(reponse));
    expect(moi.status).toBe(200);
    expect(moi.body.utilisateur ?? moi.body).toBeTruthy();
  });

  it('donne au formateur SES séances, sous des matricules propres à la copie', async () => {
    const reponse = await essayer(ROLES.FORMATEUR);
    expect(reponse.status).toBe(201);
    const { identifiant, etablissementIds } = reponse.body.utilisateur;
    expect(identifiant).toMatch(/^DM1001-[0-9A-F]{6}$/);
    expect(await Seance.countDocuments({ etablissementId: etablissementIds[0], formateurMatricule: identifiant })).toBeGreaterThan(0);
    // Le matricule du modèle n'apparaît plus nulle part dans la copie.
    expect(await Seance.countDocuments({ etablissementId: etablissementIds[0], formateurMatricule: 'DM1001' })).toBe(0);
    const base = await Base.findOne({ etablissementId: etablissementIds[0] }).lean();
    expect(base.formateurs.every((f) => f.matricule.endsWith(identifiant.slice(-7)))).toBe(true);
    expect(base.affectations.every((a) => a.formateur.endsWith(identifiant.slice(-7)))).toBe(true);
  });

  it('relie le stagiaire à sa fiche et ses absences', async () => {
    const reponse = await essayer(ROLES.STAGIAIRE);
    expect(reponse.status).toBe(201);
    const { identifiant, etablissementIds } = reponse.body.utilisateur;
    expect(await Stagiaire.countDocuments({ etablissementId: etablissementIds[0], matricule: identifiant })).toBe(1);
  });

  it('ne mêle pas deux visiteurs : chaque copie a ses propres matricules et comptes', async () => {
    const a = await essayer(ROLES.FORMATEUR);
    const b = await essayer(ROLES.FORMATEUR);
    expect(a.body.utilisateur.identifiant).not.toBe(b.body.utilisateur.identifiant);
    expect(a.body.utilisateur.etablissementIds[0]).not.toBe(b.body.utilisateur.etablissementIds[0]);
    expect(await Seance.countDocuments({ formateurMatricule: a.body.utilisateur.identifiant })).toBe(
      await Seance.countDocuments({ etablissementId: a.body.utilisateur.etablissementIds[0], formateurMatricule: a.body.utilisateur.identifiant })
    );
  });

  it('refuse un rôle qui n’est pas proposé', async () => {
    expect((await essayer(ROLES.ADMIN)).status).toBe(400);
  });

  it('décale les semaines du modèle sur la semaine en cours', async () => {
    const numero = Math.max(1, semaineDansAnnee(ANNEE, new Date()).numero);
    // Le modèle aurait été construit deux semaines plus tôt.
    const modele = await Etablissement.findOne({ modeleDemo: true });
    const semainesModele = await Seance.distinct('semaine', { etablissementId: modele._id });
    await Etablissement.updateOne({ _id: modele._id }, { demoSemaineReference: `${ANNEE}-W${numero - 2}` });

    const reponse = await essayer(ROLES.DIRECTEUR);
    const semainesCopie = await Seance.distinct('semaine', { etablissementId: reponse.body.utilisateur.etablissementIds[0] });
    const decale = (s) => `${ANNEE}-W${Number(s.split('-W')[1]) + 2}`;
    expect(semainesCopie.sort()).toEqual(semainesModele.map(decale).sort());
  });
});

describe('rien ne sort de la démo', () => {
  it('ferme les actions qui touchent de vraies personnes', async () => {
    const reponse = await essayer(ROLES.DIRECTEUR);
    const cookies = cookiesDe(reponse);
    const creation = await request(app).post('/api/v2/comptes').set('Cookie', cookies).send({});
    expect(creation.status).toBe(403);
    expect(creation.body.code).toBe('DEMO_LIMITEE');
    const profil = await request(app).patch('/api/v2/auth/profil').set('Cookie', cookies).send({ email: 'vrai@exemple.ma' });
    expect(profil.status).toBe(403);
  });

  it('n’envoie aucun e-mail, ni depuis une requête de démo, ni vers une adresse de démo', async () => {
    expect(await envoyerEmail({ destinataire: 'x@demo.invalid', sujet: 's', texte: 't' })).toMatchObject({ demo: true });
    const depuisDemo = await executerEnDemo(() => envoyerEmail({ destinataire: 'vrai@exemple.ma', sujet: 's', texte: 't' }));
    expect(depuisDemo).toMatchObject({ demo: true });
  });

  it('n’écrit pas aux administrateurs', async () => {
    const admin = await User.create({
      nomComplet: 'Admin',
      email: 'admin@edtpro.ma',
      motDePasse: 'MotDePasse2026',
      role: ROLES.ADMIN,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
    });
    const reponse = await essayer(ROLES.DIRECTEUR);
    const resultat = await envoyer(reponse.body.utilisateur.id, {
      destinataires: [String(admin._id)],
      sujet: 'Bonjour',
      corps: 'Message de démo',
    }).catch((erreur) => ({ erreur }));
    expect(await Message.countDocuments({ destinataireId: admin._id })).toBe(0);
    expect(resultat).toBeTruthy();
  });

  it('reste hors des listes de l’administration', async () => {
    await essayer(ROLES.DIRECTEUR);
    const etablissements = await listerEtablissements();
    expect(JSON.stringify(etablissements)).not.toMatch(/démonstration/i);
    const { utilisateurs } = await listerUtilisateurs({});
    expect(utilisateurs.some((u) => String(u.email).endsWith('@demo.invalid'))).toBe(false);
  });
});

describe('le ménage', () => {
  it('efface les copies échues et elles seules', async () => {
    const reel = await Etablissement.create({
      proprietaireId: (await User.findOne({ email: 'modele-directeur@demo.invalid' }))._id,
      region: 'Fès-Meknès',
      complexe: 'CF Réel',
      nom: 'ISTA Réel',
      anneeScolaire: ANNEE,
    });
    const reponse = await essayer(ROLES.DIRECTEUR);
    const copie = reponse.body.utilisateur.etablissementIds[0];

    expect(await effacerBacsExpires(new Date())).toBe(0);
    expect(await effacerBacsExpires(new Date(Date.now() + 25 * 3600 * 1000))).toBe(1);

    expect(await Etablissement.findById(copie)).toBeNull();
    expect(await Seance.countDocuments({ etablissementId: copie })).toBe(0);
    expect(await User.countDocuments({ etablissementIds: copie })).toBe(0);
    expect(await Etablissement.findById(reel._id)).toBeTruthy();
    expect(await Etablissement.countDocuments({ modeleDemo: true })).toBe(1);
  });
});
