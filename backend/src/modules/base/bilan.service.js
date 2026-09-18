import ExcelJS from 'exceljs';
import { calculerBilan } from 'shared/domain';

/**
 * Feuilles Excel du bilan offre / demande.
 * ← buildBilanSheets() + exportBilanExcel() de affectation-carte.js:2932-3013
 *
 * ═══ POURQUOI LE SERVEUR, ALORS QUE L'EXISTANT LE FAISAIT DANS LE NAVIGATEUR ═══
 * L'existant téléchargeait SheetJS (861 Ko) depuis un CDN au moment du clic, et
 * échouait donc sans réseau — ou si le CDN filtrait. Le serveur a déjà
 * `exceljs`, qui sert à l'import e-note : le classeur part en une réponse, sans
 * dépendance supplémentaire ni script tiers, et la CSP stricte prévue en
 * Phase 11 reste applicable.
 *
 * La carte est envoyée par le client parce qu'elle n'est PAS ENCORE
 * ENREGISTRÉE : on exporte ce qui est à l'écran, comme l'existant. Le bilan est
 * recalculé ici par la MÊME fonction de domaine que l'écran — les chiffres du
 * classeur ne peuvent donc pas diverger de ceux affichés.
 */

const part = (valeur, total) => (total > 0 ? Math.round((valeur / total) * 100) : 0);

const enteteFormateur = (ecart) => [
  'Formateur',
  'Mle',
  'Statutaire (h)',
  'Affecté S1 (h)',
  'Affecté S2 (h)',
  'Affecté total (h)',
  ecart,
  'Charge (%)',
];

const ligneFormateur = (f, ecart) => [
  f.nom,
  f.matricule,
  f.statutaire,
  f.s1,
  f.s2,
  f.affecte,
  ecart,
  f.taux,
];

/**
 * Les quatre tableaux de la modale, dans son ordre, puis la synthèse.
 *
 * ═══ MÊMES COLONNES QU'À L'ÉCRAN ═══
 * Mêmes en-têtes, même ordre, même ligne de total : le classeur se relit à côté
 * de l'écran sans avoir à retrouver quelle colonne correspond à quoi. La
 * synthèse vient EN DERNIER — on la consulte après le détail, et en tête elle
 * repoussait les tableaux d'un onglet.
 *
 * Les valeurs restent NUMÉRIQUES, l'unité portée par l'en-tête : « 1 060 h »
 * est du texte pour Excel, et une colonne d'heures qu'on ne peut pas sommer n'a
 * aucun intérêt dans un tableur.
 *
 * @returns {Array<{nom: string, entete: string[], lignes: Array[]}>}
 */
export function feuillesBilan(bilan) {
  const modulesNonCouverts = bilan.metiers.reduce((somme, m) => somme + m.modulesNonCouverts, 0);
  const modules = bilan.metiers.reduce((somme, m) => somme + m.modules, 0);

  return [
    {
      nom: 'Besoin par métier',
      entete: [
        'Métier',
        'Modules non couverts',
        'Modules',
        'Demande (h)',
        'Couvert (h)',
        'Besoin (h)',
        'Part non couverte (%)',
      ],
      lignes: [
        ...[...bilan.metiers]
          .sort((a, b) => b.besoin - a.besoin || a.metier.localeCompare(b.metier, 'fr'))
          .map((m) => [
            m.metier,
            m.modulesNonCouverts,
            m.modules,
            m.demande,
            m.couvert,
            m.besoin,
            part(m.besoin, m.demande),
          ]),
        [
          'Total',
          modulesNonCouverts,
          modules,
          bilan.demande.total,
          bilan.demande.couvert,
          bilan.besoin,
          bilan.besoinTaux,
        ],
      ],
    },

    {
      nom: 'Formateurs sous-affectés',
      entete: enteteFormateur('Disponible (h)'),
      lignes: [
        ...bilan.sousAffectes.map((f) => ligneFormateur(f, f.disponible)),
        [
          'Total',
          `${bilan.sousAffectes.length} formateur(s)`,
          '',
          '',
          '',
          '',
          bilan.reconciliation.disponible,
          '',
        ],
      ],
    },

    {
      nom: 'Formateurs en surcharge',
      entete: enteteFormateur('Dépassement (h)'),
      lignes: [
        ...bilan.surcharges.map((f) => ligneFormateur(f, f.depassement)),
        [
          'Total',
          `${bilan.surcharges.length} formateur(s)`,
          '',
          '',
          '',
          '',
          bilan.reconciliation.surcharge,
          '',
        ],
      ],
    },

    {
      nom: 'Demande par métier',
      entete: ['Métier', 'Groupes', 'Modules', 'Demande (h)', 'Couvert (h)', 'Couverture (%)'],
      lignes: [
        ...bilan.metiers.map((m) => [
          m.metier,
          m.groupes,
          m.modules,
          m.demande,
          m.couvert,
          part(m.couvert, m.demande),
        ]),
        ['Total', '', '', bilan.demande.total, bilan.demande.couvert, bilan.demande.taux],
      ],
    },

    {
      // La réconciliation n'est pas un tableau : ses termes sont ici des
      // indicateurs, avec le résumé de l'en-tête de la modale.
      nom: 'Synthèse',
      entete: ['Indicateur', 'Valeur'],
      lignes: [
        ['Offre — masse horaire statutaire (h)', bilan.offre.statutaire],
        ['Offre — masse horaire affectée (h)', bilan.offre.affecte],
        ['Offre — taux de charge (%)', bilan.offre.taux],
        ['Demande — total (h)', bilan.demande.total],
        ['Demande — couvert (h)', bilan.demande.couvert],
        ['Demande — taux de couverture (%)', bilan.demande.taux],
        ['Besoin — non couvert (h)', bilan.besoin],
        ['Besoin — part non couverte (%)', bilan.besoinTaux],
        ['Formateurs sous-affectés', bilan.sousAffectes.length],
        ['Capacité encore disponible (h)', bilan.reconciliation.disponible],
        ['Formateurs en surcharge', bilan.surcharges.length],
        ['Dépassement cumulé (h)', bilan.reconciliation.surcharge],
        ['Heures affectées sans capacité déclarée (h)', bilan.reconciliation.heuresSansCapacite],
        ['Heures affectées hors liste (h)', bilan.reconciliation.horsListe],
        ['Écart net offre − affecté (h)', bilan.reconciliation.ecartNet],
      ],
    },
  ];
}

/** Classeur vide, signature commune aux deux exports. */
export function nouveauClasseur() {
  const classeur = new ExcelJS.Workbook();

  classeur.creator = 'EDT Pro';
  classeur.created = new Date();

  return classeur;
}

/** Ajoute une feuille décrite par `{nom, entete, lignes}`. */
export function ajouterFeuille(classeur, { nom, entete, lignes }) {
  const feuille = classeur.addWorksheet(nom);

  feuille.addRow(entete);
  feuille.getRow(1).font = { bold: true };
  for (const ligne of lignes) feuille.addRow(ligne);

  // Sans largeur explicite, « Développement /réseau Infrastructure /Design
  // Digital » sort tronqué à l'ouverture — le classeur est fait pour être lu.
  feuille.columns.forEach((colonne, index) => {
    const contenus = [entete[index], ...lignes.map((ligne) => ligne[index])];
    const plusLong = Math.max(...contenus.map((valeur) => String(valeur ?? '').length));
    colonne.width = Math.min(50, Math.max(12, plusLong + 2));
  });

  feuille.views = [{ state: 'frozen', ySplit: 1 }];

  return feuille;
}

export async function construireClasseurBilan({ carte, anneeScolaire }) {
  const bilan = calculerBilan(carte);
  const classeur = nouveauClasseur();

  for (const feuille of feuillesBilan(bilan)) ajouterFeuille(classeur, feuille);

  return {
    tampon: Buffer.from(await classeur.xlsx.writeBuffer()),
    nomFichier: `Besoin_demande_par_metier_${anneeScolaire}-${anneeScolaire + 1}.xlsx`,
    resume: {
      metiers: bilan.metiers.length,
      modulesNonCouverts: bilan.lignes.length,
      sousAffectes: bilan.sousAffectes.length,
    },
  };
}
