import { Etablissement } from '../../models/Etablissement.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { badRequest } from '../../lib/httpError.js';
import { MODELES, construireDocxFeuillePresence, construirePdfFeuillePresence } from './exportFeuillePresenceDocx.js';

/**
 * Une feuille de présence d'épreuve — EFF ou contrôle continu / EFM — ou la
 * liste des stagiaires, pour un ou plusieurs groupes, en Word ou PDF
 * (2026-10-02, demandes du porteur, canevas transmis). Depuis la page
 * Documents, comme la feuille d'absence hebdomadaire. Une page par groupe ;
 * voir `exportFeuillePresenceDocx.js`.
 *
 * ⚠️ « FILIÈRE » ET « GROUPE » VIENNENT DU NOM DU GROUPE, pas de
 * `Stagiaire.filiere` : les canevas écrivent « DEVOWFS » | « 201 » pour le
 * groupe DEVOWFS201, quand `filiere` porte l'intitulé complet (« Génie
 * Mécanique option… ») qui ne tiendrait pas dans la case. Un nom qui ne suit
 * pas le modèle lettres + numéro garde l'intitulé et le nom entier.
 *
 * ⚠️ L'ÉTABLISSEMENT EST LE NOM ABRÉGÉ (« ISTA BEN M'SIK »), comme « CFP MGD
 * HASSANIA » sur les canevas : le nom complet déborderait.
 *
 * @param {'eff' | 'cc-efm' | 'liste' | 'badges-sans' | 'badges-infos' | 'checklist' | 'verification' | 'retrait-definitif' | 'retrait-provisoire'} cleModele
 */
export async function construireFeuillePresence(etablissementId, anneeScolaire, cleModele, { format, groupes }) {
  const modele = MODELES[cleModele];
  if (!modele) throw badRequest(`Feuille de présence « ${cleModele} » inconnue`, { code: 'MODELE_INCONNU' });

  const [stagiaires, etablissement] = await Promise.all([
    Stagiaire.find({ etablissementId, anneeScolaire, groupes: { $in: groupes } })
      .select('matricule nom prenom nomArabe prenomArabe cin dateNaissance lieuNaissance filiere niveau groupes')
      .sort({ nom: 1, prenom: 1 })
      .lean(),
    Etablissement.findById(etablissementId).select('nom nomAbrege region complexe').lean(),
  ]);

  const efp = etablissement?.nomAbrege || etablissement?.nom || '';
  // « Casablanca-Settat » → « CS », comme sur la check-list des diplômes.
  const region = String(etablissement?.region ?? '')
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((mot) => mot[0].toUpperCase())
    .join('');

  const feuilles = groupes
    .map((groupe) => {
      const liste = stagiaires.filter((s) => (s.groupes ?? []).includes(groupe));
      if (liste.length === 0) return null;
      const decoupe = /^([A-Za-z]+)(\d.*)$/.exec(groupe);
      return {
        groupe,
        efp,
        region,
        etablissement: etablissement?.nom ?? '',
        complexe: etablissement?.complexe ?? '',
        directionRegionale: etablissement?.region ? `Direction Régionale ${etablissement.region}` : '',
        filiere: decoupe ? decoupe[1] : liste[0].filiere ?? '',
        numero: decoupe ? decoupe[2] : groupe,
        niveau: liste.find((s) => s.niveau)?.niveau ?? '',
        effectif: String(liste.length),
        stagiaires: liste.map((s) => ({
          matricule: s.matricule,
          nom: s.nom ?? '',
          prenom: s.prenom ?? '',
          niveau: s.niveau ?? '',
          filiereLibelle: s.filiere ?? '',
          cin: s.cin ?? '',
          nomArabe: s.nomArabe ?? '',
          prenomArabe: s.prenomArabe ?? '',
          // Konosys donne « 06/10/2007 00:00:00 » : la date seule.
          dateNaissance: String(s.dateNaissance ?? '').split(' ')[0],
          lieuNaissance: s.lieuNaissance ?? '',
        })),
      };
    })
    .filter(Boolean);

  if (feuilles.length === 0) {
    throw badRequest('Aucun stagiaire dans les groupes demandés', { code: 'GROUPE_VIDE' });
  }

  const donnees = { anneeScolaire, feuilles };
  const nomFichier =
    feuilles.length === 1
      ? `Feuille_${modele.nomFichier}_${feuilles[0].groupe}`
      : `Feuilles_${modele.nomFichier}_${feuilles.length}_groupes`;

  if (format === 'docx') {
    return {
      tampon: await construireDocxFeuillePresence(modele, donnees),
      nomFichier: `${nomFichier}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  return {
    tampon: await construirePdfFeuillePresence(modele, donnees),
    nomFichier: `${nomFichier}.pdf`,
    contentType: 'application/pdf',
  };
}
