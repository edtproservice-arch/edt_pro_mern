import QRCode from 'qrcode';
import { LIBELLES_NIVEAUX } from 'shared/domain';
import { ROLES } from 'shared/constants';
import { env } from '../../config/env.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { User } from '../../models/User.js';
import { badRequest } from '../../lib/httpError.js';
import { creerJetonCarte } from '../auth/jetonCarte.js';
import { convertirDocxEnPdf } from '../seances/libreOffice.js';
import { construireDocxCartes } from './exportCarteStagiaireDocx.js';

/**
 * Les CARTES DE STAGIAIRE des groupes choisis, en Word ou PDF (2026-10-11) —
 * dix par page, à découper. Voir `exportCarteStagiaireDocx.js` pour la carte,
 * `auth/jetonCarte.js` pour le QR.
 *
 * ⚠️ LE QR NE SE POSE QUE SUR UN STAGIAIRE QUI A UN COMPTE (Paramètres →
 * Sessions) : il connecte À CE COMPTE. Sans compte, la carte le dit au lieu
 * d'imprimer un code qui ne mène nulle part.
 *
 * ⚠️ `renouveler` INVALIDE LES CARTES DÉJÀ IMPRIMÉES des stagiaires concernés
 * (carte perdue, volée, photographiée) : leur version augmente, les anciens QR
 * cessent de connecter. Sans lui, les cartes se réimpriment à l'identique.
 */
/**
 * ═══ L'ADRESSE DU LIEN DU QR (2026-10-11, signalé par le porteur : le QR menait
 * à « edtpro.ma », l'ANCIEN EDT Pro) ═══ `APP_URL` n'était pas renseigné sur
 * l'hébergement : sa valeur par défaut désigne le domaine prévu, encore occupé
 * par l'ancienne application. Le lien part donc de l'adresse de l'écran qui
 * demande les cartes — l'application qu'on est en train d'utiliser — que le
 * navigateur envoie dans l'en-tête `Origin`.
 *
 * ═══ 2e VERSION (2026-10-11, le porteur : « le même problème de lien ») ═══ Se
 * fier au seul en-tête `Origin` ne suffisait pas : un GET de même origine n'en
 * porte pas, le proxy de développement le présente sous une autre adresse, et
 * derrière un proxy le protocole se lit `http` au lieu de `https`. L'écran
 * envoie donc AUSSI son adresse (`window.location.origin`) : `demandee`.
 *
 * ⚠️ UNE ADRESSE ATTESTÉE, PAS RECOPIÉE : `demandee` n'est retenue que si le
 * navigateur la confirme — en-tête `Origin` ou `Referer` de la même requête —
 * ou si elle figure parmi les origines autorisées (`HTTP_ORIGINES`). À défaut,
 * l'`Origin` seul, puis l'origine du `Referer`, puis `APP_URL`.
 */
const ORIGINE_BIEN_FORMEE = /^https?:\/\/[^/\s?#]+$/;
const nettoyer = (adresse) => String(adresse ?? '').trim().replace(/\/+$/, '');
const origineDe = (url) => {
  try {
    return new URL(String(url)).origin;
  } catch {
    return '';
  }
};

export function adresseDesLiens({ demandee, origine, referent } = {}) {
  const autorisees = String(env.HTTP_ORIGINES ?? '')
    .split(',')
    .map(nettoyer)
    .filter(Boolean);
  const attestees = [nettoyer(origine), origineDe(referent)].filter((a) => ORIGINE_BIEN_FORMEE.test(a));

  const voulue = nettoyer(demandee);
  if (ORIGINE_BIEN_FORMEE.test(voulue) && (attestees.includes(voulue) || autorisees.includes(voulue))) return voulue;
  if (attestees.length > 0) return attestees[0];
  return nettoyer(env.APP_URL);
}

/** L'adresse de la requête : ce que l'écran demande, et ce que le navigateur atteste. */
export const adresseDeLaRequete = (req, demandee) =>
  adresseDesLiens({ demandee, origine: req.get('origin'), referent: req.get('referer') });

/** Le lien de connexion d'un compte stagiaire — celui que porte le QR. */
const lienDeCarte = (adresse, compte, anneeScolaire) =>
  `${adresse}/carte/${creerJetonCarte({ utilisateurId: String(compte._id), version: compte.versionCarte ?? 1, anneeScolaire })}`;

const OPTIONS_QR = { errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0B1F44', light: '#FFFFFF' } };

/**
 * Les liens (et leurs QR) des stagiaires d'UN groupe — pour la colonne QR de la
 * fiche stagiaire (2026-10-11, demande du porteur). Un stagiaire sans compte n'a
 * pas de lien. Mêmes liens que sur les cartes imprimées.
 */
export async function liensDesCartes(etablissementId, anneeScolaire, groupe, adresse) {
  const stagiaires = await Stagiaire.find({ etablissementId, anneeScolaire, groupes: groupe }).select('matricule').lean();
  const comptes = await User.find({
    role: ROLES.STAGIAIRE,
    identifiant: { $in: stagiaires.map((s) => s.matricule) },
    etablissementIds: etablissementId,
  })
    .select('identifiant versionCarte')
    .lean();

  const liens = [];
  for (const compte of comptes) {
    const lien = lienDeCarte(adresse, compte, anneeScolaire);
    liens.push({ matricule: compte.identifiant, lien, qr: await QRCode.toDataURL(lien, { ...OPTIONS_QR, width: 320 }) });
  }
  return { adresse, liens };
}

export async function construireCartesStagiaires(
  etablissementId,
  anneeScolaire,
  { format, groupes, renouveler = false, adresse, matricules: voulus = null }
) {
  // `matricules` : seulement ces stagiaires des groupes (2026-10-17, filtre par stagiaire de Documents) —
  // et seules leurs cartes sont renouvelées.
  const filtre = { etablissementId, anneeScolaire, groupes: { $in: groupes } };
  if (voulus?.length) filtre.matricule = { $in: voulus };
  const [stagiaires, etablissement] = await Promise.all([
    Stagiaire.find(filtre)
      .select('matricule nom prenom nomArabe prenomArabe niveau annee filiere groupes')
      .sort({ nom: 1, prenom: 1 })
      .lean(),
    Etablissement.findById(etablissementId).select('nom nomAbrege').lean(),
  ]);
  if (stagiaires.length === 0) {
    throw badRequest('Aucun stagiaire dans les groupes demandés', { code: 'GROUPE_VIDE' });
  }

  const matricules = [...new Set(stagiaires.map((s) => s.matricule))];
  const filtreComptes = { role: ROLES.STAGIAIRE, identifiant: { $in: matricules }, etablissementIds: etablissementId };
  if (renouveler) await User.updateMany(filtreComptes, { $inc: { versionCarte: 1 } });
  const comptes = new Map(
    (await User.find(filtreComptes).select('identifiant versionCarte').lean()).map((compte) => [compte.identifiant, compte])
  );

  const efp = etablissement?.nomAbrege || etablissement?.nom || '';
  const annee = `${anneeScolaire}-${anneeScolaire + 1}`;
  const base = adresse ?? adresseDesLiens();

  const cartes = [];
  for (const groupe of groupes) {
    for (const stagiaire of stagiaires.filter((s) => (s.groupes ?? []).includes(groupe))) {
      const compte = comptes.get(stagiaire.matricule);
      const qrPng = compte ? await QRCode.toBuffer(lienDeCarte(base, compte, anneeScolaire), { ...OPTIONS_QR, width: 360 }) : null;
      const anneeFormation = /^(\d)/.exec(String(stagiaire.annee ?? ''))?.[1];
      cartes.push({
        nomComplet: [stagiaire.nom, stagiaire.prenom].filter(Boolean).join(' ') || stagiaire.matricule,
        // Le nom en arabe, prénom d'abord — l'ordre du canevas (« وليد عباوي »).
        nomArabe: [stagiaire.prenomArabe, stagiaire.nomArabe].filter(Boolean).join(' '),
        matricule: stagiaire.matricule,
        groupe,
        filiere: stagiaire.filiere ?? '',
        niveau: [
          LIBELLES_NIVEAUX[stagiaire.niveau] ?? stagiaire.niveau,
          anneeFormation ? `${anneeFormation === '1' ? '1re' : `${anneeFormation}e`} année` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        efp,
        etablissement: etablissement?.nom ?? '',
        annee,
        qrPng,
      });
    }
  }

  const docx = await construireDocxCartes(cartes);
  const nom = groupes.length === 1 ? `Cartes_stagiaires_${groupes[0]}` : `Cartes_stagiaires_${groupes.length}_groupes`;
  if (format === 'docx') {
    return {
      tampon: docx,
      nomFichier: `${nom}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sansCompte: cartes.filter((c) => !c.qrPng).length,
    };
  }
  return { tampon: await convertirDocxEnPdf(docx), nomFichier: `${nom}.pdf`, contentType: 'application/pdf' };
}
