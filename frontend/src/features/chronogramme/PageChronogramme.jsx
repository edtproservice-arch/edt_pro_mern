import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ChevronDown, RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import Alerte from '@/components/common/Alerte';
import { ROLES } from 'shared/constants';
import {
  comparerMaquettes,
  droitSuffit,
  effacerAvecJumelles,
  groupesJumeaux,
  masseAnnuelle,
  masseHebdomadaire,
  poserAvecJumelles,
  semainesDeLaLigne,
} from 'shared/domain';
import { cn } from '@/lib/utils';
import CadreReglage from '@/features/parametres/CadreReglage';
import EnTetePartage from '@/features/partages/EnTetePartage';
import CurseursDistants from '@/features/tempsReel/CurseursDistants';
import { useSallePage } from '@/features/tempsReel/useSallePage';
import { useEmetteurCurseur } from '@/features/tempsReel/useEmetteurCurseur';
import { fractionDansCase } from '@/features/tempsReel/positions';
import { lireCurseurs } from '@/lib/tempsReel';
import { useAnneeActive } from '@/lib/anneeActive';
import { usePartagesAvecMoi } from '@/features/partages/usePartagesAvecMoi';
import {
  chargerChronogramme,
  chargerChronogrammeFormateur,
  chargerFormateursChronogramme,
  chargerGroupesChronogramme,
  enregistrerChronogramme,
} from './api';
import GrilleChronogramme, { FOND_FORMATION, FOND_STAGE, LegendeRattrapage } from './GrilleChronogramme';
import VueFormateur from './VueFormateur';
import SectionGrille, { OUVERTES_AU_DEPART } from './SectionGrille';
import BoutonDupliquer from './BoutonDupliquer';
import { amorcerPlannings, amorcerVersions, groupesModifies, integrerPlanning, omettreGroupes } from './etatPlannings';
import { estVersionPerimee } from '@/lib/useBrouillonVersionne';
import BarreClasseur from './BarreClasseur';
import BoutonCharge from './BoutonCharge';

/**
 * Chronogramme — planning annuel prévisionnel, par groupe (F7).
 * ← le panneau « chronogramme » de profile.html + api/profile/*chrono*
 *
 * ═══ CE QUE CE PLANNING ENGAGE ═══
 * Ce n'est pas un document d'affichage : il sert de référence au « planifié »
 * de l'avancement, et la génération automatique d'emploi du temps le lit. Une
 * heure posée ici est une heure que le générateur cherchera à placer.
 *
 * ═══ PLUSIEURS GROUPES À LA FOIS ═══
 * Les groupes d'une même promotion suivent les mêmes modules avec les mêmes
 * masses : les planifier l'un après l'autre oblige à refaire vingt fois la même
 * répartition, en rouvrant le sélecteur entre chaque. Les grilles s'empilent
 * donc, une par groupe, et l'enregistrement les écrit toutes.
 */
/** Les clés que relit une annonce d'un collègue : liste, grilles par groupe et par formateur. */
const CLES_A_RELIRE = [['chronogrammes'], ['chronogramme'], ['chronogramme-formateur']];

/*
 * Ce qui DÉRIVE d'un planning appliqué sans relecture : la liste des groupes
 * (« planifié ») et les charges. Les grilles, elles, viennent de l'annonce.
 */
const CLES_APRES_APPLICATION = [['chronogrammes']];

/*
 * Pas de semaine, de période ni d'axe sur cette page : la clé d'une case —
 * `groupe||module||semaine` — est la même dans les deux vues. ⚠️ Un objet STABLE
 * et non `null` : `memeVue` refuse une vue absente.
 */
const VUE_CHRONOGRAMME = {};

/*
 * ═══ ENREGISTREMENT QUASI IMMÉDIAT (2026-09-13) ═══ 300 ms de pause au lieu de
 * 900 : c'est ce délai qui faisait paraître « lente » la collaboration — la
 * cellule d'un collègue n'arrivait qu'une seconde après sa saisie. Un
 * chronogramme se saisit par clics, pas par frappes : il n'y a pas de rafale à
 * attendre, et l'écriture d'un groupe est légère.
 */
const REPOS_CHRONOGRAMME = 300;

export default function PageChronogramme() {
  const cache = useQueryClient();
  /*
   * ═══ CE QUE LA PERSONNE PEUT FAIRE ICI (Phase 5bis, étape d2) ═══
   *   - « peut consulter » : les grilles en LECTURE — ni saisie, ni recopie,
   *     ni Dupliquer, ni Réinitialiser, ni enregistrement ;
   *   - « peut modifier »  : la saisie, comme le directeur ;
   *   - l'import de classeur reste au DIRECTEUR (il réécrit plusieurs groupes).
   * Le serveur applique les mêmes règles ; l'écran n'offre que ce qui passera.
   */
  const { role, droitSur } = usePartagesAvecMoi();
  const lectureSeule = !droitSuffit(droitSur('chronogramme'), 'modifier');
  const peutImporter = role === ROLES.DIRECTEUR;
  const [selection, setSelection] = useState([]);
  const [plannings, setPlannings] = useState({});

  /*
   * ═══ LE PLANNING D'UN COLLÈGUE ARRIVE AVEC SON ANNONCE (2026-09-13) ═══
   * L'annonce d'un enregistrement porte le planning du groupe et sa version :
   * on les pose dans le cache, sans relecture. L'amorçage fait le reste — il
   * ADOPTE le planning reçu si la grille n'a pas de saisie en cours, et le garde
   * pour le 409 sinon. Relire coûtait un aller-retour après 250 ms de
   * regroupement : la cellule changeait chez les autres une à deux secondes
   * après la saisie.
   */
  const appliquerAnnonce = useCallback(
    (message) => {
      if (message.action !== 'enregistrer' || !message.planning || typeof message.version !== 'number') {
        return false;
      }
      const annonce = { groupe: message.groupe, planning: message.planning, version: message.version };
      cache.setQueryData(['chronogramme', message.groupe], (donnees) => integrerPlanning(donnees, annonce));
      cache.setQueriesData({ queryKey: ['chronogramme-formateur'] }, (donnees) =>
        integrerPlanning(donnees, annonce)
      );
      return true;
    },
    [cache]
  );

  const anneeActive = useAnneeActive();
  const salle = useSallePage('chronogramme', {
    anneeScolaire: anneeActive,
    clesARelire: CLES_A_RELIRE,
    // Même règle que l'en-tête autonome : sans année choisie, celle du serveur.
    anneeParDefaut: true,
    appliquer: appliquerAnnonce,
    clesApresApplication: CLES_APRES_APPLICATION,
  });

  /*
   * ═══ MON CURSEUR ET MA CASE OUVERTE, ENVOYÉS AUX AUTRES ═══
   * ⚠️ RELATIFS À UNE CELLULE, JAMAIS EN PIXELS : deux écrans n'ont ni la même
   * largeur, ni le même zoom, ni le même défilement horizontal. On envoie la
   * clé de la cellule survolée et la fraction de sa largeur et de sa hauteur.
   */
  const zoneGrilles = useRef(null);
  const emettreCurseur = useEmetteurCurseur(salle.envoyerCurseur);

  const suivreSouris = (evenement) => {
    const cellule = evenement.target.closest?.('[data-case]');
    if (!cellule) return;
    const fraction = fractionDansCase(cellule.getBoundingClientRect(), evenement.clientX, evenement.clientY);
    if (fraction) emettreCurseur({ cle: cellule.dataset.case, ...fraction });
  };

  /*
   * La case OUVERTE — c'est elle que les autres voient encadrée « X modifie ».
   * ⚠️ PLUSIEURS GRILLES sur la page : la fermeture d'une case ne doit effacer
   * que SA propre annonce, pas celle qu'une autre grille vient d'ouvrir.
   */
  const focusCourant = useRef(null);
  const { envoyerFocus, rejoint } = salle;

  const surOuverture = useCallback(
    (cle, precedente) => {
      if (cle) {
        focusCourant.current = cle;
        envoyerFocus({ cle });
        /*
         * ⚠️ UNE CASE QU'UN COLLÈGUE SAISIT DÉJÀ : on ne l'interdit pas — il a pu
         * la laisser ouverte en partant — mais on le DIT. Lecture impérative :
         * s'abonner aux curseurs ferait re-rendre la page vingt fois par seconde.
         */
        for (const { utilisateur, focus } of lireCurseurs('chronogramme').values()) {
          if (focus?.cle === cle) {
            toast.warning(`${utilisateur.nom} est en train de modifier cette cellule`, {
              description: 'Si vous enregistrez tous les deux le même groupe, le second devra recharger.',
            });
            break;
          }
        }
      } else if (focusCourant.current === precedente) {
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

  /*
   * ═══ DEUX LECTURES DE LA MÊME DONNÉE ═══
   * Le chronogramme est STOCKÉ par groupe — c'est le mode par défaut, et le
   * seul qui s'écrit. Le mode formateur relit ces mêmes plannings sous l'angle
   * d'une personne : ses modules, dans tous ses groupes, sur une seule grille.
   * Il n'y a donc qu'une source de vérité, et pas de route d'écriture
   * symétrique qui pourrait en diverger.
   */
  const [parFormateur, setParFormateur] = useState(false);
  /*
   * PLUSIEURS formateurs, comme pour les groupes. Deux personnes qui
   * interviennent sur la même promotion se comparent semaine par semaine — et
   * l'ancien sélecteur unique obligeait à le rouvrir entre chaque, en perdant
   * la grille précédente de vue.
   */
  const [selectionFormateurs, setSelectionFormateurs] = useState([]);

  /*
   * ⚠️ QUELLES GRILLES SONT MONTÉES — et c'est une question de tenue, pas de
   * confort. Une grille pèse ~1 700 nœuds DOM ; cocher les 17 formateurs en
   * montait 28 961 d'un coup, et le rendu se figeait plus de trente secondes.
   * C'est la mesure faite sur la page Affectations, au mot près.
   *
   * On garde donc l'ensemble des blocs REPLIÉS au-delà des deux premiers, et
   * `CollapsibleContent` démonte ce qui est fermé.
   */
  const [depliees, setDepliees] = useState([]);

  const basculerDepli = (cle, ouvert) =>
    setDepliees((courantes) =>
      ouvert ? [...new Set([...courantes, cle])] : courantes.filter((autre) => autre !== cle)
    );

  const groupes = useQuery({
    queryKey: ['chronogrammes'],
    queryFn: chargerGroupesChronogramme,
    retry: false,
  });

  const formateurs = useQuery({
    queryKey: ['chronogrammes', 'formateurs'],
    queryFn: chargerFormateursChronogramme,
    enabled: parFormateur,
    retry: false,
  });

  const grilles = useQueries({
    queries: (parFormateur ? [] : selection).map((groupe) => ({
      queryKey: ['chronogramme', groupe],
      queryFn: () => chargerChronogramme(groupe),
      retry: false,
    })),
  });

  const grillesFormateurs = useQueries({
    queries: (parFormateur ? selectionFormateurs : []).map((identifiant) => ({
      queryKey: ['chronogramme-formateur', identifiant],
      queryFn: () => chargerChronogrammeFormateur(identifiant),
      retry: false,
    })),
  });

  /**
   * Les plannings tels qu'ils sont EN BASE — UNIQUEMENT ceux qui sont ARRIVÉS.
   *
   * ⚠️⚠️ NE JAMAIS Y METTRE UN GROUPE DONT LA REQUÊTE N'A PAS RÉPONDU. Un
   * `?? {}` de repli sur une requête en vol coûtait une PERTE DE DONNÉES, et
   * elle s'est produite : le groupe était amorcé à `{}`, l'amorçage ne le
   * reprenait plus une fois la clé posée, et à l'arrivée des données l'écart
   * entre `{}` et le planning réel le faisait passer pour MODIFIÉ.
   * L'enregistrement automatique écrivait alors une grille VIDE par-dessus le
   * chronogramme du groupe — sans un clic de l'utilisateur, et sans rien à
   * l'écran qui le dise. Constaté en base : deux groupes à zéro module.
   *
   * « Pas encore chargé » et « chargé et vide » DOIVENT donc se distinguer, et
   * c'est l'absence de la clé qui les sépare.
   *
   * ⚠️ Le mode formateur en reçoit les plannings COMPLETS des groupes qu'il
   * touche, pas seulement les modules de la personne : c'est ce qui permet à
   * l'enregistrement de ne pas effacer les modules de ses collègues.
   */
  const initiaux = useMemo(() => {
    const depart = {};

    if (parFormateur) {
      /*
       * ⚠️ DEUX FORMATEURS PEUVENT PARTAGER UN GROUPE. Chacun reçoit le planning
       * COMPLET de ce groupe — c'est ce qui protège les modules des collègues à
       * l'enregistrement — donc les deux réponses portent la même valeur pour ce
       * groupe, et la fusion est sans perte quel que soit l'ordre.
       */
      for (const grille of grillesFormateurs) {
        if (grille.data) Object.assign(depart, grille.data.plannings ?? {});
      }
      return depart;
    }

    for (const [rang, groupe] of selection.entries()) {
      const chargee = grilles[rang]?.data;
      if (chargee) depart[groupe] = chargee.planning ?? {};
    }
    return depart;
  }, [parFormateur, grillesFormateurs, selection, grilles]);

  /*
   * La version de chaque planning EN BASE (étape d3) — mêmes sources que
   * `initiaux`, et même règle : un groupe dont la requête n'a pas répondu n'y
   * figure pas.
   */
  const versionsInitiales = useMemo(() => {
    const versions = {};
    if (parFormateur) {
      for (const grille of grillesFormateurs) {
        if (grille.data) Object.assign(versions, grille.data.versions ?? {});
      }
      return versions;
    }
    for (const [rang, groupe] of selection.entries()) {
      const chargee = grilles[rang]?.data;
      if (chargee) versions[groupe] = chargee.version ?? 0;
    }
    return versions;
  }, [parFormateur, grillesFormateurs, selection, grilles]);

  /*
   * Changer de mode REPART de la base. Les deux vues écrivent la même donnée,
   * mais pas la même sélection : garder l'état d'avant ferait apparaître comme
   * « modifié » un groupe qu'on ne regarde plus, et l'enregistrement
   * automatique l'écrirait sans qu'on l'ait vu à l'écran.
   */
  useEffect(() => {
    setPlannings({});
    // La CHAÎNE et non le tableau : un nouveau tableau à chaque rendu relancerait
    // l'effet en boucle, et la saisie en cours serait effacée à chaque frappe.
  }, [parFormateur, selectionFormateurs.join('|')]);

  /*
   * Les DEUX PREMIÈRES d'une sélection s'ouvrent seules : en cocher une et
   * devoir encore la déplier ferait deux gestes pour une intention. Au-delà, on
   * ouvre ce qu'on veut lire — c'est la sélection en masse qui rend le montage
   * automatique impraticable.
   */
  const selectionCourante = parFormateur ? selectionFormateurs : selection;
  const empreinteSelection = selectionCourante.join('|');

  useEffect(() => {
    setDepliees(selectionCourante.slice(0, OUVERTES_AU_DEPART));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empreinteSelection, parFormateur]);

  /*
   * Les plannings entrent en état LOCAL : la saisie doit répondre à la frappe,
   * sans aller-retour serveur. On n'y verse un groupe qu'à son ARRIVÉE, et on
   * retire ceux qu'on a décochés — sinon un groupe retiré puis recoché
   * repartirait de sa saisie précédente, pas de ce qui est en base.
   */
  /*
   * ⚠️ `precedents` : ce que le serveur rendait au tour d'avant. C'est lui qui
   * permet de reconnaître un groupe SANS saisie en cours — et de lui faire
   * suivre ce qu'un collègue vient d'enregistrer (voir `amorcerPlannings`).
   */
  const precedents = useRef({});

  /*
   * ═══ VERSION OPTIMISTE (Phase 5bis, étape d3) ═══
   * `versionsBase` : la version sur laquelle repose chaque copie locale — c'est
   * elle qui part avec l'enregistrement (`amorcerVersions`).
   * `aAdopter` : les groupes refusés en 409, que l'amorçage doit reprendre du
   * serveur dès qu'il rend une version plus récente — la saisie refusée est
   * abandonnée, c'est la règle du porteur. `adoptions` force l'amorçage à
   * repasser quand la version plus récente est DÉJÀ dans le cache (une annonce
   * l'y a mise avant l'envoi).
   */
  const versionsBase = useRef({});
  const aAdopter = useRef(new Set());
  const [adoptions, setAdoptions] = useState(0);

  useEffect(() => {
    const avant = precedents.current;
    precedents.current = initiaux;

    // Calculé HORS du `setState` : une fonction de mise à jour doit rester pure —
    // React peut l'appeler deux fois.
    const forces = [...aAdopter.current].filter(
      (groupe) => groupe in initiaux && (versionsInitiales[groupe] ?? 0) > (versionsBase.current[groupe] ?? 0)
    );
    for (const groupe of forces) aAdopter.current.delete(groupe);

    setPlannings((courants) => {
      const suivants = amorcerPlannings(omettreGroupes(courants, forces), initiaux, avant);
      versionsBase.current = amorcerVersions(versionsBase.current, suivants, initiaux, versionsInitiales);
      return suivants;
    });
  }, [initiaux, versionsInitiales, adoptions]);

  const modifies = groupesModifies(plannings, initiaux);

  const enregistrement = useMutation({
    /*
     * Les groupes modifiés partent EN PARALLÈLE, et chacun a sa propre route :
     * un échec sur l'un n'empêche pas les autres d'être écrits. Les regrouper
     * dans un appel unique ferait tout perdre sur une seule erreur.
     */
    mutationFn: async () => {
      /*
       * ⚠️ `allSettled` ET NON `all` (étape d3) : un groupe refusé en 409 ne doit
       * pas faire croire perdus les autres, qui ont bien été écrits.
       */
      const issues = await Promise.allSettled(
        modifies.map(async (groupe) => {
          const reponse = await enregistrerChronogramme(
            groupe,
            plannings[groupe],
            versionsBase.current[groupe] ?? 0
          );
          // Tout de suite : une seconde saisie doit partir avec la NOUVELLE version.
          versionsBase.current = { ...versionsBase.current, [groupe]: reponse.version };
          return reponse;
        })
      );

      const perimes = modifies.filter(
        (groupe, rang) => issues[rang].status === 'rejected' && estVersionPerimee(issues[rang].reason)
      );
      const autreEchec = issues.find(
        (issue) => issue.status === 'rejected' && !estVersionPerimee(issue.reason)
      );

      if (autreEchec) throw autreEchec.reason;

      if (perimes.length > 0) {
        for (const groupe of perimes) aAdopter.current.add(groupe);
        toast.warning('Modifié entre-temps par quelqu’un d’autre', {
          description: `${perimes.join(', ')} : votre dernière saisie n’a pas été enregistrée — la grille affiche maintenant la version en place.`,
        });
        // Relire ces groupes : c'est leur version plus récente que l'amorçage adoptera.
        for (const groupe of perimes) cache.invalidateQueries({ queryKey: ['chronogramme', groupe] });
        cache.invalidateQueries({ queryKey: ['chronogramme-formateur'] });
        setAdoptions((compte) => compte + 1);
        /*
         * ⚠️ LA MUTATION ÉCHOUE, même si d'autres groupes sont passés : sinon
         * l'indicateur annoncerait « Enregistré » sous le toast qui dit le
         * contraire. Les groupes écrits ont déjà leur nouvelle version.
         */
        throw issues[modifies.indexOf(perimes[0])].reason;
      }

      return issues.filter((issue) => issue.status === 'fulfilled').map((issue) => issue.value);
    },
    onSuccess: (resultats) => {
      cache.invalidateQueries({ queryKey: ['chronogrammes'] });
      cache.invalidateQueries({ queryKey: ['chronogramme-formateur'] });
      for (const groupe of modifies) {
        cache.invalidateQueries({ queryKey: ['chronogramme', groupe] });
      }

      const cellules = resultats.reduce((somme, resultat) => somme + resultat.cellules, 0);
      toast.success(`${resultats.length} chronogramme(s) enregistré(s)`, {
        description: `${cellules} séance(s) planifiée(s).`,
      });
    },
    onError: (erreur) => {
      // Un 409 est déjà annoncé, et la grille rechargée : pas de second message.
      if (estVersionPerimee(erreur)) return;
      toast.error('Enregistrement impossible', { description: erreur.message });
    },
  });

  const liste = groupes.data?.groupes ?? [];
  const listeFormateurs = formateurs.data?.formateurs ?? [];

  /*
   * ═══ TOUT EST RETENU D'OFFICE, LE SÉLECTEUR NE SERT PLUS QU'À FILTRER ═══
   * (2026-09-06, demande du porteur : « je veux que les groupes et formateurs
   * soient tous sélectionnés par défaut, il reste le select seulement pour
   * filtrer, comme en affectation ».)
   *
   * L'écran s'ouvrait VIDE : il fallait cocher avant de voir quoi que ce soit,
   * alors que la question qui amène ici est « où en est la promotion ». La page
   * Affectations montre au contraire tous ses ensembles, repliés, et son champ
   * ne fait que réduire — c'est ce modèle-là.
   *
   * ⚠️⚠️ CE N'EST TENABLE QUE PARCE QUE LES GRILLES SONT REPLIÉES. « Tout
   * cocher » avait figé le rendu plus de trente secondes le 2026-08-20 —
   * 17 grilles, 10 260 cellules, 28 961 nœuds montés d'un coup. `SectionGrille`
   * n'en ouvre que DEUX (`OUVERTES_AU_DEPART`), et `CollapsibleContent`
   * DÉMONTE le reste. Sans ce repli, ce défaut serait le geste par défaut.
   *
   * ⚠️ UNE SEULE FOIS PAR LISTE, jamais à chaque rendu : un défaut est un POINT
   * DE DÉPART, pas une contrainte. Sans cette garde, tout décocher recocherait
   * aussitôt, et le filtre paraîtrait cassé — c'est le défaut déjà corrigé sur
   * la page Avancement (`defautPose`, 2026-09-01). La CLÉ est la liste
   * elle-même : une bascule d'année la change, et la sélection d'avant ne
   * désigne plus rien.
   */
  const defautPose = useRef({ groupes: null, formateurs: null });
  /*
   * ⚠️⚠️ `liste` PORTE DES OBJETS `{groupe, planifie}`, PAS DES CHAÎNES — et
   * `selection`, elle, ne contient que des NOMS. Ma première version faisait un
   * `liste.join('|')` : elle produisait vingt fois « [object Object] », donc
   * vingt entrées IDENTIQUES dans la sélection. Symptômes — le compte était
   * juste (« 20 groupes retenus »), mais **56 avertissements de clé dupliquée**
   * et **aucune grille rendue**. Le compte exact est ce qui rendait le défaut
   * plausible à l'œil : il faut lire la FORME de la donnée, jamais la supposer.
   */
  const cleGroupes = liste.map((entree) => entree.groupe).join('|');
  const cleFormateurs = listeFormateurs.map((entree) => entree.identifiant).join('|');

  useEffect(() => {
    if (cleGroupes === '' || defautPose.current.groupes === cleGroupes) return;
    defautPose.current.groupes = cleGroupes;
    setSelection(cleGroupes.split('|'));
  }, [cleGroupes]);

  useEffect(() => {
    if (cleFormateurs === '' || defautPose.current.formateurs === cleFormateurs) return;
    defautPose.current.formateurs = cleFormateurs;
    setSelectionFormateurs(cleFormateurs.split('|'));
  }, [cleFormateurs]);

  /** Vide la grille d'un groupe — l'enregistrement automatique suit. */
  const reinitialiser = (groupe) => {
    setPlannings((courants) => ({ ...courants, [groupe]: {} }));
    toast.success(`Grille de ${groupe} vidée`, {
      description: 'Annulable depuis le menu de la page tant que rien d’autre n’est enregistré.',
    });
  };

  /**
   * Vide les heures de CE FORMATEUR, dans tous ses groupes.
   *
   * ⚠️ ET SEULEMENT LES SIENNES. Remettre à zéro les plannings des groupes
   * qu'il touche effacerait le travail de ses collègues — huit chronogrammes de
   * groupe entiers pour un clic censé ne concerner qu'une personne. On retire
   * donc module par module, exactement les lignes qui sont à l'écran : c'est le
   * même raisonnement que l'enregistrement, et le même risque.
   */
  const reinitialiserFormateur = (donnees) => {
    setPlannings((courants) => {
      const suivants = { ...courants };

      for (const ligne of donnees.lignes) {
        const restant = { ...(suivants[ligne.groupe] ?? {}) };
        delete restant[ligne.code];
        suivants[ligne.groupe] = restant;
      }

      return suivants;
    });

    const groupes = new Set(donnees.lignes.map((ligne) => ligne.groupe));
    toast.success(`Heures de ${donnees.nom} retirées`, {
      description: `${donnees.lignes.length} module(s) sur ${groupes.size} groupe(s). Les autres modules de ces groupes sont conservés.`,
    });
  };

  /**
   * Quelles grilles chargées peuvent recevoir celle de `source` ?
   * ← get_chrono_duplicate_targets.php
   *
   * ⚠️ CE QUI A CHANGÉ, ET POURQUOI. La première version recopiait ce que la
   * cible possédait et ignorait le reste en le mentionnant dans un toast. C'est
   * le pire des deux mondes : la grille arrivée PARAÎT complète — des heures
   * s'affichent partout — alors qu'il en manque, et l'écart ne se découvre qu'au
   * moment où l'avancement ne tombe pas juste, des semaines plus tard.
   *
   * L'existant exigeait l'égalité STRICTE des maquettes et refusait les autres
   * EN DISANT POURQUOI. C'est cette règle qui s'applique désormais, portée dans
   * `shared/domain` et testée.
   */
  /*
   * ═══ ⚠️ LA MATRICE D'ÉLIGIBILITÉ EST CALCULÉE UNE FOIS, PAS À CHAQUE RENDU ═══
   * Chaque section a besoin de savoir vers QUELS autres groupes sa grille peut
   * être copiée : c'est une comparaison de maquettes par COUPLE de groupes, donc
   * n² — 21 groupes cochés font 420 comparaisons, chacune triant et sérialisant
   * une vingtaine de modules.
   *
   * Elle était refaite À CHAQUE RENDU de la page, c'est-à-dire à chaque frappe
   * dans une cellule et à chaque bloc qu'on déplie. Mesuré avec 21 groupes :
   * **1,3 à 1,7 seconde pour ouvrir ou FERMER un bloc** — fermer, qui ne fait que
   * retirer du DOM, coûtait 1,2 s. Le DOM n'y était pour rien.
   *
   * ⚠️ L'EMPREINTE FAIT LA DÉPENDANCE, pas le tableau. `useQueries` rend un
   * NOUVEAU tableau à chaque rendu : le mettre en dépendance annulerait le
   * `useMemo`. `dataUpdatedAt` ne bouge, lui, que lorsque la donnée change
   * vraiment.
   */
  const empreinteGrilles = grilles.map((requete) => requete.dataUpdatedAt ?? 0).join('|');

  const matriceCibles = useMemo(() => {
    const maquettes = new Map(
      selection.map((groupe, rang) => [groupe, grilles[rang]?.data?.modules])
    );

    const matrice = new Map();

    for (const source of selection) {
      matrice.set(
        source,
        selection
          .filter((autre) => autre !== source)
          .map((cible) => {
            const modules = maquettes.get(cible);

            // Une grille encore en chargement n'est ni compatible ni refusée :
            // on ne peut pas comparer ce qu'on n'a pas reçu.
            if (!modules) return { groupe: cible, enAttente: true };

            return {
              groupe: cible,
              ...comparerMaquettes(
                { groupe: source, modules: maquettes.get(source) ?? [] },
                { groupe: cible, modules }
              ),
            };
          })
      );
    }

    return matrice;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, empreinteGrilles]);

  const eligibilite = (source) => matriceCibles.get(source) ?? VIDE_CIBLES;

  /**
   * Recopie le planning d'un groupe sur des groupes à maquette IDENTIQUE.
   * ← duplicate_chronogramme.php
   */
  const dupliquer = (source, cibles) => {
    const planningSource = plannings[source] ?? {};

    setPlannings((courants) => {
      const suivants = { ...courants };
      // Copie EXACTE : les maquettes étant identiques, chaque module de la
      // source existe chez la cible. Plus rien à filtrer, donc plus rien à
      // perdre en silence.
      for (const cible of cibles) suivants[cible] = structuredClone(planningSource);
      return suivants;
    });

    const cellules = Object.values(planningSource).reduce(
      (somme, semaines) => somme + Object.keys(semaines ?? {}).length,
      0
    );

    toast.success(`Grille de ${source} copiée sur ${cibles.length} groupe(s)`, {
      description: `${cellules} cellule(s) par groupe : ${cibles.join(', ')}.`,
    });
  };

  /**
   * Écrit le planning d'UN groupe, et le REPORTE sur ses groupes JUMEAUX
   * actuellement chargés à l'écran.
   * ← demande du porteur, 2026-09-03 : « lorsque je sélectionne une séance
   * synchrone il ne sélectionne pas automatiquement en autre groupe en fusion
   * groupe ». La propagation existait déjà, mais SEULEMENT en mode formateur
   * (`VueFormateur`), où une seule grille porte les deux groupes fusionnés
   * comme deux LIGNES d'un même tableau. En mode groupe, chaque groupe est une
   * grille SÉPARÉE (`SectionGroupe` + `GrilleChronogramme` indépendants) :
   * rien ne les reliait.
   *
   * ⚠️ ON RÉUTILISE `poserAvecJumelles` / `effacerAvecJumelles`, ON NE LES
   * RÉÉCRIT PAS ICI : ce sont elles qui savent apparier une fusion à trois
   * groupes ou plus, dédoublonner par TYPE, et refuser une semaine fermée pour
   * le jumeau (stage, rentrée). Les réécrire à la main dans cette page, c'est
   * exactement la cause n°1 d'instabilité que le plan de migration répète
   * depuis la Phase 2 : la même règle en deux exemplaires finit par diverger.
   * On construit donc, PAR CASE MODIFIÉE, une vue combinée à plat
   * (`cle = groupe||code`) du groupe édité et de SES SEULS jumeaux déjà
   * ouverts, on appelle la fonction du domaine, puis on répartit le résultat.
   *
   * ⚠️ UN JUMEAU NON CHARGÉ N'EST PAS TOUCHÉ, ET C'EST VOULU : sans ses
   * données (masses, semaines propres à SON stage), impossible de savoir s'il
   * a la place. Lui écrire à l'aveugle romprait la garantie qu'un groupe en
   * stage ou pas encore rentré ne reçoit jamais une séance qu'il ne peut pas
   * tenir — la même retenue que `poserAvecJumelles` applique déjà en mode
   * formateur.
   */
  const onChangerGroupe = (groupe, rang, nouveau, motif) => {
    if (nouveau === null) {
      toast.error('Saisie refusée', { description: motif });
      return;
    }

    setPlannings((courants) => {
      const suivants = { ...courants, [groupe]: nouveau };
      const donneesGroupe = grilles[rang]?.data;
      if (!donneesGroupe) return suivants;

      const modulesGroupe = modulesAvecFormations(donneesGroupe);

      for (const changement of changementsCellules(courants[groupe] ?? {}, nouveau)) {
        const module = modulesGroupe.find((m) => m.code === changement.code);
        if (!module) continue;

        const jumeauxCharges = groupesJumeaux(module, groupe)
          .map((nom) => ({ nom, rang: selection.indexOf(nom) }))
          .filter(({ rang: r }) => r !== -1 && grilles[r]?.data);
        if (jumeauxCharges.length === 0) continue;

        const cle = (unGroupe) => `${unGroupe}||${changement.code}`;
        const planningPlat = { [cle(groupe)]: suivants[groupe]?.[changement.code] ?? {} };
        const modulesPlat = [
          { ...module, cle: cle(groupe), groupe, semaines: module.semaines ?? donneesGroupe.semaines },
        ];

        for (const { nom, rang: r } of jumeauxCharges) {
          const donneesJumeau = grilles[r].data;
          const moduleJumeau = modulesAvecFormations(donneesJumeau).find(
            (m) => m.code === changement.code
          );
          if (!moduleJumeau) continue;

          planningPlat[cle(nom)] = suivants[nom]?.[changement.code] ?? {};
          modulesPlat.push({
            ...moduleJumeau,
            cle: cle(nom),
            groupe: nom,
            semaines: moduleJumeau.semaines ?? donneesJumeau.semaines,
          });
        }

        const semaine = (module.semaines ?? donneesGroupe.semaines ?? []).find(
          (s) => s.numero === changement.numero
        );
        if (!semaine) continue;

        const resultat =
          changement.apres === null
            ? effacerAvecJumelles({
                planning: planningPlat,
                modules: modulesPlat,
                module: modulesPlat[0],
                semaine,
              })
            : poserAvecJumelles({
                planning: planningPlat,
                modules: modulesPlat,
                module: modulesPlat[0],
                semaine,
                heures: changement.apres.heures,
                type: changement.apres.type,
              });

        for (const { nom } of jumeauxCharges) {
          const cellules = resultat.planning[cle(nom)];
          if (cellules === undefined) continue;
          suivants[nom] = { ...(suivants[nom] ?? {}), [changement.code]: cellules };
        }
      }

      return suivants;
    });
  };

  return (
    <>
      <EnTetePartage page="chronogramme" salle={salle} />
      <CadreReglage
        titre="Chronogramme"
        chargement={groupes.isLoading}
        erreur={groupes.isError ? groupes.error.message : null}
        modifie={!lectureSeule && modifies.length > 0}
        enCours={enregistrement.isPending}
        echec={enregistrement.isError}
        onEnregistrer={!lectureSeule && modifies.length > 0 ? () => enregistrement.mutate() : undefined}
        valeur={plannings}
        onRestaurer={setPlannings}
        repos={REPOS_CHRONOGRAMME}
      >

        {liste.length === 0 ? (
          <Alerte type="avertissement" titre="Aucun groupe">
            Importez votre base e-note ou construisez votre carte : un chronogramme se fait sur un
            groupe existant.
          </Alerte>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-3">
            {parFormateur ? (
              <ChoixFormateurs
                requete={formateurs}
                selection={selectionFormateurs}
                onChange={setSelectionFormateurs}
              />
            ) : (
              <ChoixGroupes liste={liste} selection={selection} onChange={setSelection} />
            )}

            <BasculeMode actif={parFormateur} onChange={setParFormateur} />
          </div>
        )}

        {/*
          La barre du classeur est posée SOUS le sélecteur : elle porte sur ce qui
          vient d'y être coché, et « Exporter (3) » ne se comprend qu'à côté des
          trois sujets retenus.
        */}
        {liste.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <BarreClasseur
              mode={parFormateur ? 'formateur' : 'groupe'}
              sujets={selectionCourante}
              peutImporter={peutImporter}
            />

            {/*
              ⚠️ LE BOUTON CROISE LE MODE : en vue par groupe il montre la charge
              des FORMATEURS, en vue par formateur celle des GROUPES. Chaque vue
              montre déjà ce qu'elle a sous les yeux ; ce tableau apporte l'autre
              moitié de la réponse — et il ne dépend PAS de ce qui est coché.
            */}
            <BoutonCharge mode={parFormateur ? 'formateur' : 'groupe'} />
          </div>
        )}

        {liste.length > 0 && !parFormateur && selection.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Choisissez un ou plusieurs groupes pour afficher leurs grilles.
          </p>
        )}

        {parFormateur && selectionFormateurs.length === 0 && liste.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Choisissez un ou plusieurs formateurs pour voir leurs modules, tous groupes confondus.
          </p>
        )}

        {/*
          La zone des grilles porte la couche des curseurs : `relative` pour
          qu'elle s'y cale, et le suivi de la souris se fait ici — une seule
          écoute pour toutes les cellules de toutes les grilles.
        */}
        <div
          ref={zoneGrilles}
          className="relative space-y-6"
          onMouseMove={suivreSouris}
          onMouseLeave={() => emettreCurseur(null)}
        >
          <CurseursDistants page="chronogramme" vue={VUE_CHRONOGRAMME} conteneurRef={zoneGrilles} unique />

        {parFormateur && selectionFormateurs.length > 0 && <Legende parFormateur />}

        {parFormateur &&
          selectionFormateurs.map((identifiant, rang) => {
            const donnees = grillesFormateurs[rang]?.data;

            return (
              <SectionGrille
                key={identifiant}
                titre={donnees?.nom ?? identifiant}
                resume={
                  donnees ? (
                    <ResumeMasses
                      modules={donnees.lignes}
                      groupesCount={new Set(donnees.lignes.map((l) => l.groupe)).size}
                    />
                  ) : undefined
                }
                ouvert={depliees.includes(identifiant)}
                onOuvrir={(ouvert) => basculerDepli(identifiant, ouvert)}
                actions={
                  /*
                    ⚠️ PAS DE « DUPLIQUER » ICI, contrairement à la vue par groupe.
                    Recopier la grille d'une personne sur une autre n'a pas de sens :
                    elles n'enseignent pas les mêmes modules aux mêmes groupes, et
                    la copie ne retiendrait presque rien.
                  */
                  !lectureSeule &&
                  donnees?.lignes?.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!aDesHeures(plannings, donnees.lignes)}
                      className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => reinitialiserFormateur(donnees)}
                    >
                      <RotateCcw className="size-3.5" />
                      Réinitialiser
                    </Button>
                  )
                }
              >
                <VueFormateur
                  requete={grillesFormateurs[rang]}
                  plannings={plannings}
                  lectureSeule={lectureSeule}
                  onOuverture={surOuverture}
                  onChanger={(nouveaux, motif) => {
                    if (nouveaux === null) {
                      toast.error('Saisie refusée', { description: motif });
                      return;
                    }
                    setPlannings(nouveaux);
                  }}
                />
              </SectionGrille>
            );
          })}

        {!parFormateur && selection.length > 0 && <Legende />}

        {!parFormateur &&
          selection.map((groupe, rang) => (
          <SectionGroupe
            key={groupe}
            ouvert={depliees.includes(groupe)}
            onOuvrir={(ouvert) => basculerDepli(groupe, ouvert)}
            groupe={groupe}
            requete={grilles[rang]}
            planning={plannings[groupe]}
            onReinitialiser={() => reinitialiser(groupe)}
            cibles={eligibilite(groupe)}
            onDupliquer={(vers) => dupliquer(groupe, vers)}
            onChanger={(nouveau, motif) => onChangerGroupe(groupe, rang, nouveau, motif)}
            lectureSeule={lectureSeule}
            onOuverture={surOuverture}
          />
        ))}
        </div>
      </CadreReglage>
    </>
  );
}

/** ⚠️ UN SEUL tableau vide partagé : en allouer un par section défait la
    mémoïsation qu'on vient de poser. */
const VIDE_CIBLES = [];

/** Une grille, et ce qu'il faut dire quand elle ne peut pas s'afficher. */
function SectionGroupe({
  groupe,
  requete,
  planning,
  cibles,
  ouvert,
  onOuvrir,
  onReinitialiser,
  onDupliquer,
  onChanger,
  lectureSeule,
  onOuverture,
}) {
  const vide = !planning || Object.values(planning).every((cellules) => !cellules || Object.keys(cellules).length === 0);
  const modules = requete?.data?.modules ?? [];

  /*
   * ⚠️⚠️ MÉMOÏSÉ, SANS QUOI LE `memo` DES 765 CELLULES NE SERT À RIEN. Cette
   * fonction reconstruit les modules — donc de NOUVEAUX objets — et la cellule
   * les reçoit en prop : recalculée à chaque rendu, elle rendait toutes les
   * props inégales et la mémoïsation ne retenait rien. Mesuré : ouvrir la liste
   * d'UNE cellule coûtait encore 879 ms.
   */
  const modulesPrepares = useMemo(
    () => (requete?.data ? modulesAvecFormations(requete.data) : []),
    [requete?.data]
  );

  return (
    <SectionGrille
      titre={groupe}
      resume={modules.length > 0 ? <ResumeMasses modules={modules} /> : undefined}
      ouvert={ouvert}
      onOuvrir={onOuvrir}
      actions={
        !lectureSeule &&
        modules.length > 0 && (
          <div className="flex items-center gap-1">
            {/*
              Dupliquer n'apparaît QUE s'il y a une cible à comparer, et QUE si
              la grille porte des heures : copier une grille vide n'efface
              qu'accidentellement celle d'en face.
            */}
            <BoutonDupliquer
              source={groupe}
              cibles={cibles}
              vide={vide}
              onDupliquer={onDupliquer}
            />

            <Button
              variant="ghost"
              size="sm"
              disabled={vide}
              className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onReinitialiser}
            >
              <RotateCcw className="size-3.5" />
              Réinitialiser
            </Button>
          </div>
        )
      }
    >
      {requete?.isError ? (
        <Alerte type="erreur" titre="Grille non chargée">
          {requete.error.message}
        </Alerte>
      ) : requete?.isLoading || !planning ? (
        <p className="text-sm text-muted-foreground">Chargement de la grille…</p>
      ) : modules.length === 0 ? (
        <Alerte type="avertissement" titre="Aucun module affecté à ce groupe">
          La grille se construit à partir des affectations. Renseignez-les depuis « Paramètres →
          Affectations » : un module sans formateur n&apos;y figure pas encore.
        </Alerte>
      ) : (
        <GrilleChronogramme
          modules={modulesPrepares}
          semaines={requete.data.semaines}
          planning={planning}
          onChanger={onChanger}
          lectureSeule={lectureSeule}
          groupe={groupe}
          onOuverture={onOuverture}
          // Semaines d'absence et de rattrapage de ce groupe (2026-09-14).
          marques={requete.data.marques}
        />
      )}
    </SectionGrille>
  );
}

/**
 * Verrouille, ligne par ligne, les semaines où les formateurs du module sont
 * tous en formation.
 *
 * ⚠️ PAR LIGNE, JAMAIS PAR COLONNE. Une formation retient une PERSONNE : fermer
 * la colonne du groupe rendrait insaisissables les dix autres modules, dont les
 * formateurs sont là. C'est le pendant exact du stage en vue formateur, et les
 * deux passent par la MÊME fonction de domaine — l'écrire deux fois, c'était la
 * faire diverger au premier changement.
 */
function modulesAvecFormations({ modules, semaines }) {
  return modules.map((module) =>
    module.formationSemaines?.length > 0
      ? { ...module, semaines: semainesDeLaLigne(semaines, { formation: module.formationSemaines }) }
      : module
  );
}

/**
 * Les cases dont la valeur diffère entre deux plannings d'UN groupe.
 * ← sert la propagation inter-groupes de `onChangerGroupe` : on ne rejoue QUE
 * ce qui vient de changer — un clic pose une case, un glissement peut en
 * changer plusieurs d'un coup.
 *
 * ⚠️ `apres: null` DÉSIGNE UN EFFACEMENT — `poserCellule` RETIRE la clé d'une
 * case vidée plutôt que d'y garder un zéro (le planning ne doit porter que ce
 * qui est réellement prévu). C'est cette absence qu'on compare, pas une
 * valeur — sans quoi une case effacée ne serait jamais vue comme un
 * changement.
 *
 * @returns {Array<{code: string, numero: number, apres: {heures, type}|null}>}
 */
function changementsCellules(ancien = {}, nouveau = {}) {
  const changements = [];

  for (const code of new Set([...Object.keys(ancien), ...Object.keys(nouveau)])) {
    const semainesAncien = ancien[code] ?? {};
    const semainesNouveau = nouveau[code] ?? {};

    for (const numero of new Set([...Object.keys(semainesAncien), ...Object.keys(semainesNouveau)])) {
      const avant = semainesAncien[numero] ?? null;
      const apres = semainesNouveau[numero] ?? null;
      if (JSON.stringify(avant) === JSON.stringify(apres)) continue;

      changements.push({ code, numero: Number(numero), apres });
    }
  }

  return changements;
}

/**
 * Choix multiple des groupes.
 * ← `chronoMultiSelectList` de profil-dialogues.js
 *
 * Le filtre apparaît au-delà d'une douzaine : en dessous il occupe la place
 * sans rien faire gagner ; au-dessus, trouver un groupe dans vingt cases à
 * cocher devient un exercice.
 */
function ChoixGroupes({ liste, selection, onChange }) {
  const [filtre, setFiltre] = useState('');

  const visibles = liste.filter((entree) =>
    entree.groupe.toLowerCase().includes(filtre.trim().toLowerCase())
  );

  const basculer = (groupe) =>
    onChange(
      selection.includes(groupe)
        ? selection.filter((autre) => autre !== groupe)
        : [...selection, groupe]
    );

  const planifies = liste.filter((entree) => entree.planifie).length;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-72 space-y-1.5">
        <Label>Groupes</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full justify-start gap-2 font-normal">
              <span className="min-w-0 flex-1 truncate text-left">
                {selection.length === 0
                  ? 'Choisir un ou plusieurs groupes…'
                  : selection.length === 1
                    ? selection[0]
                    : `${selection.length} groupes retenus`}
              </span>
              <ChevronDown className="size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>

          <PopoverContent align="start" className="w-72 p-3">
            <div className="space-y-2">
              <BasculeTout
                visibles={visibles}
                selection={selection}
                onChange={onChange}
                cle={(entree) => entree.groupe}
              />

              {liste.length > 12 && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={filtre}
                    onChange={(evenement) => setFiltre(evenement.target.value)}
                    placeholder="Filtrer…"
                    className="h-8 pl-8"
                  />
                </div>
              )}

              <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
                {visibles.length === 0 && (
                  <p className="px-1 py-2 text-sm text-muted-foreground">
                    Aucun groupe ne correspond.
                  </p>
                )}

                {visibles.map((entree) => (
                  <label
                    key={entree.groupe}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={selection.includes(entree.groupe)}
                      onCheckedChange={() => basculer(entree.groupe)}
                    />
                    {/*
                      ⚠️ La pastille est DANS le même bloc que le nom, et non
                      poussée au bout de la ligne : rejetée à droite, elle
                      flottait loin du groupe qu'elle qualifie et se lisait comme
                      un état de la ligne entière. `flex-1` reste sur le
                      conteneur pour que la ligne garde sa largeur.
                    */}
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate">{entree.groupe}</span>
                      {entree.planifie && (
                        <Check
                          className="size-3.5 shrink-0 text-success"
                          title="Chronogramme déjà planifié"
                        />
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <p className="pb-2 text-xs text-muted-foreground">
        {planifies} sur {liste.length} groupe(s) planifié(s)
      </p>
    </div>
  );
}

/**
 * « Tout cocher » / « Tout décocher », au-dessus des deux listes.
 *
 * ⚠️ « TOUT COCHER » PORTE SUR CE QUI EST VISIBLE, pas sur la liste entière.
 * Filtrer « SMP » puis cocher tout doit retenir les groupes SMP — c'est ce
 * qu'on vient de demander à l'écran. Cocher les vingt autres au passage
 * ouvrirait vingt grilles qu'on n'a pas demandées, et il faudrait les retrouver
 * une à une pour les retirer.
 *
 * Le bouton BASCULE : quand tout le visible est déjà retenu, il décoche. Deux
 * boutons côte à côte dont l'un est toujours sans effet font hésiter sur ce
 * qu'ils font.
 */
function BasculeTout({ visibles, selection, onChange, cle }) {
  const valeurs = visibles.map(cle);
  const toutRetenu = valeurs.length > 0 && valeurs.every((valeur) => selection.includes(valeur));
  const horsFiltre = selection.filter((valeur) => !valeurs.includes(valeur)).length;

  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">
        {selection.length > 0 ? `${selection.length} retenu(s)` : 'Aucun retenu'}
      </Label>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={valeurs.length === 0}
          onClick={() =>
            onChange(
              toutRetenu
                ? selection.filter((valeur) => !valeurs.includes(valeur))
                : [...new Set([...selection, ...valeurs])]
            )
          }
        >
          {toutRetenu ? 'Tout décocher' : 'Tout cocher'}
        </Button>

        {/*
          « Vider » n'apparaît QUE s'il reste des cases cochées hors du filtre :
          là, « Tout décocher » n'atteint pas tout, et rien d'autre ne permet de
          repartir de zéro sans effacer le filtre d'abord. Sans ce cas, il ferait
          doublon avec le bouton voisin.
        */}
        {horsFiltre > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onChange([])}
          >
            Vider
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Le commutateur des deux lectures.
 * ← le bouton « Mode formateur » du chronogramme d'EDT Pro
 *
 * En INTERRUPTEUR et non en deux onglets : ce n'est pas un changement de page,
 * c'est le meme planning regarde autrement. Les deux libelles restent affiches,
 * sinon rien ne dit ce qu'on quitte en le desactivant.
 */
function BasculeMode({ actif, onChange }) {
  return (
    <div className="flex items-center gap-2 pb-2">
      <Label
        htmlFor="mode-formateur"
        className={cn('text-xs font-normal', !actif && 'font-medium text-foreground')}
      >
        Par groupe
      </Label>
      <Switch id="mode-formateur" checked={actif} onCheckedChange={onChange} />
      <Label
        htmlFor="mode-formateur"
        className={cn('text-xs font-normal', actif && 'font-medium text-foreground')}
      >
        Par formateur
      </Label>
    </div>
  );
}

/**
 * Choix des formateurs — PLUSIEURS, comme les groupes.
 *
 * Deux personnes qui interviennent sur la même promotion se comparent semaine
 * par semaine ; un sélecteur unique obligeait à le rouvrir entre chaque, en
 * perdant la grille précédente de vue. Le panneau reste donc ouvert pendant
 * qu'on coche — comme celui des groupes, et pour la même raison.
 */
function ChoixFormateurs({ requete, selection, onChange }) {
  const [filtre, setFiltre] = useState('');
  const liste = requete.data?.formateurs ?? [];

  const visibles = liste.filter((entree) =>
    entree.nom.toLowerCase().includes(filtre.trim().toLowerCase())
  );

  const basculer = (identifiant) =>
    onChange(
      selection.includes(identifiant)
        ? selection.filter((autre) => autre !== identifiant)
        : [...selection, identifiant]
    );

  if (requete.isError) {
    return (
      <div className="w-72 space-y-1.5">
        <Label>Formateurs</Label>
        <Alerte type="erreur" titre="Liste indisponible">
          {requete.error.message}
        </Alerte>
      </div>
    );
  }

  return (
    <div className="w-72 space-y-1.5">
      <Label>Formateurs</Label>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start gap-2 font-normal">
            <span className="min-w-0 flex-1 truncate text-left">
              {requete.isLoading
                ? 'Chargement\u2026'
                : selection.length === 0
                  ? 'Choisir un ou plusieurs formateurs\u2026'
                  : selection.length === 1
                    ? (liste.find((entree) => entree.identifiant === selection[0])?.nom ??
                      selection[0])
                    : `${selection.length} formateurs retenus`}
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-72 p-3">
          <div className="space-y-2">
            <BasculeTout
              visibles={visibles}
              selection={selection}
              onChange={onChange}
              cle={(entree) => entree.identifiant}
            />

            {liste.length > 12 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filtre}
                  onChange={(evenement) => setFiltre(evenement.target.value)}
                  placeholder="Filtrer\u2026"
                  className="h-8 pl-8"
                />
              </div>
            )}

            <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border p-2">
              {visibles.length === 0 && (
                <p className="px-1 py-2 text-sm text-muted-foreground">
                  {liste.length === 0
                    ? 'Aucun formateur affect\u00e9 dans la base de cette ann\u00e9e.'
                    : 'Aucun formateur ne correspond.'}
                </p>
              )}

              {visibles.map((entree) => (
                <label
                  key={entree.identifiant}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={selection.includes(entree.identifiant)}
                    onCheckedChange={() => basculer(entree.identifiant)}
                  />
                  <span className="min-w-0 flex-1 truncate">{entree.nom}</span>
                  {/* Le nombre de modules situe la personne avant de l'ouvrir. */}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {entree.modules}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Sans elle, les couleurs des colonnes ne s'expliquent pas. */
/** Le badge d'en-tête, rendu à l'identique dans la légende. */
function BadgeLegende({ classe, children }) {
  return (
    <span className={`rounded px-1 text-[0.55rem] font-semibold leading-4 ${classe}`}>
      {children}
    </span>
  );
}

function Legende({ parFormateur }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {/* Le bleu clair des vacances est celui du calendrier : même notion,
          même couleur d'un écran à l'autre. */}
      <Pastille classe="bg-primary/10" libelle="Vacances" />
      {/*
        ⚠️ STAGE ET FORMATION PARTAGENT LE MÊME GRIS depuis le 2026-08-26 : ce
        sont deux absences, et rien ne justifiait que l'une pèse plus que
        l'autre à l'écran. Les deux pastilles sont donc identiques — ce sont
        leurs LIBELLÉS qui distinguent la portée, et les badges d'en-tête qui
        disent lequel des deux ferme la colonne.
      */}
      <Pastille
        classe={FOND_STAGE}
        libelle={parFormateur ? 'Stage \u2014 tous les groupes' : 'Stage du groupe'}
      />
      {/*
        Le libellé change selon la vue — par groupe la formation ne ferme QU'UNE
        ligne, par formateur elle les ferme toutes.
      */}
      <Pastille
        classe={FOND_FORMATION}
        libelle={parFormateur ? 'Formateur en formation' : 'Formateur du module en formation'}
      />
      <Pastille classe="bg-warning/25" libelle="Semaine amputée d’un férié" />
      {/*
        ⚠️ LES BADGES SE LISENT EN CHIFFRES, la teinte ne dit que « il manque
        quelque chose ». « STG » ferme la semaine, « 3 JSTG » dit que trois jours
        partent et que le reste se saisit — la distinction que la couleur ne peut
        pas porter. Ce sont ceux de l'ancien EDT Pro.
      */}
      <span className="flex items-center gap-1">
        <BadgeLegende classe="bg-primary/20 text-primary">VAC</BadgeLegende>
        <BadgeLegende classe="bg-zinc-300 text-foreground dark:bg-zinc-600">STG</BadgeLegende>
        <BadgeLegende classe="bg-zinc-300 text-foreground dark:bg-zinc-600">FOR</BadgeLegende>
        <span>semaine entière</span>
      </span>
      <span className="flex items-center gap-1">
        <BadgeLegende classe="bg-zinc-300 text-foreground dark:bg-zinc-600">3 JSTG</BadgeLegende>
        <BadgeLegende classe="bg-zinc-300 text-foreground dark:bg-zinc-600">2 JFOR</BadgeLegende>
        <BadgeLegende classe="bg-warning/40 text-foreground">1 JF</BadgeLegende>
        <span>jours retirés — le reste se saisit</span>
      </span>
      {/* Les repères d'absence et de rattrapage (2026-09-14). */}
      <LegendeRattrapage />

      {/*
        Les deux teintes d'une cellule REMPLIE. Le vert du présentiel n'a aucun
        homonyme dans la grille — un second bleu se serait confondu avec les
        vacances à 45 colonnes de distance.
      */}
      <Pastille classe="bg-accent-green/15" libelle="Heures présentielles" />
      <Pastille classe="bg-accent-purple/25" libelle="Heures synchrones" />
      {/*
        Le repère des couleurs du pied : sans lui, le bleu et le rouge d'un
        total se lisent comme un avertissement sans seuil connu.
      */}
      <span className="inline-flex items-center gap-1.5">
        {parFormateur ? 'Charge hebdomadaire :' : 'Total hebdomadaire :'}
        {/*
          \u26a0\ufe0f LE M\u00caME SEUIL DES DEUX C\u00d4T\u00c9S. J'avais voulu colorer la vue formateur
          contre sa masse statutaire : elle vaut ~1 000 h, donc ANNUELLE, et les
          45 colonnes prenaient toutes la m\u00eame teinte \u2014 l'\u00e9chelle ne disait plus
          rien. 30 h est ce qu'une semaine peut physiquement contenir, 6 jours de
          5 s\u00e9ances : c'est vrai d'un groupe comme d'une personne. La comparaison
          \u00e0 la masse annuelle est d\u00e9j\u00e0 port\u00e9e par les colonnes MHP et \u00c9cart.
        */}
        <span className="text-primary">sous 30 h</span>
        <span className="text-success">30 h</span>
        <span className="text-destructive">au-delà</span>
      </span>
    </div>
  );
}

/**
 * Ce formateur a-t-il des heures posées quelque part ?
 *
 * Sert à éteindre « Réinitialiser » quand il n'y a rien à retirer : un bouton
 * destructeur actif sur une grille vide invite à un clic sans effet, et fait
 * douter qu'il en ait eu un.
 */
function aDesHeures(plannings, lignes) {
  return lignes.some(
    (ligne) => Object.keys(plannings?.[ligne.groupe]?.[ligne.code] ?? {}).length > 0
  );
}

/**
 * Ce que porte l'en-tête d'un bloc : le nombre de modules, la masse ANNUELLE et
 * ce qu'elle représente chaque semaine.
 *
 * ⚠️ LA CHARGE HEBDOMADAIRE EST LE CHIFFRE UTILE. Un total annuel ne dit pas si
 * la semaine sera tenable — 1 060 h restent abstraites — alors que 30,3 h par
 * semaine se comparent immédiatement aux 30 h qu'une semaine peut contenir.
 * C'est ce rapport qui dit si un chronogramme est jouable AVANT de le remplir,
 * et il se lit sans déplier la grille.
 */
function ResumeMasses({ modules, groupesCount }) {
  const annuelle = masseAnnuelle(modules);

  // Séparateur de milliers : « 1060 h » se lit mal, « 1 060 h » se lit d'un coup.
  const nombre = (valeur) => valeur.toLocaleString('fr-FR');

  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span>{modules.length} module(s)</span>
      <Badge variant="outline" className="font-normal text-xs text-muted-foreground">
        {nombre(annuelle)} h/an · {nombre(masseHebdomadaire(annuelle))} h/sem
      </Badge>
      {groupesCount !== undefined && <span>· {groupesCount} groupe(s)</span>}
    </span>
  );
}

function Pastille({ classe, libelle }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-3 rounded ${classe}`} />
      {libelle}
    </span>
  );
}
