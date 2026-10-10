import { forwardRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarDays,
  CalendarOff,
  ChevronDown,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  Filter,
  X,
  GanttChart,
  List,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { exporterPeriodes } from '@/features/configuration/api';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import CalendrierPeriode, { enTexte } from './CalendrierPeriode';
import ChoixMultiple from './ChoixMultiple';
import FrisePeriodes from './FrisePeriodes';
import BoutonTelecharger from '@/components/common/BoutonTelecharger';

/**
 * Périodes datées rattachées à des sujets — stages ou formations.
 *
 * Les deux écrans posent la même question — « qui, et du quand au quand ? » —
 * et partagent donc la même mécanique. Ils diffèrent sur un seul point, la
 * façon de désigner la période :
 *
 *   STAGE     → par SEMAINES entières (l'établissement envoie du lundi au
 *               dimanche, jamais « du mercredi au mardi »)
 *   FORMATION → par PLAGE libre (deux jours, cinq, dix)
 *
 * ═══ DEUX CHAMPS QUI S'OUVRENT, PAS DEUX BLOCS DÉPLOYÉS ═══
 * Le calendrier sur deux mois et la liste des sujets occupaient ensemble tout
 * l'écran, en permanence — alors que les périodes DÉJÀ déclarées, qu'on vient
 * consulter bien plus souvent, se retrouvaient repoussées hors de vue. Chacun
 * tient désormais dans un champ qui s'ouvre au clic, comme l'existant le
 * faisait pour sa période de stage.
 */
export default function ListePeriodes({
  periodes,
  onChange,
  cle,
  sujets,
  anneeScolaire,
  libelleSujet,
  libelleVide,
  aideVide,
  couleur,
  /*
   * Invité « peut consulter » (Phase 5bis, étape d3) : la liste se lit — le
   * formulaire d'ajout et les corbeilles disparaissent. Masqués plutôt que
   * grisés : un formulaire éteint laisse chercher comment l'allumer.
   */
  lectureSeule = false,
  /*
   * Export Word / PDF / Excel (2026-10-10) : `type` désigne la route
   * (« stages » ou « formations »), `detailDe(periode)` la 2ᵉ colonne du
   * document — le mode du groupe, le matricule du formateur.
   */
  exportation,
  // Groupe → identité (filière, niveau, année) : le filtre d'Édition dans la liste des groupes (2026-10-10).
  identites = null,
}) {
  const [selection, setSelection] = useState([]);
  // Les périodes tracées, et le début posé d'une période pas encore refermée.
  const [saisie, setSaisie] = useState(SAISIE_VIDE);
  const [ouvert, setOuvert] = useState(false);
  // Le dernier affichage choisi est retenu (confort par navigateur, rien de plus).
  const [affichage, setAffichage] = useState(() => {
    try {
      return localStorage.getItem(CLE_AFFICHAGE) === 'calendrier' ? 'calendrier' : 'liste';
    } catch {
      return 'liste';
    }
  });
  const choisirAffichage = (valeur) => {
    setAffichage(valeur);
    try {
      localStorage.setItem(CLE_AFFICHAGE, valeur);
    } catch {
      // Stockage refusé (navigation privée) : l'affichage vaut pour cette visite.
    }
  };

  /* ⚠️ UN DÉBUT POSÉ SANS FIN VAUT UNE JOURNÉE : l'ignorer perdrait en silence
     le dernier clic de celui qui pense avoir sélectionné un seul jour. */
  const plages = saisie.debut
    ? [...saisie.plages, { from: saisie.debut, to: saisie.debut }]
    : saisie.plages;
  const aPeriode = plages.length > 0;
  const complet = selection.length > 0 && aPeriode;

  const ajouter = () => {
    if (!complet) return;

    const nouvelles = plages.map((p) => ({ debut: enTexte(p.from), fin: enTexte(p.to) }));

    const ajouts = selection.flatMap((valeur) => {
      const sujet = sujets.find((candidat) => candidat.valeur === valeur);
      return nouvelles.map((periode) => ({ ...cle(sujet), ...periode }));
    });

    onChange(
      [...periodes, ...ajouts].sort(
        (a, b) => a.debut.localeCompare(b.debut) || libelleDe(a).localeCompare(libelleDe(b), 'fr')
      )
    );

    setSelection([]);
    setSaisie(SAISIE_VIDE);
    setOuvert(false);
  };

  const retirer = (index) => onChange(periodes.filter((_, rang) => rang !== index));

  /*
   * ═══ FILTRE PAR SUJET, DANS LES DEUX AFFICHAGES (2026-10-10, demande du
   * porteur) ═══ Liste et frise montrent les MÊMES sujets retenus, et l'export
   * suit : il imprime ce qu'on voit. Le filtre ne retire rien des données —
   * `index` reste le rang dans `periodes`, et supprimer ou glisser une période
   * filtrée vise toujours la bonne.
   *
   * Les choix proposés sont les sujets QUI ONT des périodes (inutile de filtrer
   * sur un groupe absent de la liste), avec leur mode — d'où le filtre
   * Alterné / Résidentiel de `ChoixMultiple`, ici aussi.
   */
  const [filtreSujets, setFiltreSujets] = useState([]);
  const sujetDe = (periode) =>
    sujets.find((sujet) => {
      const [champ, identifiant] = Object.entries(cle(sujet))[0];
      return periode[champ] === identifiant;
    });
  const choixFiltre = [...new Map(
    periodes.map((periode) => [libelleDe(periode), { valeur: libelleDe(periode), libelle: libelleDe(periode), mode: sujetDe(periode)?.mode }])
  ).values()].sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr', { numeric: true }));
  // Un sujet retenu qui n'a plus de période (supprimée entre-temps) ne filtre plus rien.
  const filtreActif = filtreSujets.filter((valeur) => choixFiltre.some((choix) => choix.valeur === valeur));
  const visibles = filtreActif.length > 0
    ? periodes.filter((periode) => filtreActif.includes(libelleDe(periode)))
    : periodes;
  const groupesVisibles = regrouper(periodes).filter(
    ({ libelle }) => filtreActif.length === 0 || filtreActif.includes(libelle)
  );
  // Glissement dans la frise : seules les dates changent, le sujet reste.
  const deplacer = (index, { debut, fin }) =>
    onChange(periodes.map((periode, rang) => (rang === index ? { ...periode, debut, fin } : periode)));

  /*
   * ═══ LES SUJETS RETENUS, VUS DEPUIS LE CALENDRIER (2026-10-10, demande du
   * porteur) ═══ On trace les périodes POUR des groupes : sans les voir, on
   * oubliait lesquels étaient cochés, et on reposait un stage déjà déclaré.
   * Le calendrier montre donc leurs noms ET leurs périodes déjà enregistrées.
   *
   * ⚠️ LA CORRESPONDANCE PASSE PAR LA PREMIÈRE CLÉ de `cle(sujet)` (groupe, ou
   * matricule) — jamais par le nom affiché, qui peut changer.
   */
  const retenus = selection
    .map((valeur) => sujets.find((candidat) => candidat.valeur === valeur))
    .filter(Boolean)
    .map((sujet) => {
      const [champ, identifiant] = Object.entries(cle(sujet))[0];
      return {
        sujet,
        existantes: periodes.filter((periode) => periode[champ] === identifiant),
      };
    });
  const existantes = retenus.flatMap(({ existantes: liste }) =>
    liste.map((periode) => ({
      from: new Date(`${periode.debut}T00:00:00`),
      to: new Date(`${periode.fin}T00:00:00`),
    }))
  );

  return (
    <div className="space-y-4">
      {!lectureSeule && (
      <div className="space-y-1.5 rounded-lg border p-4">
        <Label>Période et {libelleSujet.toLowerCase()}s</Label>
        {/*
          ═══ UN SEUL CHAMP (2026-10-10, demande du porteur) ═══ Le choix des
          sujets et le bouton « Ajouter » vivent DANS la carte du calendrier :
          deux popovers ne restent jamais ouverts ensemble, et cocher un groupe
          à côté imposait de rouvrir le calendrier pour voir ses périodes.
        */}
        <Popover open={ouvert} onOpenChange={setOuvert}>
          <PopoverTrigger asChild>
            <Champ
              icone={CalendarDays}
              rempli={aPeriode || selection.length > 0}
              libelle={
                aPeriode || selection.length > 0
                  ? [
                      aPeriode ? resume(plages) : 'aucune période',
                      `${selection.length} ${libelleSujet.toLowerCase()}(s)`,
                    ].join(' — ')
                  : `Choisir les périodes et les ${libelleSujet.toLowerCase()}s…`
              }
            />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto max-w-[min(100vw-2rem,80rem)] space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs">
              <span className="font-medium">Pour :</span>
              {retenus.length === 0 ? (
                <span className="text-muted-foreground">
                  aucun {libelleSujet.toLowerCase()} retenu — cochez-les dans la liste à droite.
                </span>
              ) : (
                retenus.map(({ sujet, existantes: liste }) => (
                  <span
                    key={sujet.valeur}
                    title={
                      liste.length > 0
                        ? liste.map((p) => `${afficher(p.debut)} → ${afficher(p.fin)}`).join('\n')
                        : 'Aucune période déclarée'
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-primary bg-primary px-2 py-0.5 font-medium text-primary-foreground"
                  >
                    {sujet.nom ?? sujet.libelle}
                    {liste.length > 0 && (
                      <span className="font-normal opacity-80">· {liste.length} déjà</span>
                    )}
                  </span>
                ))
              )}
            </div>

            <div className="flex flex-wrap items-start gap-3">
              <CalendrierPeriode
                valeur={saisie}
                onChange={setSaisie}
                anneeScolaire={anneeScolaire}
                couleur={couleur}
                existantes={existantes}
              />
              <div className="w-full space-y-3 sm:w-60">
                <ChoixMultiple
                  sujets={sujets}
                  selection={selection}
                  onChange={setSelection}
                  libelle={libelleSujet}
                  identites={identites}
                />
                <Button className="w-full" onClick={ajouter} disabled={!complet}>
                  <Plus className="h-4 w-4" />
                  Ajouter
                </Button>
                {!complet && (
                  <p className="text-xs text-muted-foreground">
                    {aPeriode
                      ? `Cochez au moins un ${libelleSujet.toLowerCase()}.`
                      : 'Tracez au moins une période.'}
                  </p>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      )}

      {/* ⚠️ AUSSI EN LECTURE SEULE : exporter n'écrit rien, un invité « peut consulter » imprime. */}
      {periodes.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Liste (retouches, corbeilles) ou frise (lecture de l'année d'un regard). */}
          {/* ⚠️ UN `ButtonGroup`, comme Jour / Soir d'Emploi et d'Édition (2026-10-10,
              demande du porteur : « pour être cohérent ») — pas une pastille à part. */}
          <ButtonGroup aria-label="Affichage">
            {[
              { valeur: 'liste', libelle: 'Liste', icone: List },
              { valeur: 'calendrier', libelle: 'Calendrier', icone: GanttChart },
            ].map(({ valeur, libelle, icone: Icone }) => (
              <Button
                key={valeur}
                type="button"
                size="sm"
                variant={affichage === valeur ? 'default' : 'outline'}
                aria-pressed={affichage === valeur}
                className="h-8 gap-1.5 text-xs"
                onClick={() => choisirAffichage(valeur)}
              >
                <Icone className="size-3.5" />
                {libelle}
              </Button>
            ))}
          </ButtonGroup>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={filtreActif.length > 0 ? 'default' : 'outline'}
                  size="sm"
                  aria-label={`Filtrer par ${libelleSujet.toLowerCase()}`}
                >
                  <Filter className="h-4 w-4" />
                  {filtreActif.length > 0
                    ? `${filtreActif.length} ${libelleSujet.toLowerCase()}(s)`
                    : `Filtrer par ${libelleSujet.toLowerCase()}`}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-3">
                <ChoixMultiple
                  sujets={choixFiltre}
                  selection={filtreActif}
                  onChange={setFiltreSujets}
                  libelle={`Afficher seulement`}
                  identites={identites}
                />
              </PopoverContent>
            </Popover>
            {filtreActif.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setFiltreSujets([])}
                title="Retirer le filtre"
                aria-label="Retirer le filtre"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            {/* L'export suit le filtre : il imprime ce qui est affiché. */}
            {exportation && <BoutonExporter periodes={visibles} exportation={exportation} affichage={affichage} />}
          </div>
        </div>
      )}

      {periodes.length > 0 && affichage === 'calendrier' ? (
        <FrisePeriodes
          groupes={groupesVisibles}
          anneeScolaire={anneeScolaire}
          onRetirer={lectureSeule ? undefined : retirer}
          onDeplacer={lectureSeule ? undefined : deplacer}
        />
      ) : periodes.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <CalendarOff className="h-4 w-4 shrink-0" />
          <span>
            {libelleVide}
            {aideVide && <span className="block text-xs">{aideVide}</span>}
          </span>
        </div>
      ) : (
        /*
         * ⚠️ UNE LIGNE PAR SUJET (2026-10-10, demande du porteur) : un groupe en
         * stage en octobre ET en décembre apparaissait sur deux lignes éloignées,
         * et la liste devenait trop longue pour voir qui part quand. Chaque
         * période garde sa propre corbeille : `index` reste le rang dans
         * `periodes`, la seule chose que `retirer` sache viser.
         */
        <ul className="divide-y rounded-lg border">
          {groupesVisibles.map(({ libelle, entrees }) => (
            <li key={libelle} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <div className="w-40 shrink-0">
                <div className="truncate text-sm font-medium">{libelle}</div>
                <div className="text-xs text-muted-foreground">
                  {entrees.length} période(s) · {entrees.reduce((total, { periode }) => total + compter(periode), 0)} jour(s)
                </div>
              </div>

              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {entrees.map(({ periode, index }) => (
                  <span
                    key={`${periode.debut}-${index}`}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 pr-0.5 text-xs"
                  >
                    <span className="tabular-nums">
                      {afficher(periode.debut)} → {afficher(periode.fin)}
                    </span>
                    <span className="text-muted-foreground">· {compter(periode)} j</span>
                    {lectureSeule ? (
                      <span className="w-1.5" />
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        onClick={() => retirer(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="sr-only">
                          Retirer la période du {afficher(periode.debut)} au {afficher(periode.fin)} — {libelle}
                        </span>
                      </Button>
                    )}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Télécharger les périodes en Word, PDF ou Excel — la liste de l'ÉCRAN, ajouts
 * pas encore enregistrés compris (voir `exportPeriodes.service.js`).
 */
function BoutonExporter({ periodes, exportation, affichage }) {
  const telechargement = useMutation({
    mutationFn: (format) =>
      exporterPeriodes(exportation.type, {
        format,
        // En vue Calendrier, le document reprend la frise en Gantt (par mois).
        affichage,
        periodes: periodes.map((periode) => ({
          sujet: libelleDe(periode),
          detail: exportation.detailDe?.(periode) ?? '',
          debut: periode.debut,
          fin: periode.fin,
        })),
      }),
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  return <BoutonTelecharger enCours={telechargement.isPending} onChoisir={(format) => telechargement.mutate(format)} />;
}

/**
 * Déclencheur de popover, à l'allure d'un champ de formulaire.
 *
 * Il porte le RÉSUMÉ de ce qui est retenu, pas un libellé fixe : refermé, c'est
 * le seul endroit qui dise ce qu'on vient de choisir.
 *
 * ⚠️ `forwardRef` et la diffusion des props ne sont PAS décoratifs.
 * `PopoverTrigger asChild` CLONE son enfant pour lui passer son `onClick`, ses
 * attributs ARIA et sa `ref` d'ancrage. Un composant qui ne les transmet pas au
 * bouton les avale : le clic n'atteint jamais Radix, et le popover ne s'ouvre
 * pas — sans la moindre erreur en console.
 */
const Champ = forwardRef(({ icone: Icone, rempli, libelle, className, ...proprietes }, ref) => (
  <Button
    ref={ref}
    variant="outline"
    className={cn(
      'w-full justify-start gap-2 font-normal',
      !rempli && 'text-muted-foreground',
      className
    )}
    {...proprietes}
  >
    <Icone className="h-4 w-4 shrink-0" />
    <span className="min-w-0 flex-1 truncate text-left">{libelle}</span>
    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
  </Button>
));

Champ.displayName = 'Champ';

const libelleDe = (periode) =>
  periode.groupe ?? periode.nomFormateur ?? periode.matriculeFormateur ?? '';

/**
 * Les périodes rangées par sujet, sujets dans l'ordre alphabétique (TSDEE202
 * avant TSDEE210), périodes de chacun dans l'ordre chronologique.
 */
function regrouper(periodes) {
  const parSujet = new Map();
  periodes.forEach((periode, index) => {
    const libelle = libelleDe(periode);
    if (!parSujet.has(libelle)) parSujet.set(libelle, []);
    parSujet.get(libelle).push({ periode, index });
  });
  return [...parSujet]
    .map(([libelle, entrees]) => ({
      libelle,
      entrees: entrees.sort((a, b) => a.periode.debut.localeCompare(b.periode.debut)),
    }))
    .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr', { numeric: true }));
}

const SAISIE_VIDE = { plages: [] };
const CLE_AFFICHAGE = 'periodes.affichage';

function resume(plages) {
  if (plages.length === 0) return '—';

  const periodes = plages.map((p) => ({ debut: enTexte(p.from), fin: enTexte(p.to) }));
  const jours = periodes.reduce((total, periode) => total + compter(periode), 0);
  if (periodes.length === 1) {
    const [periode] = periodes;
    return `${afficher(periode.debut)} → ${afficher(periode.fin)} · ${jours} j`;
  }
  return `${periodes.length} périodes · ${jours} j`;
}

/** Les dates sont des chaînes « AAAA-MM-JJ » : midi évite tout décalage. */
function afficher(jour) {
  return new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
  });
}

function compter({ debut, fin }) {
  const ecart = new Date(`${fin}T12:00:00`) - new Date(`${debut}T12:00:00`);
  return Math.round(ecart / 86400000) + 1;
}
