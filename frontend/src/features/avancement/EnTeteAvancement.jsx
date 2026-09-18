import { Presentation } from 'lucide-react';
import Teams from '@/components/icons/Teams';
import CarteAuSurvol from '@/components/common/CarteAuSurvol';
import { nombre } from '@/lib/nombres';
import AnneauTaux from './AnneauTaux';
import GrapheProgression, {
  COULEURS_PROGRESSION as COULEURS,
  COULEUR_VACANCES,
} from './GrapheProgression';
import AchevementModules from './AchevementModules';

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
   * porteur) : la carte au survol de « Avancement de l'établissement » résume la
   * COURBE, qui ne se filtre jamais. Y montrer la sélection (un groupe) faisait
   * lire le taux d'une promotion sous le nom de l'établissement.
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
  completion = null,
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
   * accessibles au survol de leur repère dans la légende.
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
   * face apporte de propre — n'est plus à l'écran par défaut. Il reste à un
   * survol de la légende, et revient dès qu'un filtre est posé.
   */
  const chiffresVisibles = chiffresAAfficher({ filtre, avecCourbe }) && !chiffresAilleurs;
  const chiffresEnTete = !avecCourbe;

  return (
    <section className="rounded-lg border p-4">
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
            heures posées JUSQU'À CETTE SEMAINE ; celui du bandeau compte TOUT ce
            qui est posé, semaines à venir comprises. Les deux sont justes et
            diffèrent — les nommer pareil ferait chercher une erreur de calcul.
          */}
          <span className="text-muted-foreground">À la {courante?.libelle ?? 'semaine en cours'} : </span>
          <span className="font-medium tabular-nums">{nombre(atteint)} %</span>
          <span className="text-muted-foreground"> contre {nombre(attendu)} % attendus — </span>
          <span
            className={
              ecart >= 0 ? 'font-medium text-success' : 'font-medium text-destructive'
            }
          >
            {ecart >= 0 ? `+${nombre(ecart)}` : nombre(ecart)} point(s)
          </span>
        </p>
      </div>

      {/*
        ⚠️ LE TRACÉ VIT DANS `GrapheProgression`, PARTAGÉ AVEC L'ACCUEIL : c'est
        le MÊME graphe, cadré autrement — l'année entière ici, une fenêtre autour
        de la semaine en cours là-bas. Deux copies auraient divergé au premier
        ajustement de couleur ou de règle.
      */}
      <div className="mt-2">
        <GrapheProgression progression={progression} courante={courante} />
      </div>

      {/* La légende sous le graphe, comme le modèle. */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs">
        {/*
          ⚠️ LES CHIFFRES SONT ICI, AU SURVOL DE LEUR PROPRE REPÈRE (demande du
          porteur) : c'est le seul endroit où l'on peut les chercher sans les
          avoir sous les yeux — la légende nomme la courbe qu'ils résument.

          ⚠️ RIEN N'EST MONTÉ AU REPOS : `CarteAuSurvol` ne rend qu'un `span` tant
          qu'on ne survole pas, comme partout ailleurs dans le projet.
        */}
        <CarteAuSurvol
          enveloppe="inline-block"
          /*
            ⚠️ `w-96` ET NON `w-80` : avec `whitespace-nowrap`, une ligne trop
            longue ne se replie plus — elle DÉBORDE. « En présentiel 74 /
            14 115,5 h » demande ~300 px à côté d'un anneau de 72 : dans 320 px
            moins la marge intérieure, le « h » sortait de la carte. Les deux
            réglages vont ensemble, on ne peut pas garder l'un sans l'autre.
          */
          largeur="w-96"
          align="center"
          contenu={() => <Chiffres total={totalEtablissement} face={face} disposition="carte" />}
        >
          <Repere
            couleur={COULEURS.avancement}
            libelle="Avancement de l’établissement"
            /* ⚠️ UN SOULIGNÉ POINTILLÉ : un libellé qui cache un détail doit le
               DIRE. Sans ce signal, la carte reste introuvable pour qui ne
               survole pas la légende par hasard. */
            indice
          />
        </CarteAuSurvol>
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
            completion={completion}
            anneeScolaire={anneeScolaire}
            dateObservee={dateObservee}
            face={face}
          />
        </>
      )}
    </section>
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

function Repere({ couleur, libelle, indice = false }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="block size-3 rounded-sm" style={{ background: couleur }} />
      <span className={indice ? 'underline decoration-dotted underline-offset-2' : undefined}>
        {libelle}
      </span>
    </span>
  );
}

/**
 * Le taux global et son détail — anneau, présentiel, distanciel, modules.
 *
 * ⚠️ UN SEUL COMPOSANT POUR LES DEUX EMPLACEMENTS : à l'écran quand un filtre
 * est actif, et dans la carte au survol de la légende sinon. Deux versions
 * auraient divergé au premier ajustement — c'est la cause n°1 d'instabilité du
 * §4.2, appliquée à un bloc de chiffres.
 */
/**
 * Les chiffres s'affichent-ils à l'écran, ou seulement au survol de la légende ?
 *
 * ⚠️ EXPORTÉE : la page en a besoin pour décider si le panneau latéral du graphe
 * a quelque chose à montrer. Recopier la condition là-bas l'aurait fait diverger
 * de celle-ci au premier ajustement (§4.2).
 */
export const chiffresAAfficher = ({ filtre, avecCourbe }) => filtre || !avecCourbe;

/**
 * @param {'large'|'carte'|'colonne'} [disposition]
 *   `large`   — le bloc de tête : anneau à gauche, mesures en deux colonnes.
 *   `carte`   — la carte au survol de la légende : anneau à gauche, mesures
 *               empilées, tout sur une ligne chacune.
 *   `colonne` — le panneau à droite du graphe : anneau AGRANDI et CENTRÉ, les
 *               mesures DESSOUS. C'est la seule des trois qui ait de la hauteur
 *               à revendre (456 px), et l'anneau y est le premier chiffre qu'on
 *               vient lire.
 */
export function Chiffres({ total, face, filtre, disposition = 'large' }) {
  const compact = disposition === 'carte';
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
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-4">
          <AnneauTaux taux={total.taux} taille="grand" />
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

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-4">
          <AnneauTaux taux={total.taux} />
          {/* ⚠️ `whitespace-nowrap` : c'est la coupure des libellés qui rendait
              la carte illisible, pas leur longueur. */}
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
      <AnneauTaux taux={total.taux} />

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
