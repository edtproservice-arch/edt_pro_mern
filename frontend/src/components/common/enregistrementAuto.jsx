import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, TriangleAlert } from 'lucide-react';

/**
 * L'enregistrement automatique : la minuterie, et l'état qu'elle affiche.
 *
 * ═══ POURQUOI C'EST UN MODULE COMMUN ═══
 * (2026-09-03, quand le calendrier national l'a demandé à son tour.) La règle
 * vivait dans `CadreReglage`, le cadre des écrans de « Paramètres ». Or elle
 * n'a rien de propre à ce cadre — et surtout, elle porte une correction chèrement
 * acquise (voir `useEnregistrementAuto`) qu'une seconde minuterie écrite à côté
 * aurait immédiatement rouverte.
 *
 * Deux précautions, sans lesquelles l'automatisme devient un piège :
 *   - une PAUSE de {@link REPOS} ms, sinon chaque frappe déclenche une requête ;
 *   - un ÉTAT VISIBLE, sinon on ne sait jamais si c'est parti.
 */

/** Délai avant écriture, en millisecondes. */
export const REPOS = 900;

/**
 * Écrit `onEnregistrer()` après une pause, dès que `modifie` est vrai.
 *
 * ═══ ⚠️⚠️ LA MINUTERIE SE RÉ-ARME SUR LA VALEUR, PAS SUR LE BOOLÉEN ═══
 * (correction du 2026-08-26, à l'origine du défaut « Modification en attente… »
 * qui ne partait jamais.) Un effet qui ne dépend que de `modifie` ne se rejoue
 * pas tant que celui-ci reste vrai : une seconde saisie faite pendant qu'un
 * enregistrement est en vol — ou après un enregistrement dont la comparaison ne
 * retombe pas à zéro — N'ARME PLUS RIEN, et n'est jamais écrite.
 *
 * ⚠️ LA FONCTION EST GARDÉE DANS UNE RÉFÉRENCE : écrite en place par l'appelant,
 * elle change à chaque rendu et relancerait la minuterie indéfiniment pendant la
 * saisie — l'écriture n'arriverait jamais.
 *
 * @param {object} options
 * @param {boolean} options.modifie      y a-t-il quelque chose à écrire ?
 * @param {*} [options.valeur]           ce qu'on écrirait — sert d'empreinte
 * @param {Function} options.onEnregistrer
 * @param {Function} [options.avantEcriture]  appelé juste avant, pour l'appelant
 *   qui a de la comptabilité à faire (pile d'annulation, trace de modification).
 * @returns {boolean} vrai dès la première écriture — l'accusé de réception.
 */
/*
 * `repos` : la pause avant d'écrire. 900 ms par défaut, taillés pour la FRAPPE
 * — on écrit après le dernier caractère. Une grille où l'on CHOISIT une valeur
 * (le chronogramme) n'a pas de frappe à attendre : une pause plus courte y rend
 * la saisie visible plus tôt chez les collègues (2026-09-13).
 */
/*
 * ═══ ⚠️⚠️ `enCours` : JAMAIS DEUX ÉCRITURES EN MÊME TEMPS (2026-09-13) ═══
 * La minuterie partait sans regarder si l'écriture précédente était revenue.
 * Or une écriture VERSIONNÉE (étape d3) part avec la version qu'elle a lue : la
 * seconde, lancée avant le retour de la première, portait donc la MÊME version
 * — et le serveur la refusait en 409, comme si un collègue avait écrit entre-
 * temps. On se refusait à soi-même, et la saisie refusée était perdue. La pause
 * ramenée à 300 ms (chronogramme, affectations) rendait le cas ordinaire.
 *
 * Tant qu'une écriture est en vol, rien ne s'arme ; à son retour, `enCours`
 * repasse à faux, l'effet se rejoue, et ce qui a été saisi entre-temps part avec
 * la NOUVELLE version. Facultatif : sans lui, le comportement d'avant.
 */
export function useEnregistrementAuto({
  modifie,
  valeur,
  onEnregistrer,
  avantEcriture,
  repos = REPOS,
  enCours = false,
}) {
  const [enregistreUneFois, setEnregistreUneFois] = useState(false);

  const enregistrer = useRef(onEnregistrer);
  enregistrer.current = onEnregistrer;

  const avant = useRef(avantEcriture);
  avant.current = avantEcriture;

  /*
   * `valeur` est facultative : à défaut, on retombe sur l'ancien comportement,
   * qui reste juste pour un écran à une seule écriture.
   */
  const empreinte = valeur === undefined ? null : JSON.stringify(valeur);

  useEffect(() => {
    if (!modifie || enCours || !enregistrer.current) return undefined;

    const minuterie = setTimeout(() => {
      avant.current?.();
      enregistrer.current?.();
      setEnregistreUneFois(true);
    }, repos);

    // La minuterie repart à chaque changement : on écrit après la DERNIÈRE
    // frappe, pas après la première.
    return () => clearTimeout(minuterie);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modifie, empreinte, enCours]);

  return enregistreUneFois;
}

/**
 * Ce que l'écran dit de son enregistrement — quatre états, toujours au même
 * endroit. C'est le seul accusé de réception dont dispose une page sans bouton.
 */
export function IndicateurEnregistrement({ modifie, enCours, echec, enregistreUneFois }) {
  /*
   * ⚠️ L'ÉCHEC PASSE AVANT TOUT LE RESTE. Sans bouton, c'est la SEULE chose qui
   * distingue « c'est écrit » de « ça n'est pas parti » — et un écran qui
   * afficherait « Enregistré » après un refus serait pire que pas d'indicateur
   * du tout.
   */
  if (echec) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-destructive">
        <TriangleAlert className="h-4 w-4" />
        Non enregistré
      </span>
    );
  }

  if (enCours) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Enregistrement…
      </span>
    );
  }

  if (modifie) {
    return <span className="text-sm text-muted-foreground">Modification en attente…</span>;
  }

  if (enregistreUneFois) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-success">
        <Check className="h-4 w-4" />
        Enregistré
      </span>
    );
  }

  /*
   * Badge vert au repos : il annonce que la page s'enregistre seule, et c'est ce
   * qui remplace le bouton disparu. En gris, il passait pour une mention
   * technique et laissait planer le doute — « faut-il valider quelque part ? ».
   */
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2 py-1 text-xs font-medium text-success">
      <Check className="h-3.5 w-3.5" />
      Enregistrement automatique
    </span>
  );
}
