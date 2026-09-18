import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ROLES } from 'shared/constants';
import {
  BarChart3,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Table as TableIcon,
  TrendingUp,
} from 'lucide-react';
import {
  AXES,
  FACETTES,
  FILTRES_VIDES,
  agregerAvancement,
  completionModules,
  dimensionComplement,
  facettesAvancement,
  filtrerAvancement,
  nombreDeFiltres,
  referenceDeLAxe,
  totalAvancement,
} from 'shared/domain';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Alerte from '@/components/common/Alerte';
import CadreReglage from '@/features/parametres/CadreReglage';
import BoutonImportEnote from '@/features/configuration/BoutonImportEnote';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { usePartagesAvecMoi } from '@/features/partages/usePartagesAvecMoi';
import { basculerPanneauTaux, usePanneauTaux } from '@/lib/panneauTaux';
import { chargerAvancement } from './api';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import GrapheAvancement, { Legende } from './GrapheAvancement';
import EnTeteAvancement, { Chiffres, chiffresAAfficher } from './EnTeteAvancement';
import PanneauFiltres, { etiquetteValeur } from './PanneauFiltres';
import SheetChronologie from './SheetChronologie';
import TableauAvancement from './TableauAvancement';

/**
 * Avancement réalisé / prévu (F7) — Phase 7, sous-livraison (a).
 * ← public/avancement.html (5 751 l.) + api/data/get_planned_progress.php
 *
 * ═══ ⚠️ DEUX FACES, ET C'EST L'ÉCART QU'ON VIENT CHERCHER ═══
 * « E-note » montre ce que l'établissement a DÉCLARÉ dans le système national ;
 * « eDTpro » ce qui est réellement posé dans la grille. Les deux se rapportent
 * aux mêmes masses affectées : leur écart dit ce qui n'a pas été saisi d'un
 * côté ou de l'autre, jamais une différence de référentiel. L'existant les
 * présentait sur deux faces d'une carte qu'on retourne ; la bascule les nomme
 * toutes les deux, comme celle des pages Édition et Absences.
 *
 * ⚠️ CE QUI N'EST PAS ENCORE LÀ, et qui suit : la frise chronologique (côté
 * e-note, en rejouant les imports), la complétion des modules et leurs dates
 * d'achèvement, et les graphiques.
 */
/**
 * ⚠️ LES DEUX VUES SONT DÉCLARÉES UNE FOIS : leur ordre, leur libellé et leur
 * icône vivent ici, pas dans deux blocs recopiés.
 *
 * ⚠️ L'ONGLET « COMPARAISON » A ÉTÉ RETIRÉ (correction du porteur, 2026-08-31) :
 * le taux régional se compare au taux GLOBAL de l'établissement, pas à chaque
 * sujet. Il n'avait donc pas besoin d'une vue à lui — un seul graphe, en tête de
 * page, suffit et se lit sans changer d'onglet.
 */
const VUES = [
  { cle: 'graphique', libelle: 'Graphique', Icone: BarChart3 },
  { cle: 'tableau', libelle: 'Tableau', Icone: TableIcon },
];

export default function PageAvancement() {
  const [face, setFace] = useState('edtpro');
  /*
   * ⚠️ L'IMPORT E-NOTE RESTE AU DIRECTEUR (étape d2) : la page est partagée en
   * LECTURE, et la route d'import ne s'ouvre qu'à lui. Un bouton offert à un
   * invité échouerait à chaque fois.
   */
  const { role } = usePartagesAvecMoi();
  const peutImporter = role === ROLES.DIRECTEUR;

  const [axe, setAxe] = useState('module');
  const [recherche, setRecherche] = useState('');
  /*
   * ⚠️ LE GRAPHIQUE EST LA VUE PAR DÉFAUT (décision du porteur, 2026-08-31). On
   * vient d'abord voir OÙ ON EN EST — le rapport affecté/réalisé de cinquante
   * sujets d'un coup — et seulement ensuite chercher un chiffre exact. Le
   * tableau reste à un clic.
   *
   * ⚠️ DEUX VUES, ET ELLES NE SE REMPLACENT PAS : le GRAPHIQUE compare des
   * HEURES entre sujets, le TABLEAU donne les chiffres exacts. La comparaison au
   * rythme régional, elle, vit en tête de page — c'est une lecture d'ENSEMBLE,
   * pas un troisième découpage par sujet.
   */
  const [vue, setVue] = useState('graphique');
  const [filtres, setFiltres] = useState(FILTRES_VIDES);
  /*
   * ═══ ⚠️ LA DATE OBSERVÉE REMBOBINE L'ÉCRAN ═══ (décision du porteur,
   * 2026-08-31 : la chronologie porte sur le graphe à BÂTONS et le tableau, pas
   * sur la courbe du rythme régional.)
   *
   * ⚠️ ELLE FAIT PARTIE DE LA CLÉ DE CACHE : sans cela, rembobiner rendrait
   * l'état courant depuis le cache, et l'écran mentirait sans rien signaler.
   */
  const [dateObservee, setDateObservee] = useState(null);
  /*
   * ⚠️ L'OUVERTURE DU PANNEAU EST PILOTÉE PAR LA PAGE, pas par le composant :
   * non modal, il se pose PAR-DESSUS le bas de la page sans rien décaler, et les
   * dernières lignes du tableau passeraient dessous SANS qu'on puisse défiler
   * plus loin — la page est déjà à son terme. La page réserve donc sa place tant
   * qu'il est ouvert. (Même parade que le `pb-20` de la barre flottante de
   * l'emploi du temps.)
   */
  const [chronologieOuverte, setChronologieOuverte] = useState(false);

  /* Le panneau du taux, à droite du graphe — une préférence de POSTE. */
  const panneauTaux = usePanneauTaux();

  const requete = useQuery({
    queryKey: ['avancement', dateObservee],
    queryFn: () => chargerAvancement(dateObservee),
    retry: false,
    /*
     * ═══ ⚠️⚠️ L'ÉCRAN NE SE VIDE PAS ENTRE DEUX DATES ═══ (demande du porteur,
     * 2026-08-31 : « je ne veux pas que je clique sur la semaine puis la page
     * recharge pour voir les modifications ».)
     *
     * Changer de date change la CLÉ de cache : sans cela la nouvelle requête
     * part sans données, `isLoading` repasse à vrai, et `CadreReglage` remplace
     * la page entière par « Chargement… » — le graphe qu'on voulait regarder
     * DISPARAÎT le temps de l'aller-retour, ce qui se lit comme un
     * rechargement. Les données précédentes restent affichées jusqu'à l'arrivée
     * des nouvelles, et le graphe se met simplement à jour sur place.
     */
    placeholderData: keepPreviousData,
  });

  /*
   * ═══ ⚠️ FILTRER LES LIGNES, PUIS AGRÉGER — jamais l'inverse ═══
   * Un module vu « par module » réunit tous ses groupes : filtrer après
   * agrégation ne pourrait que le garder ou le retirer en bloc, alors que la
   * question posée est « ce module, POUR LES GROUPES DE 1ʳᵉ ANNÉE ». C'est ce
   * qui permet à un même module d'afficher un taux différent selon la promotion
   * regardée.
   *
   * L'agrégation est une fonction PURE du domaine : la faire ici ne crée pas un
   * second calcul, c'est la même que celle des tests, appelée de ce côté-ci du
   * réseau. Et le filtrage devient immédiat, sans aller-retour par facette.
   */
  const brutes = requete.data?.faces?.[face] ?? [];
  const facettes = useMemo(() => facettesAvancement(brutes), [brutes]);
  const retenues = useMemo(() => filtrerAvancement(brutes, filtres), [brutes, filtres]);

  /*
   * ═══ ⚠️ CE QUE LE BÂTON PORTE DÉPEND DE CE QUE LE FILTRE FIXE DÉJÀ ═══
   * Filtré sur un formateur, l'axe module écrivait son nom sur les cinquante
   * bâtons — la même information partout, à la place de celle qu'on cherche.
   * La règle vit dans le domaine ; l'écran ne fait que la lire, et la donne à
   * l'agrégation ET au graphe pour qu'ils ne puissent pas diverger.
   */
  const complement = useMemo(() => dimensionComplement(axe, filtres), [axe, filtres]);

  const lignes = useMemo(
    () => agregerAvancement(retenues, axe, complement),
    [retenues, axe, complement]
  );
  const total = useMemo(() => totalAvancement(retenues), [retenues]);
  // Tout l'établissement, filtres ignorés : c'est ce que la courbe — et sa carte
  // au survol — décrivent.
  const totalEtablissement = useMemo(() => totalAvancement(brutes), [brutes]);
  /*
   * ⚠️ L'ACHÈVEMENT SE CALCULE SUR LES LIGNES RETENUES, comme le reste : filtré
   * sur la 2ᵉ année, « 12 modules achevés sur 40 » parle de cette promotion —
   * c'est précisément la question qu'on pose en filtrant.
   */
  const completion = useMemo(() => completionModules(retenues), [retenues]);

  /*
   * ═══ ⚠️ L'AXE MODULE S'OUVRE SUR UN SEUL GROUPE ═══ (demande du porteur,
   * 2026-09-01.) Vu « par module », un même code réunit ses vingt et un groupes :
   * le taux affiché est alors une moyenne d'établissement, qui ne décrit AUCUNE
   * promotion en particulier. Restreint à un groupe, il redevient la question
   * qu'on se pose — « où en est CE groupe sur CE module ». Les deux autres axes
   * n'ont pas ce défaut : leurs lignes SONT déjà des sujets distincts.
   */
  const groupeAutomatique = useRef(null);
  /*
   * ═══ ⚠️ LE DÉFAUT NE SE POSE QU'UNE FOIS PAR PASSAGE SUR L'AXE ═══
   * Sans cela, « Tout effacer » vidait le filtre… que l'effet reposait aussitôt :
   * le bouton paraissait cassé alors qu'il faisait exactement ce qu'il annonce.
   * Un défaut est un POINT DE DÉPART, jamais une contrainte — il se réarme en
   * quittant l'axe, ou en changeant de face.
   */
  const defautPose = useRef(false);

  useEffect(() => {
    const groupes = facettes.groupe ?? [];
    const choisis = filtres.groupe ?? [];

    if (axe === 'module') {
      if (!defautPose.current && groupes.length > 0 && choisis.length === 0) {
        defautPose.current = true;
        groupeAutomatique.current = groupes[0];
        setFiltres((actuels) => ({ ...actuels, groupe: [groupes[0]] }));
      }
      return;
    }

    /* Quitter l'axe réarme le défaut pour le prochain retour. */
    defautPose.current = false;

    /*
     * ⚠️ ON NE DÉFAIT QUE NOTRE PROPRE DÉFAUT, jamais un choix de l'utilisateur :
     * `groupeAutomatique` retient ce qu'on a posé. Sans lui, quitter l'axe
     * module effacerait un groupe que l'utilisateur venait de cocher lui-même.
     *
     * ⚠️ ET IL FAUT LE DÉFAIRE : sur l'axe « par groupe », un filtre à un seul
     * groupe ne laisse qu'UNE ligne — l'écran se lirait comme une panne.
     */
    if (groupeAutomatique.current && choisis.length === 1 && choisis[0] === groupeAutomatique.current) {
      groupeAutomatique.current = null;
      setFiltres((actuels) => ({ ...actuels, groupe: [] }));
    }
  }, [axe, facettes.groupe, filtres.groupe]);

  const visibles = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (terme === '') return lignes;
    /* ⚠️ LA VENTILATION EST CHERCHABLE AUSSI : ventilé par groupe, « SMP101 »
       est ce qui distingue deux lignes portant le même code de module — ne
       chercher que le sujet les rendrait toutes les deux, ou aucune. */
    return lignes.filter((ligne) =>
      `${ligne.sujet} ${ligne.ventilation ?? ''}`.toLowerCase().includes(terme)
    );
  }, [lignes, recherche]);

  /*
   * ⚠️ LA MÊME RÈGLE QUE LE BLOC DE TÊTE, appelée : sans filtre et avec la
   * courbe, l'anneau répéterait ce que celle-ci montre déjà — il reste alors au
   * survol de la légende.
   */
  const chiffresLateraux =
    vue === 'graphique' &&
    chiffresAAfficher({
      filtre: nombreDeFiltres(filtres) > 0,
      avecCourbe: Boolean(requete.data?.regional) && Boolean(requete.data?.progression?.length),
    });

  const source = requete.data?.source;
  /*
   * ⚠️ LES OBJECTIFS SONT CALCULÉS PAR LE SERVEUR, groupe par groupe : le taux
   * objectif pédagogique parcourt l'année jour par jour en retirant dimanches,
   * fériés, vacances et stages — un calendrier que l'écran n'a pas, et qu'il ne
   * doit pas avoir à charger pour tracer une courbe.
   */
  const objectifs = requete.data?.objectifs ?? {};
  /* Le rythme attendu au niveau RÉGIONAL — une référence unique pour tout
     l'établissement, en semaines actives de S1 à S39. */
  const regional = requete.data?.regional ?? null;
  /* Le nom lisible de chaque module, résolu par le serveur depuis la
     répartition DRIF : `Base.affectations` ne garde que le code. */
  const intitules = requete.data?.intitules ?? {};

  /* Les courbes ne valent que là où les sujets se comparent — cf.
     `GrapheAvancement`. Calculées ici parce que la LÉGENDE, qui doit les
     annoncer, est posée par la page. */
  /*
   * ⚠️ LA RÉFÉRENCE SE CALCULE SUR LES LIGNES RETENUES, donc APRÈS filtrage :
   * sur une vue réduite à la 1ʳᵉ année, le plafond du programme doit descendre
   * avec les barres. C'est une règle métier — d'où `referenceDeLAxe` dans le
   * domaine, et non un `if` dans le rendu.
   */
  const reference = useMemo(
    () => referenceDeLAxe(axe, { statutaires: requete.data?.statutaires ?? {}, lignes: retenues }),
    [axe, requete.data?.statutaires, retenues]
  );

  const courbeTaux = axe === 'formateur' || axe === 'groupe';
  const courbeObjectif = axe === 'groupe' && Object.keys(objectifs).length > 0;

  /*
   * ⚠️ CHANGER DE FACE REMET LES FILTRES À ZÉRO. Les deux faces n'ont pas
   * forcément les mêmes groupes ni les mêmes formateurs — l'import e-note peut
   * dater d'avant la dernière carte : un filtre resté actif viderait la liste
   * sans qu'on voie plus ce qu'il retient.
   */
  const changerFace = (nouvelle) => {
    setFace(nouvelle);
    setFiltres(FILTRES_VIDES);
    /*
     * ⚠️ ET LA DATE AUSSI : les deux faces n'ont pas la même frise — e-note
     * avance par imports, la grille par semaines. Une date retenue sur l'une
     * peut ne correspondre à AUCUN point de l'autre, et le panneau s'ouvrirait
     * sur une frise où rien n'est sélectionné alors que l'écran est rembobiné.
     */
    setDateObservee(null);
    /* Changer de face remet les filtres à zéro : le défaut de l'axe module doit
       donc pouvoir se reposer, sinon l'écran s'ouvrirait sur les 21 groupes. */
    defautPose.current = false;
  };

  return (
    <>
      {/* Les annonces d'un collègue (séances posées, chronogramme, import e-note)
          font relire toute la page : taux, frise et achèvement. */}
      <EnTetePartage page="avancement" clesARelire={[['avancement']]} />
      <CadreReglage
        large
        titre="Avancement du programme"
        chargement={requete.isLoading}
        /* ⚠️ LE MESSAGE, PAS L'OBJET : `CadreReglage` rend `erreur` comme un
           enfant React, et une `Error` y provoque « Objects are not valid as a
           React child » — écran BLANC, alors que la seule chose à montrer était
           justement le message d'erreur. */
        erreur={requete.isError ? requete.error.message : null}
      >
        {/* ── Le choix de la face ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <ButtonGroup>
            {Object.entries(AXES).map(([cle, { libelle }]) => (
              <Button
                key={cle}
                variant={axe === cle ? 'default' : 'outline'}
                size="sm"
                aria-pressed={axe === cle}
                className="h-8 text-xs"
                onClick={() => setAxe(cle)}
              >
                Par {libelle.toLowerCase()}
              </Button>
            ))}
          </ButtonGroup>

          {/*
            ⚠️ LES DEUX FACES SONT NOMMÉES, DE PART ET D'AUTRE — comme les bascules
            des pages Édition et Absences. Légendée d'un seul côté, elle ne dit pas
            ce qu'on quitte, et le libellé actif est en pleine encre.
          */}
          <Label className="ml-auto flex cursor-pointer items-center gap-2 text-xs font-normal">
            <span className={face === 'edtpro' ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              eDTpro
            </span>
            <Switch
              checked={face === 'enote'}
              onCheckedChange={(coche) => changerFace(coche ? 'enote' : 'edtpro')}
              aria-label="Basculer entre l’avancement eDTpro et l’avancement déclaré dans e-note"
            />
            <span className={face === 'enote' ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              E-note
            </span>
          </Label>
        </div>

        {/*
          ⚠️ CHAQUE FACE DIT D'OÙ ELLE VIENT. Sans cela, un taux à zéro laisse
          chercher un défaut de calcul, alors qu'aucun fichier n'a été importé ou
          qu'aucune séance n'a été posée.
        */}
        {face === 'enote' && !source && (
          <Alerte type="avertissement" titre="Aucun fichier e-note importé pour cette année">
            <p>
              Cette face lit les heures déclarées dans le système national. Importez votre export
              e-note pour la renseigner — une seule base est admise par semaine.
            </p>
            {peutImporter && (
              <div className="mt-2">
                <BoutonImportEnote />
              </div>
            )}
          </Alerte>
        )}

        {/*
          ⚠️ LE BOUTON D'IMPORT EST ICI, contre la phrase qui nomme le fichier en
          place (demande du porteur, 2026-09-01). C'est en lisant « importé le
          19 août » qu'on s'aperçoit que la base a une semaine de retard : envoyer
          alors chercher « Paramètres → Affectations » fait perdre le fil.
        */}
        {face === 'enote' && source && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-xs text-muted-foreground">
              D’après <span className="font-medium text-foreground">{source.fichier}</span> —{' '}
              {source.lignes} ligne(s), importé le{' '}
              {new Date(source.importeLe).toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
              .
            </p>
            {peutImporter && <BoutonImportEnote />}
          </div>
        )}

        {/*
          ═══ ⚠️ UN SEUL BLOC EN TÊTE (correction du porteur, 2026-08-31) ═══
          Le bandeau et le graphe disaient la MÊME chose — le taux d'avancement —
          dans deux cadres empilés qui prenaient ensemble le tiers de l'écran avant
          la première donnée détaillée. Les chiffres ont rejoint le graphe : ils LE
          LÉGENDENT, puisque c'est sa courbe qu'ils résument.
        */}
        <EnTeteAvancement
          total={total}
          totalEtablissement={totalEtablissement}
          face={face}
          progression={requete.data?.progression}
          regional={regional}
          /* ⚠️ CALCULÉE PAR LE SERVEUR, plus déduite du rythme régional : celui-ci
             ne monte pas pendant les vacances, et la déduction désignait alors la
             semaine précédente. */
          semaineCourante={requete.data?.semaineCourante ?? null}
          /* ⚠️ SOUS FILTRE, LES CHIFFRES DÉCRIVENT LA SÉLECTION et ne répètent
             donc plus la courbe, qui reste celle de tout l'établissement : ils
             reviennent à l'écran. Sans filtre, ils sont dans la carte au survol de
             la légende. */
          filtre={nombreDeFiltres(filtres) > 0}
          completion={completion}
          /* En vue graphique, ils vivent à droite du graphe — cf. plus bas. */
          chiffresAilleurs={chiffresLateraux}
          anneeScolaire={requete.data?.anneeScolaire}
          /* ⚠️ LES PLAGES SUIVENT LA MÊME DATE que les taux : elles vivent dans le
             même bloc, et une plage posée qui dépasserait la date observée
             contredirait le nombre de modules achevés juste à côté. */
          dateObservee={dateObservee}
        />

        {/* ── Le tableau de l'axe choisi ────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-72">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={recherche}
              onChange={(evenement) => setRecherche(evenement.target.value)}
              placeholder={`Rechercher un ${AXES[axe].libelle.toLowerCase()}…`}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {/*
              ⚠️ LE MOT SUIT CE QU'UNE LIGNE EST DEVENUE. Ventilé par groupe, un
              bâton n'est plus « un module » mais un module POUR UNE PROMOTION :
              17 bâtons pour 11 modules. Garder « modules » ferait deux nombres
              contradictoires sur le même écran — le panneau du taux, lui,
              continue de compter les modules DISTINCTS (« 11 module(s) »).
            */}
            {visibles.length} sur {lignes.length}{' '}
            {complement === 'groupes' && axe === 'module'
              ? 'modules par groupe'
              : AXES[axe].pluriel}
          </span>

          {/*
            ⚠️ UN GROUPE DE BOUTONS, PLUS UN INTERRUPTEUR (décision du porteur,
            2026-08-31) — la forme du choix Jour/Soir de l'emploi du temps. Un
            interrupteur convient à un OUI/NON ; ici ce sont deux vues de même
            rang, et le bloc soudé dit qu'il faut en choisir une. Chacune porte son
            icône : on retrouve un mode d'affichage à sa forme avant de lire son
            nom.

            Elles ne montrent pas la même chose : le TABLEAU donne les chiffres
            exacts, sujet par sujet ; le GRAPHIQUE donne le rapport affecté/réalisé
            de cinquante sujets d'un seul regard, et c'est lui qui fait ressortir
            ceux qui décrochent.
          */}
          <div className="ml-auto flex items-center gap-2">
            <ButtonGroup>
              {VUES.map(({ cle, libelle, Icone }) => (
                <Button
                  key={cle}
                  variant={vue === cle ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={vue === cle}
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setVue(cle)}
                >
                  <Icone className="size-3.5" />
                  {libelle}
                </Button>
              ))}
            </ButtonGroup>
          </div>
        </div>

        {/*
          ═══ LA RANGÉE DES REPÈRES ═══ (disposition demandée par le porteur,
          2026-08-31.) Le bouton « Filtrer » descend SOUS la bascule et partage sa
          ligne avec la légende du graphe : ce sont les deux éléments qui
          expliquent ce qu'on regarde, là où la rangée du dessus décide de CE QU'ON
          REGARDE. Chacun sur sa propre rangée, ils prenaient deux lignes pour
          trois éléments courts.
        */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <PanneauFiltres facettes={facettes} filtres={filtres} onChange={setFiltres} />

          {/*
            ⚠️ À CÔTÉ DES FILTRES, pas dans la rangée des vues : la chronologie
            RESTREINT ce qu'on regarde, comme un filtre — sur le TEMPS plutôt que
            sur les sujets. Les vues, elles, changent la forme de l'affichage.
          */}
          <SheetChronologie
            face={face}
            date={dateObservee}
            onChanger={setDateObservee}
            ouvert={chronologieOuverte}
            onOuvrir={setChronologieOuverte}
          />

          {/* ⚠️ LA LÉGENDE N'A DE SENS QU'AVEC LE GRAPHE : le tableau nomme ses
              colonnes lui-même, et une légende de couleurs y serait sans objet. */}
          {vue === 'graphique' && (
            <Legende
              courbeTaux={courbeTaux}
              courbeObjectif={courbeObjectif}
              reference={reference?.libelle ?? null}
              /* Rembobiné, le bandeau dit déjà la date : on ne l'écrit pas deux
                 fois, et surtout pas avec la semaine COURANTE, qui serait fausse. */
              jusquA={dateObservee ? null : (requete.data?.semaineCourante ?? null)}
            />
          )}
        </div>

        {/*
          ⚠️ CE QUE LE FILTRE RETIENT EST DIT EN CLAIR, sous les commandes. Replié
          dans un panneau, il agit sans qu'on le voie : on lit un taux global de
          40 % en croyant qu'il porte sur l'établissement, alors qu'il ne porte que
          sur une promotion.
        */}
        {nombreDeFiltres(filtres) > 0 && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            Filtré sur
            {/*
              ⚠️ LA VALEUR, PAS LE NOM DE LA FACETTE (demande du porteur,
              2026-09-01). « groupe (1) » disait qu'un filtre existe ; il fallait
              rouvrir le panneau pour savoir LEQUEL — alors que c'est précisément
              ce qu'on a besoin de lire en regardant les chiffres juste en dessous.
              En bleu et en gras : c'est la seule chose de cette ligne qui change
              d'un affichage à l'autre.
            */}
            {Object.entries(FACETTES)
              .filter(([cle]) => (filtres[cle]?.length ?? 0) > 0)
              .map(([cle], rang) => (
                <span key={cle} className="flex items-center gap-x-1.5">
                  {/*
                    ⚠️ UNE SÉPARATION ENTRE FACETTES : sans elle, « GM101, GM102 +3 »
                    et « EFM régional » se suivaient en bleu gras et se lisaient
                    comme une seule liste — alors que ce sont deux critères qui se
                    CROISENT.
                  */}
                  {rang > 0 && <span aria-hidden="true">·</span>}
                  <span className="font-semibold text-primary">
                    {resumerValeurs(cle, filtres[cle])}
                  </span>
                </span>
              ))}
            — {retenues.length} ligne(s) sur {brutes.length}.
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => setFiltres(FILTRES_VIDES)}
            >
              Tout effacer
            </button>
          </p>
        )}

        {/*
          ⚠️ UN ÉCRAN REMBOBINÉ LE DIT EN PERMANENCE. Le panneau se referme, et
          sans cette ligne on lirait des chiffres du passé en les croyant courants —
          c'est le « ● Données actuelles » de l'existant, mais dans l'autre sens.
        */}
        {dateObservee && (
          <Alerte type="avertissement" titre={`Écran rembobiné au ${dateObservee}`}>
            Les chiffres, le graphique et le tableau montrent l’état à cette date.
            <button
              type="button"
              className="ml-1 font-medium underline"
              onClick={() => setDateObservee(null)}
            >
              Revenir aux données actuelles
            </button>
          </Alerte>
        )}

        {lignes.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            <TrendingUp className="mx-auto mb-2 size-5 opacity-50" />
            Rien à afficher sur cette face.
          </p>
        ) : vue === 'graphique' ? (
          /*
            ═══ ⚠️ L'ANNEAU PASSE À DROITE DU GRAPHE ═══ (demande du porteur,
            2026-09-01.) Il décrit la SÉLECTION, le graphe compare les sujets entre
            eux : côte à côte, on lit « ma promotion est à 16,7 % » et « voici où
            chaque module en est » d'un seul regard. Sous le graphe, il fallait
            remonter la page pour rapprocher les deux.

            ⚠️ `lg:items-start` — ET SEULEMENT À PARTIR DE `lg`. Sans lui, le
            panneau s'étirerait sur toute la hauteur du graphe et son anneau
            flotterait au milieu du vide. Mais EN PILE, `items-start` porte sur
            l'axe transverse, c'est-à-dire sur la LARGEUR : mesuré à 1000 px, le
            graphe se réduisait à 346 px dans un espace de 686. En dessous de
            `lg`, on laisse donc l'étirement par défaut.
          */
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <GrapheAvancement
                lignes={visibles}
                entete={AXES[axe].libelle}
                axe={axe}
                complement={complement}
                objectifs={objectifs}
                intitules={intitules}
                reference={reference}
              />
            </div>

            {chiffresLateraux && (
              <aside
                className={cn(
                  /*
                   * ⚠️ `lg:self-stretch` : le panneau prend la HAUTEUR du graphe
                   * (demande du porteur, 2026-09-01). Il défait pour ce seul
                   * enfant le `lg:items-start` du parent, qui le laissait à sa
                   * hauteur naturelle — 199 px contre 456, un cadre court posé à
                   * côté d'un grand qui se lisait comme un reste de place.
                   */
                  'w-full shrink-0 rounded-lg border lg:self-stretch',
                  /*
                   * ⚠️ REPLIÉ, IL REND SA LARGEUR AU GRAPHE : c'est tout l'intérêt
                   * du geste. Garder 18 rem pour un seul bouton reviendrait à
                   * masquer le contenu sans rien libérer. Il ne reste qu'un rail,
                   * comme la barre latérale de l'application en mode icônes.
                   */
                  panneauTaux ? 'p-3 lg:w-72' : 'p-2 lg:w-12'
                )}
              >
                <div
                  className={cn(
                    'flex items-center gap-2',
                    panneauTaux ? 'mb-2 justify-between' : 'justify-center'
                  )}
                >
                  {/* Le titre ne tient pas dans 3 rem : replié, l'infobulle du
                      bouton porte seule le sens. */}
                  {panneauTaux && (
                    <span className="text-xs font-medium">
                      {nombreDeFiltres(filtres) > 0 ? 'Sélection' : 'Établissement'}
                    </span>
                  )}
                  <BasculePanneau ouvert={panneauTaux} />
                </div>

                {/* ⚠️ LA VARIANTE COMPACTE : les points de rupture de Tailwind
                    lisent le VIEWPORT, jamais la largeur du conteneur — la
                    disposition à deux colonnes se couperait dans 18 rem. */}
                {panneauTaux && (
                  <Chiffres
                    total={total}
                    face={face}
                    filtre={nombreDeFiltres(filtres) > 0}
                    disposition="colonne"
                  />
                )}
              </aside>
            )}
          </div>
        ) : (
          <TableauAvancement
            lignes={visibles}
            entete={AXES[axe].libelle}
            axe={axe}
            intitules={intitules}
          />
        )}

        {/* ⚠️ LA PLACE DU PANNEAU, réservée tant qu'il est ouvert : posé en
            `fixed bottom-0`, il recouvre la fin de la page, et sans ce vide les
            dernières lignes du tableau resteraient dessous, hors d'atteinte. */}
        {chronologieOuverte && <div className="h-44 shrink-0" aria-hidden="true" />}
      </CadreReglage>
    </>
  );
}

/**
 * Replier ou déplier le panneau du taux.
 *
 * ⚠️ L'ICÔNE DIT CE QU'UN CLIC PRODUIT, jamais l'état courant — la règle déjà
 * posée pour l'épingle de la barre latérale.
 */
function BasculePanneau({ ouvert }) {
  const Icone = ouvert ? PanelRightClose : PanelRightOpen;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      aria-pressed={ouvert}
      title={ouvert ? 'Masquer le taux' : 'Afficher le taux'}
      onClick={basculerPanneauTaux}
    >
      <Icone className="size-3.5" />
      <span className="sr-only">{ouvert ? 'Masquer le taux' : 'Afficher le taux'}</span>
    </Button>
  );
}

/** Combien de valeurs se nomment avant que la ligne ne devienne une énumération. */
const VALEURS_NOMMEES = 3;

/**
 * Ce qu'une facette retient, en clair.
 *
 * ⚠️ AU-DELÀ DE TROIS, ON COMPTE LE RESTE : « GM101, GM102, SMP201 +18 » se lit
 * encore ; les vingt et un noms à la suite repousseraient les chiffres hors de
 * l'écran, et c'est eux qu'on est venu voir.
 *
 * ⚠️ LES LIBELLÉS VIENNENT DU PANNEAU DE FILTRES : « 1 » ne dit pas « 1re année »
 * ni « oui » « EFM régional », et deux tables de libellés auraient divergé.
 */
function resumerValeurs(cle, valeurs = []) {
  const nommees = valeurs.slice(0, VALEURS_NOMMEES).map((valeur) => etiquetteValeur(cle, valeur));
  const reste = valeurs.length - nommees.length;

  return reste > 0 ? `${nommees.join(', ')} +${reste}` : nommees.join(', ');
}


