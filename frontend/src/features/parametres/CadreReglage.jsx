import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useLargeurPage } from '@/components/layout/largeurPage';
import { titreDePage } from '@/components/layout/navigation';
import { useSansFilAriane } from '@/components/layout/titrePage';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import {
  IndicateurEnregistrement,
  useEnregistrementAuto,
} from '@/components/common/enregistrementAuto';
import { marquerModifiee } from '@/lib/derniereModification';
import { cn } from '@/lib/utils';
import {
  declarerAnnulable,
  empilerAvantEnregistrement,
  oublierAnnulation,
} from '@/lib/annulation';

/**
 * Cadre commun aux écrans de « Paramètres ».
 *
 * ═══ POURQUOI UN CADRE PLUTÔT QUE DE RECOPIER ═══
 * Ces écrans réutilisent les composants de l'assistant de configuration, qui
 * sont conçus pour être PILOTÉS : ils reçoivent `valeur` / `onChange` et
 * laissent leur parent enregistrer. Le cadre fournit ce parent — chargement,
 * écriture, état — une seule fois pour les quatre.
 *
 * ═══ ENREGISTREMENT AUTOMATIQUE ═══
 * Pas de bouton : la modification part d'elle-même après une pause de saisie.
 * Un bouton « Enregistrer » sur un écran de réglages fabrique un état où le
 * travail est fait mais pas écrit — et c'est là qu'on ferme l'onglet.
 *
 * La minuterie et l'indicateur vivent dans `components/common/enregistrementAuto`
 * depuis le 2026-09-03 : le calendrier national les demande aussi, et la règle
 * de ré-armement qu'ils portent est trop chèrement acquise pour être réécrite à
 * côté.
 */
export default function CadreReglage({
  /*
   * ⚠️ `large` : la largeur par défaut (`max-w-4xl`, 896 px) convient à un écran
   * de RÉGLAGES — des lignes de texte, qu'on ne lit pas au-delà de cette
   * largeur. Elle étrangle en revanche une GRILLE : l'emploi du temps y tenait
   * ses 24 colonnes dans 31 px chacune, et sa barre d'outils repassait à la
   * ligne. Une exception nommée vaut mieux qu'un `max-w` écrit en place, qui
   * aurait divergé du reste.
   */
  large,
  titre,
  description,
  chargement,
  erreur,
  modifie,
  enCours,
  echec,
  onEnregistrer,
  /**
   * Deux props FACULTATIVES qui activent « Défaire » dans l'en-tête.
   * `valeur` est ce que la page enregistrerait maintenant ; `onRestaurer` sait
   * le reposer dans son état. Sans elles, l'entrée reste désactivée — un écran
   * qui n'écrit rien n'a rien à annuler.
   */
  valeur,
  onRestaurer,
  // Pause avant l'enregistrement automatique — voir `useEnregistrementAuto`.
  repos,
  children,
}) {
  const { pathname } = useLocation();

  /*
   * L'état tel qu'il était au DERNIER enregistrement — le point de retour.
   * Il est tenu dans une référence : le modifier ne doit rien re-rendre, il
   * n'apparaît nulle part à l'écran.
   */
  const precedente = useRef(undefined);
  const valeurCourante = useRef(valeur);
  valeurCourante.current = valeur;

  useEffect(() => {
    if (!onRestaurer) return undefined;

    declarerAnnulable(pathname, onRestaurer);
    // La pile est vidée en quittant l'écran : la page relira sa donnée du
    // serveur, et un point de retour survivant n'aurait plus de rapport avec
    // ce qui est affiché.
    return () => oublierAnnulation(pathname);
  }, [pathname, onRestaurer]);

  // Premier état connu = celui d'avant toute modification. C'est le point de
  // retour du tout premier « Défaire ».
  useEffect(() => {
    if (precedente.current === undefined && valeur !== undefined && valeur !== null) {
      precedente.current = structuredClone(valeur);
    }
  }, [valeur]);

  /*
   * ⚠️ `avantEcriture` PORTE LA COMPTABILITÉ PROPRE À CE CADRE — pile
   * d'annulation et trace de modification — que le crochet partagé n'a pas à
   * connaître. On empile l'état PRÉCÉDENT, pas celui qu'on s'apprête à écrire :
   * « Défaire » doit ramener à ce qui était en base AVANT cette écriture.
   */
  const enregistreUneFois = useEnregistrementAuto({
    modifie,
    valeur,
    onEnregistrer,
    repos,
    // Pas de seconde écriture tant que la première n'est pas revenue — voir le crochet.
    enCours,
    avantEcriture: () => {
      empilerAvantEnregistrement(pathname, precedente.current);
      precedente.current = structuredClone(valeurCourante.current);
      /*
       * Trace LOCALE, lue par « Modifié … » dans l'en-tête. Elle dit « vous avez
       * enregistré cette page », pas « la donnée a changé » : un collègue qui
       * enregistre depuis son poste ne l'inscrit pas ici.
       */
      marquerModifiee(pathname);
    },
  });

  /*
   * ═══ ⚠️ LE TITRE DE PAGE EST RENDU ICI, PAS PAR LA COQUILLE ═══
   * (2026-09-05, correction du porteur : « corrige le titre » — il était posé
   * par `CoquilleApp` et se retrouvait donc COLLÉ À GAUCHE, pendant que le
   * contenu, lui, est centré dans ce cadre.)
   *
   * C'est ce cadre qui connaît sa propre largeur — `max-w-4xl`, ou `max-w-[110rem]`
   * en mode `large` — et elle change d'une page à l'autre : « Mon emploi du
   * temps » est large, « Table des matières » ne l'est pas. Aucune largeur fixe
   * posée dans la coquille ne pouvait s'aligner sur les deux.
   *
   * ⚠️ LE TEXTE VIENT TOUJOURS DE `navigation.js` : le cadre le RETROUVE par la
   * route, il ne le reçoit pas de la page. Chaque écran devrait sinon répéter
   * son propre titre, déjà écrit dans le menu.
   *
   * ⚠️ SEULES LES ENTRÉES QUI PORTENT `titrePage` EN ONT UN — aujourd'hui les
   * quatre écrans de session, dont la coquille n'a pas de fil d'Ariane. En
   * donner un à une page de DIRECTEUR ferait un SECOND `<h1>` à quelques
   * centimètres de celui du fil d'Ariane : c'est précisément le défaut qui
   * avait fait retirer le titre d'ici le 2026-08-25.
   */
  /*
   * ⚠️ ET UNE PAGE PARTAGÉE OUVERTE PAR UN FORMATEUR (étape d2 bis) : sa coquille
   * n'a pas de fil d'Ariane, la page restait muette. La règle vit dans
   * `titreDePage`, testée ; la coquille dit seulement si le fil d'Ariane manque.
   */
  const sansFilAriane = useSansFilAriane();
  const titrePage = titreDePage(pathname, { sansFilAriane });

  /*
   * ═══ ⚠️ LA COQUILLE PASSE AVANT LE DÉFAUT DU CADRE ═══ (2026-09-06, demande
   * du porteur : « mettre le max width de la page le même max width du navbar
   * pour toutes les pages des sessions ».)
   *
   * `max-w-4xl` est taillé pour un écran de RÉGLAGES — des lignes de texte
   * qu'on ne lit pas plus large. Sur les sessions formateur et stagiaire, il
   * COUPAIT la dernière colonne des tableaux à neuf colonnes. Quand une coquille
   * annonce une largeur, c'est elle qui sait de quelle place la page dispose :
   * son gabarit l'emporte, `large` compris — en session, toutes les pages
   * s'alignent sur la barre, et aucune ne se distingue des autres.
   */
  const largeurCoquille = useLargeurPage();

  /*
   * ⚠️ LE MÊME CADRE DANS LES TROIS ÉTATS. Le titre doit tenir sa place pendant
   * le chargement et sur une erreur : sinon il apparaît après coup, et la page
   * saute au moment où la donnée arrive.
   */
  const cadre = (contenu) => (
    <section
      aria-label={titre}
      className={cn('mx-auto', largeurCoquille ?? (large ? 'max-w-[110rem]' : 'max-w-4xl'))}
    >
      {/*
        ⚠️ `mb-4` SUR LE TITRE, PAS `space-y-6` SUR LA SECTION (2026-09-05,
        demande du porteur : « diminue l'espace entre le titre et les cards »).
        L'espacement de 24 px vaut ENTRE les blocs de contenu — l'y appliquer
        aussi sous le titre l'éloignait de ce qu'il annonce. Le contenu garde
        donc son `space-y-6` dans son propre conteneur, le titre reçoit ses
        16 px, et les deux réglages cessent d'être le même.
      */}
      {titrePage && (
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">{titrePage}</h1>
      )}
      <div className="space-y-6">{contenu}</div>
    </section>
  );

  /*
   * L'ERREUR d'abord. Les appelants calculent leur `chargement` à partir d'un
   * état encore vide (« la donnée n'est pas arrivée ») : sur un échec, cet état
   * ne se relâche jamais et l'écran reste bloqué sur « Chargement… » au lieu de
   * dire ce qui s'est passé.
   */
  if (erreur) {
    return cadre(
      <p className="text-sm text-muted-foreground">
        Ces réglages n&apos;ont pas pu être chargés. {erreur}
      </p>
    );
  }

  if (chargement) {
    return cadre(
      <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center">
        <IndicateurChargement />
      </div>
    );
  }

  /*
   * ═══ ⚠️ PLUS DE TITRE ICI ═══
   * (2026-08-25, demande du porteur — pour rendre de la place aux grilles.)
   *
   * Le fil d'Ariane porte DÉJÀ le nom de la page, et il le rend en `<h1>` :
   * ce titre-ci en faisait un SECOND, à quelques centimètres du premier. Deux
   * `<h1>` sur une page, c'est aussi un repère de navigation faussé pour un
   * lecteur d'écran — le retirer corrige les deux à la fois.
   *
   * ⚠️ `titre` RESTE UNE PROP, et sert d'étiquette à la section : la
   * suppression ne doit pas faire perdre l'information à qui n'a pas le fil
   * d'Ariane sous les yeux.
   */
  const enTete = description || onEnregistrer;

  return cadre(
    <>
      {enTete && (
        <header className="flex flex-wrap items-center justify-between gap-3">
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : (
            <span />
          )}

          {onEnregistrer && (
            <IndicateurEnregistrement
              enCours={enCours}
              modifie={modifie}
              echec={echec}
              enregistreUneFois={enregistreUneFois}
            />
          )}
        </header>
      )}

      {children}
    </>
  );
}
