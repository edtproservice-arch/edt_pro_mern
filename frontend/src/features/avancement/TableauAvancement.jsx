import { Presentation, Star } from 'lucide-react';
import { niveauAvancement } from 'shared/domain';
import BadgeAvancement from '@/components/common/BadgeAvancement';
import BadgeRegional from '@/components/common/BadgeRegional';
import BadgeSemestre from '@/components/common/BadgeSemestre';
import CarteAuSurvol from '@/components/common/CarteAuSurvol';
import TableauTriable from '@/components/common/TableauTriable';
import Teams from '@/components/icons/Teams';
import { cn } from '@/lib/utils';
import { nombre } from '@/lib/nombres';

/**
 * Un axe d'avancement, en tableau.
 * ← les trois vues « viewByFormateur / viewByGroupe / viewByModule »
 *   d'avancement.html
 *
 * ⚠️ LE PRÉSENTIEL ET LE SYNCHRONE ONT LEURS PROPRES COLONNES. Un taux global
 * ne dit pas si c'est la salle ou la classe à distance qui a pris du retard —
 * or ce ne sont ni les mêmes causes ni les mêmes remèdes. C'est la même
 * séparation que les quotas de la grille et que les colonnes du chronogramme.
 */
export default function TableauAvancement({
  lignes,
  entete,
  axe,
  intitules = {},
  /**
   * ⚠️ `detaille` — LES BADGES DANS LEUR FORME LONGUE : « EFM régional » /
   * « Local » en pastille bordée plutôt que l'étoile seule, et « Semestre 1 » /
   * « Module annuel » plutôt que « 1 » / « A ». (2026-09-05 puis 2026-09-06,
   * demandes du porteur pour « Mon avancement » : « comme celui en programme ».)
   *
   * Les deux formes coexistent À DESSEIN. Chez le DIRECTEUR, ces colonnes
   * portent cinquante-quatre lignes : la forme longue les élargirait pour ne
   * rien apprendre de plus — l'étoile et la lettre y suffisent, sous des
   * en-têtes qui disent déjà « Régional » et « Semestre ». Sur l'écran d'un
   * stagiaire, la liste tient en dix-sept lignes, et ce sont les badges qu'il
   * vient de voir sur « Programme » : deux écrans voisins ne peuvent pas nommer
   * la même chose de deux façons.
   *
   * ⚠️ ET EN MODE CARTES, la forme longue est la SEULE lisible : « Régional :
   * ⭐ » ou « Semestre : A » sous une étiquette ne se comprennent pas.
   *
   * ⚠️ UNE SEULE PROP POUR LES DEUX BADGES, PAS DEUX : elles décrivent le même
   * choix — la version détaillée, pour un tableau court — et deux booléens
   * toujours posés ensemble finissent par ne l'être qu'à moitié.
   */
  detaille = false,
  /**
   * ⚠️ `colonneComplement` — le LIBELLÉ d'une colonne portant l'autre dimension
   * (« Formateur »), ou `null`. (2026-09-06, demande du porteur : « je veux
   * ajouter colonne formateur pour savoir le formateur de chaque module ».)
   *
   * ⚠️ ELLE NE VAUT QUE LÀ OÙ LA DIMENSION N'EST PAS DÉJÀ VENTILÉE : quand le
   * complément est « groupes », `agregerAvancement` ÉCLATE déjà le module par
   * groupe et la colonne « Module » nomme la ventilation — une colonne de plus
   * répéterait ce qui est écrit deux centimètres à gauche. C'est à l'appelant
   * de trancher, puisque c'est lui qui choisit le complément.
   */
  colonneComplement = null,
  /**
   * ⚠️ `collant` ET `cartesSous` VONT ENSEMBLE ICI, et l'appelant doit poser les
   * deux (2026-09-06). Ce tableau porte jusqu'à NEUF colonnes : mesuré, il lui
   * faut ~983 px. Un en-tête collant impose de renoncer au défilement interne
   * (les deux sont incompatibles en CSS) — sous ce seuil, il déborderait donc la
   * PAGE. Le remède est de basculer en cartes plus tôt, d'où `cartesSous`
   * relevé par l'écran qui demande le collant.
   */
  collant = null,
  cartesSous = 'md',
}) {
  const parModule = axe === 'module';

  /*
   * ═══ ⚠️ `TableauTriable`, PAS UN TABLEAU ÉCRIT ICI ═══ (2026-09-05, demande
   * du porteur : « je veux que le tableau soit responsive ».) Il apporte la
   * bascule en CARTES sur écran étroit — la même que « Programme » et que les
   * quatre tableaux de l'administration — et le TRI par colonne, qui manquait à
   * un tableau de cinquante-quatre modules.
   *
   * ⚠️ `cartesSous="md"` : huit colonnes de chiffres ne tiennent pas sur un
   * téléphone, mais tiennent très bien dès 768 px.
   *
   * ⚠️ LE TRI PORTE SUR LA VALEUR, jamais sur le texte affiché : « 90 / 140 »
   * se trierait sinon comme une chaîne, et « 9 h » passerait après « 85 h ».
   */
  const colonnes = [
    {
      id: 'sujet',
      entete,
      tri: (ligne) => ligne.sujet ?? '',
      rendu: (ligne) => (
        <span className="font-medium">
          {/*
            ⚠️ LE CODE NE DIT RIEN, ET LA COLONNE NE TIENT PAS LE NOM.
            « M107 » n'apprend rien, et un intitulé DRIF fait soixante
            caractères — écrit en clair, il pousserait toutes les colonnes de
            chiffres hors de l'écran. La carte au survol le donne à la demande,
            comme celle des modules du chronogramme.

            ⚠️ RIEN N'EST MONTÉ AU REPOS : `CarteAuSurvol` ne rend qu'un `span`
            tant qu'on ne survole pas. Sur cinquante-quatre lignes, monter
            autant de `HoverCard` serait le piège déjà payé sur la page
            Affectations.
          */}
          <CarteAuSurvol
            actif={parModule && Boolean(intitules[ligne.sujet])}
            enveloppe="inline-block"
            largeur="w-72"
            contenu={() => <FicheModule ligne={ligne} intitule={intitules[ligne.sujet]} />}
          >
            {ligne.sujet}
          </CarteAuSurvol>

          {/*
            ⚠️ LA VENTILATION EST NOMMÉE, sans quoi deux lignes « EGQ107 » se
            suivraient sans que rien ne dise ce qui les sépare — on chercherait
            un doublon là où il y a deux promotions.
          */}
          {ligne.ventilation && (
            <span className="ml-2 font-normal text-muted-foreground">{ligne.ventilation}</span>
          )}
        </span>
      ),
    },

    /*
      ═══ LA COLONNE DE L'AUTRE DIMENSION ═══ « qui enseigne ce module ? » est la
      question suivante, immédiatement — et la seule réponse que la ligne ne
      portait pas.

      ⚠️ ELLE LIT `ligne.complements`, que `agregerAvancement` COLLECTE DÉJÀ pour
      les étiquettes du graphe : c'est la même liste, triée par le domaine, et la
      recomposer ici en aurait fait une seconde définition (§4.2). Les DEUX rôles
      du formateur y sont — présentiel et synchrone —, un module co-enseigné
      nomme donc bien ses deux enseignants.
    */
    ...(colonneComplement
      ? [
          {
            id: 'complement',
            entete: colonneComplement,
            tri: (ligne) => (ligne.complements ?? []).join(', '),
            rendu: (ligne) =>
              (ligne.complements ?? []).length > 0 ? (
                <span className="text-muted-foreground">{ligne.complements.join(', ')}</span>
              ) : (
                /* ⚠️ UN TIRET, PAS UNE CASE VIDE : un module sans formateur
                   affecté est un fait à voir, pas une donnée manquante. */
                <span className="text-muted-foreground">—</span>
              ),
          },
        ]
      : []),

    /*
      ═══ ⚠️ LE SEMESTRE ET LE RÉGIONAL ONT LEUR PROPRE COLONNE ═══ (demande du
      porteur.) Empilés sous le code, ils allongeaient chaque ligne d'un
      demi-étage pour deux informations d'un caractère — et un tableau se
      PARCOURT en colonnes : on cherche « quels modules sont en S2 », pas « que
      porte cette ligne-ci ».

      ⚠️ SUR L'AXE MODULE SEULEMENT : un groupe suit des modules des deux
      semestres et porterait toujours « A », un formateur de même. Deux colonnes
      vides sur toute leur hauteur feraient chercher ce qui manque.
    */
    ...(parModule
      ? [
          {
            id: 'semestre',
            entete: 'Semestre',
            aligne: 'centre',
            tri: (ligne) => ligne.semestre ?? '',
            // Le MÊME badge que la grille et le chronogramme : un module ne
            // peut pas changer de couleur selon l'écran — seule sa FORME change,
            // longue là où la place le permet.
            rendu: (ligne) => <BadgeSemestre semestre={ligne.semestre} long={detaille} />,
          },
          {
            id: 'regional',
            entete: 'Régional',
            aligne: 'centre',
            tri: (ligne) => (ligne.estRegional ? 0 : 1),
            rendu: (ligne) =>
              detaille ? (
                <BadgeRegional estRegional={ligne.estRegional} />
              ) : ligne.estRegional ? (
                <Star
                  className="mx-auto size-3 shrink-0 fill-warning text-warning"
                  aria-label="EFM régional"
                />
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
        ]
      : []),

    {
      id: 'presentiel',
      entete: (
        <span className="inline-flex items-center gap-1">
          <Presentation className="size-3 text-accent-teal" />
          Présentiel
        </span>
      ),
      aligne: 'centre',
      // ⚠️ ON TRIE SUR LE PRÉVU, PAS SUR LE RÉALISÉ : « quels modules pèsent le
      // plus » est la question de cette colonne — la PROGRESSION a la sienne,
      // « Taux ». En début d'année, tous les réalisés valent zéro et un tri sur
      // eux ne bougerait rien.
      tri: (ligne) => ligne.prevuPresentiel ?? 0,
      rendu: (ligne) => <Paire realise={ligne.realisePresentiel} prevu={ligne.prevuPresentiel} />,
    },
    {
      id: 'synchrone',
      entete: (
        <span className="inline-flex items-center gap-1">
          <Teams className="size-3" />
          Distanciel
        </span>
      ),
      aligne: 'centre',
      tri: (ligne) => ligne.prevuSynchrone ?? 0,
      rendu: (ligne) => <Paire realise={ligne.realiseSynchrone} prevu={ligne.prevuSynchrone} />,
    },
    {
      id: 'total',
      entete: 'Total',
      aligne: 'centre',
      tri: (ligne) => ligne.prevu ?? 0,
      rendu: (ligne) => (
        <span className="font-medium">
          <Paire realise={ligne.realise} prevu={ligne.prevu} />
        </span>
      ),
    },
    {
      id: 'taux',
      entete: 'Taux',
      aligne: 'centre',
      // ⚠️ `null` (« rien de prévu ») EN DERNIER, jamais confondu avec 0 % :
      // un module sans masse n'est pas un module en retard.
      tri: (ligne) => (ligne.taux === null || ligne.taux === undefined ? -1 : ligne.taux),
      rendu: (ligne) => (
        /*
          Le MÊME badge que la case de la grille et que le chronogramme : un
          module ne peut pas changer de couleur selon l'écran.

          ⚠️ IL PREND UN OBJET `{taux, niveau}`, PAS UN `taux`. Ma première
          version lui passait `taux={…}` : `avancement` valait alors
          `undefined`, le garde de la première ligne rendait `null`, et la
          colonne « Taux » restait VIDE sur les 54 lignes — sans la moindre
          erreur pour le signaler.
        */
        <BadgeAvancement avancement={{ taux: ligne.taux, niveau: niveauDe(ligne.taux) }} />
      ),
    },
    {
      id: 'avancement',
      entete: 'Avancement',
      rendu: (ligne) => <Barre taux={ligne.taux} />,
    },
  ];

  return (
    <TableauTriable
      cartesSous={cartesSous}
      collant={collant}
      vide="Rien à afficher."
      /* ⚠️ `cle`, PAS `sujet` : ventilé par groupe, le même module revient sur
         plusieurs lignes — deux clés React identiques feraient disparaître
         l'une des deux du rendu. */
      cleLigne={(ligne) => ligne.cle}
      colonnes={colonnes}
      lignes={lignes}
    />
  );
}

/**
 * Le nom complet du module et ses masses — la carte au survol de son code.
 *
 * ⚠️ ELLE REPREND LA FORME DE CELLE DU CHRONOGRAMME : un titre, puis le détail
 * chiffré. Ce n'est pas une infobulle native — celles-ci ont été retirées des
 * grilles du projet parce qu'elles se déplient à chaque case franchie, sans
 * délai réglable ni mise en forme.
 */
function FicheModule({ ligne, intitule }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium leading-snug">{intitule}</p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{ligne.sujet}</span>
        {ligne.semestre && <BadgeSemestre semestre={ligne.semestre} />}
        {ligne.estRegional && (
          <span className="inline-flex items-center gap-0.5">
            <Star className="size-2.5 shrink-0 fill-warning text-warning" />
            EFM régional
          </span>
        )}
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">En présentiel</dt>
        <dd className="tabular-nums">
          {nombre(ligne.realisePresentiel)} / {nombre(ligne.prevuPresentiel)} h
        </dd>
        <dt className="text-muted-foreground">À distance</dt>
        <dd className="tabular-nums">
          {nombre(ligne.realiseSynchrone)} / {nombre(ligne.prevuSynchrone)} h
        </dd>
        <dt className="text-muted-foreground">Total</dt>
        <dd className="font-medium tabular-nums">
          {nombre(ligne.realise)} / {nombre(ligne.prevu)} h
          {ligne.taux !== null && ` — ${nombre(ligne.taux)} %`}
        </dd>
      </dl>
    </div>
  );
}

/**
 * « 12,5 / 30 h ».
 *
 * ⚠️ LES DEUX NOMBRES, JAMAIS LE SEUL TAUX. « 40 % » ne dit pas s'il reste
 * trois heures ou trente : c'est le reste à faire qui décide de la semaine à
 * venir.
 */
function Paire({ realise, prevu }) {
  if (!(prevu > 0) && !(realise > 0)) return <span className="text-muted-foreground">—</span>;

  return (
    <span className="tabular-nums">
      {nombre(realise)}
      <span className="text-muted-foreground"> / {nombre(prevu)}</span>
    </span>
  );
}

/**
 * ⚠️ LA BARRE EST BORNÉE À 100 %, le badge ne l'est pas : un dépassement reste
 * écrit en chiffres — c'est une information — mais une barre qui déborde de sa
 * piste se lit comme un défaut d'affichage.
 */
function Barre({ taux }) {
  if (taux === null) return <span className="text-xs text-muted-foreground">rien de prévu</span>;

  const part = Math.min(Math.max(taux, 0), 100);
  return (
    /* ⚠️ LA LARGEUR EST SUR LA BARRE, plus sur la cellule (`w-40`) : une colonne
       de `TableauTriable` ne porte pas de classe propre, et une barre sans
       largeur intrinsèque s'effondrerait à zéro. `max-w-full` la laisse
       rétrécir en mode cartes, où elle occupe toute la largeur. */
    <span className="block h-2 w-40 max-w-full overflow-hidden rounded-full bg-muted">
      <span
        className={cn('block h-full rounded-full transition-[width] duration-500', couleur(taux))}
        style={{ width: `${part}%` }}
      />
    </span>
  );
}

/**
 * ⚠️ LA BARRE ET LE BADGE INTERROGENT LA MÊME RÈGLE. Mes seuils étaient écrits
 * en clair (`>= 100`, `>= 50`) sous un commentaire affirmant qu'ils suivaient
 * ceux du badge : ils les recopiaient. `niveauAvancement` porte la règle une
 * seule fois, et un ajustement ne peut plus laisser la barre verte à côté d'un
 * badge orange.
 */
const niveauDe = (taux) => (taux === null || taux === undefined ? null : niveauAvancement(taux));

const FONDS = { haut: 'bg-success', moyen: 'bg-accent-orange', bas: 'bg-destructive' };
const couleur = (taux) => FONDS[niveauDe(taux)] ?? FONDS.bas;
