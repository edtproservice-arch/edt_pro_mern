import { useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  Download,
  MousePointerSquareDashed,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { libelleSemaine } from 'shared/domain';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { Kbd } from '@/components/ui/kbd';
import CommandesZoom from '@/components/common/CommandesZoom';
import { cn } from '@/lib/utils';

/**
 * Les outils de la grille : mode, import, statistiques, réinitialisation.
 * ← `setupActionToolbar()`, `setupSelectionModeToggle()`, `importWeekBtn`,
 *   `resetBtn` de emploi.html
 *
 * ═══ ⚠️ CE QUI EST ICI, ET CE QUI N'Y EST PLUS ═══
 * Les gestes d'ÉDITION — copier, coller, vider, défaire — ont quitté ce menu
 * pour la barre flottante en pied d'écran (`BarreFlottante`) : on les enchaîne
 * par rafales sur une sélection qu'on vient de tracer, et un menu qui se referme
 * à chaque choix imposait de le rouvrir pour la commande suivante.
 *
 * Restent ici les OUTILS de la semaine, qu'on emploie une fois de temps en
 * temps : le mode de souris, l'import d'une autre semaine, les statistiques,
 * l'accès à la base et la réinitialisation.
 */
export default function MenuGrille({
  selection,
  enCours,
  modeSelection,
  semainesDisponibles = [],
  semaineCourante,
  onBasculerMode,
  onImporterSemaine,
  onReinitialiser,
  onStatistiques,
  zoom,
  onZoom,
  /*
   * ⚠️ IMPORTER ET RÉINITIALISER RESTENT AU DIRECTEUR (décision du 2026-09-12) :
   * ils touchent des semaines entières. Un invité « peut modifier » ne les voit
   * pas — les montrer pour qu'ils échouent en 403 serait un bouton qui ment.
   */
  outilsDirecteur = true,
}) {
  /*
   * ═══ ⚠️ LE MENU EST CONTRÔLÉ, ET C'EST NÉCESSAIRE ═══
   * Ouvrir une boîte de dialogue depuis un élément de menu Radix ne marche pas
   * en laissant le menu se fermer tout seul : il rend le focus à son
   * déclencheur pendant que la boîte s'ouvre, et celle-ci se referme aussitôt.
   * On ferme donc le menu NOUS-MÊMES, puis on ouvre la confirmation.
   */
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [confirmationAnnee, setConfirmationAnnee] = useState(false);

  const autresSemaines = semainesDisponibles.filter(
    (entree) => entree.semaine !== semaineCourante && entree.seances > 0
  );

  /*
   * ⚠️ UN FRAGMENT, PAS UN `div`. Ces boutons rejoignent la rangée de l'en-tête :
   * enveloppés dans leur propre conteneur flex, ils formeraient un bloc
   * insécable qui repasse à la ligne d'un seul tenant, au lieu de se répartir
   * avec la semaine et la bascule jour/soir.
   */
  return (
    <>
      {/* ── Importer une AUTRE semaine ────────────────────────────────────── */}
      {outilsDirecteur && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={enCours}>
            <Download className="size-3.5" />
            Importer
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Copier une autre semaine dans {semaineCourante ? libelleSemaine(semaineCourante) : 'celle-ci'}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {autresSemaines.length === 0 ? (
            /* ⚠️ On NOMME le cas vide : une liste sans entrée laisserait croire
               à une panne, alors qu'aucune autre semaine n'est encore remplie. */
            <DropdownMenuItem disabled className="text-xs">
              Aucune autre semaine remplie
            </DropdownMenuItem>
          ) : (
            autresSemaines.map((entree) => (
              <DropdownMenuItem
                key={entree.semaine}
                className="text-xs"
                onClick={() => onImporterSemaine(entree.semaine)}
              >
                {/* Le COURT suffit dans la liste : l'année est déjà nommée
                    juste au-dessus, et la répéter douze fois n'apprend rien. */}
                {libelleSemaine(entree.semaine, { court: true })}
                <DropdownMenuShortcut>{entree.seances} séance(s)</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      )}

      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onStatistiques}>
        <BarChart3 className="size-3.5" />
        Statistiques
      </Button>

      {/*
        ── Zoom, sélection et réinitialisation, à droite ───────────────────────
        ⚠️ SÉPARÉS, PLUS SOUDÉS (2026-08-26, demande du porteur). Ces trois
        commandes ne forment pas un choix exclusif — contrairement à Jour/Soir ou
        aux axes, qui restent groupés parce que le bloc soudé y DIT qu'il faut en
        choisir une seule. Ici ce sont trois actions indépendantes, et les souder
        laissait croire l'inverse.

        ⚠️ LE ZOOM VIT DANS `components/common/CommandesZoom` depuis le
        2026-08-26 : la page Édition le demandait aussi, et l'y recopier en
        aurait fait une troisième version à tenir en phase.
      */}
      <div className="ml-auto flex items-center gap-1.5">
        <CommandesZoom zoom={zoom} onZoom={onZoom} />

        {/*
          ⚠️ « ACTIVER » DIT CE QU'ON OBTIENT, pas où l'on est. « Déplacement »
          nommait le mode COURANT : il fallait déduire que cliquer donnerait
          l'autre. Ici le bouton s'allume quand la sélection est active, et son
          libellé ne change pas — c'est un interrupteur, pas une bascule à deux
          noms.
        */}
        <Button
          variant={modeSelection ? 'default' : 'outline'}
          size="sm"
          onClick={onBasculerMode}
          aria-pressed={modeSelection}
          title={
            modeSelection
              ? 'Sélection active — glisser trace un rectangle. Cliquer, ou appuyer sur Ctrl, pour revenir au déplacement des séances.'
              : 'Activer la sélection — glisser tracera un rectangle. Sans elle, glisser DÉPLACE une séance. Un appui sur Ctrl fait la même chose.'
          }
          className="h-8 gap-1.5 text-xs"
        >
          <MousePointerSquareDashed className="size-3.5" />
          Activer
          {/* ⚠️ Ctrl BASCULE, il ne maintient plus : le rappeler ici est le seul
              endroit qui l'apprenne. Le jeton ne s'allume donc plus tout seul —
              c'est l'état du bouton qui dit où l'on en est. */}
          <Kbd className={cn('transition-colors', modeSelection && 'bg-primary-foreground/20 text-primary-foreground')}>
            Ctrl
          </Kbd>
        </Button>

        {outilsDirecteur && (
        <DropdownMenu open={menuOuvert} onOpenChange={setMenuOuvert}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={enCours}
            className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <RotateCcw className="size-3.5" />
            Réinitialiser
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Effacer les séances — sans retour possible
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            onClick={() => onReinitialiser('semaine')}
          >
            <div>
              <span className="block text-xs font-medium">Cette semaine seulement</span>
              <span className="block text-[0.7rem] opacity-80">
                {libelleSemaine(semaineCourante)}
              </span>
            </div>
          </DropdownMenuItem>

          {/*
            ⚠️ L'ANNÉE EST SANS COMMUNE MESURE avec la semaine — l'existant
            exigeait d'ailleurs une SECONDE confirmation, reprise dans la page.
            Les deux portées sont donc distinctes et libellées, jamais un seul
            bouton « Réinitialiser » dont on découvrirait l'étendue après coup.
          */}
          {/*
            ⚠️ UNE MODALE, PLUS UN SOUS-MENU (demande du porteur, 2026-08-26).
            Un sous-menu se ferme au moindre écart de souris : la confirmation
            d'un effacement IRRÉVERSIBLE ne peut pas dépendre d'un survol. Une
            boîte de dialogue prend le focus, se lit, et ne se referme que sur un
            geste voulu.
          */}
          <DropdownMenuItem
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={() => {
              setMenuOuvert(false);
              setConfirmationAnnee(true);
            }}
          >
            <Trash2 className="size-3.5" />
            <span className="text-xs font-medium">Toute l’année scolaire…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>

      {/*
        ⚠️ RENDUE HORS DU MENU. À l'intérieur, elle disparaîtrait avec lui à la
        fermeture — le menu démonte son contenu — et la boîte ne s'ouvrirait
        jamais.
      */}
      <ConfirmationAction
        ouvert={confirmationAnnee}
        onOpenChange={setConfirmationAnnee}
        titre="Effacer toute l’année scolaire ?"
        description="Toutes les semaines de l’année seront effacées, ainsi que les absences qui s’y rattachent et leurs heures de rattrapage. Cette action est sans retour possible."
        libelleConfirmation="Tout effacer"
        destructive
        onConfirmer={() => onReinitialiser('annee')}
      />
    </>
  );
}

