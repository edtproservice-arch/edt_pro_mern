import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, Download, File, FileSpreadsheet, FileText, Moon, Sun, Users, UserRound } from 'lucide-react';
import {
  AXES_CONSULTATION,
  SEANCES_JOUR,
  SEANCE_SOIR,
  enJour,
  facettesDesGroupes,
  filtrerGroupes,
  filtrerSujets,
  groupesDuSoir,
  semaineAOuvrir,
} from 'shared/domain';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Alerte from '@/components/common/Alerte';
import CommandesZoom from '@/components/common/CommandesZoom';
import { chargerContexte, chargerSemaine, chargerSemaines } from '@/features/emploi/api';
import { ChoixSujets, FiltreGroupes, FiltreSeances } from '@/features/edition/FiltresDetaillee';
import NavigationSemaine from '@/features/emploi/NavigationSemaine';
import { useSemaineSuivie } from '@/features/emploi/useSemaineSuivie';
import GrilleConsultation from '@/features/edition/GrilleConsultation';
import { useAnneeActive } from '@/lib/anneeActive';
import { chargerValidationsAppel, exporterFeuilleAbsence } from './api';
import PanneauAppel from './PanneauAppel';
import { useEtatPartage } from '@/features/guidage/useEtatPartage';
import BoutonTelecharger from '@/components/common/BoutonTelecharger';

/** La clé qui désigne UN cours dans le signe « validé » — voir `AppelValidation` côté serveur. */
const cleValidation = ({ date, seance, periode, groupe }) => `${date}|${seance}|${periode}|${groupe}`;

/**
 * ═══ FAIRE L'APPEL DEPUIS LA GRILLE ═══ (2026-09-14, demande du porteur : « au
 * lieu de sélectionner la date et le groupe, afficher la grille de l'emploi du
 * temps comme Emploi ou Édition ; un clic sur une séance affiche la liste ».)
 * REMPLACE le choix « date + groupe + cours » livré le matin même.
 *
 * ⚠️ AUCUNE NOUVELLE GRILLE : c'est `GrilleConsultation`, la lecture de « Édition »,
 * avec ses cases rendues cliquables. Même semaine, mêmes clés de cache — déjà
 * chargées si l'on vient d'« Emploi » ou d'« Édition ».
 * ⚠️ PAR GROUPE D'ABORD : l'appel porte sur une classe. L'axe formateur reste à
 * un clic, pour qui cherche « le cours de M. X ».
 * ⚠️ UN COURS À VENIR OU DONT LE FORMATEUR ÉTAIT ABSENT NE S'OUVRE PAS, et un
 * message dit pourquoi — le serveur refuserait de toute façon l'un et l'autre.
 */
const AXES = [
  { cle: 'groupe', libelle: 'Par groupe', Icone: Users },
  { cle: 'formateur', libelle: 'Par formateur', Icone: UserRound },
];

/** Le nom d'UN sujet, pour le champ de recherche du sélecteur — voir `ChoixSujets`. */
const ENTETES_SUJET = { groupe: 'Groupe', formateur: 'Formateur' };

export default function AppelParGrille({ encadrement }) {
  const anneeChoisie = useAnneeActive();
  const contexte = useQuery({ queryKey: ['emploi', 'contexte'], queryFn: chargerContexte, retry: false });
  const semaines = useQuery({ queryKey: ['emploi', 'semaines'], queryFn: chargerSemaines, retry: false });
  const anneeScolaire = anneeChoisie ?? contexte.data?.anneeScolaire ?? null;

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

  const [axe, setAxe] = useState('groupe');
  const [periode, setPeriode] = useState('jour');
  const [choix, setChoix] = useState(null);
  /*
   * Le cours ouvert pour l'appel, partagé pendant le guidage (2026-10-04) : à
   * plat — l'objet de la page porte un sous-objet `cours` —, et rebâti chez l'autre.
   */
  useEtatPartage(
    'absences.grille.choix',
    choix
      ? { date: choix.date, seance: choix.cours.seance, periode: choix.cours.periode, groupe: choix.cours.groupe, sousTitre: choix.sousTitre }
      : null,
    (valeur) =>
      setChoix(
        valeur
          ? {
              date: valeur.date,
              cours: { seance: valeur.seance, periode: valeur.periode, groupe: valeur.groupe },
              sousTitre: valeur.sousTitre,
            }
          : null
      )
  );
  /*
   * ⚠️ LE MÊME FILTRE QU'EN ÉDITION (2026-09-29, demande du porteur : « en
   * faire l'appel je veux ajouter l'option de filtre comme en édition ») —
   * filière / niveau / année, l'IDENTITÉ des groupes, pas leur planning. Il
   * ne vaut que sur l'axe groupe : un formateur n'a ni filière ni année.
   */
  const [filtreGroupes, setFiltreGroupes] = useState({ filieres: [], niveaux: [], annees: [] });

  /*
   * ⚠️ LE MÊME SÉLECTEUR QU'EN ÉDITION (2026-09-29, demande du porteur : « en
   * absence ajouter le select des groupes et filtre ») — « montre-moi ces
   * groupes-là », un choix explicite qui se cumule au filtre filière/niveau/
   * année ci-dessus, pas qui le remplace.
   */
  const [choisis, setChoisis] = useState([]);

  /*
   * ⚠️ LE MÊME « FILTRER » QU'EN ÉDITION (2026-09-29, demande du porteur :
   * « ajouter button filtre en absence ») — le PLANNING, pas l'identité :
   * « qui a cours le lundi », sur n'importe quel axe.
   */
  const [filtre, setFiltre] = useState({ jours: [], creneaux: [] });

  /*
   * ⚠️ MÊME ÉCHELLE ET MÊMES COMMANDES QU'« Emploi » ET « Édition » (2026-09-29,
   * demande du porteur : « et les buttons de zoom ») — `CommandesZoom` est déjà
   * partagé pour ça, voir sa note en tête de fichier : une seule définition,
   * pas une troisième copie.
   */
  const [zoom, setZoom] = useState(100);

  /*
   * ⚠️ LE SIGNE SUR LA CASE, SANS CLIQUER (2026-09-27, demande du porteur :
   * « je veux un signe de validé sans cliquer sur la séance »). Une requête
   * par SEMAINE affichée, pas par case : la grille en montre des dizaines
   * d'un coup, et un aller-retour par case ouverte l'aurait rendue lente à
   * charger comme à faire défiler.
   */
  const dates = useMemo(() => (grille.data?.jours ?? []).map((j) => j.date).filter(Boolean), [grille.data]);
  const bornes = useMemo(
    () => (dates.length > 0 ? { debut: dates.at(0), fin: dates.at(-1) } : null),
    [dates]
  );
  const validations = useQuery({
    queryKey: ['absences-stagiaires', 'appel', 'validations', bornes],
    queryFn: () => chargerValidationsAppel(bornes),
    enabled: Boolean(bornes),
    retry: false,
  });
  const validees = useMemo(
    () => new Set((validations.data ?? []).map(cleValidation)),
    [validations.data]
  );

  const formateurs = contexte.data?.formateurs ?? [];
  const groupes = contexte.data?.groupes ?? [];
  const groupesIdentites = contexte.data?.groupesIdentites ?? {};
  const aDuSoir = groupesDuSoir(groupes).length > 0;
  const nomsFormateurs = useMemo(() => new Map(formateurs.map((f) => [f.matricule, f.nom])), [formateurs]);
  const facettesGroupes = useMemo(
    () => facettesDesGroupes(groupes, groupesIdentites),
    [groupes, groupesIdentites]
  );
  const libelleDuSujet = useCallback(
    (sujet) => (axe === 'formateur' ? nomsFormateurs.get(sujet) ?? sujet : sujet),
    [axe, nomsFormateurs]
  );
  /** Tous les sujets de l'axe courant, AVANT le filtre filière/niveau/année et le choix explicite. */
  const baseSujets = useMemo(() => {
    if (axe === 'groupe') return periode === 'soir' ? groupesDuSoir(groupes) : groupes;
    return formateurs.map((f) => f.matricule);
  }, [axe, periode, groupes, formateurs]);
  /*
   * ⚠️ TROIS RÉDUCTIONS QUI SE CUMULENT, comme en Édition : l'IDENTITÉ
   * (filière/niveau/année), le CHOIX explicite du sélecteur, puis le PLANNING
   * (« Filtrer » — qui a cours tel jour, tel créneau).
   */
  const sujets = useMemo(() => {
    const parIdentite = axe === 'groupe' ? filtrerGroupes(baseSujets, groupesIdentites, filtreGroupes) : baseSujets;
    const designes = choisis.length > 0 ? parIdentite.filter((s) => choisis.includes(s)) : parIdentite;
    return filtrerSujets(designes, grille.data?.seances ?? [], axe, filtre);
  }, [axe, baseSujets, groupesIdentites, filtreGroupes, choisis, grille.data?.seances, filtre]);

  /*
   * ⚠️ TOUS LES GROUPES QUE LE FILTRE LAISSE VISIBLES, D'UN SEUL GESTE
   * (2026-09-29, demande du porteur : « si tous les groupes s'affiche il
   * télécharge tous les groupes, d'après le filtre ») — jamais un fichier par
   * groupe, voir `exportFeuilleAbsenceDocx.js` côté serveur.
   */
  const telechargement = useMutation({
    mutationFn: (format) => exporterFeuilleAbsence({ format, groupes: sujets, semaine }),
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  const choisir = useCallback(
    ({ cellule, date }) => {
      const seance = cellule.seances.find((s) => s.statut !== 'absent');
      if (!seance) {
        toast.info('Le formateur était absent : ce cours n’a pas d’appel.');
        return;
      }
      if (!date || date > enJour(new Date())) {
        toast.info('Ce cours est à venir : l’appel se fait le jour même ou après.');
        return;
      }
      setChoix({
        date,
        cours: { seance: cellule.seance, periode, groupe: seance.groupe },
        sousTitre: `${date.slice(8, 10)}/${date.slice(5, 7)} · ${seance.groupe} · ${seance.module}`,
      });
    },
    [periode]
  );

  if (contexte.error || grille.error) {
    return <Alerte type="erreur" titre="Emploi du temps indisponible">{(contexte.error ?? grille.error).message}</Alerte>;
  }

  return (
    <div className="space-y-3">
      {/*
        ⚠️ DEUX RANGÉES, COMME EN ÉDITION (2026-09-29, demande du porteur :
        « met le les buttons de filtre et le button telecharger en autre
        ligne en bas ») — la première décide de CE QU'ON REGARDE (axe,
        semaine, jour/soir), la seconde de QUI en fait partie (sélection,
        filtre) et de ce qu'on en TÉLÉCHARGE. Les mêler sur une seule ligne
        les faisait passer à la ligne dans le désordre dès qu'un filtre était
        actif.
      */}
      <div className="relative flex flex-wrap items-center gap-3">
        <ButtonGroup>
          {AXES.map(({ cle, libelle, Icone }) => (
            <Button
              key={cle}
              type="button"
              variant={axe === cle ? 'default' : 'outline'}
              size="sm"
              aria-pressed={axe === cle}
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                setAxe(cle);
                // ⚠️ Les matricules d'un axe ne veulent rien dire dans l'autre.
                setChoisis([]);
                setFiltreGroupes({ filieres: [], niveaux: [], annees: [] });
              }}
            >
              <Icone className="size-3.5" />
              {libelle}
            </Button>
          ))}
        </ButtonGroup>

        <NavigationSemaine
          className="xl:absolute xl:left-1/2 xl:-translate-x-1/2"
          semaine={semaine}
          onChanger={setSemaine}
          anneeScolaire={anneeScolaire}
          remplies={semaines.data?.semaines ?? []}
          courante={semaines.data?.courante}
        />

        {/* Le soir ne concerne que les groupes « CDS » : sans eux, rien à basculer. */}
        {aDuSoir && (
          <ButtonGroup className="ml-auto">
            {[
              { cle: 'jour', libelle: 'Jour', Icone: Sun },
              { cle: 'soir', libelle: 'Soir', Icone: Moon },
            ].map(({ cle, libelle, Icone }) => (
              <Button
                key={cle}
                type="button"
                variant={periode === cle ? 'default' : 'outline'}
                size="sm"
                aria-pressed={periode === cle}
                className="h-8 gap-1.5 text-xs"
                onClick={() => setPeriode(cle)}
              >
                <Icone className="size-3.5" />
                {libelle}
              </Button>
            ))}
          </ButtonGroup>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ChoixSujets
          sujets={baseSujets}
          choisis={choisis}
          libelle={libelleDuSujet}
          entete={ENTETES_SUJET[axe]}
          onChanger={setChoisis}
        />

        {axe === 'groupe' && (
          <FiltreGroupes facettes={facettesGroupes} valeurs={filtreGroupes} onChanger={setFiltreGroupes} />
        )}

        <FiltreSeances
          jours={filtre.jours}
          creneaux={filtre.creneaux}
          creneauxProposes={periode === 'soir' ? [SEANCE_SOIR] : SEANCES_JOUR}
          onChanger={setFiltre}
        />

        <span className="text-xs text-muted-foreground">
          {sujets.length} sur {baseSujets.length}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* ⚠️ `CommandesZoom` fournit SON PROPRE groupe — ne jamais l'envelopper
              dans un autre `ButtonGroup`, voir le piège documenté dans le composant. */}
          <CommandesZoom zoom={zoom} onZoom={setZoom} />

          {/*
            ⚠️ LA FEUILLE HEBDOMADAIRE NE VAUT QUE DE JOUR (2026-09-29) : la
            grille du canevas transmis est JOURS × S1-S4, sans créneau du
            soir — voir `exportFeuilleAbsenceDocx.js`. Réservée à
            l'encadrement, comme la feuille elle-même côté serveur.
          */}
          {encadrement && axe === 'groupe' && periode === 'jour' && sujets.length > 0 && (
            <BoutonTelecharger
              disabled={!semaine}
              enCours={telechargement.isPending}
              onChoisir={(format) => telechargement.mutate(format)}
            />
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Cliquez sur un cours pour faire l’appel de ses stagiaires.</p>

      {grille.isLoading || contexte.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement de l’emploi du temps…</p>
      ) : (
        <GrilleConsultation
          sujets={sujets}
          libelle={libelleDuSujet}
          seances={grille.data?.seances ?? []}
          axe={axe}
          lignes={AXES_CONSULTATION[axe].lignes}
          periode={periode}
          zoom={zoom}
          creneaux={periode === 'soir' ? [SEANCE_SOIR] : SEANCES_JOUR}
          jours={grille.data?.jours ?? []}
          nomsFormateurs={nomsFormateurs}
          entete={AXES_CONSULTATION[axe].libelle}
          onChoisirCase={choisir}
          validees={validees}
        />
      )}

      <PanneauAppel choix={choix} onFermer={() => setChoix(null)} />
    </div>
  );
}
