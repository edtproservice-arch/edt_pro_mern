import {
  calculerHeuresSupp,
  dureeSeance,
  enJour,
  fusionnerVacances,
  instantLocal,
  joursDesPeriodes,
  lundiPremiereSemaine,
  moisCompteHeuresSupp,
  moisDeLaSemaine,
  quotaHeuresSupp,
  regimeFormateur,
  seanceTerminee,
  semaineCalendaire,
} from 'shared/domain';
import { Base } from '../../models/Base.js';
import { Seance } from '../../models/Seance.js';
import { Etablissement } from '../../models/Etablissement.js';
import { joursFeries } from '../calendrier/calendrier.service.js';
import { obtenir as calendrierNational } from '../calendrierNational/calendrierNational.service.js';
import { obtenir as horairesSeances } from '../horaires/horaires.service.js';
import { notFound } from '../../lib/httpError.js';

/**
 * Heures supplémentaires de chaque formateur sur l'année (demande du porteur, 2026-10-17).
 * La règle elle-même vit dans `shared/domain/formateurs/heuresSupplementaires.js` ; ici, on
 * rassemble ce qu'elle consomme : masses, séances de la grille, jours fermés.
 *
 * ⚠️ LES HEURES SONT CELLES DE LA GRILLE : une séance où le formateur est ABSENT ne compte pas,
 * ni la surveillance d'un EFM — ce n'est pas un cours donné (cf. `Seance.estEfm`).
 *
 * ⚠️ RÉALISÉES, PAS PLANIFIÉES (demande du porteur, 2026-10-17) : seules comptent les séances
 * TERMINÉES à l'instant du calcul — un jour passé, ou le jour même une fois l'horaire officiel du
 * créneau échu. C'est `seanceTerminee`, la règle du réalisé eDTpro et du badge « Terminé ».
 *
 * ⚠️ UN JOUR FERMÉ EST UN FÉRIÉ OU UN JOUR DE VACANCES, du lundi au samedi. Un férié tombant un
 * dimanche ne réduit pas le seuil de la semaine : on n'y travaille pas de toute façon.
 */

const JOURS_OUVRES = 6;
const cle = (valeur) => String(valeur ?? '').trim().toUpperCase();
const arrondi = (valeur) => Math.round(valeur * 100) / 100;

/**
 * @param {{complet?: boolean, maintenant?: {date: string, heure: string}}} [options]
 *   `complet` : chaque formateur garde le détail de TOUTES les semaines (cumul, reste, motif de
 *   non-paiement) — c'est ce que lit l'export Excel. L'écran, lui, ne reçoit que les semaines
 *   travaillées. `maintenant` : l'instant jusqu'auquel une séance compte comme réalisée.
 */
export async function heuresSupplementaires(
  etablissementId,
  anneeScolaire,
  { complet = false, maintenant = instantLocal(new Date()) } = {}
) {
  const [base, seances, etablissement, feries, national, horaires] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }).select('formateurs affectations').lean(),
    Seance.find({ etablissementId, anneeScolaire, statut: { $ne: 'absent' }, estEfm: { $ne: true } })
      .select('formateurMatricule semaine jour seance date')
      .lean(),
    Etablissement.findById(etablissementId).select('calendrier').lean(),
    joursFeries(etablissementId, anneeScolaire).catch(() => ({ joursFeries: [] })),
    calendrierNational(anneeScolaire),
    // L'horaire en vigueur (hiver, été, ramadan) décide de l'heure de fin d'un créneau.
    horairesSeances().then((h) => h.courant),
  ]);

  if (!base) throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });

  const rentrees = national.rentrees ?? [];
  const vacances = fusionnerVacances(
    national.vacances,
    // Les vacances propres portent `libelle`, celles du réseau `nom` : on aligne pour garder le motif.
    (etablissement?.calendrier?.vacances ?? []).map((p) => ({ ...p, nom: p.nom ?? p.libelle })),
    etablissement?.calendrier?.vacancesEcartees ?? []
  );
  // Jour fermé → motif, pour que l'écran dise POURQUOI le seuil d'une semaine a baissé.
  const fermes = new Map();
  for (const periode of vacances) {
    for (const jour of joursDesPeriodes([periode])) {
      fermes.set(jour, { type: 'vacances', motif: periode.nom || 'Vacances' });
    }
  }
  for (const ferie of feries.joursFeries ?? []) {
    const jour = enJour(ferie.date);
    // Le type et l'intitulé arabe servent à la carte au survol, comme au chronogramme.
    if (jour) {
      fermes.set(jour, {
        type: 'ferie',
        motif: ferie.intitule || 'Jour férié',
        intituleAr: ferie.intituleAr ?? '',
        estime: Boolean(ferie.estime),
      });
    }
  }

  /*
   * Les semaines de l'année, de S1 à la veille de la S1 suivante. À MIDI, comme
   * `joursDesPeriodes` : un changement d'heure ferait sinon glisser un jour.
   */
  const debut = lundiPremiereSemaine(anneeScolaire, rentrees);
  const fin = lundiPremiereSemaine(anneeScolaire + 1);
  const semaines = [];
  const curseur = new Date(debut);
  curseur.setHours(12, 0, 0, 0);
  for (let numero = 1; curseur < fin && numero <= 60; numero += 1) {
    const lundi = enJour(curseur);
    const fermesSemaine = [];
    const jour = new Date(curseur);
    for (let i = 0; i < JOURS_OUVRES; i += 1) {
      const date = enJour(jour);
      if (fermes.has(date)) fermesSemaine.push({ date, ...fermes.get(date) });
      jour.setDate(jour.getDate() + 1);
    }
    const joursFermes = fermesSemaine.length;
    const dimanche = new Date(curseur);
    dimanche.setDate(dimanche.getDate() + 6);
    semaines.push({
      numero,
      // Le numéro ISO, celui des états de l'administration (« S-40 ») : `numero` est celui de
      // l'année de formation.
      calendaire: semaineCalendaire(lundi),
      lundi,
      dimanche: enJour(dimanche),
      mois: moisDeLaSemaine(lundi),
      joursFermes,
      fermes: fermesSemaine,
    });
    curseur.setDate(curseur.getDate() + 7);
  }
  // Juillet et août sont hors du calcul (2026-10-17) : leurs semaines ne s'affichent même pas.
  const semainesComptees = semaines.filter((semaine) => moisCompteHeuresSupp(semaine.mois));

  // Heures de grille : identifiant du formateur → numéro de semaine → heures.
  const heures = new Map();
  for (const seance of seances) {
    if (!seanceTerminee(seance, maintenant, horaires)) continue;
    const numero = Number(/-W(\d+)$/.exec(seance.semaine ?? '')?.[1]);
    if (!Number.isInteger(numero)) continue;
    const parSemaine = heures.get(cle(seance.formateurMatricule)) ?? new Map();
    parSemaine.set(numero, (parSemaine.get(numero) ?? 0) + dureeSeance(seance.seance));
    heures.set(cle(seance.formateurMatricule), parSemaine);
  }

  // Masse affectée : les affectations désignent le formateur par matricule, à défaut par nom.
  const affectees = new Map();
  for (const affectation of base.affectations ?? []) {
    const identifiant = cle(affectation.formateur);
    const total = (Number(affectation.s1Heures) || 0) + (Number(affectation.s2Heures) || 0);
    affectees.set(identifiant, (affectees.get(identifiant) ?? 0) + total);
  }

  const formateurs = (base.formateurs ?? []).map((formateur) => {
    const identifiants = [...new Set([cle(formateur.matricule), cle(formateur.nomComplet)])].filter(Boolean);
    const statutaire = Number(formateur.masseHoraire) || 0;
    const affecte = arrondi(identifiants.reduce((total, id) => total + (affectees.get(id) ?? 0), 0));

    const parSemaine = new Map();
    for (const id of identifiants) {
      for (const [numero, valeur] of heures.get(id) ?? []) {
        parSemaine.set(numero, (parSemaine.get(numero) ?? 0) + valeur);
      }
    }

    // 910 h → 26 h/semaine, 1260 h → 36 h ; toute autre masse est un vacataire, sans HS.
    const regime = regimeFormateur(statutaire);
    const quota = quotaHeuresSupp(affecte, statutaire);
    const calcul = calculerHeuresSupp({
      quota,
      mhs: regime.mhs,
      semaines: semainesComptees.map((semaine) => ({ ...semaine, heures: parSemaine.get(semaine.numero) ?? 0 })),
    });

    return {
      matricule: formateur.matricule ?? '',
      nom: formateur.nomComplet,
      statutaire,
      affecte,
      sansStatutaire: statutaire <= 0,
      statut: regime.statut,
      mhs: regime.mhs,
      mois: calcul.mois,
      totaux: calcul.totaux,
      // Seules les semaines travaillées : le calendrier commun est rendu une fois, à part.
      semaines: complet
        ? calcul.semaines
        : calcul.semaines
            .filter((semaine) => semaine.heures > 0)
            .map(({ numero, heures: h, brut, paye }) => ({ numero, heures: h, brut, paye })),
    };
  });

  formateurs.sort((a, b) => b.totaux.paye - a.totaux.paye || a.nom.localeCompare(b.nom, 'fr'));

  return { anneeScolaire, realiseAu: maintenant, semaines: semainesComptees, formateurs };
}
