import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import CarteEtablissement from '@/features/configuration/carte/CarteEtablissement';
import { repliCase } from '@/features/configuration/carte/casesCarte';
import { enregistrerCarte } from '@/features/configuration/api';
import Alerte from '@/components/common/Alerte';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { useDroitPage } from '@/features/partages/useDroitPage';
import CurseursDistants from '@/features/tempsReel/CurseursDistants';
import { useSallePage } from '@/features/tempsReel/useSallePage';
import { useEmetteurCurseur } from '@/features/tempsReel/useEmetteurCurseur';
import { fractionDansCase } from '@/features/tempsReel/positions';
import { lireCurseurs } from '@/lib/tempsReel';
import { useAnneeActive } from '@/lib/anneeActive';
import { estVersionPerimee } from '@/lib/useBrouillonVersionne';
import CadreReglage from './CadreReglage';
import { useCarteEnregistree } from './useCarteEnregistree';
import { integrerBase } from './baseAnnoncee';

/** Ce que relit une annonce qui ne porte pas la base : la base elle-même. */
const CLES_A_RELIRE = [['base']];

/*
 * Ni semaine, ni période, ni axe : la clé d'une case de la carte la désigne
 * seule (`casesCarte.js`). ⚠️ Un objet STABLE et non `null` : `memeVue` refuse
 * une vue absente.
 */
const VUE_CARTE = {};

/*
 * ═══ ENREGISTREMENT QUASI IMMÉDIAT (2026-09-13) ═══ 300 ms au lieu de 900, comme
 * le chronogramme : la carte se saisit par CHOIX — une liste, un interrupteur,
 * une case à cocher — pas par frappes. Les champs de masse horaire, eux, se
 * tapent ; une valeur intermédiaire peut partir, la dernière la remplace aussitôt.
 * ⚠️ Tenable parce qu'aucune écriture ne part tant que la précédente est en vol
 * (`useEnregistrementAuto`) : la carte REMPLACE la base, et deux envois croisés
 * porteraient la même version — le second serait refusé en 409 par soi-même.
 */
const REPOS_CARTE = 300;

/**
 * Carte d'établissement : filières, groupes et affectations.
 * ← partials/affectation-carte.html + assets/js/affectation-carte.js
 *
 * ═══ ELLE PART DE CE QUI EST ENREGISTRÉ ═══
 * Contrairement à l'assistant, qui construit de zéro, cet écran recharge la
 * carte depuis la base : on y retrouve ses filières, ses groupes et ses
 * affectations. C'est ce que faisait `initAffectationLogic()`.
 *
 * ═══ PARTAGEABLE, SOUS VERSION OPTIMISTE (Phase 5bis, étape d3) ═══
 * Enregistrer la carte REMPLACE la base entière. La carte part donc avec la
 * version de la base dont elle est tirée : si un collègue a enregistré depuis
 * (carte, correction d'un formateur, import), le serveur refuse en 409 et la
 * page reprend sa version. Un invité « peut consulter » parcourt la carte sans
 * pouvoir la changer.
 *
 * ⚠️ LA CARTE VIT DANS `CarteEtablissement`, PAS ICI : le brouillon versionné
 * des autres pages ne s'applique pas tel quel. La version et l'adoption sont
 * tenues ici ; la carte, elle, se REPOSE par `reprendre`, comme pour « Défaire ».
 */
export default function PageAffectations() {
  const cache = useQueryClient();
  const { lectureSeule } = useDroitPage('affectations');
  const enregistree = useCarteEnregistree();

  /*
   * ═══ LA BASE D'UN COLLÈGUE ARRIVE AVEC SON ANNONCE (2026-09-13) ═══
   * Le serveur joint la base présentée à l'annonce de chaque écriture : on la
   * pose dans le cache de `GET /base`, sans relecture. La suite est celle d'une
   * relecture — la carte se reconstruit, et l'adoption ci-dessous la reprend si
   * rien n'est en cours de saisie ici.
   */
  const appliquerAnnonce = useCallback(
    (message) => {
      if (!message.base) return false;
      cache.setQueryData(['base'], (donnees) => integrerBase(donnees, message.base));
      return true;
    },
    [cache]
  );

  const anneeActive = useAnneeActive();
  const salle = useSallePage('affectations', {
    anneeScolaire: anneeActive,
    clesARelire: CLES_A_RELIRE,
    // Sans année choisie, celle du serveur — la même règle que l'en-tête autonome.
    anneeParDefaut: true,
    appliquer: appliquerAnnonce,
  });

  /*
   * ═══ MON CURSEUR, RELATIF À UNE CASE ═══ Une seule écoute pour toute la carte ;
   * `closest('[data-case]')` retrouve la cellule, l'en-tête d'ensemble ou le bloc
   * synchrone survolé.
   *
   * ⚠️ UN ÉVÉNEMENT VENU D'UN PORTAIL EST IGNORÉ : React fait remonter jusqu'ici
   * ceux d'une liste déroulante ouverte ou d'une fenêtre, qui ne sont pas dans la
   * carte. Y lire « aucune case » effacerait mon curseur au moment même où je
   * choisis un formateur — le cadre « X modifie » dit alors où je suis.
   */
  const zoneCarte = useRef(null);
  const emettreCurseur = useEmetteurCurseur(salle.envoyerCurseur);
  const surUneCase = useRef(false);

  const suivreSouris = (evenement) => {
    if (!zoneCarte.current?.contains(evenement.target)) return;
    const cellule = evenement.target.closest?.('[data-case]');
    if (!cellule) {
      // Une seule fois : hors des cases, rien à envoyer à chaque mouvement.
      if (surUneCase.current) emettreCurseur(null);
      surUneCase.current = false;
      return;
    }
    const fraction = fractionDansCase(cellule.getBoundingClientRect(), evenement.clientX, evenement.clientY);
    if (!fraction) return;
    surUneCase.current = true;
    emettreCurseur({ cle: cellule.dataset.case, ...fraction });
  };

  const quitterCarte = () => {
    surUneCase.current = false;
    emettreCurseur(null);
  };

  /*
   * ═══ LA CASE OUVERTE ═══ — une liste de formateurs, ou un champ de masse
   * horaire. Les collègues la voient encadrée « X modifie » ; celle d'un ensemble
   * qu'ils ont replié se pose sur son en-tête (`repliCase`).
   */
  const focusCourant = useRef(null);
  const { envoyerFocus, rejoint } = salle;

  const surOuverture = useCallback(
    (cle, ouvert) => {
      if (ouvert) {
        focusCourant.current = cle;
        envoyerFocus({ cle });
        /*
         * ⚠️ UNE CASE QU'UN COLLÈGUE SAISIT DÉJÀ : pas interdite — il a pu la
         * laisser ouverte en partant — mais DITE. Lecture impérative : s'abonner
         * aux curseurs ferait re-rendre la carte vingt fois par seconde.
         */
        for (const { utilisateur, focus } of lireCurseurs('affectations').values()) {
          if (focus?.cle === cle) {
            toast.warning(`${utilisateur.nom} est en train de modifier cette case`, {
              description:
                'La carte s’enregistre d’un bloc : si vous la modifiez tous les deux au même moment, le second reprendra la version en place.',
            });
            break;
          }
        }
      } else if (focusCourant.current === cle) {
        focusCourant.current = null;
        envoyerFocus(null);
      }
    },
    [envoyerFocus]
  );

  // Une reconnexion repart d'une salle vierge : on redit la case ouverte.
  useEffect(() => {
    if (rejoint && focusCourant.current) envoyerFocus({ cle: focusCourant.current });
  }, [rejoint, envoyerFocus]);

  const [courante, setCourante] = useState(null);
  const [modifie, setModifie] = useState(false);

  /*
   * De quoi REPOSER une carte entière, remonté par `CarteEtablissement` : la
   * carte vit dans son état, pas ici. Une référence, et non un état : elle ne
   * s'affiche nulle part et la changer ne doit rien re-rendre.
   */
  const reprendre = useRef(null);

  /*
   * ═══ LA CARTE TELLE QU'ELLE EST ENREGISTRÉE ═══
   * `modifie` valait « la carte a des groupes », donc VRAI dès qu'elle était
   * chargée : l'enregistrement automatique de `CadreReglage` partait 900 ms
   * après l'ouverture de l'écran, sans qu'on ait rien touché. Ce n'était pas
   * qu'une requête de trop — `enregistrerCarte` SUPPRIME la base et la recrée
   * dans une transaction. Ouvrir « Affectations » réécrivait donc la base à
   * chaque fois, puis invalidait le cache, ce qui la rechargeait entièrement.
   *
   * La première carte émise après le montage est celle qui vient de la base :
   * elle sert de référence. Est une modification ce qui en diffère.
   */
  const reference = useRef(null);

  /*
   * La version de la base sur laquelle repose la carte à l'écran. `null` avant
   * le premier chargement. Mise à jour à l'adoption et après chaque écriture.
   */
  const version = useRef(null);
  const modifieCourant = useRef(false);
  modifieCourant.current = modifie;

  // Après un 409 : la prochaine version plus récente est adoptée même si une
  // saisie est en cours — c'est cette saisie que le serveur vient de refuser.
  const forcer = useRef(false);
  const [adoptions, setAdoptions] = useState(0);

  /*
   * ═══ SUIVRE CE QU'UN COLLÈGUE ENREGISTRE ═══
   * L'annonce temps réel fait relire la base ; si elle porte une version plus
   * récente et que rien n'est en cours de saisie ici, la carte la reprend. Une
   * saisie en cours est gardée : son enregistrement sera refusé, et c'est alors
   * que la page reprendra la version en place.
   *
   * ⚠️ `reference` EST REMISE À ZÉRO AVANT DE REPOSER LA CARTE : la carte reposée
   * est ré-émise par `CarteEtablissement`, et sans cela elle passerait pour une
   * modification — l'enregistrement automatique la réécrirait, le collègue la
   * recevrait, la reposerait à son tour… un va-et-vient sans fin entre deux
   * onglets.
   */
  useEffect(() => {
    if (!enregistree.carte) return;

    if (version.current === null) {
      version.current = enregistree.version;
      return;
    }
    if (enregistree.version <= version.current) return;
    if (modifieCourant.current && !forcer.current) return;

    forcer.current = false;
    version.current = enregistree.version;
    reference.current = null;
    setModifie(false);
    reprendre.current?.(enregistree.carte);
  }, [enregistree.carte, enregistree.version, adoptions]);

  const enregistrement = useMutation({
    // La carte voyage en VARIABLE de mutation, et non par la fermeture : c'est
    // ainsi que `onSuccess` sait ce qui a réellement été envoyé. Une retouche
    // faite pendant l'écriture reste alors « en attente » au lieu d'être
    // comptée pour écrite, donc perdue.
    mutationFn: (carte) => enregistrerCarte(carte, version.current ?? 0),
    onSuccess: (resultat, envoyee) => {
      // Tout de suite : la relecture qui suit rendra cette même version, et ne
      // doit pas passer pour l'enregistrement d'un collègue.
      version.current = resultat.version;
      reference.current = JSON.stringify(envoyee);
      setModifie(
        JSON.stringify(courante) !== reference.current && Boolean(courante?.groupes?.length)
      );
    },
    onError: async (erreur) => {
      if (!estVersionPerimee(erreur)) {
        toast.error('Enregistrement impossible', { description: erreur.message });
        return;
      }
      toast.warning('Modifiée entre-temps par quelqu’un d’autre', {
        description:
          'Votre dernière modification n’a pas été enregistrée : la carte affiche maintenant la version en place.',
      });
      forcer.current = true;
      await enregistree.relire();
      setAdoptions((compte) => compte + 1);
    },
  });

  /*
   * `useCallback` n'est pas un ornement : la carte appelle cette fonction dans
   * un effet qui en dépend. Recréée à chaque rendu, elle relancerait l'effet
   * sans fin.
   */
  const suivre = useCallback((carte) => {
    setCourante(carte);

    const empreinte = JSON.stringify(carte);
    if (reference.current === null) {
      reference.current = empreinte;
      return;
    }

    // Rien à enregistrer tant qu'aucun groupe n'existe : la route les exige, et
    // un envoi vide échouerait en boucle.
    setModifie(empreinte !== reference.current && Boolean(carte?.groupes?.length));
  }, []);

  // En lecture seule : ni indicateur, ni enregistrement, ni « Défaire ».
  const ecriture = lectureSeule
    ? {}
    : {
        modifie,
        enCours: enregistrement.isPending,
        // Un 409 compris : « Enregistré » contredirait le toast qui l'annonce.
        echec: enregistrement.isError,
        onEnregistrer: () => enregistrement.mutate(courante),
        // Active « Défaire » : la carte à l'écran, et de quoi la reposer.
        valeur: courante,
        onRestaurer: (precedente) => reprendre.current?.(precedente),
      };

  return (
    <>
      {/* La salle est celle de la page : une seule entrée par page est possible,
          et c'est elle qui porte curseurs et case ouverte. */}
      <EnTetePartage page="affectations" salle={salle} />
      <CadreReglage
        titre="Affectations"
        chargement={enregistree.chargement}
        erreur={enregistree.erreur}
        repos={REPOS_CARTE}
        {...ecriture}
      >
        {enregistree.groupesSansFiliere.length > 0 && (
          <Alerte type="avertissement" titre="Filière introuvable pour certains groupes">
            {enregistree.groupesSansFiliere.join(', ')} — leurs modules ne peuvent pas être retrouvés
            dans la répartition DRIF. Régénérez-les depuis leur filière pour les compléter.
          </Alerte>
        )}

        {/* La zone de la carte porte la couche des curseurs : `relative` pour
            qu'elle s'y cale, et c'est ici qu'on suit la souris. */}
        <div
          ref={zoneCarte}
          className="relative"
          onMouseMove={suivreSouris}
          onMouseLeave={quitterCarte}
        >
          <CarteEtablissement
            carteInitiale={enregistree.carte}
            onModifiee={suivre}
            onReprise={(fonction) => {
              reprendre.current = fonction;
            }}
            lectureSeule={lectureSeule}
            // Un invité « peut consulter » n'ouvre rien — et le serveur ne
            // relaierait pas sa case.
            onOuverture={lectureSeule ? null : surOuverture}
          />
          <CurseursDistants
            page="affectations"
            vue={VUE_CARTE}
            conteneurRef={zoneCarte}
            unique
            repli={repliCase}
          />
        </div>
      </CadreReglage>
    </>
  );
}
