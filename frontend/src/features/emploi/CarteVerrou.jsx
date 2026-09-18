import { CalendarClock, CalendarOff, GraduationCap, Briefcase, Lock } from 'lucide-react';
import CarteAuSurvol from '@/components/common/CarteAuSurvol';
import {
  FOND_AVANT_RENTREE,
  FOND_FORMATION,
  FOND_STAGE,
} from '@/components/common/apparenceGrille';
import { cn } from '@/lib/utils';

/**
 * POURQUOI cette case ne s'ouvre pas — au survol.
 * (demande du porteur, 2026-08-26)
 *
 * ═══ ⚠️ LE MOTIF ÉTAIT LU, JAMAIS VU ═══
 * Une case verrouillée portait un `aria-label` — donc rien à l'œil. Les
 * infobulles natives ont été retirées de la grille (2026-08-25 : la bulle noire
 * du système se dépliait à chaque case franchie), et la carte de l'en-tête de
 * jour ne nomme que ce qui vaut pour la COLONNE. Or un stage ferme UNE ligne et
 * une formation UNE personne : sur une grille de dix-sept lignes, rien ne disait
 * laquelle, ni pourquoi.
 *
 * ⚠️ ELLE DIT SURTOUT « JUSQU'À QUAND ». L'intitulé seul (« Stage de fin de
 * première année ») ne dit pas si le groupe revient demain ou dans trois
 * semaines — c'est pourtant la question qu'on se pose avant de chercher où
 * replacer la séance.
 *
 * ═══ ⚠️ AUCUN COMPOSANT RADIX AU REPOS ═══
 * Même contrainte, et même parade, que `CarteModule` : la grille compte 1 224
 * cases, et monter une `HoverCard` dans chacune est exactement ce qui avait figé
 * la page Affectations. Au repos, l'enveloppe n'est qu'un `span` porteur d'un
 * `onMouseEnter` ; la `HoverCard` ne se monte que sur la case survolée, DÉJÀ
 * ouverte, et Radix reprend la main pour la fermer — lui seul sait distinguer
 * « la souris part » de « la souris entre dans la carte ».
 */
export default function CarteVerrou({ absence, occupation, sujet, modeSelection, children }) {
  /*
   * ⚠️ RIEN EN MODE SÉLECTION. Tracer un rectangle balaie des dizaines de cases,
   * et une carte qui se déplie au passage masque la grille qu'on est en train de
   * sélectionner. C'est la règle déjà posée pour la carte de module.
   *
   * ⚠️ L'ENVELOPPE PREND TOUTE LA CASE, contrairement à celle de `CarteModule`.
   * Celle-ci vise les BADGES parce que la case porte par ailleurs un libellé
   * qu'on ne fait que traverser ; ici la case est ÉTEINTE — elle n'a ni valeur à
   * lire ni geste à offrir, et il n'existe aucune autre cible à viser.
   */
  return (
    <CarteAuSurvol
      actif={!modeSelection && Boolean(absence || occupation)}
      contenu={() => <Contenu absence={absence} occupation={occupation} sujet={sujet} />}
    >
      {children}
    </CarteAuSurvol>
  );
}

/** Chaque motif a son icône, sa teinte de grille et son verbe. */
const MOTIFS = {
  stage: {
    icone: Briefcase,
    fond: FOND_STAGE,
    titre: 'Groupe en stage',
    phrase: 'Ce groupe est en entreprise : aucun cours ne peut être posé.',
  },
  formation: {
    icone: GraduationCap,
    fond: FOND_FORMATION,
    titre: 'Formateur en formation',
    phrase: "Ce formateur n'est pas dans l'établissement sur cette période.",
  },
  /*
   * ⚠️ ELLE RÉPOND À « JUSQU'À QUAND ? », comme les deux autres : c'est la
   * question qu'on se pose avant de chercher où poser la séance. Sans la date,
   * la case grise ne dirait que « pas ici ».
   */
  rentree: {
    icone: CalendarClock,
    fond: FOND_AVANT_RENTREE,
    titre: 'Pas encore la rentrée',
    phrase:
      'Les groupes de cette année de formation ne sont pas encore rentrés : aucune séance ne peut être posée avant.',
  },
};

function Contenu({ absence, occupation, sujet }) {
  if (occupation) {
    return (
      <div className="flex gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded bg-muted">
          <Lock className="size-3.5 text-muted-foreground" />
        </span>

        <div className="min-w-0 space-y-1">
          <p className="font-semibold">Créneau déjà pris</p>
          {/*
            ⚠️ ON NOMME LE GROUPE QUI OCCUPE, et on dit qu'il s'agit des MÊMES
            stagiaires : c'est ce que la case seule ne peut pas expliquer. Un
            groupe FQ, une fusion ou un suffixe font qu'un créneau est pris sans
            que la ligne d'en face le montre.
          */}
          <p className="leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">{occupation.par}</span> a cours sur ce
            créneau. {sujet ? <>Ce sont les mêmes stagiaires que {sujet}.</> : null}
          </p>
        </div>
      </div>
    );
  }

  const { icone: Icone, fond, titre, phrase } = MOTIFS[absence.motif] ?? {};

  return (
    <div className="flex gap-2.5">
      {/* La MÊME teinte que la case, pour rattacher la carte à ce qu'elle explique. */}
      <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded', fond)}>
        {Icone ? <Icone className="size-3.5 text-foreground/70" /> : null}
      </span>

      <div className="min-w-0 space-y-1">
        <p className="font-semibold">{titre}</p>

        {absence.libelle ? (
          <p className="leading-snug text-muted-foreground">{absence.libelle}</p>
        ) : null}

        {/*
          ⚠️ LA PÉRIODE EST LE VRAI SUJET : « jusqu'à quand ? » est ce qui décide
          où la séance sera replacée. Elle passe donc en évidence, avec son
          icône, et non noyée dans la phrase d'explication.
        */}
        <p className="flex items-center gap-1.5 font-medium tabular-nums">
          <CalendarOff className="size-3 shrink-0 text-muted-foreground" />
          {periode(absence.debut, absence.fin)}
        </p>

        <p className="leading-snug text-muted-foreground">{phrase}</p>
      </div>
    </div>
  );
}

/**
 * « du 4 au 31 janvier », « du 28 février au 3 mars », « le 14 septembre ».
 *
 * ⚠️ LE MOIS N'EST ÉCRIT QU'UNE FOIS quand les deux bornes le partagent : « du
 * 4 janvier au 31 janvier » se lit deux fois plus lentement pour rien.
 *
 * ⚠️ MIDI dans la date construite : à minuit, un décalage de fuseau ramène la
 * veille — c'est le piège déjà consigné pour les dates de calendrier, stockées
 * en chaînes « AAAA-MM-JJ » précisément pour l'éviter.
 */
function periode(debut, fin) {
  if (!debut || !fin) return 'Période non précisée';
  if (debut === fin) return `Le ${jour(debut, true)}`;

  const memeMois = debut.slice(0, 7) === fin.slice(0, 7);
  return `Du ${jour(debut, !memeMois)} au ${jour(fin, true)}`;
}

function jour(texte, avecMois) {
  const date = new Date(`${texte}T12:00:00`);
  if (Number.isNaN(date.getTime())) return texte;

  return date
    .toLocaleDateString('fr-FR', avecMois ? { day: 'numeric', month: 'long' } : { day: 'numeric' })
    .replace('.', '');
}
