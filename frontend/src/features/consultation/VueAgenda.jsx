import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronRight, ClipboardCheck, Clock, DoorOpen, Presentation, Star, User, Users } from 'lucide-react';
import { agendaDuSujet } from 'shared/domain';
import Teams from '@/components/icons/Teams';
import PanneauAppel from '@/features/absences/stagiaires/PanneauAppel';
import Alerte from '@/components/common/Alerte';
import {
  CADRE_RATTRAPAGE,
  FOND_REDUIT,
  FOND_VACANCES,
  PASTILLE_RATTRAPAGE,
  couleurCharge,
} from '@/components/common/apparenceGrille';
import { cn } from '@/lib/utils';
import { etatDuBloc, instantPresent } from './etatAgenda';

/** L'état « en cours » change à la minute : on relit l'horloge au même pas,
 *  sans quoi une page laissée ouverte garderait la séance du matin en cours
 *  tout l'après-midi. */
const PAS_HORLOGE_MS = 30_000;

/**
 * « Mon emploi du temps », vue AGENDA — un jour après l'autre, en cartes.
 * ← `renderTimelineView()` de `public/emploiStagiaire.html` (repris à
 *   l'identique : filtre par jour, cercle d'état, badge de statut, HORAIRE
 *   RÉEL, pause entre créneaux fusionnés, nom complet du module).
 *
 * ═══ ⚠️ POURQUOI UN SECOND MODE, PAS UN REMPLACEMENT ═══ (2026-09-04, demande
 * du porteur : « ajouter un autre mode de vue comme celui dans l'ancien
 * edtpro »). `GrilleDetaillee` reste la vue par défaut — elle montre TOUTE la
 * semaine d'un regard. Celle-ci répond à une autre question : « qu'ai-je
 * aujourd'hui, et qu'est-ce qui est déjà fait ? », jour par jour, comme le
 * consultait un stagiaire sur son téléphone dans l'ancien produit.
 *
 * ═══ ⚠️⚠️ L'HORAIRE ET LES PAUSES REVIENNENT SUR « AUCUNE HEURE D'HORLOGE »
 * (2026-09-04, demande explicite du porteur, capture de l'ancien produit à
 * l'appui) ═══ `agendaDuSujet` calcule désormais `debut`/`fin`/`pauses` à
 * partir de l'horaire OFFICIEL de `get_formateur_timetable.php` — ce ne sont
 * pas des heures inventées, elles sont lues dans le code de production. Voir
 * le commentaire de `agendaDuSujet` pour le détail (horaire du Vendredi à
 * part, pause déjeuner spéciale).
 */
export default function VueAgenda({
  sujet,
  libelle,
  seances,
  axe,
  nomsFormateurs,
  jours,
  filtreJour,
  intitules,
  /** Le formateur fait l'appel de ses séances depuis la carte (F9, 2026-09-14). */
  avecAppel = false,
}) {
  const { heures, jours: agendaJours } = useMemo(
    () => agendaDuSujet({ sujet, seances, axe, nomsFormateurs }),
    [sujet, seances, axe, nomsFormateurs]
  );

  const etatDuJour = useMemo(() => new Map((jours ?? []).map((j) => [j.jour, j])), [jours]);
  const [maintenant, setMaintenant] = useState(instantPresent);
  useEffect(() => {
    const minuterie = setInterval(() => setMaintenant(instantPresent()), PAS_HORLOGE_MS);
    return () => clearInterval(minuterie);
  }, []);

  /*
   * ⚠️ UN JOUR FÉRIÉ OU EN VACANCES RESTE VISIBLE MÊME SANS SÉANCE — demande
   * du porteur (2026-09-04) : sans lui, une semaine de vacances disparaissait
   * purement et simplement de l'agenda, et rien ne disait POURQUOI elle est
   * vide plutôt que de laisser croire à une donnée manquante. Un jour
   * ORDINAIRE sans séance reste masqué : c'est tout l'intérêt de l'agenda sur
   * le tableau, ne montrer que ce qui a quelque chose à dire.
   */
  const joursAffiches = agendaJours.filter(({ jour, blocs }) => {
    if (filtreJour !== 'tous' && jour !== filtreJour) return false;
    if (blocs.length > 0) return true;
    const etat = etatDuJour.get(jour);
    return Boolean(etat?.ferie) || Boolean(etat?.vacances);
  });

  return (
    <section className="overflow-clip rounded-lg border">
      {/*
        ⚠️ MÊME BANDE QUE LA VUE TABLEAU (`GrilleDetaillee`) : couleur de
        charge et total « X h » — demande du porteur (2026-09-04). `heures`
        est le MÊME total que celui-là, rendu par `agendaDuSujet` plutôt que
        recalculé une seconde fois ici.
      */}
      <header
        className={cn(
          'flex items-baseline justify-between gap-3 border-b px-3 py-2',
          // ⚠️ BLANC, PAS GRIS, À ZÉRO — même correction que `GrilleDetaillee`
          // (2026-09-05, demande du porteur) : `bg-tableau-tete` confondait
          // une semaine vide avec un en-tête de tableau.
          heures ? couleurCharge(heures) : 'bg-card'
        )}
      >
        <h3 className="truncate text-sm font-semibold">{libelle}</h3>
        <span className="shrink-0 text-xs tabular-nums">{heures} h</span>
      </header>

      <div className="space-y-5 p-4">
      {joursAffiches.length === 0 ? (
        <Alerte type="info" titre="Rien à afficher">
          {filtreJour === 'tous'
            ? 'Aucune séance cette semaine.'
            : `Aucune séance ${filtreJour.toLowerCase()}.`}
        </Alerte>
      ) : (
        joursAffiches.map(({ jour, blocs }) => {
          const etat = etatDuJour.get(jour);
          return (
            <div key={jour}>
              <EnTeteJour jour={jour} date={etat?.date} ferie={etat?.ferie} vacances={etat?.vacances} />

              {blocs.length === 0 ? (
                <p className="pl-1 text-xs text-muted-foreground">
                  {etat?.vacances
                    ? 'Vacances — aucune séance ne peut y être placée.'
                    : 'Jour férié — aucune séance ne peut y être placée.'}
                </p>
              ) : (
                <div className="space-y-3">
                  {blocs.map((bloc, index) => (
                    <CarteBloc
                      key={`${bloc.creneaux.join('-')}-${index}`}
                      bloc={bloc}
                      axe={axe}
                      temps={etatDuBloc(bloc, etat?.date, maintenant)}
                      intitule={intitules?.[bloc.module]}
                      appel={avecAppel ? etat?.date : null}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
      </div>
    </section>
  );
}

/** ← `statusMap` de l'ancien produit, plus « En pause » (l'écart réel du
 *  Vendredi, que l'ancien écran comptait à tort comme « En cours »). */
const LIBELLE_ETAT = {
  termine: 'Terminé',
  encours: 'En cours',
  pause: 'En pause',
  aujourdhui: "Aujourd'hui",
  avenir: 'À venir',
  inconnu: '',
};

const EN_DIRECT = new Set(['encours', 'pause']);

/**
 * L'en-tête d'un jour — et sa couleur quand il est FÉRIÉ ou EN VACANCES.
 * ← demande du porteur (2026-09-04) : « je veux que les jours fériés et les
 * vacances être affichés en vue agenda ».
 *
 * ⚠️ MÊMES TOKENS QUE LA VUE TABLEAU (`GrilleDetaillee`) : `FOND_VACANCES`
 * (bleu, l'établissement est fermé) et `FOND_REDUIT` (ambre, un plafond
 * réduit plutôt qu'un blocage) — pas une troisième palette pour dire la même
 * chose (§4.2 du plan).
 *
 * ⚠️⚠️ ICI, PAS DE CARTE AU SURVOL — DÉCISION INVERSE DE LA VUE TABLEAU
 * (2026-09-04, correction du porteur : « en vue tableau je veux qu'il être
 * un hover card mais [en] vue agenda affiche le nom du jour en français et
 * arabe sans hover »). L'agenda se consulte au jour le jour, souvent sur
 * mobile où rien ne « survole » : le nom du férié — français ET arabe — est
 * donc écrit EN CLAIR dans l'en-tête, jamais caché derrière un geste qui n'a
 * pas d'équivalent tactile. C'est la vue Tableau qui garde la carte, parce
 * qu'elle est dense et qu'une case n'a pas la place d'écrire un intitulé
 * entier.
 */
function EnTeteJour({ jour, date, ferie, vacances }) {
  return (
    <div
      className={cn(
        'mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5',
        vacances ? FOND_VACANCES : ferie && FOND_REDUIT
      )}
    >
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{jour}</span>
      {date && (
        <span className="text-xs font-normal text-muted-foreground/70">{formatterDate(date)}</span>
      )}
      {vacances && <span className="text-xs font-medium text-primary">· Vacances</span>}
      {ferie && (
        <span className="flex flex-wrap items-baseline gap-x-1.5 text-xs font-medium text-foreground">
          <span>· {ferie.intitule}</span>
          {ferie.intituleAr && (
            <span dir="rtl" lang="ar" className="text-muted-foreground">
              {ferie.intituleAr}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * La couleur d'une carte suit ce qu'elle PORTE (présentiel, distance, EFM,
 * absence) — les mêmes tokens que la grille et le chronogramme
 * (`apparenceGrille.js`), pas une quatrième palette : un module ne peut pas
 * changer de couleur selon l'écran qui le montre (§4.2 du plan).
 *
 * ⚠️ LE TYPE L'EMPORTE SUR LE STATUT, comme dans l'ancien app : une séance à
 * distance reste violette qu'elle soit terminée ou à venir — seul le BADGE de
 * droite change de mot, jamais la teinte de la carte.
 *
 * ═══ LE TEXTE PREND LA TEINTE DE SA CARTE (2026-09-12, demande du porteur) ═══
 * `texte` (horaire, nom du module) et `texteDoux` (groupe, code, salle, durée)
 * reprennent la couleur PROFONDE de la carte — vert sur vert, violet sur
 * violet, rouge sur rouge — au lieu d'un gris neutre qui faisait se ressembler
 * toutes les cartes dès qu'on n'en regarde plus le fond. Ce sont les tons
 * `-deep` déjà employés par les badges (`--accent-green-deep`…) : lisibles sur
 * l'aplat pâle, et aucune teinte nouvelle.
 * ⚠️ L'EFM ÉCRIT EN `accent-orange-deep`, pas en `warning` : l'ambre à 50 %
 * de luminance, lisible en ÉTOILE, tombe à ~2:1 en texte sur son propre aplat.
 * Le `-deep` d'ambre n'existe pas (piège déjà consigné), l'orange profond est
 * le plus proche de la famille.
 *
 * ═══ « EN COURS » : UNE AIRE QUI AVANCE ═══
 * (2026-09-12, correction du porteur : l'anneau et la barre de progression en
 * pied de carte sont retirés.) `aire` remplit le fond de la carte depuis la
 * gauche jusqu'à la part ÉCOULÉE du bloc, bordée à droite d'une ONDE (`trait`)
 * qui marque l'instant. ⚠️ UN APLAT, PLUS UN DÉGRADÉ (correction du porteur, le
 * même jour) : la teinte qui s'effaçait vers le bas rejoignait presque le fond
 * de la carte, et la séparation entre l'écoulé et le restant ne se lisait plus
 * qu'en haut. `point` bat dans le badge ET derrière l'icône,
 * `anneauCercle` cerne celle-ci. La
 * couleur reste celle du TYPE — un cours à distance en cours reste violet.
 *
 * ═══ UNE SÉANCE TERMINÉE PREND LA TEINTE FONCÉE DE L'AIRE ═══ (2026-09-14,
 * demande du porteur.) `carteTerminee` : le fond de la carte entière passe au
 * ton de la part écoulée d'une séance en cours — vert foncé pour le
 * présentiel, violet foncé à distance, ambre soutenu pour un EFM. Ce qui reste
 * à faire garde le ton clair. Une journée se lit ainsi d'un regard : ce qui est
 * fait, ce qui se déroule (l'aire avance d'un ton vers l'autre), ce qui vient.
 * ⚠️ PAS POUR UNE ABSENCE : le cours n'a pas eu lieu, il n'est pas « fait ».
 */
export const STYLES = {
  presentiel: {
    carte: 'border-accent-green/30 bg-accent-green/10',
    cercle: 'border-accent-green/40 bg-accent-green/20 text-accent-green-deep',
    badge: 'border-accent-green/30 bg-accent-green/15 text-accent-green-deep',
    texte: 'text-accent-green-deep',
    texteDoux: 'text-accent-green-deep/70',
    anneauCercle: 'ring-2 ring-accent-green/60 ring-offset-2 ring-offset-background',
    point: 'bg-accent-green',
    aire: 'bg-accent-green/30',
    trait: 'bg-accent-green/70',
    carteTerminee: 'border-accent-green/50 bg-accent-green/30',
    icone: Presentation,
  },
  synchrone: {
    carte: 'border-accent-purple/40 bg-accent-purple/15',
    cercle: 'border-accent-purple/40 bg-accent-purple/25 text-accent-purple-deep',
    // ⚠️ BORDURE EN `purple-mid` (2026-09-14, demande du porteur) : en `accent-purple`
    // (L 84 %) elle se fondait dans la carte violette, surtout terminée — badge
    // et bouton « Appel » paraissaient sans contour, à côté des verts qui en ont un.
    // ⚠️ FOND EN `purple-mid` AUSSI (même jour, 2ᵉ retouche) : `accent-purple` est plus
    // CLAIR que la carte terminée (`purple-mid/30`) — badge et bouton y paraissaient
    // délavés. Comme en vert, ils doivent être un ton plus FONCÉ que la carte.
    badge: 'border-accent-purple-mid/60 bg-accent-purple-mid/25 text-accent-purple-deep',
    texte: 'text-accent-purple-deep',
    texteDoux: 'text-accent-purple-deep/70',
    anneauCercle: 'ring-2 ring-accent-purple-mid/60 ring-offset-2 ring-offset-background',
    point: 'bg-accent-purple-mid',
    aire: 'bg-accent-purple-mid/30',
    trait: 'bg-accent-purple-mid/70',
    carteTerminee: 'border-accent-purple-mid/50 bg-accent-purple-mid/30',
    icone: Teams,
  },
  efm: {
    // ⚠️ ÉTOILE AMBRE (`warning`), PAS LE TOKEN `efm` — demande du porteur
    // (2026-09-04) : « ajouter les bordures en jaune et met l'icon d'étoile
    // pour EFM régional ». `--efm` est un jaune quasi blanc (L 95 %), le
    // bordurer ne se voyait pas. `warning` (L 50 %) est LA couleur que
    // toute la grille, le chronogramme et les affectations emploient déjà
    // pour l'étoile EFM (`fill-warning text-warning`) — la reprendre ici
    // évite une cinquième palette pour dire la même chose (§4.2 du plan).
    carte: 'border-warning/50 bg-warning/10',
    cercle: 'border-warning/50 bg-warning/20 text-warning',
    // ⚠️ Le TEXTE du badge passe à l'orange profond (voir plus haut) : l'ambre
    // reste le fond et la bordure, il ne se lisait pas en lettres.
    badge: 'border-warning/40 bg-warning/15 text-accent-orange-deep',
    texte: 'text-accent-orange-deep',
    texteDoux: 'text-accent-orange-deep/70',
    anneauCercle: 'ring-2 ring-warning/70 ring-offset-2 ring-offset-background',
    point: 'bg-warning',
    aire: 'bg-warning/40',
    trait: 'bg-warning/80',
    carteTerminee: 'border-warning/70 bg-warning/40',
    icone: Star,
    iconeExtra: 'fill-warning',
  },
  absente: {
    carte: 'border-destructive/20 bg-destructive/5 opacity-80',
    cercle: 'border-destructive/30 bg-destructive/10 text-destructive',
    badge: 'border-destructive/30 bg-destructive/10 text-destructive',
    texte: 'text-destructive',
    texteDoux: 'text-destructive/70',
    icone: Clock,
  },
};

function typeDuBloc(bloc) {
  if (bloc.absente) return 'absente';
  if (bloc.efm) return 'efm';
  if (bloc.aDistance) return 'synchrone';
  return 'presentiel';
}

/*
 * ═══ L'APPEL DEPUIS LA CARTE ═══ (F9, 2026-09-14, demande du porteur : « en
 * emploi en mode agenda, en carte, un bouton appel ; la liste des stagiaires
 * s'affiche au-dessous ».) Un bouton PAR CRÉNEAU : une carte réunit parfois
 * S1 et S2, et chacun est un cours dont on fait l'appel.
 *
 * ⚠️ JAMAIS SUR UN COURS À VENIR NI ABSENT : le serveur refuse l'un et l'autre,
 * et un bouton qui échoue toujours est un défaut. « Plus tard aujourd'hui » reste
 * ouvert — l'appel se fait souvent au début du cours.
 */
const ETATS_SANS_APPEL = new Set(['avenir', 'inconnu']);

function CarteBloc({ bloc, axe, temps, intitule, appel }) {
  const [appelOuvert, setAppelOuvert] = useState(null);
  const appelPossible = Boolean(appel) && !bloc.absente && !ETATS_SANS_APPEL.has(temps.etat);

  const type = typeDuBloc(bloc);
  const style = STYLES[type];
  const Icone = style.icone;

  // ⚠️ UNE SÉANCE ABSENTE N'EST JAMAIS « EN COURS » : le cours n'a pas lieu.
  // Le badge « Absence » l'emporte sur l'horloge, comme il l'emportait déjà
  // sur « Terminé » et « À venir ».
  const enDirect = !bloc.absente && EN_DIRECT.has(temps.etat);
  const etat = bloc.absente ? 'absente' : temps.etat;

  const plage = `${formatterHeure(bloc.debut)} – ${formatterHeure(bloc.fin)}`;
  const duree = formatterDuree(bloc.heures);

  /*
   * ⚠️ POUR UN EFM, LES DEUX BADGES : « EFM Régional » dit ce qu'est la
   * séance, « En cours » quand elle se déroule. Hors du direct, l'EFM garde
   * son seul badge — comme avant, « Terminé » ou « À venir » n'y apprenaient
   * rien de plus que la date.
   */
  const badges = [];
  if (bloc.absente) badges.push({ texte: 'Absence' });
  else {
    if (bloc.efm) badges.push({ texte: 'EFM Régional' });
    if (enDirect || !bloc.efm) {
      const texte = LIBELLE_ETAT[etat];
      if (texte) badges.push({ texte, direct: enDirect, bat: etat === 'encours' });
    }
  }

  return (
    <div className="flex items-start gap-3" aria-current={etat === 'encours' ? 'time' : undefined}>
      <div
        className={cn(
          'relative flex size-9 shrink-0 items-center justify-center rounded-full border',
          style.cercle,
          enDirect && style.anneauCercle
        )}
      >
        {/* ⚠️ LE CERCLE BAT COMME LE POINT DU BADGE (2026-09-12, demande du
            porteur) — même `animate-ping`, même teinte, et seulement EN COURS :
            en pause, rien ne bat, ni ici ni dans le badge. */}
        {etat === 'encours' && !bloc.absente && (
          <span
            aria-hidden="true"
            className={cn('absolute inset-0 rounded-full opacity-30 motion-safe:animate-ping', style.point)}
          />
        )}
        {etat === 'termine' ? (
          <Check className="relative size-4" />
        ) : (
          <Icone className={cn('relative size-4', style.iconeExtra)} />
        )}
      </div>

      {/* ⚠️ UN RATTRAPAGE GARDE LA TEINTE DE SA NATURE et prend le cadre
          pointillé orange des grilles (2026-09-14) — le même repère partout. */}
      <div
        className={cn(
          'relative min-w-0 flex-1 overflow-hidden rounded-xl border',
          style.carte,
          etat === 'termine' && style.carteTerminee,
          bloc.rattrapage && !bloc.absente && CADRE_RATTRAPAGE
        )}
      >
        {enDirect && temps.progression !== null && (
          <FondProgression progression={temps.progression} aire={style.aire} trait={style.trait} />
        )}

        {/* ⚠️ `relative` : sans lui, le fond dégradé — positionné — se peindrait
            PAR-DESSUS le texte au lieu de passer dessous. */}
        <div className="relative p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn('text-sm font-bold', style.texte, bloc.absente && 'line-through')}
            >
              {plage}
            </span>
            {duree && (
              <span
                className={cn(
                  'rounded-full border bg-background px-2 py-0.5 text-[0.7rem] font-medium',
                  style.texteDoux
                )}
              >
                {duree}
              </span>
            )}
            {bloc.rattrapage && !bloc.absente && (
              <span className={cn(PASTILLE_RATTRAPAGE, 'px-1.5 text-[0.65rem] leading-5')}>
                ↺ Rattrapage
              </span>
            )}
          </div>

          {badges.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {badges.map(({ texte, direct, bat }) => (
                <span
                  key={texte}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold',
                    style.badge
                  )}
                >
                  {direct && <PointDirect couleur={style.point} bat={bat} />}
                  {texte}
                </span>
              ))}
            </div>
          )}
        </div>

        {/*
          ⚠️ LE CONTENU SE RÉPÈTE, UNE FOIS PAR CRÉNEAU DU BLOC, avec une pause
          entre deux — ← `slotsHtml` de l'ancien produit. Le critère de fusion
          garantit que module/sujet/salle sont IDENTIQUES sur tout le bloc :
          répéter la même carte de contenu, séparée par la pause réelle du
          créneau suivant, reproduit exactement ce que montrait l'ancien écran
          plutôt que d'inventer un résumé qu'il n'affichait pas.
        */}
        {bloc.creneaux.map((creneau, index) => {
          // Le créneau courant n'est désigné que dans un bloc FUSIONNÉ : seul,
          // il est déjà toute la carte, que le dégradé signale.
          const courant =
            !bloc.absente &&
            temps.etat === 'encours' &&
            temps.creneauCourant === index &&
            bloc.creneaux.length > 1;
          return (
            <div key={creneau}>
              {index > 0 && <DiviseurPause texte={bloc.pauses[index - 1]} style={style} />}
              {courant && (
                <p className={cn('mb-1 text-[0.65rem] font-semibold uppercase tracking-wide', style.texte)}>
                  Maintenant
                </p>
              )}
              {/* ⚠️ LE BOUTON DANS LE COIN OPPOSÉ (2026-09-14, demande du porteur) : en
                  bas à droite du créneau, sur la ligne de la salle. Sous le contenu,
                  il ajoutait une ligne à chaque créneau et allongeait la journée. */}
              {/* ⚠️ SOUS `sm`, LE BOUTON PASSE DESSOUS (toujours à droite) : à côté du
                  contenu, sur téléphone, il tronquait le groupe — « OPCM101 OP… » pour
                  une fusion (vu sur la capture du porteur). */}
              <div className="flex flex-wrap items-end justify-end gap-2 sm:flex-nowrap sm:justify-between">
              <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                <ContenuSeance bloc={bloc} axe={axe} intitule={intitule} style={style} />
              </div>
              {/* ⚠️ UNE PASTILLE AUX COULEURS DE LA CARTE (demande du porteur :
                  « améliorer le style du bouton ») — le vert d'un cours en salle,
                  le violet d'un cours à distance. Un bouton gris sur une carte
                  teintée se lisait comme un corps étranger. */}
              {appelPossible && (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setAppelOuvert(creneau)}
                  className={cn(
                    // Marges serrées (demande du porteur : « diminuer un peu sa largeur »).
                    'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold shadow-sm transition',
                    'hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    style.badge
                  )}
                >
                  <ClipboardCheck className="size-3.5" />
                  {/* « Appel · S1 » partout (demande du porteur) : le créneau se lit
                      même sur une carte d'un seul créneau. */}
                  Appel · {creneau}
                  <ChevronRight className="size-3.5 opacity-60" />
                </button>
              )}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/*
        ═══ LA LISTE DANS UN PANNEAU À DROITE ═══ (demande du porteur : « au lieu
        d'afficher la liste en carte, affiche-la dans un sheet right »). Dépliée
        dans la carte, elle allongeait la journée de trente lignes et repoussait
        les cours suivants hors de vue ; sur téléphone, elle n'avait que ~210 px.
        Le panneau prend toute la hauteur, et l'agenda reste lisible derrière.
        Le MÊME panneau que la grille « Faire l'appel » de l'encadrement.
      */}
      {appelPossible && (
        <PanneauAppel
          choix={
            appelOuvert
              ? {
                  date: appel,
                  cours: { seance: appelOuvert, periode: bloc.periode, groupe: bloc.groupeSeance },
                  sousTitre: `${formatterDate(appel)} · ${bloc.autreSujet} · ${intitule || bloc.module}`,
                }
              : null
          }
          onFermer={() => setAppelOuvert(null)}
        />
      )}
    </div>
  );
}

/** Le point qui bat dans le badge « En cours » — fixe « En pause ».
 *  `motion-safe` : qui a demandé moins d'animations garde un point immobile. */
function PointDirect({ couleur, bat }) {
  return (
    <span className="relative flex size-2" aria-hidden="true">
      {bat && (
        <span
          className={cn('absolute inline-flex size-full rounded-full opacity-75 motion-safe:animate-ping', couleur)}
        />
      )}
      <span className={cn('relative inline-flex size-2 rounded-full', couleur)} />
    </span>
  );
}

/*
 * ═══ L'ONDE DU BORD DROIT (2026-09-12, demande du porteur : « le droite qui
 * indique la progression un petit peu ondulé ») ═══
 * Une période de sinusoïde de 40 px de haut et 2 px d'amplitude, répétée sur
 * toute la hauteur de la carte — « un petit peu » : une première version à
 * 20 px et 4 px d'amplitude faisait une dentelle trop serrée, et 3 px
 * restaient encore trop marqués (retour du porteur). Tracée en
 * courbes de Bézier le long de x = 5 + 2·sin(2πy/40) : la pente est la plus forte au passage par le milieu
 * — là où deux tuiles se raccordent — et nulle aux crêtes, si bien que la
 * répétition ne laisse aucun angle.
 *
 * ⚠️ PAR MASQUE, PAS PAR UNE IMAGE DE FOND : une image SVG en `data:` ne sait
 * pas lire la couleur du thème (`currentColor` n'y hérite de rien). Le masque
 * découpe la FORME ; la couleur reste une classe Tailwind de `STYLES`, donc la
 * même teinte que partout ailleurs.
 */
const COURBE_ONDE = 'M5 0C6.1 3.5 7 6.4 7 10C7 13.6 6.1 16.5 5 20C3.9 23.5 3 26.4 3 30C3 33.6 3.9 36.5 5 40';
const svgEnUrl = (contenu) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='10' height='40' viewBox='0 0 10 40'>${contenu}</svg>`
  )}")`;
const ONDE_REMPLIE = svgEnUrl(`<path d='M0 0H5${COURBE_ONDE.slice(4)}H0Z' fill='black'/>`);
const ONDE_TRAIT = svgEnUrl(`<path d='${COURBE_ONDE}' fill='none' stroke='black' stroke-width='1.25'/>`);
const LARGEUR_ONDE = '10px';
// ⚠️ La même valeur que les keyframes `onde-aire` / `onde-trait` de
// globals.css : la vague glisse d'une période par tour, sinon elle saute.
const PERIODE_ONDE = '40px';

/** `mask-*` et sa variante préfixée : Chrome et Safari n'acceptent pas tous
 *  encore la propriété nue. */
function masque({ image, size, position, repeat }) {
  return {
    WebkitMaskImage: image,
    maskImage: image,
    WebkitMaskSize: size,
    maskSize: size,
    WebkitMaskPosition: position,
    maskPosition: position,
    WebkitMaskRepeat: repeat,
    maskRepeat: repeat,
  };
}

/**
 * La part ÉCOULÉE du bloc, peinte en fond de carte d'une teinte UNIFORME, et
 * une ONDE à droite qui marque l'instant présent. (Le dégradé vertical du
 * modèle « Area Chart - Gradient » est retiré : il effaçait la séparation en
 * bas de carte.)
 *
 * ⚠️ PAS DE TRAIT EN TÊTE (retiré à la demande du porteur, 2026-09-12) : il
 * doublait le bord supérieur de la carte et lui donnait l'air d'une barre.
 * ⚠️ PAS DE BARRE EN PIED DE CARTE (retirée avant lui) : le fond dit la même
 * chose sans ajouter une ligne.
 * ⚠️ DEUX COUCHES DE MASQUE pour l'aire : un aplat plein sur tout sauf les
 * 10 derniers pixels, et l'onde répétée verticalement sur ces 10 pixels. La
 * teinte passe sous les deux, elle reste donc continue jusque dans l'onde.
 * ⚠️ `transition-[width]` : l'horloge avance par pas de 30 s, l'aire glisse
 * au lieu de sauter.
 * ⚠️ L'ONDE COULE (2026-09-12, « qu'elle bouge doucement comme une vague ») :
 * `onde-aire` et `onde-trait` (globals.css) font glisser le masque d'une
 * période en 4 s, en boucle ; rien ne bouge si l'utilisateur a demandé moins
 * d'animations.
 */
function FondProgression({ progression, aire, trait }) {
  const pourcent = Math.round(progression * 100);
  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-700"
      style={{ width: `${pourcent}%` }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pourcent}
      aria-label={`Séance écoulée à ${pourcent} %`}
    >
      <div
        className={cn('onde-aire absolute inset-0', aire)}
        style={masque({
          image: `linear-gradient(#000, #000), ${ONDE_REMPLIE}`,
          size: `calc(100% - ${LARGEUR_ONDE}) 100%, ${LARGEUR_ONDE} ${PERIODE_ONDE}`,
          position: '0 0, 100% 0',
          repeat: 'no-repeat, repeat-y',
        })}
      />
      <div
        className={cn('onde-trait absolute inset-y-0 right-0', trait)}
        style={{
          width: LARGEUR_ONDE,
          ...masque({ image: ONDE_TRAIT, size: `${LARGEUR_ONDE} ${PERIODE_ONDE}`, position: '0 0', repeat: 'repeat-y' }),
        }}
      />
    </div>
  );
}

export function ContenuSeance({ bloc, axe, intitule, style }) {
  const barre = bloc.absente && 'line-through';
  // ⚠️ EFM AVANT LE NOM, comme la ligne « Module » du tableau : c'est une
  // surveillance, pas le cours ordinaire que le code laisse deviner.
  const nom = bloc.efm ? `EFM Régional — ${intitule || bloc.module}` : intitule;

  return (
    <div className={cn('space-y-1 text-xs', barre)}>
      {/*
        ⚠️ L'AUTRE SUJET D'ABORD (2026-09-05, demande du porteur : « groupe
        puis module puis salle », pas module en tête) — le Groupe pour un
        formateur, le Formateur pour un stagiaire. C'est la question qu'on se
        pose la première en lisant une case : « avec qui ? », avant « quoi ? »
        et « où ? ». Même ordre que dans la vue Tableau (`contenuLigne`).
      */}
      <LigneMeta icone={axe === 'groupe' ? User : Users} couleur={style.texteDoux}>
        {bloc.autreSujet || '—'}
      </LigneMeta>
      <p className={cn('flex items-start gap-2', style.texteDoux)}>
        <BookOpen className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          {/* Le CODE, petit, au-dessus du nom complet — sauf s'il n'a rien de
              plus à dire (aucun intitulé résolu, ou déjà porté par le préfixe
              EFM). */}
          {intitule && !bloc.efm && <span className="block text-[0.7rem]">{bloc.module}</span>}
          {/*
            ⚠️ PLUS DE `truncate` — demande du porteur (2026-09-05) : le nom
            COMPLET du module doit s'afficher, quitte à RETOURNER À LA LIGNE.
            Un intitulé DRIF monte à 60 caractères ; `[overflow-wrap:anywhere]`
            le replie proprement même sans espace de coupure commode.
          */}
          <span
            className={cn(
              'block whitespace-normal [overflow-wrap:anywhere] font-semibold',
              style.texte,
              barre
            )}
          >
            {nom || bloc.module || 'Module non défini'}
          </span>
        </span>
      </p>
      <LigneMeta icone={bloc.aDistance ? Teams : DoorOpen} couleur={style.texteDoux}>
        {bloc.salle || '—'}
      </LigneMeta>
    </div>
  );
}

/** ← `.slot-divider` de l'ancien produit : un filet, une pastille, un filet. */
function DiviseurPause({ texte, style }) {
  return (
    <div className="my-2.5 flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-[0.7rem] font-medium',
          style.texteDoux
        )}
      >
        <Clock className="size-3" />
        {texte}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function LigneMeta({ icone: Icone, couleur, children }) {
  return (
    <p className={cn('flex items-center gap-2', couleur)}>
      <Icone className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </p>
  );
}

/** 2,5 → « 2h30 », 5 → « 5h ». */
export function formatterDuree(heures) {
  if (!heures) return '';
  const h = Math.floor(heures);
  const m = Math.round((heures - h) * 60);
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/** « 08:30 » → « 08h30 » — telle quelle, avec son zéro de tête. */
export function formatterHeure(hhmm) {
  return String(hhmm ?? '').replace(':', 'h');
}

/** « AAAA-MM-JJ » → « 07/09 ». */
function formatterDate(date) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
