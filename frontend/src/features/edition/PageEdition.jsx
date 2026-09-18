import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Moon, Printer, Sun } from 'lucide-react';
import {
  AXES_CONSULTATION,
  SEANCES_JOUR,
  SEANCE_SOIR,
  facettesDesGroupes,
  filtrerGroupes,
  filtrerSujets,
  groupesDuSoir,
  sallesDeLaSemaine,
  semaineAOuvrir,
} from 'shared/domain';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Alerte from '@/components/common/Alerte';
import CommandesZoom from '@/components/common/CommandesZoom';
import CadreReglage from '@/features/parametres/CadreReglage';
import { chargerContexte, chargerSemaine, chargerSemaines } from '@/features/emploi/api';
import NavigationSemaine from '@/features/emploi/NavigationSemaine';
import { useSemaineSuivie } from '@/features/emploi/useSemaineSuivie';
import AvatarsPresence from '@/features/tempsReel/AvatarsPresence';
import BoutonPartager from '@/features/partages/BoutonPartager';
import { recupererSession } from '@/features/auth/api';
import { ROLES } from 'shared/constants';
import { PortailEnTete } from '@/components/layout/enTetePage';
import { useSalleEmploi } from '@/features/tempsReel/useSalleEmploi';
import { useAnneeActive } from '@/lib/anneeActive';
import { cn } from '@/lib/utils';
import GrilleConsultation from './GrilleConsultation';
import GrilleDetaillee from './GrilleDetaillee';
import { ChoixSujets, FiltreGroupes, FiltreSeances } from './FiltresDetaillee';

/**
 * Consultation et impression d'une semaine (F5).
 * ← `public/edition.html` (3 824 lignes)
 *
 * ═══ ⚠️ LE NOM TROMPE : CETTE PAGE N'ÉDITE RIEN ═══
 * Le seul `POST` de `edition.html` va vers l'assistant vocal ; aucun
 * enregistrement. C'est une page de LECTURE et d'IMPRESSION, à côté de
 * « Emploi » qui, lui, écrit. Le nom est conservé (décision du porteur,
 * 2026-08-26) : c'est celui que les établissements connaissent.
 *
 * ⚠️ ET C'EST VOULU QU'ELLE N'ÉCRIVE PAS. La grille d'édition porte déjà les
 * conflits, les quotas, le glisser-déposer et l'historique : deux écrans qui
 * écrivent la même grille, ce sont deux comportements à tenir en phase — la
 * cause n°1 d'instabilité du §4.2.
 *
 * ═══ CE QU'ELLE APPORTE ═══
 *   - un TROISIÈME axe, la SALLE : « Emploi » ne connaît que formateur et
 *     groupe, et rien ne disait jusqu'ici qui occupe un local ;
 *   - une vue GLOBALE, tout le monde d'un coup, faite pour l'impression ;
 *   - une vue DÉTAILLÉE, un sujet à la fois, cherché par son nom.
 *
 * ⚠️ LES SIX EXPORTS PDF DE L'EXISTANT NE SONT PAS ICI (décision du porteur) :
 * ils partent en Phase 10 avec les autres documents — badges, convocations,
 * émargement — pour une seule décision « client ou serveur ». L'impression du
 * navigateur couvre le besoin courant en attendant.
 */
export default function PageEdition() {
  const anneeChoisie = useAnneeActive();

  const [axe, setAxe] = useState('formateur');
  const [periode, setPeriode] = useState('jour');
  const [detaillee, setDetaillee] = useState(false);
  /* Les sujets DÉSIGNÉS ; vide = tout le monde. */
  const [choisis, setChoisis] = useState([]);
  /* Le filtre « qui a cours quand » ; deux facettes vides = aucun filtre. */
  const [filtre, setFiltre] = useState({ jours: [], creneaux: [] });
  /*
   * Le filtre d'IDENTITÉ des groupes — filière, niveau, année de formation.
   * ⚠️ SÉPARÉ DU PRÉCÉDENT, et c'est voulu : l'un interroge le planning (« qui a
   * cours lundi »), l'autre la carte (« quels groupes sont en TS 2e année »). Un
   * groupe sans une séance de la semaine reste trouvable par le second.
   */
  const [filtreGroupes, setFiltreGroupes] = useState({ filieres: [], niveaux: [], annees: [] });
  /*
   * Le zoom des grilles — même échelle et mêmes commandes que « Emploi » et le
   * chronogramme (demande du porteur, 2026-08-26). Préférence de LECTURE : elle
   * ne part pas au serveur et ne survit pas au rechargement, comme ailleurs.
   */
  const [zoom, setZoom] = useState(100);

  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const contexte = useQuery({
    queryKey: ['emploi', 'contexte'],
    queryFn: chargerContexte,
    retry: false,
  });

  const semaines = useQuery({
    queryKey: ['emploi', 'semaines'],
    queryFn: chargerSemaines,
    retry: false,
  });

  const anneeScolaire = anneeChoisie ?? contexte.data?.anneeScolaire ?? null;

  /*
   * ⚠️ LA SEMAINE PAR DÉFAUT N'EST PAS « celle d'aujourd'hui ». Un directeur qui
   * prépare l'année suivante est encore, au calendrier, dans l'année en cours :
   * la semaine du jour ne pourrait porter AUCUNE de ses séances, et la grille
   * reviendrait vide sans que rien ne l'explique.
   *
   * ═══ ⚠️ ON PRÉFÈRE LA SEMAINE QUE LE SERVEUR DÉSIGNE ═══ (2026-09-06.)
   * `courante` porte déjà la priorité complète — semaine PUBLIÉE, puis règle du
   * samedi 06h30, puis la règle ci-dessus — et le serveur l'adapte au RÔLE : le
   * gestionnaire ouvre sur ce qui fait foi, le directeur garde sa navigation.
   * `semaineAOuvrir` local ne sert plus que de repli si le serveur n'en donne
   * pas, et pour un écran qui s'ouvrirait sans réseau.
   *
   * ⚠️ SUIVIE, ET RELUE CHAQUE SAMEDI À 6 H 30 (2026-09-14) : le gestionnaire
   * voit la semaine suivante s'afficher d'elle-même, même page ouverte.
   */
  const [semaine, setSemaine] = useSemaineSuivie({
    courante: semaines.data?.courante,
    repli: !semaines.isLoading && anneeScolaire ? semaineAOuvrir(anneeScolaire) : null,
    cle: ['emploi', 'semaines'],
  });

  const grille = useQuery({
    queryKey: ['emploi', 'semaine', semaine],
    queryFn: () => chargerSemaine(semaine),
    enabled: Boolean(semaine),
    retry: false,
  });

  const seances = grille.data?.seances ?? [];
  const formateurs = contexte.data?.formateurs ?? [];

  /*
   * ═══ COLLABORATION EN TEMPS RÉEL ═══ La MÊME salle que « Emploi » : les deux
   * écrans montrent les mêmes séances. Un gestionnaire qui consulte la semaine
   * voit donc arriver sans recharger ce que le directeur pose — et le directeur
   * voit qu'il la consulte.
   */
  const salle = useSalleEmploi({ ecran: 'edition', semaine, periode, anneeScolaire });
  const groupes = contexte.data?.groupes ?? [];

  /** Matricule → nom : les séances portent l'un, l'écran doit montrer l'autre. */
  const nomsFormateurs = useMemo(
    () => new Map(formateurs.map((formateur) => [formateur.matricule, formateur.nom])),
    [formateurs]
  );

  /*
   * ⚠️ LES SUJETS DÉPENDENT DE L'AXE ET DE LA PÉRIODE. Le soir ne concerne que
   * les groupes « CDS » — et il n'a pas de sens sur l'axe formateur, où la
   * grille du jour porte déjà toute la charge.
   */
  const sujets = useMemo(() => {
    if (axe === 'salle') return sallesDeLaSemaine(contexte.data?.salles ?? [], seances);
    /* ⚠️ Le filtre « soir » ne vaut que pour la vue GLOBALE : en détaillée,
       chaque tableau décide seul de sa colonne S5, et restreindre la liste aux
       groupes CDS ferait disparaître tous les autres. */
    if (axe === 'groupe') return periode === 'soir' && !detaillee ? groupesDuSoir(groupes) : groupes;
    return formateurs.map((formateur) => formateur.matricule);
  }, [axe, periode, detaillee, groupes, formateurs, contexte.data?.salles, seances]);

  /*
   * ⚠️ LES FACETTES SE CALCULENT SUR TOUS LES GROUPES DE LA BASE, pas sur ceux
   * déjà filtrés : sinon cocher « TS » ferait disparaître les autres niveaux de
   * la liste, et on ne pourrait plus revenir en arrière sans tout effacer.
   */
  const facettes = useMemo(
    () => facettesDesGroupes(groupes, contexte.data?.groupesIdentites ?? {}),
    [groupes, contexte.data?.groupesIdentites]
  );

  /** Ce qu'on lit dans la colonne de gauche — un matricule ne se reconnaît pas. */
  const libelleDuSujet = (sujet) => (axe === 'formateur' ? nomsFormateurs.get(sujet) ?? sujet : sujet);

  /*
   * ⚠️ LA VUE DÉTAILLÉE MONTRE TOUT LE MONDE PAR DÉFAUT, puis se réduit
   * (demande du porteur, 2026-08-26). On arrive souvent sur cette page pour
   * PARCOURIR, pas pour retrouver quelqu'un de précis.
   *
   * ⚠️ DEUX RÉDUCTIONS QUI SE CUMULENT, et dans cet ordre : le CHOIX explicite
   * — « montre-moi ces trois-là » — puis le FILTRE — « parmi eux, ceux qui ont
   * cours le lundi ». L'inverse donnerait le même résultat, mais l'ordre écrit
   * ici est celui dans lequel l'écran les présente.
   */
  const affiches = useMemo(() => {
    /*
     * ⚠️ TROIS RÉDUCTIONS QUI SE CUMULENT, et dans cet ordre :
     *   1. l'IDENTITÉ — « les TS de 2e année » — qui ne vaut que sur l'axe
     *      groupe, seul à en avoir une ;
     *   2. le CHOIX explicite — « montre-moi ces trois-là » ;
     *   3. le PLANNING — « parmi eux, ceux qui ont cours le lundi ».
     * L'ordre ne change pas le résultat ; c'est celui dans lequel l'écran les
     * présente, de la plus large à la plus fine.
     */
    const parIdentite =
      axe === 'groupe'
        ? filtrerGroupes(sujets, contexte.data?.groupesIdentites ?? {}, filtreGroupes)
        : sujets;

    const designes =
      choisis.length > 0 ? parIdentite.filter((s) => choisis.includes(s)) : parIdentite;

    return filtrerSujets(designes, seances, axe, filtre);
  }, [
    sujets,
    axe,
    contexte.data?.groupesIdentites,
    filtreGroupes,
    choisis,
    seances,
    filtre,
  ]);

  const changerAxe = (valeur) => {
    setAxe(valeur);
    /* ⚠️ Les deux réductions repartent de zéro : un matricule retenu n'a aucun
       sens sur l'axe des salles, et le filtre resterait actif sans qu'on voie
       plus ce qu'il retient. */
    setChoisis([]);
    setFiltre({ jours: [], creneaux: [] });
    setFiltreGroupes({ filieres: [], niveaux: [], annees: [] });
    // Le soir n'existe que sur l'axe groupe : y rester ailleurs afficherait une
    // grille d'une colonne, toujours vide.
    if (valeur !== 'groupe') setPeriode('jour');
  };

  return (
    <CadreReglage
      large
      titre="Consultation de l’emploi du temps"
      chargement={contexte.isLoading}
      erreur={contexte.isError ? contexte.error.message : null}
    >
      {/* ── La barre de commandes ─────────────────────────────────────── */}
      {/*
        ═══ ⚠️ LE BLOC DE SEMAINE EST CENTRÉ SUR LA RANGÉE, PAS ENTRE LES DEUX
        CÔTÉS ═══
        Une grille `1fr auto 1fr` ne suffit PAS ici : les deux 1fr ne se
        partagent également que si leur CONTENU y tient. Mesuré à 1440 px — côté
        gauche 421 px, côté droit 270 px — le gauche débordait de sa part et
        poussait le bouton de 76 px vers la droite. Le centrage absolu ne dépend
        d'aucun des deux.
        ⚠️ À PARTIR DE `xl` SEULEMENT : en dessous, les côtés se rejoindraient et
        se chevaucheraient. La rangée reprend alors le flux normal.
      */}
      <div className="relative flex flex-wrap items-center gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <ButtonGroup>
            {Object.entries(AXES_CONSULTATION).map(([cle, { libelle }]) => (
              <Button
                key={cle}
                variant={axe === cle ? 'default' : 'outline'}
                size="sm"
                aria-pressed={axe === cle}
                className="h-8 text-xs"
                onClick={() => changerAxe(cle)}
              >
                Par {libelle.toLowerCase()}
              </Button>
            ))}
          </ButtonGroup>

          {/*
            ⚠️ EN ICÔNE, pas en bouton légendé. Mesuré à 1440 px : avec son
            libellé, le côté gauche s'étendait jusqu'à 701 px et RECOUVRAIT le
            bloc de semaine, centré à partir de 637. L'icône rend 90 px et
            l'infobulle dit ce qu'elle fait — c'est la convention des boutons à
            icône de la barre d'outils de « Emploi ».
          */}
        </div>

        <NavigationSemaine
          className="xl:absolute xl:left-1/2 xl:-translate-x-1/2"
          semaine={semaine}
          onChanger={setSemaine}
          anneeScolaire={anneeScolaire}
          remplies={semaines.data?.semaines ?? []}
          courante={semaines.data?.courante}
        />

        <div className="ml-auto flex items-center justify-end gap-3">
          {/* Le SOIR ne concerne que les groupes « CDS » : ailleurs le bouton
              n'aurait rien à montrer. */}
          {axe === 'groupe' && !detaillee && (
            <ButtonGroup>
              <Button
                variant={periode === 'jour' ? 'default' : 'outline'}
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setPeriode('jour')}
              >
                <Sun className="size-3.5" />
                Jour
              </Button>
              <Button
                variant={periode === 'soir' ? 'default' : 'outline'}
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setPeriode('soir')}
              >
                <Moon className="size-3.5" />
                Soir
              </Button>
            </ButtonGroup>
          )}
          {/*
            ⚠️ LES DEUX VUES SONT NOMMÉES, DE PART ET D'AUTRE (demande du
            porteur, 2026-08-26). Un interrupteur légendé d'un seul côté ne dit
            pas ce qu'on quitte : « Vue détaillée » éteint laissait deviner
            l'autre état. Nommer les deux fait de l'interrupteur une BASCULE
            entre deux vues connues, comme le couple Jour/Soir juste à côté.

            ⚠️ LE LIBELLÉ ACTIF EST EN PLEINE ENCRE, l'autre en gris : sur un
            interrupteur entouré de deux textes de même poids, rien ne dit
            lequel des deux est en cours.
          */}
          <Label className="flex cursor-pointer items-center gap-2 text-xs font-normal">
            <span className={detaillee ? 'text-muted-foreground' : 'font-medium text-foreground'}>
              Vue globale
            </span>
            <Switch
              checked={detaillee}
              onCheckedChange={setDetaillee}
              aria-label="Basculer entre la vue globale et la vue détaillée"
            />
            <span className={detaillee ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              Vue détaillée
            </span>
          </Label>
        </div>
      </div>

      {/*
        ═══ ⚠️ UNE SECONDE RANGÉE, ET UNE SEULE ═══
        (2026-08-26, demande du porteur : le zoom et l'impression descendent sous
        la bascule.)

        La première rangée porte ce qui décide de CE QU'ON REGARDE — l'axe, la
        semaine, le jour ou le soir, la vue. Celle-ci porte ce qui décide de
        COMMENT on le regarde et de ce qu'on en fait : réduire, agrandir,
        imprimer — et, en vue détaillée, réduire la liste des sujets.

        ⚠️ ELLE N'EST PAS UNE TROISIÈME RANGÉE. Les filtres de la vue détaillée
        vivaient déjà ici ; leur en ajouter une autre au-dessus aurait éloigné le
        choix des sujets de la bascule qui l'ouvre, pour trois boutons. Filtres à
        GAUCHE, zoom et impression à DROITE — donc juste sous la bascule, qui est
        elle-même au bout de la rangée du dessus.
      */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        {/*
          ⚠️ LES FILTRES VALENT POUR LES DEUX VUES (2026-08-26, demande du
          porteur). Ils étaient réservés à la vue détaillée ; or c'est la GLOBALE
          qu'on imprime, et c'est là qu'on veut sortir « les TS de 2e année » ou
          « qui a cours le lundi » sans le reste de l'établissement. Une grille
          de 51 lignes qu'on ne peut pas réduire s'imprime sur quatre pages dont
          on n'en voulait qu'une.
        */}
        <ChoixSujets
          sujets={sujets}
          choisis={choisis}
          libelle={libelleDuSujet}
          entete={AXES_CONSULTATION[axe].libelle}
          onChanger={setChoisis}
        />

        {/* ⚠️ SUR L'AXE GROUPE SEULEMENT : un formateur n'a ni filière ni année
            de formation, et une salle encore moins. */}
        {axe === 'groupe' && (
          <FiltreGroupes
            facettes={facettes}
            valeurs={filtreGroupes}
            onChanger={setFiltreGroupes}
          />
        )}

        <FiltreSeances
          jours={filtre.jours}
          creneaux={filtre.creneaux}
          creneauxProposes={[...SEANCES_JOUR, SEANCE_SOIR]}
          onChanger={setFiltre}
        />

        <span className="text-xs text-muted-foreground">
          {affiches.length} sur {sujets.length}
        </span>

        <div className="ml-auto flex items-center gap-3">
          {/* La pile d'avatars au même endroit que sur « Emploi » : la barre du
              haut. Deux écrans de la même salle ne la rangent pas ailleurs. */}
          <PortailEnTete>
            <AvatarsPresence
              membres={salle.membres}
              utilisateurId={salle.utilisateurId}
              statut={salle.statut}
              semaine={semaine}
              compact
            />
            {/*
              ═══ « PARTAGER » AUSSI ICI (2026-09-13, demande du porteur : le
              bouton sur toutes les pages de travail) ═══ « Édition » est
              l'emploi du temps en LECTURE : c'est donc lui qu'on y partage — la
              même boîte, les mêmes invités que sur « Emploi ». Au directeur seul.
            */}
            {session.data?.utilisateur?.role === ROLES.DIRECTEUR && (
              <BoutonPartager
                page="emploi"
                semaine={semaine}
                publication={semaines.data?.publication}
                moi={session.data.utilisateur}
              />
            )}
          </PortailEnTete>

          {/* ⚠️ `CommandesZoom` fournit SON PROPRE groupe — le zoom est soudé,
              « Imprimer » à côté ne l'est pas. Ne jamais l'envelopper dans un
              autre `ButtonGroup` : voir le piège documenté dans le composant. */}
          <CommandesZoom zoom={zoom} onZoom={setZoom} />

          {/*
            ⚠️ « IMPRIMER » NE S'AFFICHE QUE S'IL Y A QUELQUE CHOSE À IMPRIMER :
            posé à côté d'un « aucune correspondance », il proposerait d'imprimer
            une page vide.

            ⚠️ L'IMPRESSION DU NAVIGATEUR, PAS UN PDF. Les six exports de
            l'existant partent en Phase 10 ; `window.print()` couvre le besoin
            courant, et les règles `print:` ne laissent que la grille sur le
            papier.
          */}
          {!grille.isError && sujets.length > 0 && affiches.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => window.print()}
            >
              <Printer className="size-3.5" />
              Imprimer
            </Button>
          )}
        </div>
      </div>

      {/* ── La grille ─────────────────────────────────────────────────── */}
      {grille.isError ? (
        <Alerte type="erreur" titre="Semaine indisponible">
          {grille.error.message}
        </Alerte>
      ) : sujets.length === 0 ? (
        <Alerte type="avertissement" titre={`Aucun ${AXES_CONSULTATION[axe].libelle.toLowerCase()}`}>
          {axe === 'salle'
            ? 'Déclarez vos salles depuis « Paramètres → Espaces ».'
            : axe === 'groupe' && periode === 'soir'
              ? 'La grille du soir ne concerne que les groupes dont le nom porte « CDS ».'
              : 'Importez votre base e-note ou construisez votre carte depuis « Paramètres → Affectations ».'}
        </Alerte>
      ) : affiches.length === 0 ? (
        <Alerte type="avertissement" titre="Aucune correspondance">
          Aucun {AXES_CONSULTATION[axe].libelle.toLowerCase()} n’a cours sur les jours et créneaux
          retenus. Effacez le filtre pour les revoir tous.
        </Alerte>
      ) : (
        <div className={cn('space-y-4', grille.isFetching && 'opacity-60')}>
          {detaillee ? (
            /*
              ⚠️ UN TABLEAU PAR SUJET, TRANSPOSÉ. Les jours passent en lignes et
              les créneaux en colonnes : quatre colonnes larges au lieu de
              vingt-quatre étroites, où le nom d'un module se lit en entier.
              C'est la forme des trois vues détaillées de l'existant, et celle de
              la maquette.
            */
            affiches.map((sujet) => (
              /*
                ⚠️ PAS DE `periode` ICI : la vue détaillée montre la semaine
                ENTIÈRE d'un sujet, et décide seule d'ajouter la colonne S5 si
                celui-ci a cours le soir. La bascule Jour/Soir ne vaut que pour
                la vue globale, où toutes les lignes partagent leurs colonnes.
              */
              <GrilleDetaillee
                key={sujet}
                zoom={zoom}
                sujet={sujet}
                libelle={libelleDuSujet(sujet)}
                seances={seances}
                axe={axe}
                lignes={AXES_CONSULTATION[axe].lignes}
                jours={grille.data?.jours ?? []}
                nomsFormateurs={nomsFormateurs}
              />
            ))
          ) : (
            <GrilleConsultation
            /*
              ⚠️ LE SUJET RESTE BRUT — un MATRICULE sur l'axe formateur : c'est
              lui que portent les séances, et c'est sur lui que l'appariement se
              fait. `libelle` dit seulement comment l'AFFICHER. Traduire les
              séances pour pouvoir passer des noms aurait dupliqué la liste
              entière à chaque rendu, pour une question d'affichage.
            */
              zoom={zoom}
              sujets={affiches}
              libelle={libelleDuSujet}
              seances={seances}
              axe={axe}
              lignes={AXES_CONSULTATION[axe].lignes}
              periode={periode}
              creneaux={periode === 'soir' ? [SEANCE_SOIR] : SEANCES_JOUR}
              jours={grille.data?.jours ?? []}
              nomsFormateurs={nomsFormateurs}
              entete={AXES_CONSULTATION[axe].libelle}
            />
          )}
        </div>
      )}

    </CadreReglage>
  );
}
