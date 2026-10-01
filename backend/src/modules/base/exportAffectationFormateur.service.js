import { affectationsDuFormateur } from 'shared/domain';
import { Etablissement } from '../../models/Etablissement.js';
import { badRequest } from '../../lib/httpError.js';
import { construireDocxAffectationFormateur } from './exportAffectationFormateurDocx.js';
import { construirePdfAffectationFormateur } from './exportAffectationFormateurPdf.js';
import { construireXlsxAffectationFormateur } from './exportAffectationFormateurXlsx.js';

/**
 * L'affectation annuelle d'UN formateur, en Word, PDF ou Excel (2026-10-01,
 * demande du porteur : « en page affectation en mode formateur je veux ajouter
 * le téléchargement en word, pdf, excel d'affectation », canevas transmis).
 *
 * ═══ ⚠️ LA CARTE DE L'ÉCRAN, PAS CELLE DE LA BASE ═══ Comme l'export Excel de
 * la carte (`/carte/export`), l'écran envoie sa carte PROJETÉE — les séances
 * synchrones proposées par défaut comprises, et les retouches pas encore
 * enregistrées. Le document dit donc exactement ce que la fiche du formateur
 * affiche, et `affectationsDuFormateur` est la MÊME fonction qui la remplit :
 * une séance synchrone fusionnée n'y compte qu'une fois.
 */
export async function construireExportAffectationFormateur({ etablissementId, anneeScolaire, carte, formateur, format }) {
  const lignes = affectationsDuFormateur(carte.groupes ?? [], formateur);
  if (lignes.length === 0) {
    throw badRequest(`Aucune affectation pour « ${formateur} »`, { code: 'FORMATEUR_SANS_AFFECTATION' });
  }

  const etablissement = await Etablissement.findById(etablissementId).select('nom').lean();

  const libelleModule = (ligne) => (ligne.intitule ? `${ligne.module} - ${ligne.intitule}` : ligne.module);

  const presentiel = lignes
    .filter((ligne) => ligne.type === 'presentiel')
    .map((ligne) => ({ groupe: ligne.groupe, module: libelleModule(ligne), heures: ligne.total }));

  const synchrone = lignes
    .filter((ligne) => ligne.type === 'synchrone')
    .map((ligne) => ({ groupe: ligne.groupes.join(' / '), module: libelleModule(ligne), heures: ligne.total }));

  const somme = (liste) => Math.round(liste.reduce((total, ligne) => total + ligne.heures, 0) * 100) / 100;
  const totalPresentiel = somme(presentiel);
  const totalSynchrone = somme(synchrone);

  const donnees = {
    etablissement: etablissement ?? {},
    anneeScolaire,
    formateur,
    presentiel,
    synchrone,
    totalPresentiel,
    totalSynchrone,
    totalGlobal: Math.round((totalPresentiel + totalSynchrone) * 100) / 100,
  };

  if (format === 'docx') return construireDocxAffectationFormateur(donnees);
  if (format === 'xlsx') return construireXlsxAffectationFormateur(donnees);
  return construirePdfAffectationFormateur(donnees);
}
