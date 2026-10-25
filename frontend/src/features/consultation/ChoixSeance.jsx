import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { JOURS, TYPES_COURS } from 'shared/constants';
import { SEANCES_JOUR, horaireCreneau, typeDeSeance } from 'shared/domain';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Alerte from '@/components/common/Alerte';
import { FOND_PRESENTIEL, FOND_SYNCHRONE } from '@/components/common/apparenceGrille';
import NavigationSemaine from '@/features/emploi/NavigationSemaine';
import { useHorairesCourants } from '@/features/horaires/useHorairesCourants';
import { useAnneeActive } from '@/lib/anneeActive';
import { cn } from '@/lib/utils';
import { chargerContexte, chargerSemaine, chargerSemaines } from '@/features/emploi/api';
import { chargerSemaineConsultation, chargerSemainesConsultation } from './api';

/**
 * La couleur d'une séance, celle de la grille Emploi (2026-10-26, demande du
 * porteur : « les séances TEAMS en violet ») — vert en salle, violet à distance.
 */
const fondSeance = (seance) =>
  typeDeSeance(seance) === TYPES_COURS.SYNCHRONE
    ? `${FOND_SYNCHRONE} hover:bg-accent-purple/40`
    : `${FOND_PRESENTIEL} hover:bg-accent-green/30`;

/** « 22/10 » depuis « 2026-10-22 ». */
const dateCourte = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

/**
 * ═══ CHOISIR UNE DE SES SÉANCES DANS SON EMPLOI DU TEMPS ═══ Extrait le
 * 2026-10-26 de la fiche de réclamation, quand la feuille de présence CC/EFM en a
 * demandé autant (« le même pour CC/EFM, je sélectionne la séance »).
 *
 * Les semaines PUBLIÉES et la grille de « Mon emploi du temps » — mêmes requêtes,
 * même cache, même sélecteur de semaine —, plutôt qu'une longue liste déroulante :
 * on retrouve une séance par le jour et le créneau où elle a eu lieu. Sur
 * téléphone, la grille cède la place à une liste par jour.
 *
 * ⚠️ LA SEMAINE AFFICHÉE VIT ICI : à monter dans le contenu d'une fenêtre, elle
 *    repart de la semaine en cours à chaque ouverture.
 *
 * ═══ `direction` : POUR LE DIRECTEUR ET LE GESTIONNAIRE (2026-10-26, demande du
 * porteur) ═══ L'emploi du temps de l'ÉTABLISSEMENT — les mêmes requêtes que la
 * page Emploi, semaines non publiées comprises, puisqu'ils les préparent —, et un
 * choix du FORMATEUR d'abord : la grille est la sienne. Seuls ceux qui ont cours
 * cette semaine-là sont proposés.
 *
 * @param {{ seance: object|null, onChoisir: (seance|null) => void, cleGuidage: string, direction?: boolean }} props
 */
export default function ChoixSeance({ seance, onChoisir, cleGuidage, direction = false }) {
  const [semaineChoisie, setSemaineChoisie] = useState(null);
  const [formateur, setFormateur] = useState(null);
  const anneeChoisie = useAnneeActive();
  const horaires = useHorairesCourants();

  const semaines = useQuery({
    queryKey: direction ? ['emploi', 'semaines'] : ['consultation', 'emploi', 'semaines'],
    queryFn: direction ? chargerSemaines : chargerSemainesConsultation,
    retry: false,
  });
  const semaine = semaineChoisie ?? semaines.data?.courante ?? null;
  const grille = useQuery({
    queryKey: direction ? ['emploi', 'semaine', semaine] : ['consultation', 'emploi', semaine],
    queryFn: () => (direction ? chargerSemaine(semaine) : chargerSemaineConsultation(semaine)),
    enabled: Boolean(semaine),
    retry: false,
  });
  const contexte = useQuery({
    queryKey: ['emploi', 'contexte'],
    queryFn: chargerContexte,
    enabled: direction,
    retry: false,
  });

  /* Les formateurs qui ont cours cette semaine, par nom — la direction choisit d'abord la personne. */
  const formateursDeLaSemaine = useMemo(() => {
    if (!direction) return [];
    const noms = new Map((contexte.data?.formateurs ?? []).map((f) => [f.matricule, f.nom]));
    const presents = new Set((grille.data?.seances ?? []).map((s) => s.formateurMatricule).filter(Boolean));
    return [...presents]
      .map((matricule) => ({ matricule, nom: noms.get(matricule) ?? matricule }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [direction, contexte.data, grille.data]);

  const grilleAffichee =
    direction && grille.data
      ? { ...grille.data, seances: (grille.data.seances ?? []).filter((s) => s.formateurMatricule === formateur) }
      : grille.data;

  // Changer de formateur change de grille : la séance choisie n'y est plus.
  const choisirFormateur = (matricule) => {
    setFormateur(matricule);
    onChoisir(null);
  };

  const plage = seance ? horaireCreneau(seance.jour, seance.seance, horaires) : null;
  const dateSeance = seance ? (grille.data?.jours ?? []).find((j) => j.jour === seance.jour)?.date : null;

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Séance</Label>
        <NavigationSemaine
          semaine={semaine}
          onChanger={setSemaineChoisie}
          anneeScolaire={anneeChoisie ?? grille.data?.anneeScolaire}
          remplies={semaines.data?.semaines ?? []}
          courante={semaines.data?.courante}
          /*
           * En LISTE dans les deux cas (2026-10-26, demande du porteur) : les semaines
           * publiées pour le formateur ; pour la direction, celles qui ont des séances,
           * publiées ou non — elle les prépare, et une semaine vide n'a rien à choisir.
           */
          semainesPermises={
            direction
              ? (semaines.data?.semaines ?? []).filter((s) => s.seances > 0).map((s) => s.semaine)
              : (semaines.data?.publications ?? [])
          }
          titreListe={direction ? 'Semaines avec des séances' : 'Semaines publiées'}
          cleGuidage={cleGuidage}
        />
      </div>

      {direction && (
        <Select value={formateur ?? ''} onValueChange={choisirFormateur} disabled={!grille.data}>
          <SelectTrigger className="h-9">
            <SelectValue
              placeholder={
                grille.data && formateursDeLaSemaine.length === 0
                  ? 'Aucun formateur n’a cours cette semaine'
                  : 'Choisissez le formateur'
              }
            />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {formateursDeLaSemaine.map((f) => (
              <SelectItem key={f.matricule} value={f.matricule}>
                {f.nom}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {semaines.isError || grille.isError ? (
        <Alerte type="erreur" titre="Emploi du temps indisponible">
          {(semaines.error ?? grille.error).message}
        </Alerte>
      ) : grille.isLoading || !grille.data ? (
        <p className="text-xs text-muted-foreground">Chargement de la semaine…</p>
      ) : grille.data.nonPubliee ? (
        <p className="text-xs text-muted-foreground">L’emploi du temps de cette semaine n’a pas encore été publié.</p>
      ) : direction && !formateur ? null : (
        <GrilleSeances grille={grilleAffichee} horaires={horaires} choisie={seance} onChoisir={onChoisir} />
      )}

      {seance && (
        <p className="rounded-md bg-primary/5 px-2.5 py-1.5 text-xs">
          <span className="font-medium">
            {seance.jour} {dateCourte(dateSeance)} · {plage.debut}–{plage.fin}
          </span>{' '}
          · {seance.groupe} · {seance.module}
          {seance.salle ? ` · ${seance.salle}` : ''}
        </p>
      )}
    </div>
  );
}

/**
 * La semaine du formateur, jours en lignes et créneaux en colonnes : une séance
 * se choisit d'un clic. Une case vide ne se choisit pas — il n'y avait pas cours.
 *
 * ⚠️ L'HEURE DES COLONNES EST CELLE DU LUNDI : le vendredi a les siennes. C'est
 *    pourquoi la séance choisie se redit en dessous avec SON horaire (`plage`).
 */
function GrilleSeances({ grille, horaires, choisie, onChoisir }) {
  const parCase = new Map(
    (grille.seances ?? [])
      .filter((s) => (s.periode ?? 'jour') === 'jour')
      .map((s) => [`${s.jour}|${s.seance}`, s])
  );
  const jours = grille.jours?.length ? grille.jours : JOURS.map((jour) => ({ jour }));

  if (parCase.size === 0) {
    return <p className="text-xs text-muted-foreground">Aucune séance cette semaine.</p>;
  }

  return (
    <>
      <ListeSeances jours={jours} parCase={parCase} horaires={horaires} choisie={choisie} onChoisir={onChoisir} />
      <TableauSeances jours={jours} parCase={parCase} horaires={horaires} choisie={choisie} onChoisir={onChoisir} />
    </>
  );
}

/**
 * SUR TÉLÉPHONE (`sm:hidden`) : un jour après l'autre, ses séances en boutons
 * pleine largeur — créneau et horaire DU JOUR compris, puisqu'il n'y a plus
 * d'en-tête de colonne pour les dire. Un jour sans cours n'apparaît pas.
 */
function ListeSeances({ jours, parCase, horaires, choisie, onChoisir }) {
  return (
    <div className="space-y-3 sm:hidden">
      {jours.map((j) => {
        const duJour = SEANCES_JOUR.map((creneau) => parCase.get(`${j.jour}|${creneau}`)).filter(Boolean);
        if (duJour.length === 0) return null;
        return (
          <div key={j.jour} className="space-y-1.5">
            <p className="text-xs font-semibold">
              {j.jour} <span className="font-normal text-muted-foreground">{dateCourte(j.date)}</span>
            </p>
            <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
              {duJour.map((s) => {
                const active = choisie?.id === s.id;
                const { debut, fin } = horaireCreneau(s.jour, s.seance, horaires);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChoisir(s)}
                    className={cn(
                      'min-w-0 rounded-md px-2.5 py-1.5 text-left text-xs leading-tight transition-colors',
                      active ? 'bg-primary text-primary-foreground' : fondSeance(s)
                    )}
                  >
                    <span className={cn('block', !active && 'text-muted-foreground')}>
                      {s.seance} · {debut}–{fin}
                    </span>
                    <span className="block truncate font-semibold">{s.groupe}</span>
                    <span className="block truncate">
                      {s.module}
                      {s.salle ? ` · ${s.salle}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** DÈS LA TABLETTE (`sm:block`) : la semaine d'un regard, jours en lignes et créneaux en colonnes. */
function TableauSeances({ jours, parCase, horaires, choisie, onChoisir }) {
  return (
    <div className="hidden overflow-x-auto rounded-md border sm:block">
      <table className="w-full table-fixed text-xs">
        <thead>
          <tr className="bg-muted/50">
            <th className="w-24 p-1.5 text-left font-medium">Jour</th>
            {SEANCES_JOUR.map((creneau) => {
              const { debut, fin } = horaireCreneau('Lundi', creneau, horaires);
              return (
                <th key={creneau} className="border-l p-1.5 font-medium">
                  {creneau}
                  <span className="block font-normal text-muted-foreground">
                    {debut}–{fin}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {jours.map((j) => (
            <tr key={j.jour} className="border-t">
              <td className="p-1.5">
                <span className="font-medium">{j.jour}</span>
                <span className="block text-muted-foreground">{dateCourte(j.date)}</span>
              </td>
              {SEANCES_JOUR.map((creneau) => {
                const s = parCase.get(`${j.jour}|${creneau}`);
                if (!s) return <td key={creneau} className="border-l" />;
                const active = choisie?.id === s.id;
                return (
                  <td key={creneau} className="border-l p-0.5">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChoisir(s)}
                      className={cn(
                        'w-full rounded px-1.5 py-1 text-center leading-tight transition-colors',
                        active ? 'bg-primary text-primary-foreground' : fondSeance(s)
                      )}
                    >
                      <span className="block truncate font-semibold">{s.groupe}</span>
                      <span className="block truncate">{s.module}</span>
                      <span className={cn('block truncate', !active && 'text-muted-foreground')}>
                        {s.salle || '—'}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
