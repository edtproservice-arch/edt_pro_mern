import { forwardRef, useState } from 'react';
import { CalendarDays, CalendarOff, ChevronDown, Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import CalendrierPeriode, { enTexte } from './CalendrierPeriode';
import ChoixMultiple from './ChoixMultiple';

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
}) {
  const [selection, setSelection] = useState([]);
  const [plage, setPlage] = useState();

  const aPeriode = Boolean(plage?.from);
  const complet = selection.length > 0 && aPeriode;

  const ajouter = () => {
    if (!complet) return;

    /* ⚠️ UN CLIC UNIQUE VAUT UNE JOURNÉE : sans `to`, la période se referme sur
       son premier jour plutôt que de rester ouverte. */
    const nouvelles = [{ debut: enTexte(plage.from), fin: enTexte(plage.to ?? plage.from) }];

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
    setPlage(undefined);
  };

  const retirer = (index) => onChange(periodes.filter((_, rang) => rang !== index));

  return (
    <div className="space-y-4">
      {!lectureSeule && (
      <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label>Période</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Champ
                icone={CalendarDays}
                rempli={aPeriode}
                libelle={aPeriode ? resume(plage) : 'Choisir une période…'}
              />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-3">
              <CalendrierPeriode
                valeur={plage}
                onChange={setPlage}
                anneeScolaire={anneeScolaire}
                couleur={couleur}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1.5">
          <Label>{libelleSujet}</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Champ
                icone={Users}
                rempli={selection.length > 0}
                libelle={
                  selection.length > 0
                    ? `${selection.length} ${libelleSujet.toLowerCase()}(s) retenu(s)`
                    : `Choisir un ou plusieurs ${libelleSujet.toLowerCase()}s…`
                }
              />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-3">
              <ChoixMultiple
                sujets={sujets}
                selection={selection}
                onChange={setSelection}
                libelle={libelleSujet}
              />
            </PopoverContent>
          </Popover>
        </div>

        <Button onClick={ajouter} disabled={!complet}>
          <Plus className="h-4 w-4" />
          Ajouter
        </Button>
      </div>
      )}

      {periodes.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <CalendarOff className="h-4 w-4 shrink-0" />
          <span>
            {libelleVide}
            {aideVide && <span className="block text-xs">{aideVide}</span>}
          </span>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {periodes.map((periode, index) => (
            <li
              key={`${periode.debut}-${libelleDe(periode)}-${index}`}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{libelleDe(periode)}</div>
                <div className="text-xs text-muted-foreground">
                  {afficher(periode.debut)} → {afficher(periode.fin)} · {compter(periode)} jour(s)
                </div>
              </div>

              {!lectureSeule && (
                <Button variant="ghost" size="icon" onClick={() => retirer(index)}>
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Retirer cette période</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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

function resume(plage) {
  if (!plage?.from) return '—';

  const periode = { debut: enTexte(plage.from), fin: enTexte(plage.to ?? plage.from) };
  return `${afficher(periode.debut)} → ${afficher(periode.fin)} · ${compter(periode)} j`;
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
