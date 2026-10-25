import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { AUTORITES_DISCIPLINE, sanctionAssiduite } from 'shared/domain';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import BadgeSanction from '@/features/absences/stagiaires/BadgeSanction';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';

/**
 * ═══ LES SEUILS D'ASSIDUITÉ ATTEINTS ═══ (2026-10-25, demande du porteur,
 * grille « Assiduité/10 points » à l'appui : « à la place des dernières
 * absences, un tableau : motif, sanction, autorité de décision, les
 * stagiaires qui ont atteint le seuil, par ordre décroissant »).
 *
 * ⚠️ LA GRILLE ENTIÈRE, DU PLUS LÉGER AU PLUS GRAVE : une ligne vide dit
 * aussi quelque chose — personne n'en est là. Le palier d'un stagiaire vient
 * de `noteDiscipline` côté serveur (non justifiés seulement, retards et
 * séances additionnés), la sanction et l'autorité de `sanctionAssiduite` :
 * la même règle que la note de discipline, jamais une seconde table.
 *
 * ⚠️ LES PALIERS 7 À 10 PARTAGENT LEUR SANCTION, comme dans la grille : une
 * seule cellule fusionnée, sinon le même long libellé se répète quatre fois.
 */
export default function SeuilsAssiduite({ stagiaires }) {
  const parPalier = new Map();
  for (const stagiaire of stagiaires) {
    const palier = palierDe(stagiaire.points);
    parPalier.set(palier, [...(parPalier.get(palier) ?? []), stagiaire]);
  }

  const enSerie = stagiaires.filter((stagiaire) => (stagiaire.serieAbsence?.jours ?? 0) >= SERIE_MIN).length;

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-medium">Seuils d’assiduité atteints</h2>
          <p className="text-xs text-muted-foreground">
            {nombre(stagiaires.length)} stagiaire(s) · absences et retards non justifiés · 1 journée = 2 séances
            {enSerie > 0 && (
              <span className="font-medium text-destructive"> · {nombre(enSerie)} absent(s) {SERIE_MIN} jours successifs ou plus</span>
            )}
          </p>
        </div>
        <Link to="/app/absences" className="flex items-center gap-1 text-xs text-primary hover:underline">
          Voir le registre
          <ArrowUpRight className="size-3" />
        </Link>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Motif</th>
              <th className="py-2 pr-3 font-medium">Sanction</th>
              <th className="py-2 pr-3 font-medium">Autorité de décision</th>
              <th className="py-2 font-medium">Stagiaires</th>
            </tr>
          </thead>
          <tbody>
            {PALIERS.map((palier) => {
              const sanction = sanctionAssiduite(palier === AU_DELA ? 10.25 : palier);
              const fusion = PALIERS_FUSIONNES.includes(palier);
              const premierFusionne = palier === PALIERS_FUSIONNES[0];
              const concernes = parPalier.get(palier) ?? [];
              return (
                <tr key={palier} className={cn('border-b align-top last:border-0', concernes.length === 0 && 'text-muted-foreground')}>
                  <td className="whitespace-nowrap py-2 pr-3">
                    <span className="font-medium">{motif(palier)}</span>
                    <span className="block text-[0.65rem] text-muted-foreground">
                      {palier === AU_DELA ? 'plus de −10 points' : `−${palier} point${palier > 1 ? 's' : ''}`}
                    </span>
                  </td>
                  {(!fusion || premierFusionne) && (
                    <td className="py-2 pr-3" rowSpan={premierFusionne ? PALIERS_FUSIONNES.length : undefined}>
                      <BadgeSanction sanction={sanction} avecAutorite={false} />
                    </td>
                  )}
                  <td className="py-2 pr-3" title={AUTORITES_DISCIPLINE[sanction.autorite]}>
                    <span className="font-semibold">{sanction.autorite}</span>
                    <span className="block text-[0.65rem] text-muted-foreground">
                      {AUTORITES_DISCIPLINE[sanction.autorite]}
                    </span>
                  </td>
                  <td className="py-2">
                    <ListeStagiaires stagiaires={concernes} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Au-delà, la ligne se replie : un palier peut réunir des dizaines de stagiaires. */
const VISIBLES = 6;

function ListeStagiaires({ stagiaires }) {
  const [tout, setTout] = useState(false);
  if (stagiaires.length === 0) return <span>—</span>;

  const montres = tout ? stagiaires : stagiaires.slice(0, VISIBLES);
  return (
    <div className="flex flex-wrap gap-1">
      {montres.map((stagiaire) => (
        /* Une carte au survol plutôt qu'un `title` (2026-10-25, demande du
           porteur) : l'info-bulle du navigateur tardait et tenait sur une ligne. */
        <HoverCard key={stagiaire.matricule} openDelay={150} closeDelay={80}>
          <HoverCardTrigger asChild>
            <Link
              to={`/app/absences?groupe=${encodeURIComponent(stagiaire.groupe)}`}
              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 transition-colors hover:bg-muted/60"
            >
              <span>
                <span className="font-medium">{stagiaire.nom}</span>
                <span className="text-muted-foreground"> · {stagiaire.groupe}</span>
              </span>
              <SerieAbsence serie={stagiaire.serieAbsence} />
            </Link>
          </HoverCardTrigger>
          <HoverCardContent align="start" className="w-72 p-3 text-xs">
            <CarteStagiaire stagiaire={stagiaire} />
          </HoverCardContent>
        </HoverCard>
      ))}
      {stagiaires.length > VISIBLES && (
        <button
          type="button"
          onClick={() => setTout((actuel) => !actuel)}
          className="rounded-md px-1.5 py-0.5 text-primary hover:underline"
        >
          {tout ? 'Réduire' : `+ ${nombre(stagiaires.length - VISIBLES)} autre(s)`}
        </button>
      )}
    </div>
  );
}

/**
 * ⚠️ LE REPÈRE DU RISQUE D'ABANDON (2026-10-25, demande du porteur) : la plus
 * longue série de jours d'absence SUCCESSIFS de l'année, avec ses dates (calcul
 * côté serveur, `joursAbsentsConsecutifs`). Un seul jour n'est pas une série :
 * rien sous 2.
 */
const SERIE_MIN = 2;
const SERIE_ALERTE = 3;

function SerieAbsence({ serie }) {
  const jours = serie?.jours ?? 0;
  if (jours < SERIE_MIN) return null;
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 text-[0.6rem] font-semibold',
        jours >= SERIE_ALERTE ? 'bg-destructive text-white' : 'bg-warning/20 text-accent-orange-deep'
      )}
    >
      {nombre(jours)} jours successifs
    </span>
  );
}

/** Le détail d'un stagiaire : ce qui l'a mené à son palier, et sa plus longue série d'absence. */
function CarteStagiaire({ stagiaire }) {
  const { serieAbsence: serie } = stagiaire;
  const sanction = sanctionAssiduite(stagiaire.points);
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold leading-tight">{stagiaire.nom}</p>
        <p className="text-muted-foreground">
          {stagiaire.matricule} · {stagiaire.groupe}
        </p>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t pt-2">
        <dt className="text-muted-foreground">Séances non justifiées</dt>
        <dd className="text-right font-medium tabular-nums">{nombre(stagiaire.seances)}</dd>
        <dt className="text-muted-foreground">Retards non justifiés</dt>
        <dd className="text-right font-medium tabular-nums">{nombre(stagiaire.retards)}</dd>
        <dt className="text-muted-foreground">Points retirés</dt>
        <dd className="text-right font-semibold tabular-nums text-destructive">−{nombre(stagiaire.points)}</dd>
      </dl>
      {sanction && (
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <BadgeSanction sanction={sanction} avecAutorite={false} />
          <span className="text-muted-foreground">{AUTORITES_DISCIPLINE[sanction.autorite]}</span>
        </div>
      )}
      {(serie?.jours ?? 0) >= SERIE_MIN && (
        <p
          className={cn(
            'rounded-md px-2 py-1.5 font-medium',
            serie.jours >= SERIE_ALERTE ? 'bg-destructive/10 text-destructive' : 'bg-warning/15 text-accent-orange-deep'
          )}
        >
          Absent {nombre(serie.jours)} jours successifs, du {jourMois(serie.du)} au {jourMois(serie.au)} — risque
          d’abandon
        </p>
      )}
      <p className="text-[0.65rem] text-muted-foreground">Cliquer pour ouvrir son groupe dans Absences.</p>
    </div>
  );
}

/** « 2026-09-23 » → « 23/09 ». */
const jourMois = (date) => date.slice(8, 10) + '/' + date.slice(5, 7);

const AU_DELA = 11;
/** Du plus léger au plus grave, l'ordre de la grille (2026-10-25, demande du porteur). */
const PALIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, AU_DELA];
const PALIERS_FUSIONNES = [7, 8, 9, 10];

/** « Au-delà de 40 retards / 10 journées » = plus de 10 points ; sinon le palier entier atteint. */
const palierDe = (points) => (points > 10 ? AU_DELA : Math.floor(points));

const motif = (palier) =>
  palier === AU_DELA
    ? 'Au-delà de 40 retards ou de 10 journées'
    : `${palier * 4} retards ou ${palier} journée${palier > 1 ? 's' : ''}`;
