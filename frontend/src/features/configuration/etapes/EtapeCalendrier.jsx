import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fr } from 'date-fns/locale';
import { CalendarOff, MousePointerClick, Plus, Trash2, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Alerte from '@/components/common/Alerte';
import { colonneSemaine } from '@/components/common/decorationCalendrier';
import { bornesCalendrier } from '@/lib/bornesCalendrier';
import { cn } from '@/lib/utils';
import { chargerJoursFeries } from '../api';
import PanneauJoursFeries from './PanneauJoursFeries';

/**
 * Étape 3 — calendrier de l'année.
 * ← public/setup.html:546-561 (FullCalendar) + api/data/morocco_holidays.php
 *
 * ═══ CE QUE L'ÉTAPE DEMANDE RÉELLEMENT ═══
 * Un seul geste : déclarer les périodes de vacances. Les jours fériés sont
 * chargés tout seuls et ne se modifient pas ici.
 *
 * Ma première version présentait les deux à parité, dans une colonne de droite
 * où la liste des fériés — 34 badges — repoussait la saisie hors de vue, et où
 * le nom de la période se saisissait loin du calendrier qui donnait les dates.
 * Ici la saisie tient en UN endroit : le calendrier, et à côté la période
 * qu'on vient d'y tracer. Les fériés passent en panneau replié, en bas.
 *
 * Deux différences assumées avec l'existant :
 *  - FullCalendar est remplacé par le calendrier shadcn en sélection de plage :
 *    le cliquer-glisser d'origine devient « premier jour, dernier jour ».
 *  - Les fêtes religieuses viennent de l'API et restent AJUSTABLES : ce sont
 *    des estimations lunaires. Un décalage d'un jour se corrige plus tard, et
 *    la correction survit au rafraîchissement de l'API
 *    (cf. fusionnerJoursFeries dans shared/src/domain/planning/calendrier.js).
 */
/**
 * @param {Function} [chargerFeries]  D'où viennent les jours fériés.
 *
 * ⚠️ UNE PROP, PAS UN SECOND COMPOSANT (2026-09-03). Cet écran sert le
 * directeur ET l'administrateur, qui ne lisent pas les fériés au même endroit :
 * le premier voit l'estimation nationale CORRIGÉE par son établissement, le
 * second l'estimation nue — il n'a pas d'établissement, et sa requête revenait
 * en 403. En dupliquer une seconde version, c'était deux calendriers à tenir
 * cohérents pour une seule ligne de différence.
 */
export default function EtapeCalendrier({
  anneeScolaire,
  valeur,
  onChange,
  chargerFeries = chargerJoursFeries,
  /**
   * Les périodes publiées par l'administrateur pour tout le réseau, et celles
   * que cet établissement a mises de côté.
   *
   * ═══ ⚠️ ELLES REJOIGNENT « PÉRIODES DÉCLARÉES » ═══
   * (2026-09-03, demande du porteur.) Elles vivaient dans un panneau à part,
   * au-dessus du calendrier — de la place prise en permanence pour une liste
   * qu'on ne modifie pas. Réunies, on lit d'un coup TOUT ce qui ferme
   * l'établissement, quelle qu'en soit l'origine.
   *
   * ⚠️ MAIS ELLES NE SE SUPPRIMENT PAS. Une période du réseau ne peut
   * qu'être ÉCARTÉE : la supprimer n'aurait aucun sens — elle réapparaîtrait au
   * prochain enregistrement de l'admin. Chaque ligne garde donc l'action
   * qu'elle supporte RÉELLEMENT, et une corbeille sur une ligne nationale
   * serait un mensonge.
   */
  periodesReseau = [],
  ecartees = [],
  onEcarter,
  /*
   * Invité « peut consulter » (Phase 5bis, étape d3) : le calendrier se lit —
   * il colore toujours fériés et vacances, mais ne trace plus de période, et
   * ni corbeille ni « Écarter » ne sont proposés.
   */
  lectureSeule = false,
}) {
  const [plage, setPlage] = useState();
  const [intitule, setIntitule] = useState('');
  // Mois affiché à gauche : la liste des fériés le suit.
  const [mois, setMois] = useState(() => new Date(anneeScolaire, 8, 1));

  /*
   * ⚠️ LA SOURCE ENTRE DANS LA CLÉ DE CACHE. Sans elle, la liste nationale et
   * celle d'un établissement — qui diffèrent par ses ajustements — se
   * partageraient la même entrée, et la seconde consultée servirait la première.
   */
  const feries = useQuery({
    queryKey: ['jours-feries', anneeScolaire, chargerFeries === chargerJoursFeries ? 'etablissement' : 'national'],
    queryFn: () => chargerFeries(anneeScolaire),
    retry: false,
  });

  const joursFeries = feries.data?.joursFeries ?? [];
  const periodes = valeur.vacances ?? [];

  const datesFeriees = useMemo(
    () => joursFeries.map((jour) => new Date(`${jour.date}T00:00:00`)),
    [joursFeries]
  );

  /*
   * Fériés des DEUX MOIS AFFICHÉS, listés sous le calendrier et suivant la
   * navigation. Un jour coloré sans son nom n'apprend rien, et une pastille de
   * 30 px ne peut pas porter « Anniversaire de la Marche Verte » — encore moins
   * en deux langues.
   */
  const feriesDuMois = useMemo(() => {
    const debut = `${mois.getFullYear()}-${String(mois.getMonth() + 1).padStart(2, '0')}`;
    const suivant = new Date(mois.getFullYear(), mois.getMonth() + 1, 1);
    const cleSuivante = `${suivant.getFullYear()}-${String(suivant.getMonth() + 1).padStart(2, '0')}`;

    return joursFeries.filter(
      (jour) => jour.date.startsWith(debut) || jour.date.startsWith(cleSuivante)
    );
  }, [joursFeries, mois]);

  /*
   * ═══ LA LISTE UNIQUE : ce qui ferme l'établissement, quelle qu'en soit
   * l'origine ═══
   *
   * ⚠️ CHAQUE LIGNE PORTE SON ORIGINE, et c'est elle qui décide de l'action
   * offerte : corbeille pour une période propre, « Écarter » pour une période du
   * réseau. Sans cette marque, on croirait pouvoir supprimer ce qui ne se
   * supprime pas.
   */
  const misesDeCote = useMemo(() => new Set(ecartees.map((nom) => cle(nom))), [ecartees]);

  const toutes = useMemo(
    () =>
      [
        ...periodesReseau.map((periode) => ({
          ...periode,
          reseau: true,
          ecartee: misesDeCote.has(cle(periode.intitule)),
        })),
        ...periodes.map((periode, index) => ({ ...periode, reseau: false, index })),
      ].sort((a, b) => String(a.debut).localeCompare(String(b.debut))),
    [periodes, periodesReseau, misesDeCote]
  );

  /*
   * ⚠️ LE CALENDRIER COLORE LES DEUX (2026-09-03, demande du porteur). Une
   * période du réseau ferme bel et bien l'établissement : ne pas la teinter
   * laissait tracer des vacances par-dessus sans rien voir.
   *
   * ⚠️ SAUF CELLES QUI SONT ÉCARTÉES : ces jours redeviennent saisissables, et
   * les peindre en bleu affirmerait le contraire.
   */
  const datesVacances = useMemo(
    () =>
      toutes
        .filter((periode) => !periode.ecartee)
        .map((periode) => ({
          from: new Date(`${periode.debut}T00:00:00`),
          to: new Date(`${periode.fin}T00:00:00`),
        })),
    [toutes]
  );

  const ajouter = () => {
    if (!plage?.from) return;
    const fin = plage.to ?? plage.from;

    onChange({
      ...valeur,
      vacances: [
        ...periodes,
        {
          intitule: intitule.trim() || 'Vacances',
          debut: enTexte(plage.from),
          fin: enTexte(fin),
        },
      ].sort((a, b) => a.debut.localeCompare(b.debut)),
    });

    setPlage(undefined);
    setIntitule('');
  };

  const retirer = (index) =>
    onChange({ ...valeur, vacances: periodes.filter((_, i) => i !== index) });

  return (
    <div className="space-y-6">
      {/* <Alerte type="info" titre="Déclarez les périodes de vacances">
        Tracez une période dans le calendrier : cliquez son premier jour, puis son dernier. Les
        jours fériés sont déjà chargés, vous n&apos;avez rien à saisir pour eux.
      </Alerte> */}

      {feries.isError && (
        <Alerte type="info" titre="Jours fériés indisponibles">
          Le service des jours fériés n&apos;a pas répondu. Vous pourrez les saisir plus tard depuis
          la carte d&apos;établissement — la configuration peut continuer.
        </Alerte>
      )}

      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
        <div className="space-y-2">
          <div className="rounded-lg border p-2">
            <Calendar
              mode={lectureSeule ? undefined : 'range'}
              locale={fr}
              numberOfMonths={2}
              month={mois}
              onMonthChange={setMois}
              // Le calendrier ne sort pas de l'année en cours de configuration :
              // des vacances posées ailleurs n'y seraient jamais relues.
              {...bornesCalendrier(anneeScolaire)}
              selected={plage}
              onSelect={setPlage}
              /*
                ⚠️ LA COLONNE DES SEMAINES SCOLAIRES (2026-09-03, demande du
                porteur). Les vacances se déclarent presque toujours en semaines
                — « du 7 au 13 » est la S2 — et le chronogramme comme l'emploi
                du temps n'affichent QUE des numéros de semaine : sans elle, il
                fallait les compter à la main pour recouper.

                ⚠️ IMPORTÉE, PAS RECOPIÉE : c'est la MÊME colonne que les stages
                et les formations. Deux numérotations auraient fini par appeler
                la même semaine S12 ici et S13 là.
              */
              showWeekNumber
              {...colonneSemaine()}
              modifiers={{ ferie: datesFeriees, vacances: datesVacances }}
              modifiersClassNames={{
                ferie: 'bg-warning/20 font-medium rounded-md',
                vacances: 'bg-primary/10 rounded-md',
              }}
            />
          </div>

          {/*
            Sans cette légende, les jours colorés ne s'expliquent pas : on voit
            de l'ambre et du bleu sans savoir lequel est un férié.
          */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-warning/20" />
              Jour férié
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-primary/10" />
              Vacances déclarées
            </span>
          </div>

          {/*
            Les fériés des deux mois affichés, sous le calendrier et suivant sa
            navigation. Une case de 30 px ne peut pas porter « Anniversaire de
            la Marche Verte », encore moins en deux langues : le nom se lit ici,
            en regard du jour coloré.
          */}
          {feriesDuMois.length > 0 && (
            <ul className="space-y-1.5 rounded-lg bg-muted/50 p-3">
              {feriesDuMois.map((jour) => (
                <li key={`${jour.date}-${jour.intitule}`} className="flex gap-2 text-xs">
                  <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                    {courte(jour.date)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{jour.intitule}</span>
                    {jour.estime && (
                      <span className="ml-1 text-muted-foreground">(estimé)</span>
                    )}
                    {/*
                      `dir="rtl"` n'est pas décoratif : sans lui, un intitulé
                      arabe qui contient un chiffre ou une parenthèse se rend
                      dans le désordre.
                    */}
                    {jour.intituleAr && (
                      <span dir="rtl" lang="ar" className="block text-muted-foreground">
                        {jour.intituleAr}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          {/*
            Le nom ne se demande QU'UNE FOIS la période tracée. Un champ vide
            offert d'emblée, à côté d'un bouton désactivé, laissait croire que
            la saisie commençait là — alors qu'elle commence dans le calendrier.
          */}
          {lectureSeule ? null : plage?.from ? (
            <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Période sélectionnée
                </div>
                <div className="mt-0.5 text-sm font-medium">
                  {afficher(plage.from)} → {afficher(plage.to ?? plage.from)}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {compterJours(plage)} jour(s)
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="intitule-vacances">Nom de la période</Label>
                <div className="flex gap-2">
                  <Input
                    id="intitule-vacances"
                    value={intitule}
                    onChange={(e) => setIntitule(e.target.value)}
                    placeholder="Vacances de la Toussaint"
                    onKeyDown={(e) => e.key === 'Enter' && ajouter()}
                    autoFocus
                  />
                  <Button onClick={ajouter}>
                    <Plus className="h-4 w-4" />
                    Ajouter
                  </Button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPlage(undefined)}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Annuler la sélection
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <MousePointerClick className="h-4 w-4 shrink-0" />
              Cliquez le premier puis le dernier jour d&apos;une période dans le calendrier.
            </div>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              Périodes déclarées{toutes.length > 0 && ` (${toutes.length})`}
            </h3>

            {toutes.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <CalendarOff className="h-4 w-4 shrink-0" />
                Aucune pour l&apos;instant — vous pourrez en ajouter plus tard.
              </div>
            ) : (
              <ul className="space-y-2">
                {toutes.map((periode) => (
                  <li
                    key={`${periode.reseau ? 'reseau' : 'propre'}-${periode.debut}-${periode.intitule}`}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <div
                        className={cn(
                          'flex items-center gap-2 truncate text-sm font-medium',
                          /*
                            ⚠️ BARRÉE ET GRISÉE, pas retirée de la liste : une
                            période écartée doit rester visible, sinon on ne
                            pourrait plus la rétablir — et rien ne dirait qu'on a
                            pris cette décision.
                          */
                          periode.ecartee && 'line-through opacity-50'
                        )}
                      >
                        {periode.intitule}
                        {/*
                          ⚠️ L'ORIGINE EST DITE. Sans elle, on chercherait pourquoi
                          cette période n'a pas de corbeille — et on la croirait
                          saisie par erreur.
                        */}
                        {periode.reseau && (
                          <Badge variant="outline" className="shrink-0 font-normal">
                            Réseau
                          </Badge>
                        )}
                      </div>
                      <div
                        className={cn(
                          'text-xs text-muted-foreground',
                          periode.ecartee && 'opacity-50'
                        )}
                      >
                        {afficher(new Date(`${periode.debut}T00:00:00`))} →{' '}
                        {afficher(new Date(`${periode.fin}T00:00:00`))}
                      </div>
                    </div>

                    {lectureSeule ? null : periode.reseau ? (
                      onEcarter && (
                        <Button
                          variant={periode.ecartee ? 'outline' : 'ghost'}
                          size="sm"
                          className="shrink-0"
                          onClick={() => onEcarter(periode.intitule)}
                        >
                          {/* L'action dit ce qu'un clic PRODUIT, jamais l'état
                              courant : c'est le barré qui montre où l'on en est. */}
                          {periode.ecartee ? <Undo2 /> : <CalendarOff />}
                          {periode.ecartee ? 'Rétablir' : 'Écarter'}
                        </Button>
                      )
                    ) : (
                      <Button variant="ghost" size="icon" onClick={() => retirer(periode.index)}>
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Supprimer {periode.intitule}</span>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <PanneauJoursFeries jours={joursFeries} />
    </div>
  );
}

/** Nombre de jours d'une plage, bornes comprises. */
function compterJours(plage) {
  const debut = plage.from;
  const fin = plage.to ?? plage.from;
  return Math.round((fin - debut) / 86400000) + 1;
}

/** Date locale en `AAAA-MM-JJ`, sans passer par l'UTC (qui décalerait d'un jour). */
function enTexte(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

/** « lun. 30 mars » — assez court pour une colonne, assez clair pour situer. */
function courte(texte) {
  return new Date(`${texte}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function afficher(date) {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * ⚠️ L'APPARIEMENT D'UNE PÉRIODE ÉCARTÉE SE FAIT SUR SON NOM, insensible à la
 * casse et aux espaces — c'est la seule clé qui survive au décalage d'une
 * période par l'administrateur. C'est déjà la règle de `fusionnerVacances`.
 */
const cle = (valeur) => String(valeur ?? '').trim().toLowerCase();
