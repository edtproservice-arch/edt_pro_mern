import crypto from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * ═══ LE QR DE LA CARTE DE STAGIAIRE (2026-10-11, demande du porteur : « si je
 * scanne, il me permet de me connecter automatiquement à la session de ce
 * stagiaire ») ═══
 *
 * Le QR porte un lien `APP_URL/carte/<jeton>` ; le jeton est SIGNÉ, pas stocké :
 *
 *   <utilisateurId>.<version>.<anneeScolaire>.<signature>
 *
 * ⚠️ LA CARTE EST UNE CLÉ DU COMPTE : qui la tient — ou en a pris une photo — se
 * connecte. D'où :
 *   - une signature HMAC sur une clé DÉRIVÉE du secret des sessions : le jeton
 *     ne se devine ni ne se fabrique à partir du matricule ;
 *   - `version` : la carte est RÉVOCABLE. Renouveler les cartes d'un stagiaire
 *     (carte perdue) incrémente `User.versionCarte`, et l'ancien QR ne vaut plus rien ;
 *   - `anneeScolaire` : une carte ne sert que pour son année de formation ;
 *   - côté service : un compte STAGIAIRE seulement, actif et approuvé.
 *
 * Rien n'est enregistré par carte : les cartes se réimpriment à l'identique tant
 * qu'on ne les renouvelle pas.
 */
const CLE = () => crypto.createHmac('sha256', env.JWT_REFRESH_SECRET).update('edtpro:carte-stagiaire:v1').digest();

const signer = (charge) => crypto.createHmac('sha256', CLE()).update(charge).digest('base64url').slice(0, 32);

export function creerJetonCarte({ utilisateurId, version, anneeScolaire }) {
  const charge = `${utilisateurId}.${Number(version) || 1}.${anneeScolaire}`;
  return `${charge}.${signer(charge)}`;
}

/** Le contenu d'un jeton à la signature VALIDE — `null` sinon, sans dire pourquoi. */
export function lireJetonCarte(jeton) {
  const morceaux = String(jeton ?? '').split('.');
  if (morceaux.length !== 4) return null;
  const [utilisateurId, version, annee, signature] = morceaux;
  if (!/^[a-f0-9]{24}$/.test(utilisateurId) || !/^\d{1,6}$/.test(version) || !/^\d{4}$/.test(annee)) return null;

  const attendue = Buffer.from(signer(`${utilisateurId}.${version}.${annee}`));
  const recue = Buffer.from(signature);
  // ⚠️ Comparaison à temps constant : une comparaison ordinaire laisse deviner la signature octet par octet.
  if (attendue.length !== recue.length || !crypto.timingSafeEqual(attendue, recue)) return null;

  return { utilisateurId, version: Number(version), anneeScolaire: Number(annee) };
}
