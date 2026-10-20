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
import { mutualisationDesFormateurs } from '../espaces/formateursMutualises.service.js';
import { identite, nomCourt } from '../espaces/espaces.service.js';

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
 * ═══ ⚠️ UN FORMATEUR MUTUALISÉ EST COMPTÉ SUR TOUS SES ÉTABLISSEMENTS (2026-10-18) ═══
 * (demande du porteur.) Ses heures supp ne se jugent pas établissement par établissement : 90 h
 * affectées ici et 925 h ailleurs font 1015 h, soit 105 h au-delà de ses 910 h statutaires — et
 * ses semaines se chargent dans les deux. On additionne donc les masses affectées ET les séances
 * de chaque établissement où son matricule figure ; les deux directeurs voient les mêmes chiffres,
 * avec le détail par établissement (`mutualise`).
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
  const [base, seances, etablissement, feries, national, horaires, mutualisation] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }).select('formateurs affectations').lean(),
    Seance.find({ etablissementId, anneeScolaire, statut: { $ne: 'absent' }, estEfm: { $ne: true } })
      .select('formateurMatricule semaine jour seance date')
      .lean(),
    Etablissement.findById(etablissementId).select('calendrier').lean(),
    joursFeries(etablissementId, anneeScolaire).catch(() => ({ joursFeries: [] })),
    calendrierNational(anneeScolaire),
    // L'horaire en vigueur (hiver, été, ramadan) décide de l'heure de fin d'un créneau.
    horairesSeances().then((h) => h.courant),
    // Une panne de la détection ne doit pas priver l'écran : on compte alors ce seul établissement.
    mutualisationDesFormateurs(etablissementId, anneeScolaire).catch(() => ({
      parMatricule: new Map(),
      etablissements: new Map(),
    })),
  ]);

  if (!base) throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });

  const ailleurs = await chargerAilleurs(mutualisation, anneeScolaire, maintenant, horaires);

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
  const heures = heuresParSemaine(seances, maintenant, horaires);

  // Masse affectée : les affectations désignent le formateur par matricule, à défaut par nom.
  const affectees = new Map();
  for (const affectation of base.affectations ?? []) {
    const identifiant = cle(affectation.formateur);
    const total = (Number(affectation.s1Heures) || 0) + (Number(affectation.s2Heures) || 0);
    affectees.set(identifiant, (affectees.get(identifiant) ?? 0) + total);
  }

  const formateurs = (base.formateurs ?? []).map((formateur) => {
    const identifiants = [...new Set([cle(formateur.matricule), cle(formateur.nomComplet)])].filter(Boolean);
    const affecteIci = arrondi(identifiants.reduce((total, id) => total + (affectees.get(id) ?? 0), 0));

    const parSemaine = new Map();
    for (const id of identifiants) {
      for (const [numero, valeur] of heures.get(id) ?? []) {
        parSemaine.set(numero, (parSemaine.get(numero) ?? 0) + valeur);
      }
    }
    const heuresIci = arrondi([...parSemaine.values()].reduce((total, h) => total + h, 0));

    // Mutualisé : ses autres établissements s'ajoutent — masse affectée et séances.
    const autres = ailleurs.get(cle(formateur.matricule)) ?? [];
    const parSemaineAilleurs = new Map();
    for (const autre of autres) {
      for (const [numero, valeur] of autre.parSemaine) {
        parSemaineAilleurs.set(numero, (parSemaineAilleurs.get(numero) ?? 0) + valeur);
        parSemaine.set(numero, (parSemaine.get(numero) ?? 0) + valeur);
      }
    }
    const affecte = arrondi(affecteIci + autres.reduce((total, autre) => total + autre.affecte, 0));
    // La masse statutaire est celle de la PERSONNE : à défaut ici, on prend celle d'ailleurs.
    const statutaire =
      Number(formateur.masseHoraire) || Math.max(0, ...autres.map((autre) => autre.statutaire));

    // 910 h → 26 h/semaine, 1260 h → 36 h ; toute autre masse est un vacataire, sans HS.
    const regime = regimeFormateur(statutaire);
    const quota = quotaHeuresSupp(affecte, statutaire);
    const calcul = calculerHeuresSupp({
      quota,
      mhs: regime.mhs,
      // Le Cumul du mois ne compte la masse que des semaines déjà commencées.
      jusquau: maintenant.date,
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
      mutualise:
        autres.length === 0
          ? null
          : {
              ici: { affecte: affecteIci, heures: heuresIci },
              ailleurs: autres.map(({ nom, affecte: a, heures: h }) => ({ nom, affecte: a, heures: h })),
            },
      mois: calcul.mois,
      totaux: calcul.totaux,
      // Seules les semaines travaillées : le calendrier commun est rendu une fois, à part.
      /*
       * Ce qui a été fait dans chaque AUTRE établissement, pour un formateur mutualisé — nommé :
       * l'écran en fait une carte au survol, l'export un commentaire (2026-10-18). Les deux le
       * reçoivent, d'où le même ajout sur les deux branches.
       */
      semaines: (complet
        ? calcul.semaines
        : calcul.semaines
            .filter((semaine) => semaine.heures > 0)
            .map(({ numero, heures: h, brut, paye }) => ({ numero, heures: h, brut, paye }))
      ).map((semaine) =>
        parSemaineAilleurs.has(semaine.numero)
          ? {
              ...semaine,
              ailleurs: autres
                .filter((autre) => autre.parSemaine.get(semaine.numero))
                .map((autre) => ({ nom: autre.nom, heures: arrondi(autre.parSemaine.get(semaine.numero)) })),
            }
          : semaine
      ),
    };
  });

  formateurs.sort((a, b) => b.totaux.paye - a.totaux.paye || a.nom.localeCompare(b.nom, 'fr'));

  return { anneeScolaire, realiseAu: maintenant, semaines: semainesComptees, formateurs };
}

/** Séances terminées → identifiant du formateur → numéro de semaine → heures. */
function heuresParSemaine(seances, maintenant, horaires) {
  const heures = new Map();
  for (const seance of seances) {
    if (!seanceTerminee(seance, maintenant, horaires)) continue;
    const numero = Number(/-W(\d+)$/.exec(seance.semaine ?? '')?.[1]);
    if (!Number.isInteger(numero)) continue;
    const parSemaine = heures.get(cle(seance.formateurMatricule)) ?? new Map();
    parSemaine.set(numero, (parSemaine.get(numero) ?? 0) + dureeSeance(seance.seance));
    heures.set(cle(seance.formateurMatricule), parSemaine);
  }
  return heures;
}

/**
 * Ce que chaque formateur mutualisé fait AILLEURS : par établissement, sa masse affectée, sa masse
 * statutaire déclarée et ses heures réalisées semaine par semaine.
 *
 * ⚠️ UN SEUL COMPTE PAR ÉTABLISSEMENT (même nom, même complexe) : celui qui lui affecte le plus
 * d'heures. Deux comptes du même lieu porteraient sinon deux fois les mêmes affectations.
 *
 * @returns {Promise<Map<string, Array<{nom, affecte, statutaire, heures, parSemaine: Map}>>>}
 *   clé : matricule normalisé (`cle`)
 */
async function chargerAilleurs({ parMatricule, etablissements }, anneeScolaire, maintenant, horaires) {
  const resultat = new Map();
  if (parMatricule.size === 0) return resultat;

  const matricules = [...parMatricule.keys()];
  const ids = [...new Set([...parMatricule.values()].flat())];
  const [bases, seances] = await Promise.all([
    Base.find({ anneeScolaire, etablissementId: { $in: ids } })
      .select('etablissementId affectations formateurs.matricule formateurs.masseHoraire')
      .lean(),
    Seance.find({
      anneeScolaire,
      etablissementId: { $in: ids },
      formateurMatricule: { $in: matricules },
      statut: { $ne: 'absent' },
      estEfm: { $ne: true },
    })
      .select('etablissementId formateurMatricule semaine jour seance date')
      .lean(),
  ]);

  for (const [matricule, idsAilleurs] of parMatricule) {
    const parIdentite = new Map();
    for (const id of idsAilleurs) {
      const base = bases.find((b) => String(b.etablissementId) === id);
      if (!base) continue;
      const affecte = arrondi(
        (base.affectations ?? [])
          .filter((a) => cle(a.formateur) === cle(matricule))
          .reduce((total, a) => total + (Number(a.s1Heures) || 0) + (Number(a.s2Heures) || 0), 0)
      );
      const fiche = (base.formateurs ?? []).find((f) => cle(f.matricule) === cle(matricule));
      const parSemaine =
        heuresParSemaine(
          seances.filter((x) => String(x.etablissementId) === id && cle(x.formateurMatricule) === cle(matricule)),
          maintenant,
          horaires
        ).get(cle(matricule)) ?? new Map();
      const document = etablissements.get(id);
      const entree = {
        nom: nomCourt(document) ?? 'Autre établissement',
        affecte,
        statutaire: Number(fiche?.masseHoraire) || 0,
        heures: arrondi([...parSemaine.values()].reduce((total, h) => total + h, 0)),
        parSemaine,
      };
      const clef = document ? identite(document) : id;
      const deja = parIdentite.get(clef);
      if (!deja || entree.affecte > deja.affecte || (entree.affecte === deja.affecte && entree.heures > deja.heures)) {
        parIdentite.set(clef, entree);
      }
    }
    if (parIdentite.size > 0) resultat.set(cle(matricule), [...parIdentite.values()]);
  }
  return resultat;
}
