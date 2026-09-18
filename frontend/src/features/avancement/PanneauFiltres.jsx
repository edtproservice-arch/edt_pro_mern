import { ListFilter } from 'lucide-react';
import { FACETTES, nombreDeFiltres } from 'shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Les facettes du panneau « Filtres » de l'avancement.
 * ← `#filter-panel` d'avancement.html : Niveau · Mode de Formation · Groupe ·
 *   Formateur · Semestre · Statut Régional
 *
 * ═══ ⚠️ LA FORME EST CELLE DES FILTRES DE LA PAGE ÉDITION ═══
 * (demande du porteur, 2026-08-31.) Même déclencheur — bouton `outline` de 2 rem
 * avec son icône et un `Badge secondary` pour le compte —, mêmes titres de
 * section, mêmes jetons `h-7`, même « Effacer le filtre » en pied. Un filtre qui
 * change d'apparence d'un écran à l'autre se réapprend à chaque fois, alors
 * qu'il pose la même question.
 *
 * ⚠️ UNE SEULE DIVERGENCE, ASSUMÉE : la MISE EN PAGE (2026-09-01). Édition porte
 * deux ou trois sections courtes dans une colonne de 18 rem ; celle-ci en porte
 * six, dont une liste de vingt et un groupes et une de dix-sept formateurs. En
 * pile, il fallait faire défiler le panneau POUR DÉCOUVRIR qu'il restait des
 * sections. Elles sont donc en COLONNES ici — voir `PopoverContent`.
 *
 * ═══ ⚠️ MÊME GRAMMAIRE, AUSSI ═══
 * « OU » à l'intérieur d'une facette, « ET » entre les facettes, et une facette
 * VIDE ne filtre RIEN. C'est la règle du domaine (`filtrerAvancement`), pas de
 * l'écran — deux grammaires sur deux écrans du même produit seraient
 * indevinables.
 */
export default function PanneauFiltres({ facettes, filtres, onChange }) {
  const actifs = nombreDeFiltres(filtres);

  const basculer = (cle, valeur) => {
    const choisies = filtres[cle] ?? [];
    const retenu = choisies.includes(valeur);

    /*
     * ═══ ⚠️ GROUPE ET FORMATEUR NE SE CHOISISSENT QU'UN À LA FOIS ═══
     * (demande du porteur, 2026-09-01.) Un second clic REMPLACE au lieu
     * d'ajouter ; cliquer la valeur déjà retenue la retire, ce qui reste le seul
     * moyen de revenir à « tous » sans passer par « Effacer le filtre ».
     *
     * ⚠️ LA FORME DE LA DONNÉE NE CHANGE PAS : c'est toujours un TABLEAU, à un
     * élément. Le domaine (`filtrerAvancement`) et la ligne « Filtré sur … »
     * n'ont donc rien à savoir de cette règle d'écran.
     */
    if (CHOIX_UNIQUE.has(cle)) {
      onChange({ ...filtres, [cle]: retenu ? [] : [valeur] });
      return;
    }

    onChange({
      ...filtres,
      [cle]: retenu ? choisies.filter((v) => v !== valeur) : [...choisies, valeur],
    });
  };

  /*
   * ⚠️ ON N'AFFICHE QUE LES FACETTES QUI ONT DE QUOI CHOISIR. Une seule valeur
   * possible ne filtre rien — cocher « Résidentiel » quand tout l'est ne retire
   * aucune ligne, et la case laisse croire à un réglage qui n'en est pas un.
   * C'est la règle d'Édition, où `FiltreGroupes` ne se rend même pas sans
   * facette.
   */
  const utiles = Object.entries(FACETTES).filter(([cle]) => (facettes[cle]?.length ?? 0) > 1);

  /* ⚠️ AUCUNE FACETTE À PROPOSER = PAS DE BOUTON — comme `FiltreGroupes`. Un
     panneau qui s'ouvre sur des sections vides fait douter du filtre. */
  if (utiles.length === 0) return null;

  /*
   * ⚠️ DEUX FAMILLES, ET C'EST LA HAUTEUR QUI LES SÉPARE : « Niveau »,
   * « Semestre » ou « Statut régional » tiennent en deux jetons ; « Groupe » en
   * porte vingt et un et « Formateur » dix-sept. Les mettre sur le même rang
   * donnerait des colonnes aux trois quarts vides.
   */
  const longues = utiles.filter(([cle]) => COLONNE_PROPRE.has(cle));
  const courtes = utiles.filter(([cle]) => !COLONNE_PROPRE.has(cle));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <ListFilter className="size-3.5" />
          Filtrer
          {actifs > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[0.6rem] tabular-nums">
              {actifs}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      {/*
        ═══ ⚠️ EN COLONNES, PAS EN PILE ═══ (demande du porteur, 2026-09-01 :
        « il n'affiche pas toutes les sections du filtre ».)

        Empilées dans une colonne de 18 rem, les six facettes dépassaient la
        hauteur du panneau : il fallait le faire défiler POUR DÉCOUVRIR qu'il
        restait des sections — et la liste des formateurs, qui défile elle aussi,
        donnait un défilement DANS un défilement. Côte à côte, tout se voit d'un
        seul regard et il ne reste qu'un défilement, celui des listes longues.

        ⚠️ `flex-wrap` : sur un écran étroit, les colonnes se replient et l'on
        retrouve l'ancienne pile — mieux vaut cela qu'un panneau plus large que
        la fenêtre.
      */}
      <PopoverContent
        align="start"
        collisionPadding={12}
        /*
         * ⚠️ LA LARGEUR SE BORNE À L'ESPACE RÉELLEMENT DISPONIBLE, pas à une
         * fraction du `vw`. Mesuré à 900 px de fenêtre : le panneau s'ancre sur
         * son bouton (x = 280, après la barre latérale), et une borne en `92vw`
         * le laissait déborder de 167 px à droite — Radix ne le décale pas de
         * lui-même quand la largeur vient du CONTENU. `--radix-popover-content-
         * available-width` est la mesure qui tient compte de l'ancrage ; passé
         * cette largeur, `flex-wrap` replie les colonnes en pile.
         */
        className="max-h-[min(85vh,var(--radix-popover-content-available-height))] w-auto max-w-[min(56rem,var(--radix-popover-content-available-width))] overflow-y-auto p-3 scrollbar-fine"
      >
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          {/*
            ⚠️ LES FACETTES COURTES PARTAGENT UNE COLONNE : deux à quatre jetons
            chacune, elles laisseraient sinon trois colonnes aux trois quarts
            vides à côté des listes longues.
          */}
          {courtes.length > 0 && (
            <div className="w-40 shrink-0 space-y-3">
              {courtes.map(([cle, { libelle }]) => (
                <Section key={cle} libelle={libelle}>
                  <Jetons
                    cle={cle}
                    valeurs={facettes[cle]}
                    choisies={filtres[cle]}
                    onBasculer={basculer}
                  />
                </Section>
              ))}
            </div>
          )}

          {longues.map(([cle, { libelle }], rang) => (
            <div
              key={cle}
              /* Un filet plutôt qu'un `Separator` horizontal : la séparation est
                 maintenant verticale, entre colonnes. */
              className={cn(
                'min-w-0 flex-1',
                (rang > 0 || courtes.length > 0) && 'border-l pl-4'
              )}
            >
              <Section libelle={libelle} indice="un seul">
                <div
                  className={cn(
                    'max-h-72 overflow-y-auto scrollbar-fine',
                    LISTE_VERTICALE.has(cle) ? 'space-y-1' : 'flex flex-wrap gap-1'
                  )}
                >
                  <Jetons
                    cle={cle}
                    valeurs={facettes[cle]}
                    choisies={filtres[cle]}
                    onBasculer={basculer}
                    pleineLargeur={LISTE_VERTICALE.has(cle)}
                  />
                </div>
              </Section>
            </div>
          ))}
        </div>

        {/*
          ⚠️ CE QUE LE FILTRE FAIT, ÉCRIT EN TOUTES LETTRES — comme
          `FiltreSeances`. « 2ᵉ année » pourrait se comprendre comme « ne montre
          que la colonne de 2ᵉ année » : la phrase lève le doute une fois pour
          toutes, et dit du même coup qu'aucun bouton « Appliquer » n'est attendu.
        */}
        <p className="mt-3 text-[0.65rem] leading-snug text-muted-foreground">
          Ne garde que les lignes qui répondent à tous les critères cochés. Rien de coché = tout. Le
          taux se recalcule aussitôt.
        </p>

        {actifs > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-7 w-full text-xs text-muted-foreground"
            onClick={() => onChange(vider(filtres))}
          >
            Effacer le filtre
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Titre de section, avec la mention « un seul » là où le choix est unique. */
function Section({ libelle, indice, children }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold">
        {libelle}
        {/* ⚠️ LA RÈGLE EST ÉCRITE : sans elle, voir sa sélection précédente
            disparaître au clic suivant passe pour un défaut. */}
        {indice && <span className="ml-1 font-normal text-muted-foreground">({indice})</span>}
      </p>
      {children}
    </div>
  );
}

function Jetons({ cle, valeurs = [], choisies = [], onBasculer, pleineLargeur = false }) {
  return valeurs.map((valeur) => (
    <Jeton
      key={valeur}
      valeur={valeur}
      cle={cle}
      retenu={choisies.includes(valeur)}
      onClick={() => onBasculer(cle, valeur)}
      pleineLargeur={pleineLargeur}
    />
  ));
}

/** Le jeton d'Édition : un bouton `h-7`, plein quand il est retenu. */
function Jeton({ valeur, cle, retenu, onClick, pleineLargeur = false }) {
  return (
    <Button
      variant={retenu ? 'default' : 'outline'}
      size="sm"
      aria-pressed={retenu}
      onClick={onClick}
      className={
        pleineLargeur
          ? 'h-auto w-full justify-start whitespace-normal py-1 text-left text-[0.7rem] leading-snug'
          : 'h-7 px-2 text-[0.7rem]'
      }
    >
      {ETIQUETTES[cle] ? ETIQUETTES[cle](valeur) : valeur}
    </Button>
  );
}

/** Les facettes dont les valeurs sont trop longues pour une rangée de jetons. */
const LISTE_VERTICALE = new Set(['formateur']);

/** Les facettes qui ne se choisissent qu'une valeur à la fois. */
const CHOIX_UNIQUE = new Set(['groupe', 'formateur']);

/** Celles dont la liste mérite sa propre colonne. */
const COLONNE_PROPRE = new Set(['groupe', 'formateur']);

/*
 * ⚠️ LES VALEURS BRUTES NE SE LISENT PAS TOUTES. « 1 » ne dit pas « 1ʳᵉ année »,
 * et « oui / non » ne dit pas de quoi. Ce sont les libellés de l'existant.
 */
/**
 * Le libellé d'UNE valeur, exporté : la ligne « Filtré sur … » les nomme aussi,
 * et deux tables auraient divergé au premier libellé ajouté (§4.2).
 */
export const etiquetteValeur = (cle, valeur) => ETIQUETTES[cle]?.(valeur) ?? valeur;

const ETIQUETTES = {
  annee: (valeur) => (valeur === '1' ? '1re année' : `${valeur}e année`),
  semestre: (valeur) => (valeur === 'A' ? 'Annuel' : valeur),
  regional: (valeur) => (valeur === 'oui' ? 'EFM régional' : 'Hors régional'),
};

const vider = (filtres) => Object.fromEntries(Object.keys(filtres).map((cle) => [cle, []]));
