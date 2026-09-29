import { creerStockage } from './stockageLocal';

/**
 * Le panneau du taux, à droite du graphe à bâtons, est-il DÉPLIÉ ?
 *
 * ═══ POURQUOI CE RÉGLAGE EXISTE ═══
 * L'anneau et ses mesures décrivent la SÉLECTION ; le graphe, lui, compare les
 * sujets entre eux. Les deux se lisent ensemble — d'où le panneau — mais sur un
 * écran étroit, ou quand on vient seulement comparer des barres, il prend une
 * place qu'on préfère rendre au graphique.
 *
 * ⚠️ UNE PRÉFÉRENCE DE POSTE, PAS UNE DONNÉE : elle reste dans le navigateur et
 * ne part jamais au serveur. Et elle PERSISTE — un état local se serait remis à
 * zéro à chaque retour sur la page, ce qui aurait obligé à replier le panneau
 * dix fois par jour. Même choix que l'épingle de la barre latérale.
 */
const PANNEAU = creerStockage('edtpro.avancement.panneau-taux', true);

export const usePanneauTaux = PANNEAU.utiliser;

export function basculerPanneauTaux() {
  PANNEAU.definir((courant) => !courant);
}

/**
 * Le panneau de l'établissement, à droite du graphe « Semaine par semaine,
 * face au rythme régional » — une préférence SÉPARÉE de celle ci-dessus.
 *
 * ⚠️⚠️ INDÉPENDANTE DU PANNEAU DU GRAPHE À BÂTONS (correction du porteur,
 * 2026-09-25 : « si je masque un card, l'autre card en bas ne doit pas se
 * masquer — être indépendant l'un de l'autre »). Les deux panneaux
 * partageaient la MÊME clé de stockage — replier l'un repliait donc aussi
 * l'autre, silencieusement, sur un écran qu'on n'était même pas en train de
 * regarder. Ce sont deux réglages de POSTE distincts, sur deux graphes
 * distincts, qui n'ont pas à voyager ensemble.
 */
const PANNEAU_ETABLISSEMENT = creerStockage('edtpro.avancement.panneau-etablissement', true);

export const usePanneauEtablissement = PANNEAU_ETABLISSEMENT.utiliser;

export function basculerPanneauEtablissement() {
  PANNEAU_ETABLISSEMENT.definir((courant) => !courant);
}
