import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Moon, Sun } from 'lucide-react';
import {
  SEANCES_JOUR,
  SEANCE_SOIR,
  fichesModules,
  indexerContraintes,
  libelleSemaine,
  salleParDefaut,
} from 'shared/domain';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ROLES } from 'shared/constants';
import Alerte from '@/components/common/Alerte';
import CadreReglage from '@/features/parametres/CadreReglage';
import { recupererSession } from '@/features/auth/api';
import { cn } from '@/lib/utils';
import {
  chargerContexte,
  chargerSemaine,
  chargerSemaines,
  ecrireLot,
  importerSemaine,
  reinitialiserSeances,
} from './api';
import GrilleEmploi, { MARQUE_ABSENT, MARQUE_PRESENT } from './GrilleEmploi';
import MenuGrille from './MenuGrille';
import BarreFlottante from './BarreFlottante';
import NavigationSemaine from './NavigationSemaine';
import DialogueStatistiques from './DialogueStatistiques';
import BoutonPublier from './BoutonPublier';
import AvatarsPresence from '@/features/tempsReel/AvatarsPresence';
import CurseursDistants from '@/features/tempsReel/CurseursDistants';
import { useEmetteurCurseur } from '@/features/tempsReel/useEmetteurCurseur';
import { englober, fractionDansCase } from '@/features/tempsReel/positions';
import { useSalleEmploi } from '@/features/tempsReel/useSalleEmploi';
import BoutonPartager from '@/features/partages/BoutonPartager';
import { PortailEnTete } from '@/components/layout/enTetePage';
import { lireCurseurs } from '@/lib/tempsReel';
import {
  HISTORIQUE_VIDE,
  cible,
  cleCase,
  copier,
  defaire,
  deplacement,
  empiler,
  lireCle,
  rectangle,
  refaire,
} from './selection';
import { ajusterPosees, appliquerOperations, confirmer, resoudreIdentifiants } from './previsionEcriture';

/**
 * Emploi du temps hebdomadaire (F5).
 * ← public/emploi.html (18 358 lignes) + edition.html
 *
 * ═══ SOUS-LIVRAISONS (a) LECTURE · (b) SAISIE · (c) SÉLECTION ═══
 * La saisie se fait DANS les cases, par listes déroulantes, comme l'existant.
 * Les conflits — formateur, groupe, salle — sont cherchés par le SERVEUR, qui
 * voit toute la semaine : l'existant ne comparait qu'au modèle chargé dans la
 * page, et deux onglets pouvaient poser deux cours dans la même salle.
 *
 * Suit : (d) absences et rattrapages.
 */

/** La même fonction à chaque rendu : une flèche inline est une prop neuve. */
const IDENTITE = (valeur) => valeur;

export default function PageEmploi() {
  const cache = useQueryClient();
  /*
   * ⚠️ LE LIEN COPIÉ DEPUIS « PARTAGER » PORTE LA SEMAINE (`?semaine=`) : celui
   * qui l'ouvre doit tomber sur la semaine dont on lui parle, pas sur celle du
   * jour.
   */
  const [parametres] = useSearchParams();
  const [semaine, setSemaine] = useState(() => {
    const demandee = parametres.get('semaine');
    return demandee && /^\d{4}-W\d{1,3}$/i.test(demandee) ? demandee : null;
  });
  const [parGroupe, setParGroupe] = useState(false);
  const [ancre, setAncre] = useState(null);
  const [selection, setSelection] = useState(new Set());
  const [pressePapiers, setPressePapiers] = useState(null);
  const [historique, setHistorique] = useState(HISTORIQUE_VIDE);
  const [conflits, setConflits] = useState(new Map());
  /*
   * ⚠️ LES CHOIX EN COURS, AVANT QU'UNE SÉANCE SOIT COMPLÈTE. Poser une séance
   * demande DEUX choix — un groupe puis un module — et rien ne peut être écrit
   * entre les deux. Sans ce brouillon, le premier choix était perdu au rendu
   * suivant : on sélectionnait un groupe, la liste revenait à vide, et la case
   * paraissait refuser la saisie.
   */
  const [brouillons, setBrouillons] = useState(new Map());
  /*
   * ⚠️ LE MODE DÉCIDE DE CE QUE FAIT LE GLISSEMENT — rectangle de sélection, ou
   * déplacement d'une séance. Un même geste ne peut pas faire les deux, et
   * l'existant tranchait déjà par un bouton (`setupSelectionModeToggle`).
   * Un appui sur Ctrl le bascule, exactement comme le bouton.
   */
  const [modeSelection, setModeSelection] = useState(false);
  /** La seule case dont le `Select` de shadcn est réellement monté. */
  const [caseEnEdition, setCaseEnEdition] = useState(null);
  const [depot, setDepot] = useState({ source: null, survol: null });
  const [statistiques, setStatistiques] = useState(false);
  /*
   * Le zoom de la grille — préférence de LECTURE, comme celui du chronogramme.
   * Il ne part pas au serveur : deux personnes du même établissement peuvent
   * lire la même semaine à deux tailles.
   */
  const [zoom, setZoom] = useState(100);
  /*
   * ⚠️ JOUR OU SOIR — UNE SEULE GRILLE À L'ÉCRAN. Les deux ne partagent ni leurs
   * sujets (le soir ne concerne que les groupes CDS) ni leurs créneaux : tout ce
   * qui désigne des cases doit repartir de zéro à la bascule.
   */
  const [periode, setPeriode] = useState('jour');

  const changerPeriode = (valeur) => {
    if (valeur === periode) return;
    setPeriode(valeur);
    setSelection(new Set());
    setPressePapiers(null);
    setHistorique(HISTORIQUE_VIDE);
    setCaseEnEdition(null);
    setConflits(new Map());
  };

  const basculerSelection = useCallback(() => setModeSelection((actif) => !actif), []);

  /*
   * ⚠️ QUITTER LE MODE EFFACE LA SÉLECTION. Le cadre bleu désigne ce que la
   * barre flottante s'apprête à copier, vider ou coller : le laisser en place
   * alors que la souris déplace de nouveau les séances laisse croire que ces
   * gestes portent encore, et un « Suppr » viderait un bloc qu'on croyait
   * relâché.
   *
   * Le `setSelection` FONCTIONNEL évite d'avoir à dépendre de la sélection : au
   * montage, où le mode est déjà faux, il rend le même ensemble et ne provoque
   * aucun rendu de plus.
   */
  useEffect(() => {
    if (!modeSelection) setSelection((cases) => (cases.size > 0 ? new Set() : cases));
  }, [modeSelection]);

  const contexte = useQuery({ queryKey: ['emploi', 'contexte'], queryFn: chargerContexte, retry: false });
  const semaines = useQuery({ queryKey: ['emploi', 'semaines'], queryFn: chargerSemaines, retry: false });

  /*
   * ⚠️ LE RÔLE DÉCIDE DE L'AFFICHAGE DU BOUTON, et il lit la MÊME valeur que le
   * garde de la route (`requireRole(DIRECTEUR)`). L'ancien EDT Pro montrait le
   * bouton à l'admin (`role === 'director' || role === 'admin'`) là où le
   * serveur le refusait en 403 : un bouton qui échoue toujours.
   */
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const estDirecteur = session.data?.utilisateur?.role === ROLES.DIRECTEUR;

  useEffect(() => {
    if (!semaine && semaines.data?.courante) setSemaine(semaines.data.courante);
  }, [semaine, semaines.data]);

  const grille = useQuery({
    queryKey: ['emploi', 'semaine', semaine],
    queryFn: () => chargerSemaine(semaine),
    enabled: Boolean(semaine),
    retry: false,
  });

  const rafraichir = useCallback(
    () =>
      Promise.all([
        cache.invalidateQueries({ queryKey: ['emploi', 'semaine'] }),
        cache.invalidateQueries({ queryKey: ['emploi', 'semaines'] }),
        // ⚠️ Le CONTEXTE aussi : il porte les heures posées de l'année, donc les
        // taux d'avancement des cases. Sans cette invalidation ils resteraient
        // figés à leur valeur d'ouverture.
        cache.invalidateQueries({ queryKey: ['emploi', 'contexte'] }),
        /*
         * ⚠️ ET LES FICHES DE MODULE. Elles portent l'avancement semaine par
         * semaine et sont gardées une minute : sans cette invalidation, poser
         * une séance puis survoler son module rendait le taux d'AVANT, à côté
         * d'un badge de case déjà à jour — deux chiffres contradictoires sur le
         * même écran.
         */
        cache.invalidateQueries({ queryKey: ['emploi', 'module'] }),
      ]),
    [cache]
  );

  const seances = grille.data?.seances ?? [];
  const indexContraintes = useMemo(
    () => indexerContraintes(contexte.data?.contraintesFormateurs ?? []),
    [contexte.data?.contraintesFormateurs]
  );
  const jours = grille.data?.jours ?? [];

  /*
   * ═══ COLLABORATION EN TEMPS RÉEL (Phase 5bis, étape a) ═══
   * Les écritures des collègues arrivent par la socket et rafraîchissent la
   * grille sans rechargement ; la pile d'avatars dit qui d'autre est sur la page.
   */
  const salle = useSalleEmploi({
    ecran: 'emploi',
    semaine,
    periode,
    anneeScolaire: contexte.data?.anneeScolaire,
  });

  /*
   * ═══ MON CURSEUR ET MA CASE OUVERTE, ENVOYÉS AUX AUTRES (étape b) ═══
   * ⚠️ RELATIFS À UNE CASE, JAMAIS EN PIXELS — voir `positions.js`. Et bornés à
   * 20 par seconde : au-delà l'œil ne voit rien de plus, et le serveur coupe une
   * connexion qui dépasse 40 messages par seconde.
   */
  const grilleRef = useRef(null);
  const axeCourant = periode === 'soir' || parGroupe ? 'groupe' : 'formateur';

  // Borné à 20 par seconde — mécanisme partagé avec le chronogramme.
  const emettreCurseur = useEmetteurCurseur(salle.envoyerCurseur);

  /*
   * ═══ ⚠️ LE SUIVI DE SOURIS NE DOIT PAS PESER SUR LE GESTE (2026-09-19, signalé
   * par le porteur : « sélection et déplacement lents hébergé, parfaits en
   * local ») ═══
   * Il tournait à CHAQUE mouvement de souris, avant même la limite des 20 envois
   * par seconde : un balayage de la table entière (`querySelectorAll` sur 1 224
   * cases) et trois `getBoundingClientRect()` — c'est-à-dire un recalcul complet
   * de la mise en page, juste après que le rendu de la sélection l'a invalidée.
   * En local, seul, personne ne le sentait ; hébergé, avec des collègues en
   * ligne, il devenait ce qui ralentissait chaque geste.
   *
   * Trois garde-fous, du plus gros au plus fin :
   *   - PERSONNE D'AUTRE SUR LA PAGE : à qui enverrait-on ce curseur ? Rien à
   *     calculer, rien à envoyer.
   *   - UN GESTE EN COURS (rectangle de sélection, glisser-déposer) : le curseur
   *     n'apprend rien aux collègues, et c'est précisément le moment où la
   *     mise en page bouge le plus.
   *   - UNE FOIS PAR IMAGE AU PLUS (`requestAnimationFrame`) : le dernier
   *     mouvement de l'image gagne, les autres n'ont pas besoin d'être mesurés.
   */
  const autresPresents = useRef(false);
  autresPresents.current = salle.membres.some((membre) => membre.id !== salle.utilisateurId);
  const curseurEnAttente = useRef(null);

  const suivreSouris = (evenement) => {
    if (!semaine || !autresPresents.current || glisse.current || sourceDepot.current) return;
    const cellule = evenement.target.closest?.('[data-case]');
    if (!cellule || !grilleRef.current) return;

    const dejaPlanifie = curseurEnAttente.current !== null;
    curseurEnAttente.current = { cellule, x: evenement.clientX, y: evenement.clientY };
    if (dejaPlanifie) return;

    requestAnimationFrame(() => {
      const mouvement = curseurEnAttente.current;
      curseurEnAttente.current = null;
      if (!mouvement || !grilleRef.current || !mouvement.cellule.isConnected) return;

      const cle = mouvement.cellule.dataset.case;
      const boite = englober(
        [...grilleRef.current.querySelectorAll(`[data-case="${CSS.escape(cle)}"]`)].map((element) =>
          element.getBoundingClientRect()
        )
      );
      const fraction = fractionDansCase(boite, mouvement.x, mouvement.y);
      if (fraction) emettreCurseur({ semaine, periode, axe: axeCourant, cle, ...fraction });
    });
  };


  // La case ouverte : c'est elle que les autres voient encadrée à mon nom.
  const caseOuverte = caseEnEdition?.cle ?? null;
  useEffect(() => {
    salle.envoyerFocus(
      caseOuverte && semaine ? { semaine, periode, axe: axeCourant, cle: caseOuverte } : null
    );
  }, [caseOuverte, semaine, periode, axeCourant, salle.envoyerFocus, salle.rejoint]);

  /*
   * ⚠️ OUVRIR UNE CASE QU'UN COLLÈGUE SAISIT DÉJÀ : on ne l'interdit pas — il a
   * pu la laisser ouverte en partant déjeuner — mais on le DIT. La lecture est
   * impérative (`lireCurseurs`) : s'abonner aux curseurs ferait re-rendre la
   * page entière vingt fois par seconde.
   */
  const ouvrirCase = useCallback(
    (ouverture) => {
      setCaseEnEdition(ouverture);
      if (!ouverture?.cle || !semaine) return;
      for (const { utilisateur, focus } of lireCurseurs('emploi').values()) {
        if (
          focus?.cle === ouverture.cle &&
          focus.semaine === semaine &&
          focus.periode === periode &&
          focus.axe === axeCourant
        ) {
          toast.warning(`${utilisateur.nom} est en train de modifier cette case`, {
            description: 'Si vous enregistrez tous les deux, la dernière saisie l’emportera.',
          });
          return;
        }
      }
    },
    [semaine, periode, axeCourant]
  );

  const fermerCase = useCallback(() => setCaseEnEdition(null), []);

  const fiches = useMemo(
    () => fichesModules(contexte.data?.affectations ?? []),
    [contexte.data?.affectations]
  );
  const posees = useMemo(
    () => new Map(Object.entries(contexte.data?.posees ?? {})),
    [contexte.data?.posees]
  );

  /*
   * ═══ ⚠️⚠️ L'AXE EFFECTIF, PAS LA BASCULE ═══
   * Le SOIR est TOUJOURS par groupe — le créneau appartient au groupe, pas au
   * formateur — et la bascule y est désactivée, donc figée sur « Par
   * formateur ». Tout ce qui lisait `parGroupe` croyait alors que les lignes
   * étaient des MATRICULES : la saisie partait avec un nom de groupe en guise de
   * matricule et SANS groupe, l'écriture n'était jamais complète, et **rien ne
   * s'enregistrait le soir** (signalé par le porteur). Une seule valeur dérivée,
   * et tous les chemins la lisent.
   */
  const axeGroupe = periode === 'soir' || parGroupe;

  /*
   * ⚠️ MÉMORISÉ (2026-09-19, signalé par le porteur : « parfois rapide, parfois
   * lent hébergé »). `.map()` rendait un tableau NEUF à chaque rendu de la page :
   * la grille en tirait toutes ses lignes à nouveau — la semaine entière
   * réassemblée — pour un changement de sélection, un avatar qui arrive ou une
   * relecture terminée. Les mêmes sujets doivent être LE MÊME tableau.
   */
  const sujets = useMemo(
    () =>
      axeGroupe
        ? (contexte.data?.groupes ?? [])
        : (contexte.data?.formateurs ?? []).map((f) => f.matricule),
    [axeGroupe, contexte.data]
  );
  const groupesSoir = contexte.data?.groupesSoir ?? [];

  // Le même Set tant que les refus ne changent pas — un `new Set(...)` inline
  // rendait à la grille une prop neuve à chaque rendu de la page.
  const conflitsVus = useMemo(() => new Set(conflits.keys()), [conflits]);

  const nomDuFormateur = useMemo(() => {
    const noms = new Map((contexte.data?.formateurs ?? []).map((f) => [f.matricule, f.nom]));
    return (matricule) => noms.get(matricule) ?? matricule;
  }, [contexte.data]);

  /** La séance d'une case, pour le presse-papiers et le vidage. */
  const seanceDe = useCallback(
    (cle) => {
      const { sujet, jour, creneau, periode } = lireCle(cle);
      return seances.find(
        (s) =>
          s.jour === jour &&
          s.seance === creneau &&
          s.periode === periode &&
          (axeGroupe ? s.groupe === sujet : s.formateurMatricule === sujet)
      );
    },
    [seances, axeGroupe]
  );

  // ═══ Écriture ═══
  const ecrire = useMutation({
    /*
     * ⚠️ LES GESTES S'ENCHAÎNENT, ILS NE SE CHEVAUCHENT PAS. Deux gestes rapprochés
     * (couper puis coller) partiraient sinon ensemble : le second lirait un cache
     * que le premier n'a pas fini de corriger, et porterait des identifiants
     * encore provisoires. Même `scope` = file d'attente, un à la fois.
     */
    scope: { id: 'emploi-ecriture' },
    /*
     * ⚠️ CETTE ÉCRITURE CORRIGE ELLE-MÊME SON CACHE (réponse du serveur), donc le
     * filet global de `queryClient` ne doit rien relire derrière elle : hébergé,
     * ces relectures — une dizaine, après CHAQUE case déposée — valaient plus que
     * l'écriture elle-même. Voir `meta.invalidation` dans `lib/queryClient.js`.
     */
    meta: { invalidation: 'passive' },
    mutationFn: async ({ operations, memoriser = false }) => {
      const bilan = { posees: 0, videes: 0, refus: [], salleRetiree: [] };

      /*
       * ⚠️ L'ÉTAT D'AVANT SE LIT DANS LE CACHE, À L'INSTANT DE L'ÉCRITURE — pas
       * dans la fermeture du rendu. Le rendu ne porte que ce que la dernière
       * relecture a ramené : deux gestes rapprochés y empilaient DEUX FOIS le
       * même état, et « défaire » rétablissait alors une case qui n'existait pas
       * avant le geste. Constaté en base — l'annulation d'un collage REPOSAIT la
       * case au lieu de la supprimer.
       */
      if (memoriser) {
        const avant = cache.getQueryData(['emploi', 'semaine', semaine])?.seances ?? [];
        /*
         * ⚠️ AVEC LA PORTÉE DU GESTE (`cles`) — collaboration temps réel. L'état
         * d'avant est la semaine ENTIÈRE, collègues compris : sans la liste des
         * cases touchées, « défaire » rétablirait aussi celles qu'un autre a
         * modifiées depuis, et effacerait son travail sans le dire.
         */
        const cles = operations.flatMap((o) => [o.cle, o.cleSource].filter(Boolean));
        setHistorique((h) => empiler(h, { etat: avant, cles }));
      }

      /*
       * ═══ ⚠️ L'ÉCRAN BOUGE AVANT LE SERVEUR — MAIS JAMAIS SUR UN FAUX ═══
       * (2026-09-19, signalé par le porteur : « lent, surtout hébergé », puis
       * « il donne parfois des chevauchements qui ne sont pas justes, puis il
       * rattrape et masque ».)
       *
       * Avant, la grille attendait un aller-retour réseau PAR case puis la
       * relecture de la semaine avant de bouger : hébergé, chaque requête paie
       * 100 à 300 ms de latence, et un collage de trente cases durait des
       * secondes sans rien montrer.
       *
       * On rejoue donc le geste dans le cache tout de suite — mais en JUGEANT
       * chaque pose avec les règles du serveur (`appliquerOperations`) : ce
       * qu'il refuserait n'est PAS montré. Une première version montrait tout, et
       * l'écran affichait un instant deux séances sur le même créneau avant que
       * le refus ne les retire. Une prévision peut retarder un affichage — le
       * serveur l'accepte malgré tout, la case apparaît à sa réponse — jamais le
       * fausser.
       *
       * ⚠️ `cancelQueries` D'ABORD : une relecture partie avant le geste
       * reviendrait sinon écraser l'affichage instantané par l'ancien état, et la
       * case reviendrait un instant à sa place avant de repartir.
       */
      const cleSemaine = ['emploi', 'semaine', semaine];
      const cleContexte = ['emploi', 'contexte'];
      await cache.cancelQueries({ queryKey: cleSemaine });
      const photo = cache.getQueryData(cleSemaine);
      const contexteCache = cache.getQueryData(cleContexte);

      /*
       * ⚠️ LES IDENTIFIANTS PROVISOIRES SE RÉSOLVENT ICI, PAS À LA CONSTRUCTION DU
       * GESTE. Une modification bâtie sur une séance qu'on vient d'afficher
       * (module choisi, puis salle) porte son identifiant provisoire ; les
       * écritures étant en file, la précédente est terminée à cet instant et le
       * cache porte le vrai. Sans cela le serveur voit une création et refuse la
       * séance contre… elle-même — le « chevauchement qui n'existe pas ».
       */
      const aEnvoyer = resoudreIdentifiants(operations, photo?.seances ?? []);

      // Sans le contexte (affectations, quotas), on ne peut PAS juger : on
      // n'affiche rien avant le serveur, plutôt que de risquer un faux.
      let affichee = null;
      if (photo && contexteCache) {
        const gels = new Map((photo.jours ?? []).map((j) => [j.jour, j.rentreesGelees ?? []]));
        affichee = appliquerOperations(photo.seances ?? [], aEnvoyer, {
          groupesFq: contexteCache.groupesFq ?? [],
          fiches: fichesModules(contexteCache.affectations ?? []),
          posees: new Map(Object.entries(contexteCache.posees ?? {})),
          affectations: contexteCache.affectations ?? [],
          gelDuJour: (jour) => gels.get(jour) ?? [],
        });
        cache.setQueryData(cleSemaine, { ...photo, seances: affichee });
      }

      let reponse;
      try {
        /*
         * ⚠️ EN SÉRIE CÔTÉ SERVEUR, PAS EN PARALLÈLE. Les conflits se cherchent
         * sur l'état courant : dix écritures simultanées regarderaient toutes la
         * même photo d'avant, et deux séances du même bloc pourraient atterrir
         * sur la même salle. Le serveur les exécute donc une à une, dans
         * l'ordre — mais sans qu'Internet s'intercale entre deux.
         */
        reponse = await ecrireLot(semaine, aEnvoyer);
      } catch (erreur) {
        // Réseau coupé, session expirée : on ignore ce qui est parti ou non, et
        // la vérité se relit plutôt que de laisser une simulation à l'écran.
        await rafraichir();
        throw erreur;
      }

      const acceptees = [];
      const confirmees = [];
      reponse.resultats.forEach((resultat, rang) => {
        const operation = aEnvoyer[rang];
        if (!resultat.ok) {
          bilan.refus.push({ cle: operation.cle, erreur: resultat.erreur });
          return;
        }
        acceptees.push(operation);
        if (resultat.seance) confirmees.push(resultat.seance);
        if (operation.type === 'vider') bilan.videes += 1;
        else bilan.posees += 1;
        if (resultat.salleRetiree) bilan.salleRetiree.push(operation.cle);
      });

      /*
       * ═══ ⚠️ ON CONFIRME AVEC LA RÉPONSE, ON NE RELIT PLUS LA SEMAINE ═══
       * Le serveur rend, pour chaque pose, la séance TELLE QU'IL L'A ÉCRITE
       * (vrai identifiant, date, statut). On recompose la semaine à partir de
       * l'état d'avant et des seules opérations ACCEPTÉES, puis on y range ces
       * séances : c'est exactement l'état du serveur, sans les quatre requêtes de
       * relecture — ni l'attente qu'elles imposaient à chaque geste.
       *
       * ⚠️ MAIS SEULEMENT SI RIEN N'A BOUGÉ ENTRE-TEMPS. Un collègue qui écrit
       * pendant notre requête fait relire la semaine (temps réel) : recomposer
       * depuis notre photo effacerait sa modification. Le cache n'est alors plus
       * celui que nous avions posé — on relit, comme avant.
       */
      const actuel = cache.getQueryData(cleSemaine);
      const intact = Boolean(photo) && actuel?.seances === (affichee ?? photo.seances);

      if (intact) {
        let confirmee = appliquerOperations(photo.seances ?? [], acceptees);
        for (const seance of confirmees) confirmee = confirmer(confirmee, seance);
        cache.setQueryData(cleSemaine, { ...actuel, seances: confirmee });

        // Les heures posées de l'année (les taux des cases) suivent le geste :
        // sans cela le geste suivant jugerait ses quotas sur des chiffres d'avant.
        if (contexteCache) {
          cache.setQueryData(cleContexte, {
            ...contexteCache,
            posees: ajusterPosees(contexteCache.posees, photo.seances ?? [], confirmee),
          });
        }
      }

      if (!intact || bilan.refus.length > 0) {
        /*
         * ⚠️ ON ATTEND LA RELECTURE quand quelque chose ne colle pas — un refus,
         * ou un cache qui a bougé : la grille doit dire vrai avant le geste
         * suivant, qui prendrait sinon son historique sur un état périmé.
         */
        await rafraichir();
      }
      // Sinon RIEN n'est relu : semaine et heures posées viennent d'être corrigées
      // avec la réponse du serveur, et le reste (liste des semaines, fiches de
      // modules) est seulement marqué périmé par `meta.invalidation: 'passive'` —
      // il se recharge à son prochain affichage, sans requête de plus maintenant.

      return bilan;
    },
    onSuccess: (bilan) => {
      setConflits(new Map(bilan.refus.map(({ cle, erreur }) => [cle, erreur])));

      if (bilan.salleRetiree.length > 0) {
        toast.warning(
          bilan.salleRetiree.length === 1
            ? 'Séance déposée sans salle'
            : `${bilan.salleRetiree.length} séances déposées sans salle`,
          { description: 'L’ancienne salle était déjà prise sur ce créneau — choisissez-en une dans la case.' }
        );
      }

      if (bilan.refus.length === 0) {
        if (bilan.posees + bilan.videes > 0) {
          toast.success(`${bilan.posees} posée(s), ${bilan.videes} vidée(s)`);
        }
        return;
      }

      /*
       * ⚠️ CE QUI A ÉCHOUÉ EST NOMMÉ, et le reste est bien passé. Tout annuler
       * pour une case en conflit obligerait à recommencer un collage de vingt
       * cases ; le taire laisserait croire l'opération complète.
       */
      toast.error(`${bilan.refus.length} case(s) refusée(s)`, {
        description: bilan.refus[0].erreur.details?.[0]?.message ?? bilan.refus[0].erreur.message,
      });
    },
    onError: (erreur) => toast.error('Écriture impossible', { description: erreur.message }),
  });

  /**
   * Import d'une autre semaine et réinitialisation.
   *
   * ⚠️ À PART DE `ecrire` : ces deux-là touchent des SEMAINES ENTIÈRES, pas des
   * cases. Les faire passer par l'historique laisserait croire qu'un « défaire »
   * ramène une année effacée — il ne le pourrait pas, et l'annonce serait pire
   * que l'absence de bouton. Le presse-papiers et la sélection sont vidés,
   * puisque ce qu'ils désignaient n'existe plus.
   */
  const outils = useMutation({
    mutationFn: async (ordre) => {
      if (ordre.type === 'importer') return importerSemaine(semaine, ordre.depuis);
      return reinitialiserSeances({ portee: ordre.portee, semaine });
    },
    onSuccess: async (bilan, ordre) => {
      setSelection(new Set());
      setPressePapiers(null);
      setHistorique(HISTORIQUE_VIDE);
      setConflits(new Map());
      await rafraichir();

      if (ordre.type === 'importer') {
        /*
         * ⚠️ `libelleSemaine`, JAMAIS LA VALEUR BRUTE. « 2026-W2 » est la forme
         * STOCKÉE : un toast qui l'affiche parle un langage que l'écran ne parle
         * nulle part ailleurs. Les messages éphémères sont les plus faciles à
         * oublier quand on renomme un affichage — celui-ci l'avait été.
         */
        const remplacees =
          bilan.remplacees > 0
            ? `${bilan.remplacees} séance(s) de ${libelleSemaine(semaine)} ont été remplacées.`
            : null;

        /*
         * ⚠️ CE QUI N'EST PAS ENTRÉ EST DIT. L'import est borné par la masse
         * horaire des modules : se taire ferait croire la semaine copiée en
         * entier, et l'écart ne se découvrirait qu'en comparant les deux
         * grilles case par case.
         */
        if (bilan.refusees?.length > 0) {
          toast.warning(
            `${bilan.importees} séance(s) copiée(s), ${bilan.refusees.length} refusée(s)`,
            { description: bilan.refusees[0].motif }
          );
          return;
        }

        toast.success(
          `${bilan.importees} séance(s) copiée(s) depuis ${libelleSemaine(bilan.depuis)}`,
          { description: remplacees ?? undefined }
        );
        return;
      }

      toast.success(
        ordre.portee === 'annee'
          ? `Année effacée — ${bilan.effacees} séance(s)`
          : `Semaine effacée — ${bilan.effacees} séance(s)`
      );
    },
    onError: (erreur) => toast.error('Opération impossible', { description: erreur.message }),
  });

  /** Mémorise l'état d'AVANT, puis écrit. */
  const appliquer = useCallback(
    (operations) => {
      if (operations.length === 0) return;
      ecrire.mutate({ operations, memoriser: true });
    },
    [ecrire.mutate]
  );

  // ═══ Saisie d'une case ═══
  /*
   * ⚠️ MÉMORISÉE (`useCallback`). `changer`, `ouvrirCase`, `onFermerCase`,
   * `debuter` et `glisserDeposer` descendent tous jusque dans `GrilleEmploi`,
   * qui les repasse tels quels aux 1 224 `CaseEmploi` — chacune mémorisée par
   * `memo`. Une seule de ces fonctions recréée à chaque rendu suffit à rendre
   * TOUTE la grille à chaque survol pendant un glissement ou un rectangle de
   * sélection : `memo` compare TOUTES les props, pas seulement celles qui ont
   * changé de sens. C'est ce qui rendait le déplacement et la sélection lents,
   * mesuré sur cette page (2026-09-18).
   */
  const oublierBrouillon = useCallback(
    (cle) =>
      setBrouillons((table) => {
        if (!table.has(cle)) return table;
        const suivante = new Map(table);
        suivante.delete(cle);
        return suivante;
      }),
    []
  );

  const changer = useCallback(({ cle, sujet, jour, creneau, periode, champ, valeur, seance }) => {
    const encours = brouillons.get(cle) ?? {};

    // Le brouillon l'emporte sur la séance : c'est ce qu'on vient de choisir.
    const base = {
      id: seance?.id,
      jour,
      seance: creneau,
      periode,
      formateurMatricule:
        encours.formateurMatricule ?? (axeGroupe ? seance?.formateurMatricule : sujet),
      groupe: encours.groupe ?? (axeGroupe ? sujet : seance?.groupe),
      module: encours.module ?? seance?.module,
      salle: encours.salle ?? seance?.salle ?? '',
      statut: seance?.statut ?? 'planifie',
    };

    if (champ === 'Groupe') {
      base.groupe = valeur;
      // ⚠️ Changer de groupe OUBLIE le module : il appartenait à l'autre groupe,
      // et le serveur le refuserait — le refus paraîtrait inexplicable puisque
      // la valeur est bien à l'écran.
      base.module = '';
    }
    if (champ === 'Formateur') {
      base.formateurMatricule = valeur;
      base.module = '';
    }
    if (champ === 'Module') base.module = valeur;
    if (champ === 'Salle') {
      /*
       * ⚠️ MARQUER ABSENT NE TOUCHE PAS À LA SALLE. L'existant écrivait
       * « ABSENT » DANS le champ salle : on perdait alors l'endroit où le cours
       * aurait dû avoir lieu, et une salle réellement nommée ainsi devenait
       * indistinguable. C'est `statut` qui porte le fait.
       */
      if (valeur === MARQUE_ABSENT) base.statut = 'absent';
      else if (valeur === MARQUE_PRESENT) base.statut = 'planifie';
      else base.salle = valeur;
    }

    /*
     * ═══ LA SALLE SE PRÉ-REMPLIT (2026-09-17) ═══
     * ← assignDefaultRoomFromConfig() de emploi.html : la première salle
     * attribuée au formateur qui soit libre sur ce créneau. Seulement quand
     * aucune n'est choisie — TEAMS, choisi d'abord, n'est jamais remplacé.
     */
    if (
      !base.salle &&
      base.formateurMatricule &&
      base.statut !== 'absent' &&
      ['Groupe', 'Formateur', 'Module'].includes(champ)
    ) {
      base.salle = salleParDefaut(
        indexContraintes,
        base.formateurMatricule,
        seances.filter((s) => s.jour === jour && s.seance === creneau && s.periode === periode),
        { id: base.id }
      );
    }

    const complet = base.formateurMatricule && base.groupe && base.module;

    if (!complet) {
      /*
       * Rien d'assez complet pour écrire : on RETIENT le choix. Et si la case
       * portait une séance, effacer son groupe ou son module la retire — une
       * séance sans l'un des deux n'a plus de sens.
       */
      const retire = seance && (champ === 'Groupe' || champ === 'Module') && !valeur;

      if (retire) {
        oublierBrouillon(cle);
        appliquer([
          {
            type: 'vider',
            cle,
            creneau: { jour, seance: creneau, periode, formateurMatricule: seance.formateurMatricule },
          },
        ]);
        return;
      }

      setBrouillons((table) => new Map(table).set(cle, base));
      return;
    }

    oublierBrouillon(cle);
    appliquer([{ type: 'poser', cle, seance: base }]);
  }, [brouillons, axeGroupe, indexContraintes, seances, oublierBrouillon, appliquer]);

  // ═══ Sélection ═══
  // ⚠️ Le soir n'a qu'UN créneau : la sélection rectangulaire et le collage
  // doivent le savoir, sinon ils viseraient des colonnes qui n'existent pas.
  const creneaux = periode === 'soir' ? [SEANCE_SOIR] : SEANCES_JOUR;
  const sujetsAffiches = periode === 'soir' ? groupesSoir : sujets;
  const glisse = useRef(false);

  const debuter = useCallback(
    (cellule) => {
      glisse.current = true;
      setAncre(cellule);
      setSelection(new Set([cleCase(cellule.sujet, cellule.jour, cellule.creneau, periode)]));
    },
    [periode]
  );

  const etendre = useCallback(
    (cellule) => {
      if (!ancre) return;
      setSelection(new Set(rectangle(ancre, cellule, { sujets: sujetsAffiches, creneaux, periode })));
    },
    [ancre, sujetsAffiches, creneaux, periode]
  );

  /*
   * ⚠️ LE RELÂCHEMENT S'ÉCOUTE SUR LA FENÊTRE. On lâche souvent le bouton hors
   * de la grille, et le glissement resterait actif indéfiniment — chaque survol
   * suivant redessinerait la sélection.
   */
  useEffect(() => {
    const finir = () => {
      glisse.current = false;
    };
    window.addEventListener('mouseup', finir);
    return () => window.removeEventListener('mouseup', finir);
  }, []);

  /*
   * ⚠️ CTRL BASCULE LE MODE — un appui l'active, le suivant le désactive.
   * C'est ce que demande le porteur, et cela évite l'aller-retour vers le bouton
   * pour deux cases. La version précédente n'activait la sélection QUE tant que
   * la touche restait enfoncée : tracer un rectangle imposait alors de garder un
   * doigt sur Ctrl pendant tout le glissement.
   *
   * ⚠️⚠️ UN APPUI SEUL, JAMAIS UN RACCOURCI. Copier (Ctrl+C), coller, défaire —
   * tous commencent par un `keydown` sur Control : basculer dès cet appui aurait
   * changé de mode à chaque raccourci, en silence. On ne bascule donc qu'au
   * RELÂCHEMENT, et seulement si rien d'autre n'a été pressé ni cliqué entre
   * temps. `blur` annule aussi : un Alt+Tab n'est pas un appui sur Ctrl.
   */
  useEffect(() => {
    let seul = false;

    const appuyer = (evenement) => {
      if (evenement.key === 'Control') {
        if (!evenement.repeat) seul = true;
        return;
      }
      seul = false;
    };
    const relacher = (evenement) => {
      if (evenement.key !== 'Control') return;
      if (seul) basculerSelection();
      seul = false;
    };
    const annuler = () => {
      seul = false;
    };

    window.addEventListener('keydown', appuyer);
    window.addEventListener('keyup', relacher);
    // Ctrl + glisser COPIE une séance : ce n'est pas un appui seul non plus.
    window.addEventListener('mousedown', annuler);
    window.addEventListener('blur', annuler);
    return () => {
      window.removeEventListener('keydown', appuyer);
      window.removeEventListener('keyup', relacher);
      window.removeEventListener('mousedown', annuler);
      window.removeEventListener('blur', annuler);
    };
  }, [basculerSelection]);

  // ═══ Glisser-déposer ═══
  /**
   * ⚠️ LE SUJET DE LA CASE D'ARRIVÉE L'EMPORTE. Déposer sur la ligne d'un autre
   * formateur doit CHANGER de formateur — garder celui du départ reposerait la
   * séance là d'où elle vient. Idem en vue par groupe, où la ligne EST le groupe.
   */
  const imposerLeSujet = useCallback(
    (sujet) => (axeGroupe ? { groupe: sujet } : { formateurMatricule: sujet }),
    [axeGroupe]
  );

  /*
   * ⚠️ LA SOURCE VIT AUSSI DANS UNE REF. `depot.source` ne sert qu'au dernier
   * temps du geste (le dépôt) ; le lire depuis l'ÉTAT obligerait `glisserDeposer`
   * à changer de référence à chaque case survolée (`depot` change à chaque
   * `phase: 'survol'`), et donc à re-rendre les 1 224 cases à chaque pixel du
   * glissement — précisément ce que cette mémorisation évite.
   */
  const sourceDepot = useRef(null);

  const glisserDeposer = useCallback(
    ({ phase, cle, sujet, copie }) => {
      if (phase === 'debut') {
        sourceDepot.current = cle;
        setDepot({ source: cle, survol: null });
        return;
      }
      if (phase === 'survol') {
        setDepot((etat) => (etat.survol === cle ? etat : { ...etat, survol: cle }));
        return;
      }
      if (phase === 'fin') {
        sourceDepot.current = null;
        setDepot({ source: null, survol: null });
        return;
      }

      const source = sourceDepot.current;
      sourceDepot.current = null;
      setDepot({ source: null, survol: null });
      if (!source) return;

      appliquer(
        deplacement(source, cle, seanceDe(source), { copie, sujetDe: () => imposerLeSujet(sujet) })
          // La case QUITTÉE fait partie du geste : « défaire » doit la reremplir.
          .map((operation) => (operation.type === 'deplacer' ? { ...operation, cleSource: source } : operation))
      );
    },
    [appliquer, seanceDe, imposerLeSujet]
  );

  // ═══ Presse-papiers et historique ═══
  const actions = {
    onCopier: () => {
      setPressePapiers(copier([...selection], seanceDe));
      toast.success(`${selection.size} case(s) copiée(s)`);
    },
    onCouper: () => {
      setPressePapiers(copier([...selection], seanceDe));
      actions.onVider();
    },
    onColler: () => {
      const depart = lireCle([...selection][0]);
      const cases = cible(pressePapiers, depart, { sujets: sujetsAffiches, creneaux, periode });

      appliquer(
        cases.map(({ cle, seance }) => {
          const { sujet, jour, creneau, periode } = lireCle(cle);
          const existante = seanceDe(cle);

          if (!seance) {
            return existante
              ? {
                  type: 'vider',
                  cle,
                  creneau: {
                    jour,
                    seance: creneau,
                    periode,
                    formateurMatricule: existante.formateurMatricule,
                  },
                }
              : null;
          }

          return {
            type: 'poser',
            cle,
            seance: {
              id: existante?.id,
              jour,
              seance: creneau,
              periode,
              // ⚠️ Le SUJET de la destination l'emporte : coller la ligne d'un
              // formateur sur celle d'un autre doit changer de formateur, sinon
              // le bloc reviendrait toujours au même.
              formateurMatricule: axeGroupe ? seance.formateurMatricule : sujet,
              groupe: axeGroupe ? sujet : seance.groupe,
              module: seance.module,
              salle: seance.salle ?? '',
              statut: seance.statut ?? 'planifie',
            },
          };
        }).filter(Boolean)
      );
    },
    onVider: () => {
      appliquer(
        [...selection]
          .map((cle) => {
            const existante = seanceDe(cle);
            if (!existante) return null;
            const { jour, creneau, periode } = lireCle(cle);
            return {
              type: 'vider',
              cle,
              creneau: {
                jour,
                seance: creneau,
                periode,
                formateurMatricule: existante.formateurMatricule,
              },
            };
          })
          .filter(Boolean)
      );
    },
    onDefaire: () => restaurer(defaire(historique, seances)),
    onRefaire: () => restaurer(refaire(historique, seances)),
  };

  /**
   * Remet la semaine dans un état passé.
   *
   * ⚠️ On REJOUE des écritures, on ne « remet » pas un blob : chaque séance est
   * un document, et l'état d'avant se rétablit en reposant ce qui y était et en
   * vidant ce qui n'y était pas.
   */
  const restaurer = (resultat) => {
    if (!resultat) return;

    /*
     * Une entrée porte sa PORTÉE (`{ etat, cles }`) : seules ces cases sont
     * rétablies. Les autres ont pu être modifiées par un collègue depuis — les
     * toucher effacerait son travail. Une entrée nue (sans portée) rétablit tout.
     */
    const entree = resultat.etat;
    const etatAvant = Array.isArray(entree) ? entree : (entree?.etat ?? []);
    const portee = Array.isArray(entree) ? null : new Set(entree?.cles ?? []);
    const dansLaPortee = (cle) => !portee || portee.has(cle);

    const avant = new Map(
      etatAvant.map((s) => [cleCase(axeGroupe ? s.groupe : s.formateurMatricule, s.jour, s.seance, s.periode), s])
    );
    const maintenant = new Map(
      seances.map((s) => [cleCase(axeGroupe ? s.groupe : s.formateurMatricule, s.jour, s.seance, s.periode), s])
    );

    const operations = [];

    for (const [cle, s] of avant) {
      if (!dansLaPortee(cle)) continue;
      const actuelle = maintenant.get(cle);
      if (actuelle && actuelle.module === s.module && actuelle.groupe === s.groupe && actuelle.salle === s.salle) {
        continue;
      }
      const { jour, creneau, periode } = lireCle(cle);
      operations.push({
        type: 'poser',
        cle,
        seance: {
          id: actuelle?.id,
          jour,
          seance: creneau,
          periode,
          formateurMatricule: s.formateurMatricule,
          groupe: s.groupe,
          module: s.module,
          salle: s.salle ?? '',
          statut: s.statut ?? 'planifie',
        },
      });
    }

    for (const [cle, s] of maintenant) {
      if (avant.has(cle) || !dansLaPortee(cle)) continue;
      const { jour, creneau, periode } = lireCle(cle);
      operations.push({
        type: 'vider',
        cle,
        creneau: { jour, seance: creneau, periode, formateurMatricule: s.formateurMatricule },
      });
    }

    // `memoriser` reste FAUX : c'est l'historique lui-même qui avance ici, et
    // empiler l'état courant ferait boucler « défaire » sur deux états.
    setHistorique(resultat.historique);
    if (operations.length > 0) ecrire.mutate({ operations });
  };

  // ═══ Raccourcis clavier ═══
  useEffect(() => {
    const surTouche = (evenement) => {
      // Une saisie en cours dans une liste garde ses propres touches.
      if (['SELECT', 'INPUT', 'TEXTAREA'].includes(evenement.target.tagName)) return;

      const ctrl = evenement.ctrlKey || evenement.metaKey;
      const geste = {
        c: ctrl && selection.size > 0 ? actions.onCopier : null,
        x: ctrl && selection.size > 0 ? actions.onCouper : null,
        v: ctrl && pressePapiers && selection.size > 0 ? actions.onColler : null,
        z: ctrl ? actions.onDefaire : null,
        y: ctrl ? actions.onRefaire : null,
      }[evenement.key?.toLowerCase()];

      // Échap annule la sélection — c'est ce que la barre flottante annonce, et
      // le geste attendu pour se dégager sans rien modifier.
      if (evenement.key === 'Escape' && selection.size > 0) {
        evenement.preventDefault();
        setSelection(new Set());
        return;
      }

      const suppression =
        !ctrl && ['Delete', 'Backspace'].includes(evenement.key) && selection.size > 0
          ? actions.onVider
          : null;

      const choisi = geste ?? suppression;
      if (!choisi) return;

      evenement.preventDefault();
      choisi();
    };

    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  });

  const sansConflit = () => setConflits(new Map());

  /*
   * ⚠️ LA SÉANCE QU'ON DÉPLACE, PAS SEULEMENT SA CASE D'ORIGINE. `GrilleEmploi`
   * s'en sert pour calculer, UNE SEULE FOIS par geste (pas par case survolée),
   * l'ensemble des créneaux où elle pourrait atterrir sans conflit — d'où le
   * vert qui s'allume pendant le glissement. `seanceDe` retourne la MÊME
   * référence tant que `seances` n'a pas changé : ça reste stable pendant tout
   * le geste, comme les autres props qui protègent le `memo` des 1 224 cases.
   */
  const seanceEnDeplacement = depot.source ? seanceDe(depot.source) : null;

  return (
    <CadreReglage
      /* Une GRILLE de 24 colonnes, pas un écran de réglages : la largeur par
         défaut lui laissait 31 px par case et faisait replier sa barre. */
      large
      titre="Emploi du temps"
      chargement={contexte.isLoading || semaines.isLoading}
      erreur={contexte.isError ? contexte.error.message : null}
    >
      {/*
        ⚠️ UNE SEULE RANGÉE. La bascule jour/soir EN TÊTE : elle décide de ce que
        la grille montre, donc de ce que tout le reste manipule. Puis la semaine,
        puis les outils, puis à droite la sélection et la réinitialisation.
      */}
      <div
        /*
         * ⚠️ UNE GRILLE À TROIS COLONNES, PAS UN `flex`. Le bloc de navigation
         * doit être CENTRÉ dans la rangée — avec `justify-between`, il se
         * décalerait au gré de la largeur des deux extrémités, qui ne sont pas
         * de même taille. `1fr auto 1fr` fixe le milieu au centre RÉEL de la
         * rangée, quoi que portent les côtés.
         */
        className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]"
      >
        {/*
          JOUR ET SOIR SONT DEUX GRILLES, PAS DEUX SECTIONS EMPILÉES. La grille
          du soir ne concerne que les groupes « CDS » et ne porte qu'un créneau :
          posée SOUS celle du jour, elle passait sous la ligne de flottaison et
          on la découvrait par hasard.
        */}
        <div className="flex flex-wrap items-center gap-2 justify-self-start">
        <ButtonGroup>
          <Button
            variant={periode === 'jour' ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => changerPeriode('jour')}
          >
            <Sun className="size-3.5" />
            Jour
          </Button>
          {/*
            ⚠️ LE BOUTON N'EST PAS DÉSACTIVÉ QUAND IL N'Y A PAS DE GROUPE CDS.
            Désactivé, il ne dit ni ce qu'il ferait ni pourquoi il refuse. C'est
            la GRILLE qui l'explique, comme dans l'existant (emploi.html:5197).
          */}
          <Button
            variant={periode === 'soir' ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            title={`Créneau ${SEANCE_SOIR}, réservé aux groupes CDS`}
            onClick={() => changerPeriode('soir')}
          >
            <Moon className="size-3.5" />
            Soir
          </Button>
        </ButtonGroup>

        </div>

        <NavigationSemaine
          className="justify-self-center"
          semaine={semaine}
          onChanger={(valeur) => {
            setSemaine(valeur);
            setSelection(new Set());
            // ⚠️ L'historique est propre à la SEMAINE : le garder ferait
            // rejouer sur mardi un état qui appartenait à lundi.
            setHistorique(HISTORIQUE_VIDE);
            sansConflit();
          }}
          courante={semaines.data?.courante}
          anneeScolaire={contexte.data?.anneeScolaire}
          remplies={semaines.data?.semaines ?? []}
        />

  
        <div className="flex items-center gap-3 justify-self-end">
          {/*
            ═══ LES AVATARS ET « PARTAGER » MONTENT DANS LA BARRE DU HAUT ═══
            (2026-09-12, demande du porteur : « comme dans Notion ».) Ils disent
            QUI est sur la page et À QUI elle est ouverte — une propriété de la
            page entière, pas de la rangée d'outils de la grille. Et la rangée
            s'en trouve desserrée : le compteur et la bascule d'axe y passaient
            sur deux lignes.
          */}
          <PortailEnTete>
            <AvatarsPresence
              membres={salle.membres}
              utilisateurId={salle.utilisateurId}
              statut={salle.statut}
              semaine={semaine}
              compact
            />
            {/* ⚠️ Au directeur seul : il est le seul à partager — le serveur
                refuse de toute façon. */}
            {estDirecteur && (
              <BoutonPartager
                page="emploi"
                semaine={semaine}
                publication={semaines.data?.publication}
                moi={session.data?.utilisateur}
              />
            )}
          </PortailEnTete>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {seances.length > 0 ? `${seances.length} séance(s)` : 'aucune séance'}
          </span>

          <Label htmlFor="axe-emploi" className={cn('whitespace-nowrap text-xs font-normal', !parGroupe && 'font-medium text-foreground')}>
            Par formateur
          </Label>
          <Switch
            id="axe-emploi"
            checked={parGroupe}
            /* ⚠️ Le soir est TOUJOURS par groupe : le créneau appartient au
               groupe CDS, pas au formateur. Laisser la bascule active ferait
               croire à une vue formateur qui n'existe pas. */
            disabled={periode === 'soir'}
            onCheckedChange={(valeur) => {
              setParGroupe(valeur);
              setSelection(new Set());
              setHistorique(HISTORIQUE_VIDE);
            }}
          />
          <Label htmlFor="axe-emploi" className={cn('whitespace-nowrap text-xs font-normal', parGroupe && 'font-medium text-foreground')}>
            Par groupe
          </Label>
        </div>
      </div>

      {/*
        ⚠️ LES OUTILS GARDENT LEUR PROPRE RANGÉE. Fondus dans l'en-tête, ils le
        faisaient déborder : le retour à la ligne tombait AU MILIEU du bloc de
        navigation, et la seconde ligne s'ouvrait sur « …e(s) » — la fin du
        compteur de séances — suivie d'un trou. Une rangée par famille se replie
        proprement, quelle que soit la largeur.
      */}
      <div className="flex flex-wrap items-center gap-2">
        {/*
          ═══ ⚠️ AVANT `MenuGrille`, ET C'EST CE QUI LE POSE À GAUCHE ═══
          (2026-09-06, correction du porteur : « à côté d'Importer, à gauche ».)
          `MenuGrille` rend un FRAGMENT qui commence par « Importer » : ce qui
          le précède dans cette rangée se range donc juste avant, sans prop
          nouvelle ni conteneur de plus. Le bloc de droite garde son `ml-auto`.

          ⚠️ HORS DE TOUT `ButtonGroup` : celui-ci est réservé aux choix
          EXCLUSIFS (2026-08-26), et publier est une action indépendante.
        */}
        {estDirecteur && (
          <BoutonPublier semaine={semaine} publication={semaines.data?.publication} />
        )}

        <MenuGrille
          selection={selection}
          enCours={ecrire.isPending || outils.isPending}
          modeSelection={modeSelection}
          semainesDisponibles={semaines.data?.semaines ?? []}
          semaineCourante={semaine}
          onBasculerMode={basculerSelection}
          onImporterSemaine={(depuis) => outils.mutate({ type: 'importer', depuis })}
          onReinitialiser={(portee) => outils.mutate({ type: 'reinitialiser', portee })}
          outilsDirecteur={estDirecteur}
          onStatistiques={() => setStatistiques(true)}
          zoom={zoom}
          onZoom={setZoom}
        />
      </div>

      {grille.isError ? (
        <Alerte type="erreur" titre="Semaine non chargée">
          {grille.error.message}
        </Alerte>
      ) : grille.isLoading || !grille.data ? (
        <p className="text-sm text-muted-foreground">Chargement de la semaine…</p>
      ) : periode === 'soir' && groupesSoir.length === 0 ? (
        /*
          ← « Aucun groupe CDS trouvé. » de emploi.html:5197. La grille du soir
          ne concerne QUE les groupes dont le nom porte « CDS » — c'est la seule
          marque que la base garde du renommage e-note. Le dire ici, et dire OÙ
          cela se règle, vaut mieux qu'un bouton éteint.
        */
        <Alerte type="info" titre="Aucun groupe CDS dans la base">
          La grille du soir ne concerne que les groupes dont le nom porte « CDS ».
          Aucun n’existe pour l’année en cours : le créneau {SEANCE_SOIR} n’a donc
          personne à recevoir. Les noms de groupes viennent de la base e-note ou de
          la carte, dans « Paramètres → Affectations ».
        </Alerte>
      ) : sujets.length === 0 ? (
        <Alerte type="avertissement" titre="Aucun sujet à afficher">
          La grille se construit à partir de la base de l’année. Importez votre base e-note ou
          construisez votre carte depuis « Paramètres → Affectations ».
        </Alerte>
      ) : (
        /*
          ⚠️ `pb-20` : la barre flottante se pose PAR-DESSUS le bas de page.
          Sans cette marge, elle masque la dernière ligne de la grille — le
          dernier formateur devient illisible sans qu'on comprenne pourquoi.
        */
        <div className="space-y-3 pb-20">

          {/*
            ⚠️ EN PIED D'ÉCRAN, ET SEULEMENT QUAND ELLE SERT. Ces gestes
            s'enchaînent sur une sélection qu'on vient de tracer : un menu se
            refermait à chaque choix, et il fallait remonter en haut de page pour
            le rouvrir. Ici, la barre est là où le regard se trouve après le
            glissement.
          */}
          <BarreFlottante
            selection={selection}
            pressePapiers={pressePapiers}
            historique={historique}
            enCours={ecrire.isPending || outils.isPending}
            onEffacerSelection={() => setSelection(new Set())}
            {...actions}
          />

          <DialogueStatistiques
            ouvert={statistiques}
            onFermer={() => setStatistiques(false)}
            seances={seances}
            contexte={contexte.data ?? {}}
            semaine={semaine}
          />

          {conflits.size > 0 && (
            <Alerte type="erreur" titre={`${conflits.size} case(s) refusée(s)`}>
              <ul className="space-y-0.5">
                {[...conflits].slice(0, 6).map(([cle, erreur]) => (
                  <li key={cle}>
                    {lireCle(cle).jour} {lireCle(cle).creneau} —{' '}
                    {/*
                      ⚠️ `Array.isArray`, PAS `?.map` — signalé par le porteur le
                      2026-09-03. Une route qui rendait `details` en OBJET a fait
                      TOMBER TOUTE LA PAGE sur « details?.map is not a function »,
                      là où le message aurait suffi à expliquer le refus. La
                      forme a été corrigée côté serveur ; ce garde évite qu'une
                      prochaine route mal formée coûte l'écran entier.
                    */}
                    {Array.isArray(erreur.details) && erreur.details.length > 0
                      ? erreur.details.map((d) => d.message).join(' ; ')
                      : erreur.message}
                  </li>
                ))}
              </ul>
              <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={sansConflit}>
                Masquer
              </Button>
            </Alerte>
          )}

          <div
            ref={grilleRef}
            // ⚠️ `relative` : la couche des curseurs se positionne dans CE repère.
            className="relative"
            onMouseOver={(e) => glisse.current && e.target.closest('[data-case]') && etendre(lireCle(e.target.closest('[data-case]').dataset.case))}
            onMouseMove={suivreSouris}
            onMouseLeave={() => emettreCurseur(null)}
          >
            <CurseursDistants
              page="emploi"
              vue={{ semaine, periode, axe: axeCourant }}
              conteneurRef={grilleRef}
              zoom={zoom}
            />
            <GrilleEmploi
              zoom={zoom}
              /*
               * ⚠️ UNE SEULE GRILLE À L'ÉCRAN. La bascule choisit laquelle : la
               * grille du soir n'a qu'un créneau et ne concerne que les groupes
               * CDS — empilée sous celle du jour, elle passait sous la ligne de
               * flottaison. Elle est toujours PAR GROUPE : le créneau du soir
               * appartient au groupe, pas au formateur.
               */
              sujets={sujetsAffiches}
              seances={seances.filter((s) => s.periode === periode)}
              jours={jours}
              periode={periode}
              axe={axeGroupe ? 'groupe' : 'formateur'}
              nomDuSujet={axeGroupe ? IDENTITE : nomDuFormateur}
              contexte={contexte.data ?? {}}
              fiches={fiches}
              posees={posees}
              selection={selection}
              conflits={conflitsVus}
              brouillons={brouillons}
              modeSelection={modeSelection}
              caseEnEdition={caseEnEdition}
              survolDepot={depot.survol}
              seanceEnDeplacement={seanceEnDeplacement}
              onChanger={changer}
              onOuvrirCase={ouvrirCase}
              onFermerCase={fermerCase}
              onDeplacer={glisserDeposer}
              onDebuterSelection={debuter}
              onEtendreSelection={etendre}
            />
          </div>

        </div>
      )}
    </CadreReglage>
  );
}


