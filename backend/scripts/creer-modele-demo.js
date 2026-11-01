/**
 * ═══ L'ÉTABLISSEMENT MODÈLE DE LA DÉMO PUBLIQUE (2026-11-01) ═══
 * Construit, avec des données ENTIÈREMENT FICTIVES, l'établissement que la page d'accueil copie
 * pour chaque visiteur (`modules/demo`) : six formateurs, quatre groupes, leurs affectations,
 * les séances de neuf semaines autour de la semaine en cours, des stagiaires, quelques absences,
 * deux messages et une annonce — et trois comptes (directeur, formateur, stagiaire).
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
import { anneeScolaireCourante, dateDuJour, semaineDansAnnee } from 'shared/domain';
import { connectDatabase } from '../src/config/db.js';
import { retenirToutesLesRentrees } from '../src/modules/calendrierNational/calendrierNational.service.js';
import {
  AbsenceStagiaire,
  Base,
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
  const compte = (role, nomComplet, identifiant = null, extra = {}) =>
    new User({
      nomComplet,
      email: `modele-${role}@${DOMAINE_DEMO}`,
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
  const formateur = compte(ROLES.FORMATEUR, FORMATEURS[0].nomComplet, FORMATEURS[0].matricule);
  const stagiaire = compte(ROLES.STAGIAIRE, `${PRENOMS[0]} ${NOMS[0]}`, 'DM2001');
  for (const u of [directeur, formateur, stagiaire]) await u.save();

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
        s1Heures: m === 0 ? 30 : 75,
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
        const distanciel = a.type === TYPES_COURS.SYNCHRONE;
        const salle = distanciel ? '' : SALLES.find((s) => !occupe.has(cle(s)));
        if (salle === undefined) continue;
        for (const q of [a.formateur, a.groupe, salle].filter(Boolean)) occupe.add(cle(q));
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

  // ── Messagerie et annonce ───────────────────────────────────────────────
  const message = await Message.create({
    expediteurId: directeur._id,
    destinataireId: formateur._id,
    sujet: 'Réunion pédagogique',
    corps: 'Bonjour, la réunion pédagogique est avancée à jeudi 10 h, salle 1. Merci de prévoir le point sur l’avancement de vos modules.',
  });
  await Message.create({
    expediteurId: formateur._id,
    destinataireId: directeur._id,
    sujet: 'Re : Réunion pédagogique',
    corps: 'Bien noté, je serai présente. Le contrôle de M102 avec DEV101 est prêt.',
    reponseA: message._id,
  });
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

  return { reference, semaines: semaines.length, seances: seances.length, stagiaires: stagiaires.length, absences: absences.length };
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
