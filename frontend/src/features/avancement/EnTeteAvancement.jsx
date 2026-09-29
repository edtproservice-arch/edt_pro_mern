import { useState } from 'react';
import { PanelRightClose, PanelRightOpen, Presentation } from 'lucide-react';
import { taux } from 'shared/domain';
import Teams from '@/components/icons/Teams';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import { basculerPanneauEtablissement, usePanneauEtablissement } from '@/lib/panneauTaux';
import AnneauTaux from './AnneauTaux';
import GrapheProgression, {
  COULEURS_PROGRESSION as COULEURS,
  COULEUR_VACANCES,
} from './GrapheProgression';
import AchevementModules from './AchevementModules';

/** Référence stable : évite de refaire les calculs d'`AchevementModules` à chaque rendu. */
const VIDE = [];

/**
 * L'en-tête de la page : le taux global, son détail, et la progression de
 * l'ÉTABLISSEMENT face au rythme régional, semaine par semaine.
 * ← `#regional-progress-rate` d'avancement.html, qui n'affichait qu'un chiffre
 *
 * ═══ ⚠️ UN SEUL BLOC, PAS DEUX (correction du porteur, 2026-08-31) ═══
 * Le bandeau et le graphe disaient la MÊME chose — le taux d'avancement — dans
 * deux cadres empilés qui prenaient ensemble le tiers de l'écran avant la
 * première donnée détaillée. Les chiffres du bandeau rejoignent donc le graphe :
 * ils LE LÉGENDENT, puisque c'est sa courbe qu'ils résument.
 *
 * ═══ ⚠️ LE TAUX RÉGIONAL SE COMPARE AU TAUX GLOBAL ═══ (correction du porteur,
 * 2026-08-31.) C'est UN nombre pour tout l'établissement : le confronter à
 * chaque module, formateur ou groupe donnait une nappe plate sous cinquante-
 * quatre pics, ce qui n'apprenait rien — ma première version le faisait, dans un
 * onglet séparé désormais retiré.
 *
 * ═══ CE QUE LA COURBE APPORTE, ET QUE LE CHIFFRE NE DIT PAS ═══
 * « 4,1 % » ne dit pas si l'établissement rattrape ou décroche. Posée à côté du
 * rythme régional, qui monte d'une semaine active à l'autre, la progression
 * réelle montre l'écart SE CREUSER ou SE RÉSORBER. C'est la seule lecture qui
 * distingue un retard de début d'année d'un retard qui s'installe.
 *
 * ⚠️ ELLE N'EST PAS FILTRÉE : c'est la progression de tout l'ÉTABLISSEMENT. Le
 * rythme régional ne connaît ni filière ni formateur — le comparer à une
 * sélection confronterait deux périmètres différents.
 *
 * ⚠️ CE POINT N'EST PLUS ÉCRIT À L'ÉCRAN (décision du porteur, 2026-08-31 : les
 * deux phrases de sous-titre sont retirées). Ce qui le rend lisible malgré tout :
 * sous filtre, les chiffres de la sélection s'affichent SOUS la courbe et portent
 * la mention « Sélection : », qui les distingue d'elle.
 */

export default function EnTeteAvancement({
  total,
  /*
   * ⚠️ LE TOTAL DE TOUT L'ÉTABLISSEMENT, filtres ignorés (2026-09-17, demande du
   * porteur) : le panneau à droite du graphe résume la COURBE, qui ne se filtre
   * jamais. Y montrer la sélection (un groupe) ferait lire le taux d'une
   * promotion sous le nom de l'établissement.
   */
  totalEtablissement = total,
  face,
  progression,
  regional,
  semaineCourante = null,
  filtre = false,
  /*
   * ⚠️ LES CHIFFRES SONT AILLEURS (demande du porteur, 2026-09-01) : en vue
   * GRAPHIQUE, l'anneau et ses mesures vivent à DROITE du graphe à bâtons. Le
   * bloc de tête ne les rend alors pas — deux exemplaires du même taux à
   * quelques centimètres n'apprendraient rien et prendraient deux étages.
   */
  chiffresAilleurs = false,
  lignesAchevement = VIDE,
  intitules,
  anneeScolaire,
  dateObservee = null,
}) {
  if (!total) return null;

  /*
   * ═══ ⚠️ LA COURBE SE LIT TOUJOURS DANS LES SÉANCES POSÉES ═══ (correction du
   * porteur, 2026-08-31 : « le graphe ne s'affiche pas en mode e-note ».)
   *
   * Je l'avais conditionnée à la face eDTpro, au motif qu'un fichier e-note ne
   * porte qu'un état DÉCLARÉ à la date de son import, sans historique
   * hebdomadaire. Le raisonnement était juste sur la SOURCE, faux sur la
   * conclusion : la progression ne CHANGE pas de source avec la bascule — elle
   * vient des séances, un point c'est tout. La masquer privait la face e-note
   * d'une lecture qui lui reste parfaitement valable, et le rythme régional avec.
   *
   * ⚠️ SUR LA FACE E-NOTE, LA COURBE N'EST DONC PAS LE DÉCLARATIF — elle reste
   * celle des séances posées. La phrase qui le disait a été retirée avec le
   * sous-titre ; l'anneau des chiffres déclarés étant lui aussi masqué par
   * défaut, les deux ne se contredisent plus à l'écran.
   */
  const avecCourbe = Boolean(regional) && Boolean(progression?.length);

  const dernier = avecCourbe
    ? [...progression].reverse().find((point) => point.regional !== null)
    : null;

  /* La légende ne nomme la bande que si la courbe en montre une. */
  const aDesVacances = avecCourbe && progression.some((point) => point.vacances);

  /*
   * ═══ ⚠️ LA SEMAINE EN COURS VIENT DU SERVEUR ═══ (correction du porteur,
   * 2026-09-01.) On la cherchait en repérant le point dont le rythme régional
   * vaut celui d'aujourd'hui — or ce rythme NE MONTE PAS pendant les vacances :
   * plusieurs semaines partagent la même valeur, et `find` rendait la PREMIÈRE.
   * Une semaine de vacances en cours s'annonçait donc sous le nom de la semaine
   * précédente. Le serveur connaît la date ; il répond `semaineCourante`.
   */
  const courante = avecCourbe
    ? progression.find((point) => point.numero === semaineCourante)
    : null;

  const atteint = courante?.avancement ?? 0;
  /*
   * ⚠️ `regional` PEUT ÊTRE NUL — sur la face e-note, ou si le calendrier ne
   * permet pas le calcul. Le lire sans garde ferait planter le bloc entier, y
   * compris les chiffres qui, eux, sont toujours disponibles.
   */
  const attendu = regional?.taux ?? 0;
  const ecart = avecCourbe ? Math.round((atteint - attendu) * 10) / 10 : 0;

  /*
   * ═══ ⚠️ LES CHIFFRES SE MASQUENT QUAND ILS RÉPÈTENT LA COURBE ═══ (demande du
   * porteur, 2026-08-31.) Sans filtre, l'anneau dit exactement où la courbe
   * orange finit : deux fois la même chose, sur deux étages. Ils restent
   * accessibles dans le panneau de l'établissement, à droite du graphe.
   *
   * ⚠️ AVEC UN FILTRE, ILS NE RÉPÈTENT PLUS RIEN : ils décrivent la SÉLECTION,
   * quand la courbe reste celle de tout l'établissement. C'est même la
   * comparaison qu'on vient chercher — « ma promotion fait 4,1 %, l'établissement
   * suit cette courbe » — d'où leur retour à l'écran.
   *
   * ⚠️ ET SANS AUCUNE COURBE, ILS S'AFFICHENT TOUJOURS : les masquer laisserait
   * un cadre vide, et le taux global est le premier chiffre de l'écran.
   *
   * ═══ ⚠️ LA MÊME RÈGLE SUR LES DEUX FACES ═══ (décision du porteur,
   * 2026-08-31, qui revient sur l'exception que j'avais posée pour e-note.)
   * Un seul comportement à retenir plutôt qu'un par face.
   * ⚠️ CONSÉQUENCE ASSUMÉE : sur la face e-note, l'état DÉCLARÉ — ce que cette
   * face apporte de propre — n'est plus à l'écran par défaut. Il ne revient que
   * dès qu'un filtre est posé.
   */
  const chiffresVisibles = chiffresAAfficher({ filtre, avecCourbe }) && !chiffresAilleurs;
  const chiffresEnTete = !avecCourbe;

  /* ⚠️ SA PROPRE PRÉFÉRENCE DE POSTE, INDÉPENDANTE de celle du graphe à
     bâtons (correction du porteur, 2026-09-25) : replier ce panneau-ci ne doit
     pas replier l'autre, sur un écran qu'on ne regarde pas forcément. */
  const panneauEtablissement = usePanneauEtablissement();

  return (
    /*
     * ⚠️ `lg:items-stretch` (correction du porteur, 2026-09-25 : « augmenter le
     * height du card […] pour aligner avec le card du taux ») — c'est la valeur
     * PAR DÉFAUT de flexbox, explicitée ici parce que ce fichier utilisait
     * `items-start` avant : les deux cartes gardaient alors leur hauteur
     * NATURELLE, et celle du graphe, plus courte, laissait un vide sous la
     * carte de l'établissement plutôt que de s'aligner sur son bas.
     */
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      <section className="min-w-0 flex-1 rounded-lg border p-4">
        {/*
          ⚠️ EN TÊTE SEULEMENT S'IL N'Y A PAS DE COURBE : il n'y a alors rien
          au-dessus de quoi les poser. Dès qu'une courbe existe, ils passent en
          DESSOUS — la lecture d'ensemble vient d'abord, le détail chiffré la
          commente.
        */}
        {chiffresVisibles && chiffresEnTete && <Chiffres total={total} face={face} filtre={filtre} />}

        {!avecCourbe && regional && (
          /*
            ⚠️ LE RYTHME RÉGIONAL RESTE ÉCRIT MÊME SANS COURBE : un taux de 0,6 %
            ne veut rien dire tant qu'on ne sait pas ce que la région attend à
            cette date. Sans cette ligne, la face e-note perdrait l'information.
          */
          <p className="mt-3 border-t pt-3 text-xs">
            <span className="text-muted-foreground">Rythme régional attendu : </span>
            <span className="font-medium text-foreground">{nombre(regional.taux)} %</span>
            <span className="text-muted-foreground">
              {' '}
              — {regional.passees} semaine(s) active(s) sur {regional.total}, de la S1 à la S39.
            </span>
          </p>
        )}

        {avecCourbe && (
          <>
            <div
              className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1${
                chiffresVisibles && chiffresEnTete ? ' mt-3 border-t pt-3' : ''
              }`}
            >
              <h2 className="text-sm font-medium">Semaine par semaine, face au rythme régional</h2>
              {/*
                ⚠️ L'ÉCART EST ÉCRIT, PAS SEULEMENT DESSINÉ. C'est la seule question
                qu'on pose à ce graphe — « sommes-nous en avance ou en retard ? » — et
                la lire sur deux nappes qui se frôlent demande de viser à l'œil.
              */}
              <p className="text-xs">
                {/*
                  ⚠️ « À LA {SEMAINE} », PAS « AUJOURD'HUI ». Ce chiffre cumule les
                  heures posées JUSQU'À CETTE SEMAINE ; celui du bandeau compte TOUT
                  ce qui est posé, semaines à venir comprises. Les deux sont justes
                  et diffèrent — les nommer pareil ferait chercher une erreur de
                  calcul.
                */}
                <span className="text-muted-foreground">
                  À la {courante?.libelle ?? 'semaine en cours'} :{' '}
                </span>
                <span className="font-medium tabular-nums">{nombre(atteint)} %</span>
                <span className="text-muted-foreground"> contre {nombre(attendu)} % attendus — </span>
                <span className={ecart >= 0 ? 'font-medium text-success' : 'font-medium text-destructive'}>
                  {ecart >= 0 ? `+${nombre(ecart)}` : nombre(ecart)} point(s)
                </span>
              </p>
            </div>

            {/*
              ⚠️ LE TRACÉ VIT DANS `GrapheProgression`, PARTAGÉ AVEC L'ACCUEIL : c'est
              le MÊME graphe, cadré autrement — l'année entière ici, une fenêtre autour
              de la semaine en cours là-bas. Deux copies auraient divergé au premier
              ajustement de couleur ou de règle.

              ⚠️ `hauteur={260}`, PAS LE DÉFAUT (demande du porteur, 2026-09-25 :
              la carte s'est agrandie pour s'aligner sur celle de l'établissement,
              et cet espace en plus doit revenir au TRACÉ, pas rester un vide sous
              la ligne « module(s) achevé(s) »). Un défaut passé ici seul, sans
              toucher `GrapheProgression` : la vue ZOOMÉE de l'accueil, qui ne
              passe pas ce prop, garde sa hauteur habituelle.
            */}
            <div className="mt-2">
              <GrapheProgression progression={progression} courante={courante} hauteur={260} />
            </div>

            {/* La légende sous le graphe, comme le modèle. */}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs">
              <Repere couleur={COULEURS.avancement} libelle="Avancement de l’établissement" />
              <Repere couleur={COULEURS.regional} libelle="Rythme régional attendu" />
              {/*
                ⚠️ LA BANDE SE NOMME, sinon elle passe pour un artefact du tracé. Elle
                n'apparaît que si la fenêtre en contient une — annoncer des vacances
                qu'on ne voit nulle part ferait chercher ce qui manque.
              */}
              {aDesVacances && <Repere couleur={COULEUR_VACANCES} libelle="Vacances" />}
              {dernier && (
                <span className="text-muted-foreground">
                  Année régionale : S1 à S{dernier.numero}
                </span>
              )}
            </div>

            {chiffresVisibles && !chiffresEnTete && (
              <div className="mt-3 border-t pt-3">
                <Chiffres total={total} face={face} filtre={filtre} />
              </div>
            )}

            {/*
              ⚠️ L'ACHÈVEMENT EST UNE AUTRE QUESTION QUE LE TAUX : « combien
              d'heures sont faites » et « combien de modules sont TERMINÉS » ne se
              déduisent pas l'un de l'autre — un établissement à 60 % peut n'avoir
              achevé aucun module. D'où sa propre ligne, sous la courbe.
            */}
            <AchevementModules
              lignes={lignesAchevement}
              intitules={intitules}
              anneeScolaire={anneeScolaire}
              dateObservee={dateObservee}
              face={face}
            />
          </>
        )}
      </section>

      {/*
        ═══ ⚠️ UNE CARTE EXTERNE, PAS DANS CELLE DU GRAPHE (demande du porteur,
        2026-09-25 : « la card je veux qu'il être en externe du card Semaine par
        semaine, face au rythme régional ») ═══ Posé DANS la section du graphe,
        le panneau semblait un détail de celui-ci ; en carte à part — comme le
        panneau du graphe à bâtons, qui n'est pas non plus dans le cadre de son
        graphe — il se lit comme une donnée de RANG ÉGAL, pas un sous-élément.
        Les deux cartes s'ALIGNENT en hauteur via `lg:items-stretch` sur leur
        parent, ci-dessus — en dessous de `lg`, elles sont empilées et chacune
        garde sa hauteur naturelle.

        ⚠️ REPLIÉE, ELLE PERD AUSSI SON CADRE (demande du porteur, 2026-09-25 :
        « si je masque le taux, les bordures du card doivent aussi être
        masquées ») : un rectangle bordé autour du seul bouton de bascule
        dessinait une carte vide, alors qu'il ne reste plus rien à y montrer.
      */}
      {avecCourbe && (
        <aside
          className={cn(
            'w-full shrink-0',
            panneauEtablissement ? 'rounded-lg border p-3 lg:w-72' : 'p-2 lg:w-12'
          )}
        >
          <div
            className={cn(
              'flex items-center gap-2',
              panneauEtablissement ? 'mb-2 justify-between' : 'justify-center'
            )}
          >
            {panneauEtablissement && <span className="text-xs font-medium">Établissement</span>}
            <BasculePanneau ouvert={panneauEtablissement} />
          </div>

          {panneauEtablissement && (
            <Chiffres total={totalEtablissement} face={face} disposition="colonne" />
          )}
        </aside>
      )}
    </div>
  );
}

/** « 25 / 922 h » — le réalisé sur le prévu, pour un type de séance. */
function Mesure({ icone, libelle, realise, prevu }) {
  return (
    <span className="flex items-center gap-2">
      {icone}
      <span className="text-xs text-muted-foreground">{libelle}</span>
      <span className="font-medium tabular-nums">
        {nombre(realise)} <span className="text-muted-foreground">/ {nombre(prevu)} h</span>
      </span>
    </span>
  );
}

function Repere({ couleur, libelle }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="block size-3 rounded-sm" style={{ background: couleur }} />
      <span>{libelle}</span>
    </span>
  );
}

/**
 * Replier ou déplier le panneau de l'établissement, à droite de CE graphe —
 * sa propre préférence, indépendante de celle du graphe à bâtons.
 *
 * ⚠️ COPIÉE DE `PageAvancement`, PAS IMPORTÉE : ce fichier est importé PAR
 * `PageAvancement`, l'importer en retour créerait une dépendance circulaire.
 * Le composant est trivial ; deux copies d'un bouton de deux lignes ne
 * divergeront pas comme diverge un calcul.
 *
 * ⚠️ L'ICÔNE DIT CE QU'UN CLIC PRODUIT, jamais l'état courant — la règle déjà
 * posée pour l'épingle de la barre latérale et le panneau du graphe à bâtons.
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
      onClick={basculerPanneauEtablissement}
    >
      <Icone className="size-3.5" />
      <span className="sr-only">{ouvert ? 'Masquer le taux' : 'Afficher le taux'}</span>
    </Button>
  );
}

/**
 * Le taux global et son détail — anneau, présentiel, distanciel, modules.
 *
 * ⚠️ UN SEUL COMPOSANT POUR TOUS LES EMPLACEMENTS : le bloc de tête, le panneau
 * à droite de CE graphe, et celui à droite du graphe à bâtons. Des versions
 * séparées auraient divergé au premier ajustement — c'est la cause n°1
 * d'instabilité du §4.2, appliquée à un bloc de chiffres.
 */
/**
 * Les chiffres s'affichent-ils à l'écran ?
 *
 * ⚠️ EXPORTÉE : la page en a besoin pour décider si le panneau latéral du graphe
 * a quelque chose à montrer. Recopier la condition là-bas l'aurait fait diverger
 * de celle-ci au premier ajustement (§4.2).
 */
export const chiffresAAfficher = ({ filtre, avecCourbe }) => filtre || !avecCourbe;

/**
 * Les trois mesures que l'anneau peut afficher, et leur couleur — la même
 * palette que `GrapheAvancement` pour le présentiel et le distanciel, afin
 * qu'un mode se lise de la même teinte d'un graphe à l'autre.
 */
const MODES_ANNEAU = [
  { cle: 'total', libelle: 'Total', couleur: 'hsl(var(--accent-orange))' },
  { cle: 'distanciel', libelle: 'Distanciel', couleur: 'hsl(var(--accent-purple-mid))' },
  { cle: 'presentiel', libelle: 'Présentiel', couleur: 'hsl(var(--accent-green))' },
];

/**
 * La bascule Total / Distanciel / Présentiel au-dessus de l'anneau.
 *
 * ═══ ⚠️ UN SEUL ANNEAU, TROIS MESURES (demande du porteur, 2026-09-25 : « je
 * n'aime pas [le demi-cercle empilé qui les montrait toutes les trois à la
 * fois], utilise Radial Chart - Shape [...] avec un bouton groupe bascule
 * total, distanciel, présentiel ») ═══
 * Les essais précédents cherchaient à montrer les trois chiffres EN MÊME
 * TEMPS sur le même anneau — empilé, ou en pistes concentriques — et aucun ne
 * convenait : soit deux mesures devenaient invisibles, soit le taux global
 * qu'on vient lire en premier se perdait parmi les autres. Le porteur préfère
 * un anneau simple qui n'en montre qu'UNE, et cette bascule pour choisir
 * laquelle.
 */
function BasculeAnneau({ mode, onChange }) {
  return (
    <ButtonGroup>
      {MODES_ANNEAU.map(({ cle, libelle }) => (
        <Button
          key={cle}
          type="button"
          variant={mode === cle ? 'default' : 'outline'}
          size="sm"
          aria-pressed={mode === cle}
          className="h-6 px-2 text-[0.65rem]"
          onClick={() => onChange(cle)}
        >
          {libelle}
        </Button>
      ))}
    </ButtonGroup>
  );
}

/**
 * @param {'large'|'colonne'} [disposition]
 *   `large`   — le bloc de tête : anneau à gauche, mesures en deux colonnes.
 *   `colonne` — le panneau à droite d'un graphe (celui-ci ou le graphe à
 *               bâtons) : anneau AGRANDI et CENTRÉ, les mesures DESSOUS. C'est
 *               la seule des deux qui ait de la hauteur à revendre (456 px), et
 *               l'anneau y est le premier chiffre qu'on vient lire.
 */
export function Chiffres({ total, face, filtre, disposition = 'large' }) {
  /*
   * ⚠️ UN ÉTAT PAR INSTANCE DE `Chiffres` — pas partagé (demande implicite : la
   * bascule du panneau de l'établissement n'a pas à changer ce que montre celle
   * du bloc de tête, qui décrit une sélection différente).
   */
  const [modeAnneau, setModeAnneau] = useState('total');
  const { couleur: couleurAnneau } = MODES_ANNEAU.find((m) => m.cle === modeAnneau);

  const tauxAnneau =
    modeAnneau === 'total'
      ? total.taux
      : modeAnneau === 'presentiel'
        ? taux(total.realisePresentiel, total.prevuPresentiel)
        : taux(total.realiseSynchrone, total.prevuSynchrone);

  const mesures = (
    <>
      <Mesure
        icone={<Presentation className="size-3.5 text-accent-teal" />}
        libelle="En présentiel"
        realise={total.realisePresentiel}
        prevu={total.prevuPresentiel}
      />
      <Mesure
        icone={<Teams className="size-3.5" />}
        libelle="À distance"
        realise={total.realiseSynchrone}
        prevu={total.prevuSynchrone}
      />
    </>
  );

  /*
   * ═══ ⚠️ UNE DISPOSITION COMPACTE POUR LA CARTE ═══ (correction du porteur,
   * 2026-08-31.) Les points de rupture de Tailwind lisent la largeur du
   * VIEWPORT, jamais celle du conteneur : `sm:grid-cols-2` s'appliquait donc
   * aussi dans une carte de 320 px, où deux colonnes plus un `gap-x-8` ne
   * tiennent pas. « En présentiel » se coupait en deux lignes et « 5 / 1 045 h »
   * en trois. En pile, tout tient sur une ligne chacun.
   */
  if (disposition === 'colonne') {
    return (
      <div className="space-y-3">
        <div className="flex flex-col items-center gap-2">
          <BasculeAnneau mode={modeAnneau} onChange={setModeAnneau} />
          <AnneauTaux taux={tauxAnneau} couleur={couleurAnneau} taille="grand" />
          {/* ⚠️ `whitespace-nowrap` ici aussi : c'est la coupure des libellés qui
              rend la colonne illisible, pas leur longueur. */}
          <div className="space-y-1.5 whitespace-nowrap text-sm">{mesures}</div>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">
          {filtre && <span className="font-medium text-foreground">Sélection : </span>}
          {total.modules} module(s) —{' '}
          <span className="font-medium text-foreground">{nombre(total.realise)} h</span> réalisées
          sur {nombre(total.prevu)} h prévues,{' '}
          {face === 'enote' ? 'd’après les heures déclarées' : 'd’après les séances posées'}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex flex-col items-center gap-2">
        <BasculeAnneau mode={modeAnneau} onChange={setModeAnneau} />
        <AnneauTaux taux={tauxAnneau} couleur={couleurAnneau} />
      </div>

      <div className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
        {mesures}
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {/*
            ⚠️ « SÉLECTION » QUAND UN FILTRE EST ACTIF : la courbe juste en
            dessous porte sur TOUT l'établissement, et deux périmètres différents
            à quelques centimètres d'écart se lisent comme une contradiction si
            rien ne les distingue.
          */}
          {filtre && <span className="font-medium text-foreground">Sélection : </span>}
          {total.modules} module(s) —{' '}
          <span className="font-medium text-foreground">{nombre(total.realise)} h</span> réalisées
          sur {nombre(total.prevu)} h prévues,{' '}
          {face === 'enote' ? 'd’après les heures déclarées' : 'd’après les séances posées'}.
        </p>
      </div>
    </div>
  );
}
