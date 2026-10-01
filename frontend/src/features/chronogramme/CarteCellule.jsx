import { Briefcase, CalendarClock, GraduationCap, Gauge, Palmtree } from 'lucide-react';
import { PLAFOND_CELLULE, plafondSemaine } from 'shared/domain';
import CarteAuSurvol from '@/components/common/CarteAuSurvol';
import {
  FOND_AVANT_RENTREE,
  FOND_FORMATION,
  FOND_STAGE,
} from '@/components/common/apparenceGrille';
import { cn } from '@/lib/utils';

/**
 * POURQUOI cette cellule refuse la saisie, ou ce qu'elle peut encore recevoir.
 * (demande du porteur, 2026-08-26)
 *
 * ═══ ⚠️ ELLE REMPLACE UN `title` NATIF ═══
 * `motifVerrou` posait une infobulle du système : une bulle noire qui se
 * déplie à chaque case franchie, avec un délai qu'on ne règle pas, et qui ne
 * peut porter ni couleur ni mise en forme. C'est le même défaut qui avait fait
 * retirer les infobulles de la grille d'emploi le 2026-08-25.
 *
 * ═══ ⚠️ ELLE S'OUVRE AUSSI SUR UNE SEMAINE SEULEMENT AMPUTÉE ═══
 * Depuis que stages et formations se comptent en JOURS, une semaine peut rester
 * ouverte avec un plafond réduit. Rien à l'écran ne dirait pourquoi « 20 h » y
 * est refusé : la carte le dit, et donne le plafond exact.
 */
export default function CarteCellule({ semaine, complet, cellule, children }) {
  const motif = motifDeLaCellule(semaine, complet, cellule);

  return (
    <CarteAuSurvol
      actif={Boolean(motif)}
      enveloppe="block"
      largeur="w-60"
      contenu={() => <Contenu semaine={semaine} motif={motif} />}
    >
      {children}
    </CarteAuSurvol>
  );
}

/**
 * Ce qu'il y a à expliquer sur cette cellule — rien, le plus souvent.
 *
 * ⚠️ L'ORDRE SUIT LA PORTÉE, comme partout ailleurs : ce qui ferme
 * l'établissement l'emporte sur ce qui ferme un groupe, qui l'emporte sur ce qui
 * retient une personne, et la masse horaire vient en dernier — c'est la seule
 * cause qui ne vienne pas du calendrier.
 */
function motifDeLaCellule(semaine, complet, cellule) {
  if (semaine.motif) return semaine.motif;
  if (complet && !cellule) return 'masse';

  /*
   * ═══ ⚠️ RIEN SUR UNE SEMAINE SEULEMENT AMPUTÉE ═══
   * (2026-08-26, correction du porteur : « annule la hover card car elle
   * dérange ».) Ces semaines restent SAISISSABLES : une carte qui s'y déplie
   * pendant qu'on parcourt la grille masque les colonnes voisines pour une
   * information qu'on n'a pas demandée. Elle est remplacée par les BADGES de
   * l'en-tête — « 3 JSTG », « 1 JF » — qui disent la même chose en permanence,
   * sans rien recouvrir.
   *
   * La carte ne subsiste donc que là où la cellule REFUSE la saisie : c'est le
   * seul cas où l'écran doit se justifier.
   */
  return null;
}

const MOTIFS = {
  vacances: {
    icone: Palmtree,
    fond: 'bg-primary/10',
    titre: 'Vacances scolaires',
    phrase: 'L’établissement est fermé : aucune heure ne peut être planifiée.',
  },
  /*
   * ⚠️ LA PHRASE NE PEUT PAS PORTER LA DATE : elle est écrite une fois pour
   * tous les motifs. La date de reprise part donc dans `Retraits`, avec le
   * décompte de jours — c'est le seul endroit qui connaisse la semaine.
   */
  rentree: {
    icone: CalendarClock,
    fond: FOND_AVANT_RENTREE,
    titre: 'Pas encore la rentrée',
    phrase: 'Les stagiaires de cette année de formation ne sont pas encore là.',
  },
  stage: {
    icone: Briefcase,
    fond: FOND_STAGE,
    titre: 'Groupe en stage toute la semaine',
    phrase: 'Le groupe est en entreprise les six jours : rien à planifier ici.',
  },
  formation: {
    icone: GraduationCap,
    fond: FOND_FORMATION,
    titre: 'Formateur en formation toute la semaine',
    phrase: 'La personne est absente les six jours.',
  },
  masse: {
    icone: Gauge,
    fond: 'bg-muted',
    titre: 'Masse horaire atteinte',
    phrase: 'Tout est posé pour ce module : retirez des heures ailleurs pour en poser ici.',
  },
};

function Contenu({ semaine, motif }) {
  const { icone: Icone, fond, titre, phrase } = MOTIFS[motif] ?? {};
  const plafond = plafondSemaine(semaine);
  const jours = semaine.joursDisponibles ?? 0;

  return (
    <div className="flex gap-2.5">
      {/* La MÊME teinte que la cellule, pour rattacher la carte à ce qu'elle explique. */}
      <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded', fond)}>
        {Icone ? <Icone className="size-3.5 text-foreground/70" /> : null}
      </span>

      <div className="min-w-0 space-y-1">
        <p className="font-semibold">{titre}</p>

        {/*
          ⚠️ LE PLAFOND EST LE VRAI SUJET d'une semaine amputée. « 20 h refusé »
          sans le nombre de jours restants se lit comme un défaut du logiciel ;
          avec, c'est une contrainte du calendrier qu'on comprend d'un regard.
        */}
        {semaine.disponible && (
          <>
            <p className="tabular-nums">
              <span className="font-medium">{jours} jour(s)</span> ouvré(s) —{' '}
              <span className="font-medium">{plafond} h</span> au plus dans cette cellule
            </p>
            {plafond < PLAFOND_CELLULE && (
              <p className="leading-snug text-muted-foreground">
                Une journée porte quatre créneaux de 2,5 h.
              </p>
            )}
          </>
        )}

        {phrase ? <p className="leading-snug text-muted-foreground">{phrase}</p> : null}

        {/* Ce qui a été retiré, et par quoi — la cellule seule ne le dit pas. */}
        <Retraits semaine={semaine} />
      </div>
    </div>
  );
}

function Retraits({ semaine }) {
  const lignes = [];
  if ((semaine.joursRentree ?? 0) > 0) {
    lignes.push(
      semaine.rentree
        ? `${semaine.joursRentree} jour(s) avant la rentrée du ${semaine.rentree}`
        : `${semaine.joursRentree} jour(s) avant la rentrée`
    );
  }
  if ((semaine.joursStage ?? 0) > 0) lignes.push(`${semaine.joursStage} jour(s) de stage`);
  if ((semaine.joursFormation ?? 0) > 0) {
    lignes.push(`${semaine.joursFormation} jour(s) de formation`);
  }
  for (const ferie of semaine.feries ?? []) {
    lignes.push(ferie.intitule ?? 'jour férié');
  }

  if (lignes.length === 0) return null;

  return (
    <p className="leading-snug text-muted-foreground">Retiré&nbsp;: {lignes.join(' · ')}.</p>
  );
}
