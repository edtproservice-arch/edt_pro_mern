import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Tableau dont chaque colonne se trie au clic sur son en-tête.
 * ← `activerTriTableaux()` / `trierTableau()` de affectation-carte.js:2705-2768
 *
 * ═══ POURQUOI PAS LE MÊME MÉCANISME QUE L'ANCIEN ═══
 * L'existant triait le DOM : il relisait le texte des cellules et devinait s'il
 * s'agissait d'un nombre (« 1 410 h », « 44 % », « 6 / 24 ») avec une expression
 * régulière. Une cellule mise en forme autrement se retrouvait triée comme du
 * texte, et « 90 h » passait avant « 100 h ». Ici chaque colonne déclare la
 * VALEUR sur laquelle elle se trie, séparément de ce qu'elle affiche : le tri ne
 * dépend plus de la présentation.
 *
 * Le sens choisi est mémorisé par tableau et réappliqué après chaque rendu,
 * comme dans l'existant — sinon il serait perdu à chaque changement
 * d'affectation.
 *
 * ═══ ⚠️ DEUX MODES DE DÉFILEMENT ═══ (2026-09-03, demande du porteur : « en
 * admin tous tableau … entête fixe … sans ajouter une scroll bar en tableau ».)
 *
 * Par défaut (`pleinePage` absent), le tableau est celui des MODALES : borné en
 * hauteur par l'appelant (`className="min-h-0 flex-1 overflow-auto"`), il défile
 * DANS SA PROPRE ENVELOPPE, et l'en-tête colle au sommet de CETTE enveloppe.
 * C'est le mode qu'utilisent déjà `AchevementModules` et `BilanDetail` : ne pas
 * y toucher.
 *
 * `pleinePage` est le second mode, pour un tableau qui occupe une PAGE entière
 * (les listes de l'administration) : l'en-tête doit rester en vue quand on
 * défile la PAGE, sans qu'un défilement interne s'ajoute au tableau lui-même.
 *
 * ⚠️⚠️ LES DEUX SONT INCOMPATIBLES EN CSS, ET C'EST POURQUOI CE SONT DEUX
 * MODES : `position: sticky` s'accroche au plus proche ANCÊTRE QUI DÉFILE — et
 * un ancêtre avec `overflow: auto` (même sans barre visible, même seulement sur
 * l'axe horizontal) EN EST UN, qu'il défile ou non. Poser le même en-tête
 * collant dans l'enveloppe `overflow-auto` d'un tableau non borné en hauteur ne
 * ferait donc RIEN : cette enveloppe ne défile jamais elle-même, l'en-tête s'y
 * accrocherait à un cadre immobile — exactement le défaut « top: -8956px » déjà
 * consigné pour la grille d'emploi. En mode `pleinePage`, l'enveloppe passe donc
 * en `overflow-clip` (qui NE défile jamais, et n'est pas considérée comme un
 * ancêtre défilant) : plus rien n'intercepte le collant avant la vraie page.
 *
 * ⚠️ ET SANS `overflow-x-auto`, une colonne trop large ferait déborder la PAGE
 * — la règle déjà tenue partout ailleurs (« c'est la page qui ne doit jamais
 * défiler horizontalement, pas ses composants »). Le tableau passe donc en
 * `table-fixed` : les colonnes se PARTAGENT la largeur disponible au lieu de la
 * réclamer, comme la grille d'emploi. `colonne.largeur` (une classe `w-*`)
 * donne leur part aux colonnes qui en ont besoin ; les autres se partagent le
 * reste.
 *
 * ═══ ⚠️⚠️ SOUS 1280 PX, LE TABLEAU DEVIENT DES CARTES (2026-09-05, demande du
 * porteur : « je veux que les tableaux soient responsive, peuvent changer leur
 * forme ») ═══ `pleinePage` sert UNIQUEMENT aux quatre tableaux de
 * l'administration (Directeurs, Statistiques, Répartition, Réseau) — vérifié,
 * c'est le seul endroit où ce mode est employé. Chacun porte 4 à 8 colonnes à
 * largeur FIXE (`colonne.largeur`) dont la SOMME dépasse déjà 700-850 px, avant
 * même la colonne d'identité qui absorbe le reste : sur un écran de tablette
 * (~768 px), `table-fixed` ne peut plus les répartir sans les écraser, et le
 * texte d'une colonne se peint PAR-DESSUS sa voisine — signalé par le porteur
 * sur « Statistiques ».
 *
 * Une colonne plus étroite n'aurait fait que reculer le seuil : à 4-8 colonnes
 * de données, il n'existe pas de largeur qui reste lisible en dessous d'un
 * certain point. La réponse n'est donc pas un ajustement de largeur mais un
 * CHANGEMENT DE FORME, déjà pratiqué ailleurs dans ce projet (l'agenda de
 * « Mon emploi du temps ») : sous 1280 px, chaque ligne devient une CARTE — les
 * mêmes `colonne.rendu(ligne)`, empilés avec leur étiquette au lieu d'être
 * alignés en grille. La colonne SANS étiquette (`entete: ''`, la colonne
 * d'actions dans les quatre tableaux) passe en pied de carte, sans répéter un
 * intitulé vide.
 *
 * ⚠️ `pleinePage` L'ACTIVE SEUL, à `xl` : les deux notions se confondaient dans
 * les faits (aucun consommateur n'utilisait l'un sans l'autre), et un prop de
 * plus qu'il aurait fallu penser à poser à chaque nouvel appel aurait fini par
 * être oublié une fois — la cause n°1 d'instabilité du §4.2, version « un
 * réglage qui devrait toujours accompagner un autre ».
 *
 * ⚠️ MAIS LE SEUIL SE CHOISIT (`cartesSous`), et un tableau peut passer en
 * cartes SANS être en pleine page (2026-09-05, « Table des matières » du
 * stagiaire) : celui-là vit dans un cadre de 896 px, ses six colonnes tiennent
 * largement jusqu'à `md`, et basculer dès 1280 px l'aurait mis en cartes sur un
 * portable qui l'affichait très bien. `xl` reste le défaut de `pleinePage`,
 * calibré sur les 730-850 px de largeurs FIXES des tableaux de l'administration.
 *
 * ⚠️ LES SEUILS SONT UNE TABLE DE LITTÉRAUX, PAS UNE INTERPOLATION : Tailwind
 * scanne le code source pour ses classes, il ne compose jamais un nom de classe
 * à l'exécution (`` `${bp}:hidden` `` ne générerait RIEN). D'où un jeu FERMÉ de
 * valeurs, chacune écrite en toutes lettres.
 *
 * ⚠️ LE TRI RESTE CELUI DÉJÀ CALCULÉ : les cartes rendent `triees`, pas
 * `lignes` — un tri posé avant que la fenêtre ne se rétrécisse continue de
 * s'appliquer. Il n'existe en revanche aucune commande de tri EN MODE CARTES
 * (pas d'en-tête à cliquer) : c'est le même compromis que l'agenda de « Mon
 * emploi du temps », qui n'en offre pas non plus.
 *
 * @param {Array} colonnes {id, entete, aligne?, tri?, rendu, pied?, largeur?}
 *   `aligne` vaut `'droite'` ou `'centre'` — une colonne de chiffres se lit
 *   alignée, une colonne de badges se centre sous son intitulé.
 *   `largeur` (ex. `'w-64'`) n'est lue qu'en mode `pleinePage`, pour le
 *   `<colgroup>` que `table-fixed` exige pour répartir la largeur.
 * @param {Array} lignes   déjà triées par le domaine — c'est l'ordre par défaut
 * @param {string} className  classes du conteneur — en mode par défaut, c'est
 *   par là qu'un appelant borne la hauteur (`min-h-0 flex-1 overflow-auto`).
 * @param {boolean} [pleinePage]  active le second mode.
 * @param {string} [collerSous]  valeur CSS de `top` pour l'en-tête collant en
 *   mode `pleinePage` — la hauteur de ce qui est DÉJÀ collant au-dessus (une
 *   barre de navigation, par exemple). `'0px'` si rien n'est au-dessus.
 */
/**
 * Le seuil de bascule vers les cartes, en classes LITTÉRALES (voir plus haut :
 * Tailwind ne compose pas un nom de classe à l'exécution).
 */
const RUPTURES = {
  md: { table: 'hidden md:block', cartes: 'md:hidden' },
  lg: { table: 'hidden lg:block', cartes: 'lg:hidden' },
  xl: { table: 'hidden xl:block', cartes: 'xl:hidden' },
};

export default function TableauTriable({
  colonnes,
  lignes,
  cleLigne,
  pied,
  vide,
  className,
  pleinePage = false,
  collerSous = '0px',
  /**
   * ⚠️ `collant` — un en-tête qui reste en vue SANS le reste de `pleinePage`
   * (2026-09-06, demande du porteur : « l'en-tête des tableaux avancement,
   * affectation, programme doit être fixe lors du scroll, sans ajouter une autre
   * scroll bar »). Sa valeur est le `top` CSS, exprimé PAR RAPPORT au conteneur
   * défilant qui l'accueille.
   *
   * ═══ ⚠️⚠️ POURQUOI PAS `pleinePage` TOUT SIMPLEMENT ═══ Celui-ci impose aussi
   * `table-fixed`, qui répartit la largeur d'après `colonne.largeur`. Les quatre
   * tableaux de l'administration les déclarent ; ceux des sessions non — leurs
   * cinq à neuf colonnes se retrouveraient toutes de MÊME largeur, « Semestre »
   * aussi large que « Module ». Le collant et la répartition des largeurs sont
   * deux questions distinctes : les lier ici aurait imposé de régler la seconde
   * pour obtenir la première.
   *
   * ⚠️⚠️ MAIS LA CONTRAINTE DE `pleinePage` RESTE ENTIÈRE : sans
   * `overflow-x-auto`, un tableau plus large que son cadre fait déborder la
   * PAGE. C'est à l'appelant de s'assurer qu'il tient — en relevant `cartesSous`
   * jusqu'au seuil où la table passe, ce que « Mon avancement » (neuf colonnes)
   * a dû faire.
   */
  collant = null,
  /** `'md' | 'lg' | 'xl'` — en dessous, une carte par ligne. `pleinePage` vaut `'xl'`. */
  cartesSous,
}) {
  const [tri, setTri] = useState(null);
  const rupture = RUPTURES[cartesSous ?? (pleinePage ? 'xl' : '')] ?? null;

  const basculer = (colonne) => {
    if (!colonne.tri) return;
    setTri((actuel) =>
      actuel?.id === colonne.id && actuel.sens === 'asc'
        ? { id: colonne.id, sens: 'desc' }
        : { id: colonne.id, sens: 'asc' }
    );
  };

  const triees = trier(lignes, colonnes, tri);

  /*
   * `min-w-0` n'est pas décoratif : ce bloc est l'enfant d'une grille (le
   * DialogContent de shadcn), et un enfant de grille a `min-width: auto` par
   * défaut — il refuse donc de devenir plus étroit que son contenu. Sans lui,
   * `overflow-x-auto` ne retient rien : c'est la MODALE ENTIÈRE qui s'élargit
   * et défile, en emportant l'en-tête et les autres sections.
   */
  return (
    <div
      className={cn(
        'flex min-w-0 max-w-full flex-col rounded-lg border',
        // ⚠️ `overflow-clip`, PAS `overflow-hidden` ni `overflow-auto` : les
        // deux derniers créent un ANCÊTRE DÉFILANT, qui piégerait le collant de
        // l'en-tête avant qu'il n'atteigne la vraie page. `clip` coupe les
        // coins arrondis sans jamais compter comme tel.
        (pleinePage || collant) && 'overflow-clip',
        className
      )}
    >
      {/*
        ⚠️ LE DÉFILEMENT EST SUR L'ENVELOPPE DE `Table`, pas sur ce cadre : c'est
        elle que shadcn pose en `overflow-auto`, donc elle qui sert d'ancre à
        l'en-tête collant. `h-full` la fait remplir ce cadre quand l'appelant le
        borne en hauteur ; sans borne, elle reste à sa taille naturelle et rien
        ne change pour les tableaux qui ne défilent qu'horizontalement.

        ⚠️ `flex-1 min-h-0` ET NON `h-full` : mesuré, `height: 100%` retombait sur
        la hauteur du CONTENU (10 273 px) parce que le cadre parent, dimensionné
        par `flex-1`, garde `height: auto` — un pourcentage n'a alors rien contre
        quoi se résoudre. La croissance flex, elle, n'a pas besoin d'une hauteur
        définie.

        ═══ ⚠️ EN MODE `pleinePage`, LA MÊME RAISON IMPOSE L'INVERSE ═══
        `overflow-auto` — même sans rien à défiler — établit tout de même un
        ancêtre défilant : le collant s'y accrocherait, à un cadre qui ne défile
        jamais lui-même (sa hauteur épouse son contenu). `overflow-visible`
        laisse le collant traverser jusqu'à la page, qui, elle, défile
        réellement.
      */}
      {/*
        ⚠️ CACHÉE, PAS DÉMONTÉE : `hidden` (display:none) suffit, la table
        n'a ni requête ni état à préserver entre les deux formes — la démonter
        ferait juste perdre le confort de l'inspecter dans les deux tailles à
        la fois pendant le développement, pour aucun gain réel.
      */}
      <div className={rupture?.table}>
      <Table
        wrapperClassName={pleinePage || collant ? 'overflow-visible' : 'min-h-0 flex-1'}
        className={pleinePage ? 'table-fixed' : undefined}
      >
        {pleinePage && colonnes.some((colonne) => colonne.largeur) && (
          // `table-fixed` répartit la largeur d'après CETTE rangée, jamais
          // d'après le contenu : sans elle, un texte long élargirait sa colonne
          // au détriment des autres, colonne « Actions » comprise.
          <colgroup>
            {colonnes.map((colonne) => (
              <col key={colonne.id} className={colonne.largeur} />
            ))}
          </colgroup>
        )}

        {/*
          L'en-tête reste en vue quand le tableau défile. Sans `bg-*`, les
          lignes se peindraient EN TRANSPARENCE dessous ; la couleur vient de
          `TableHeader` (`bg-tableau-tete`), le fond commun à tous les tableaux
          depuis le 2026-08-24 — l'ancien `bg-muted`, chaud, la contredisait.

          ⚠️ `collerSous` REMPLACE `top-0` EN MODE `pleinePage` : la barre de
          navigation de l'espace admin est ELLE-MÊME collante, au-dessus. Sans
          ce décalage, l'en-tête du tableau se logerait DERRIÈRE elle au lieu de
          juste en dessous.
        */}
        {/*
          ⚠️ `collant` REMONTE SOUVENT AU-DESSUS DE ZÉRO (une valeur NÉGATIVE) :
          le conteneur défilant d'une page porte une marge intérieure, et Chrome
          accroche l'élément au bord du CONTENU, pas de la zone visible — sans ce
          décalage, l'en-tête s'immobilise une marge trop bas et les premières
          lignes défilent dans la bande ainsi laissée. Piège déjà payé sur la
          grille d'emploi du temps.
        */}
        <TableHeader
          className={cn('sticky z-10', !pleinePage && !collant && 'top-0')}
          style={pleinePage ? { top: collerSous } : collant ? { top: collant } : undefined}
        >
          <TableRow className="hover:bg-transparent">
            {colonnes.map((colonne) => (
              <TableHead
                key={colonne.id}
                onClick={() => basculer(colonne)}
                title={colonne.tri ? 'Trier sur cette colonne' : undefined}
                className={cn(
                  colonne.enroule ? 'min-w-[12rem]' : 'whitespace-nowrap',
                  colonne.aligne === 'droite' && 'text-right',
                  colonne.aligne === 'centre' && 'text-center',
                  colonne.tri && 'cursor-pointer select-none hover:text-foreground'
                )}
              >
                <span
                  className={cn(
                    'inline-flex items-center gap-1',
                    colonne.aligne === 'droite' && 'flex-row-reverse'
                  )}
                >
                  {colonne.entete}
                  {tri?.id === colonne.id &&
                    (tri.sens === 'desc' ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronUp className="h-3 w-3" />
                    ))}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {triees.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={colonnes.length}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                {vide}
              </TableCell>
            </TableRow>
          ) : (
            triees.map((ligne) => (
              <TableRow key={cleLigne(ligne)}>
                {colonnes.map((colonne) => (
                  <TableCell
                    key={colonne.id}
                    className={cn(
                      // ⚠️ `table-fixed` borne DÉJÀ la largeur : `min-w`/
                      // `whitespace-nowrap` couperaient le contenu au lieu de le
                      // laisser passer à la ligne dans sa colonne.
                      !pleinePage && (colonne.enroule ? 'min-w-[12rem]' : 'whitespace-nowrap'),
                      colonne.aligne === 'droite' && 'text-right',
                      colonne.aligne === 'centre' && 'text-center'
                    )}
                  >
                    {colonne.rendu(ligne)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>

        {pied && triees.length > 0 && (
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              {colonnes.map((colonne) => (
                <TableCell
                  key={colonne.id}
                  className={cn(
                    'font-medium',
                    !pleinePage && (colonne.enroule ? 'min-w-[12rem]' : 'whitespace-nowrap'),
                    colonne.aligne === 'droite' && 'text-right',
                    colonne.aligne === 'centre' && 'text-center'
                  )}
                >
                  {pied[colonne.id] ?? ''}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </Table>
      </div>

      {/*
        ═══ LA FORME « CARTES » ═══ Une carte par ligne, ses champs empilés avec
        leur étiquette au lieu d'être alignés en colonnes — c'est ce qui reste
        lisible quand une grille de 4 à 8 colonnes ne tient plus. Rendue dès
        qu'un seuil est demandé, la classe `…:hidden` décidant seule de la
        montrer.
      */}
      {rupture && (
        <div className={cn('space-y-3 p-3', rupture.cartes)}>
          {triees.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{vide}</p>
          ) : (
            triees.map((ligne) => (
              <CarteLigne key={cleLigne(ligne)} colonnes={colonnes} ligne={ligne} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Une ligne de tableau, en carte : chaque colonne y devient un champ
 * ÉTIQUETÉ, empilé — sauf la colonne SANS étiquette (`entete: ''`, la colonne
 * d'actions dans les quatre tableaux de l'administration), qui passe en pied
 * de carte, séparée par un filet, sans répéter un intitulé vide.
 *
 * ⚠️ AUCUNE HEURISTIQUE PAR `id` : se caler sur `entete === ''` — un signal
 * que les QUATRE tableaux posent déjà pour la même raison (une colonne
 * d'actions n'a rien à titrer) — évite d'avoir à reconnaître une colonne
 * « spéciale » par son nom, qui diffère d'un tableau à l'autre (`actions`
 * partout ici, mais rien ne le garantit pour un futur tableau).
 */
function CarteLigne({ colonnes, ligne }) {
  const champs = colonnes.filter((colonne) => colonne.entete !== '');
  const actions = colonnes.filter((colonne) => colonne.entete === '');

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {champs.map((colonne) => (
        <div key={colonne.id}>
          <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            {colonne.entete}
          </div>
          <div className="mt-0.5">{colonne.rendu(ligne)}</div>
        </div>
      ))}

      {actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-1 border-t pt-3">
          {actions.map((colonne) => (
            <div key={colonne.id}>{colonne.rendu(ligne)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function trier(lignes, colonnes, tri) {
  if (!tri) return lignes;

  const colonne = colonnes.find((c) => c.id === tri.id);
  if (!colonne?.tri) return lignes;

  const sens = tri.sens === 'desc' ? -1 : 1;

  return [...lignes].sort((a, b) => {
    const va = colonne.tri(a);
    const vb = colonne.tri(b);
    const comparaison =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'fr', { numeric: true });
    return comparaison * sens;
  });
}
