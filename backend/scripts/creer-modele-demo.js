/**
 * ═══ L'ÉTABLISSEMENT MODÈLE DE LA DÉMO PUBLIQUE (2026-11-01) ═══
 * Construit, avec des données ENTIÈREMENT FICTIVES, l'établissement que la page d'accueil copie
 * pour chaque visiteur (`modules/demo`) : six formateurs, quatre groupes, leurs affectations,
 * les séances de neuf semaines autour de la semaine en cours, des stagiaires, quelques absences,
 * le chronogramme de l'année, une messagerie vivante et une annonce — et les comptes (direction,
 * six formateurs, un stagiaire).
 *
 * ⚠️ LA MESSAGERIE MONTRE L'APPLICATION (2026-11-02, demande du porteur : « plus de messages,
 *    par exemple le chronogramme ») : le chronogramme d'une formatrice part au directeur par la
 *    VRAIE fonction de l'application (`renvoyerAuDirecteur`), avec sa grille ; les autres
 *    formateurs écrivent ce qu'on lit d'ordinaire dans une boîte de direction.
 *
 * ⚠️ IL REMPLACE LE MODÈLE PRÉCÉDENT : relancer le script suffit (à chaque rentrée, ou pour
 *    rafraîchir les données). Les copies déjà ouvertes par des visiteurs ne sont pas touchées.
 * ⚠️ AUCUN VRAI ÉTABLISSEMENT : complexe « Démo », matricules en « DM », adresses en
 *    `@demo.invalid` (domaine réservé, rien n'y est jamais envoyé).
 *
 *   npm run creer:modele-demo --workspace=backend      (lit MONGODB_URI dans .env)
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { JOURS, PERIODES, ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';
import { SALLE_DISTANCIEL, anneeScolaireCourante, dateDuJour, semaineDansAnnee, vacances } from 'shared/domain';
import { connectDatabase } from '../src/config/db.js';
import {
  obtenir as obtenirCalendrierNational,
  retenirToutesLesRentrees,
} from '../src/modules/calendrierNational/calendrierNational.service.js';
import { renvoyerAuDirecteur } from '../src/modules/chronogramme/chronogramme.service.js';
import {
  AbsenceStagiaire,
  Base,
  Chronogramme,
  Etablissement,
  Message,
  Seance,
  Stagiaire,
  User,
} from '../src/models/index.js';
import { Annonce } from '../src/models/Annonce.js';
import { effacerModeleDemo } from '../src/modules/demo/demo.service.js';
import { DOMAINE_DEMO } from '../src/lib/contexteDemo.js';

const FORMATEURS = [
  { matricule: 'DM1001', nomComplet: 'Nadia Amrani' },
  { matricule: 'DM1002', nomComplet: 'Youssef Berrada' },
  { matricule: 'DM1003', nomComplet: 'Salma Idrissi' },
  { matricule: 'DM1004', nomComplet: 'Hicham Tazi' },
  { matricule: 'DM1005', nomComplet: 'Imane Lahlou' },
  { matricule: 'DM1006', nomComplet: 'Omar Bennis' },
];

const FILIERES = {
  DEV101: 'Développement digital',
  DEV102: 'Développement digital',
  GE101: 'Gestion des entreprises',
  GE102: 'Gestion des entreprises',
};
const GROUPES = Object.keys(FILIERES);
const MODULES = ['M101', 'M102', 'M103', 'M104', 'M105', 'M106'];
const SALLES = ['Salle 1', 'Salle 2', 'Salle 3', 'Salle 4', 'Labo info 1', 'Labo info 2'];
const CRENEAUX = ['S1', 'S2', 'S3', 'S4'];
const DUREE_SEANCE = 2.5; // heures — `DUREE_JOUR` du domaine de l'emploi

const PRENOMS = ['Adam', 'Aya', 'Ilyas', 'Rim', 'Zakaria', 'Hiba', 'Anas', 'Lina', 'Mehdi', 'Sara', 'Ayoub', 'Nour'];
const NOMS = ['Alaoui', 'Chraibi', 'El Fassi', 'Haddad', 'Kettani', 'Mansouri', 'Naciri', 'Ouazzani', 'Rami', 'Sebti'];

/** Un tirage fixe : le modèle est identique d'une exécution à l'autre. */
function hasard(graine) {
  let x = graine;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}

const motDePasseInutilisable = () => crypto.randomBytes(24).toString('base64url');
const aujourdhui = (date) => date.toISOString().slice(0, 10);

export async function construireModele(maintenant = new Date()) {
  const annee = anneeScolaireCourante(maintenant);
  const numero = Math.max(1, semaineDansAnnee(annee, maintenant).numero);
  const reference = `${annee}-W${numero}`;
  const semaines = [];
  for (let n = numero - 5; n <= numero + 3; n += 1) if (n >= 1) semaines.push(`${annee}-W${n}`);

  await effacerModeleDemo();

  // ── Les comptes et l'établissement ──────────────────────────────────────
  const idEtablissement = new mongoose.Types.ObjectId();
  const compte = (role, nomComplet, identifiant = null, extra = {}, rang = '') =>
    new User({
      nomComplet,
      email: `modele-${role}${rang}@${DOMAINE_DEMO}`,
      identifiant,
      motDePasse: motDePasseInutilisable(),
      role,
      statut: STATUTS_COMPTE.APPROUVE,
      etablissementIds: [idEtablissement],
      estVerifie: true,
      estActif: true,
      demo: true,
      ...extra,
    });
  const directeur = compte(ROLES.DIRECTEUR, 'Direction de la démo', null, { configurationTerminee: true });
  // Un compte par formateur : la messagerie en a besoin. ⚠️ Le PREMIER est celui qu'ouvre
  // « Essayer comme formateur » (la copie prend le plus ancien compte du rôle).
  const formateurs = FORMATEURS.map((f, i) => compte(ROLES.FORMATEUR, f.nomComplet, f.matricule, {}, `-${i + 1}`));
  const [formateur] = formateurs;
  const stagiaire = compte(ROLES.STAGIAIRE, `${PRENOMS[0]} ${NOMS[0]}`, 'DM2001');
  for (const u of [directeur, ...formateurs, stagiaire]) await u.save();

  await Etablissement.create({
    _id: idEtablissement,
    proprietaireId: directeur._id,
    region: 'Démonstration',
    complexe: 'Démo',
    nom: 'Établissement de démonstration',
    nomAbrege: 'EFP Démo',
    anneeScolaire: annee,
    espaces: SALLES,
    publications: semaines
      .filter((s) => Number(s.split('-W')[1]) <= numero + 1)
      .map((semaine) => ({ anneeScolaire: annee, semaine, publieeLe: maintenant, publieePar: directeur._id })),
    modeleDemo: true,
    demoSemaineReference: reference,
  });

  // ── La base : formateurs, groupes, affectations ─────────────────────────
  const affectations = [];
  GROUPES.forEach((groupe, g) => {
    MODULES.forEach((module, m) => {
      const f = FORMATEURS[(g * MODULES.length + m) % FORMATEURS.length];
      affectations.push({
        formateur: f.matricule,
        groupe,
        module,
        type: m === 5 ? TYPES_COURS.SYNCHRONE : TYPES_COURS.PRESENTIEL,
        // Des volumes annuels plausibles, au-dessus de ce que la démo pose déjà (≈ 60 h).
        s1Heures: m === 0 ? 90 : 120,
        s2Heures: 0,
        estRegional: m === 2,
        filiere: FILIERES[groupe],
      });
    });
  });
  await Base.create({
    etablissementId: idEtablissement,
    anneeScolaire: annee,
    formateurs: FORMATEURS.map((f) => ({ ...f, nomUnique: f.nomComplet, masseHoraire: 22 })),
    groupes: GROUPES,
    affectations,
    groupeFilieres: FILIERES,
  });

  // ── Les séances : deux par module et par semaine, sans conflit ──────────
  const tirer = hasard(42);
  const seances = [];
  for (const semaine of semaines) {
    const occupe = new Set();
    for (const a of affectations) {
      let posees = 0;
      for (let essai = 0; essai < 60 && posees < 2; essai += 1) {
        const jour = JOURS[Math.floor(tirer() * JOURS.length)];
        const seance = CRENEAUX[Math.floor(tirer() * CRENEAUX.length)];
        if (jour === 'Samedi' && seance > 'S2') continue;
        const cle = (quoi) => `${quoi}|${jour}|${seance}`;
        if (occupe.has(cle(a.formateur)) || occupe.has(cle(a.groupe))) continue;
        // ⚠️ À distance, la salle est « TEAMS » : c'est elle qui fait le type de la séance
        //    (`typeDeSeance`) — une salle vide la ferait lire présentielle, « Espace ? ».
        const distanciel = a.type === TYPES_COURS.SYNCHRONE;
        const salle = distanciel ? SALLE_DISTANCIEL : SALLES.find((s) => !occupe.has(cle(s)));
        if (salle === undefined) continue;
        for (const q of [a.formateur, a.groupe, distanciel ? null : salle].filter(Boolean)) occupe.add(cle(q));
        seances.push({
          etablissementId: idEtablissement,
          anneeScolaire: annee,
          semaine,
          jour,
          seance,
          date: dateDuJour(semaine, jour),
          formateurMatricule: a.formateur,
          groupe: a.groupe,
          module: a.module,
          salle,
          type: a.type,
          periode: PERIODES.JOUR,
        });
        posees += 1;
      }
    }
  }
  await Seance.insertMany(seances);

  // ── Le chronogramme de l'année, ACCORDÉ À L'EMPLOI (2026-11-02) ─────────────
  // Sur les semaines du modèle, exactement les heures placées (2,5 h par séance) : l'emploi est
  // alors conforme au chronogramme, comme dans un établissement tenu. Avant, 5 h par semaine
  // depuis la rentrée ; après, 5 h par semaine jusqu'au volume du module. Les semaines de
  // vacances du calendrier national restent vides.
  const { vacances: periodesVacances } = await obtenirCalendrierNational(annee).catch(() => ({ vacances: [] }));
  const premiere = Number(semaines[0].split('-W')[1]);
  const heures = new Map(); // « groupe|module » → Map(numéro de semaine → heures)
  const ajouter = (groupe, module, n, h) => {
    const cle = `${groupe}|${module}`;
    if (!heures.has(cle)) heures.set(cle, new Map());
    heures.get(cle).set(n, (heures.get(cle).get(n) ?? 0) + h);
  };
  for (const s of seances) ajouter(s.groupe, s.module, Number(s.semaine.split('-W')[1]), DUREE_SEANCE);
  const ouvree = (n) => !vacances(dateDuJour(`${annee}-W${n}`, 'Lundi'), periodesVacances);
  for (let n = 1; n < premiere; n += 1) {
    if (!ouvree(n)) continue;
    for (const a of affectations) ajouter(a.groupe, a.module, n, 2 * DUREE_SEANCE);
  }
  const derniere = Number(semaines.at(-1).split('-W')[1]);
  for (const a of affectations) {
    const cellules = heures.get(`${a.groupe}|${a.module}`) ?? new Map();
    let total = [...cellules.values()].reduce((x, y) => x + y, 0);
    for (let n = derniere + 1; n <= 40 && total < a.s1Heures; n += 1) {
      if (!ouvree(n)) continue;
      const h = Math.min(2 * DUREE_SEANCE, a.s1Heures - total);
      ajouter(a.groupe, a.module, n, h);
      total += h;
    }
  }
  await Chronogramme.insertMany(
    GROUPES.map((groupe) => ({
      etablissementId: idEtablissement,
      anneeScolaire: annee,
      groupe,
      planning: Object.fromEntries(
        affectations
          .filter((a) => a.groupe === groupe)
          .map((a) => [
            a.module,
            [...(heures.get(`${groupe}|${a.module}`) ?? new Map())]
              .sort(([x], [y]) => x - y)
              .map(([n, h]) => ({ semaine: `S${n}`, heures: h, type: a.type === TYPES_COURS.SYNCHRONE ? 'S' : 'P' })),
          ])
      ),
      version: 1,
    }))
  );


  // ── Les stagiaires ──────────────────────────────────────────────────────
  const stagiaires = [];
  GROUPES.forEach((groupe, g) => {
    for (let i = 0; i < 6; i += 1) {
      const n = g * 6 + i;
      stagiaires.push({
        etablissementId: idEtablissement,
        anneeScolaire: annee,
        matricule: `DM${2001 + n}`,
        prenom: PRENOMS[n % PRENOMS.length],
        nom: NOMS[(n * 3) % NOMS.length],
        groupes: [groupe],
        groupePrincipal: groupe,
        filiere: FILIERES[groupe],
      });
    }
  });
  // Le compte stagiaire de la démo est le premier : même nom que son compte.
  stagiaires[0].prenom = PRENOMS[0];
  stagiaires[0].nom = NOMS[0];
  await Stagiaire.insertMany(stagiaires);

  // ── Quelques absences dans les semaines passées ─────────────────────────
  const passees = seances.filter((s) => Number(s.semaine.split('-W')[1]) < numero);
  const absences = [];
  for (let i = 0; i < 14 && passees.length; i += 1) {
    const s = passees[Math.floor(tirer() * passees.length)];
    const candidats = stagiaires.filter((st) => st.groupePrincipal === s.groupe);
    const st = candidats[Math.floor(tirer() * candidats.length)];
    const cle = `${st.matricule}|${s.semaine}|${s.jour}|${s.seance}`;
    if (absences.some((a) => a.cle === cle)) continue;
    absences.push({
      cle,
      etablissementId: idEtablissement,
      anneeScolaire: annee,
      matricule: st.matricule,
      nomComplet: `${st.prenom} ${st.nom}`,
      groupe: s.groupe,
      filiere: st.filiere,
      date: aujourdhui(s.date),
      semaine: s.semaine,
      jour: s.jour,
      seance: s.seance,
      module: s.module,
      formateurMatricule: s.formateurMatricule,
      type: 'absence',
      justifiee: tirer() < 0.4,
    });
  }
  await AbsenceStagiaire.insertMany(absences.map(({ cle, ...a }) => a));

  // ── Messagerie ──────────────────────────────────────────────────────────
  const ilYa = (heures) => new Date(maintenant.getTime() - heures * 3600 * 1000);
  const ecrire = (de, a, sujet, corps, heures, extra = {}) =>
    Message.create({ expediteurId: de._id, destinataireId: a._id, sujet, corps, createdAt: ilYa(heures), ...extra });
  const [nadia, youssef, salma, hicham, imane, omar] = formateurs;

  const reunion = await ecrire(
    directeur,
    nadia,
    'Réunion pédagogique',
    'Bonjour, la réunion pédagogique est avancée à jeudi 10 h, salle 1. Merci de prévoir le point sur l’avancement de vos modules.',
    98,
    { lu: true }
  );
  await ecrire(nadia, directeur, 'Re : Réunion pédagogique', 'Bien noté, je serai présente. Le contrôle de M102 avec DEV101 est prêt.', 96, {
    reponseA: reunion._id,
    lu: true,
  });
  await ecrire(
    hicham,
    directeur,
    'Vidéoprojecteur de la salle 1',
    'Bonjour, le vidéoprojecteur de la salle 1 ne s’allume plus depuis ce matin. Pouvez-vous prévenir le service technique ? En attendant, je peux faire cours en salle 3.',
    74,
    { lu: true }
  );
  await ecrire(
    youssef,
    directeur,
    'Rattrapage M102 — DEV102',
    'Bonjour, suite à mon absence de mardi, je propose de rattraper M102 avec DEV102 samedi matin, en salle 2 si elle est libre.',
    50,
    { lu: true }
  );
  await ecrire(
    salma,
    directeur,
    'Contrôle continu de M103',
    'Le contrôle continu de M103 est prévu la semaine prochaine pour GE101. Pourriez-vous me réserver la salle 3 pour deux séances ?',
    26
  );
  await ecrire(
    imane,
    directeur,
    'Formation pédagogique jeudi',
    'Je serai en formation pédagogique jeudi prochain. Mes séances avec GE102 seront à reporter ; je peux les rattraper le samedi suivant.',
    5
  );
  await ecrire(
    omar,
    directeur,
    'Cours à distance de M106',
    'Les séances synchrones de M106 se feront sur Teams cette semaine ; le lien est envoyé aux groupes. Tout est prêt de mon côté.',
    2
  );
  // Le chronogramme de Nadia, renvoyé pour validation PAR L'APPLICATION ELLE-MÊME (le plus récent).
  await renvoyerAuDirecteur(idEtablissement, annee, nadia, nadia.identifiant);

  const fin = new Date(maintenant.getTime() + 14 * 24 * 3600 * 1000);
  await Annonce.create({
    auteurId: directeur._id,
    roleAuteur: ROLES.DIRECTEUR,
    cible: ROLES.FORMATEUR,
    etablissementIds: [idEtablissement],
    texte: 'Bienvenue dans la démo d’EDT Pro : explorez, modifiez, publiez — rien de ce que vous faites ici ne quitte la démo.',
    importance: 'info',
    debut: aujourdhui(maintenant),
    fin: aujourdhui(fin),
  });

  return {
    reference,
    semaines: semaines.length,
    seances: seances.length,
    stagiaires: stagiaires.length,
    absences: absences.length,
    formateurs: formateurs.length,
    messages: await Message.countDocuments({ destinataireId: directeur._id }),
  };
}

// Lancé directement : `node scripts/creer-modele-demo.js`.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/creer-modele-demo.js')) {
  (async () => {
    await connectDatabase();
    await retenirToutesLesRentrees();
    const bilan = await construireModele();
    console.log('Modèle de démo construit :', bilan);
    await mongoose.disconnect();
  })().catch(async (erreur) => {
    console.error(erreur);
    await mongoose.disconnect();
    process.exit(1);
  });
}
