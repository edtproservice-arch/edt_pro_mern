import { useQuery } from '@tanstack/react-query';
import { ROLES } from 'shared/constants';
import { Badge } from '@/components/ui/badge';
import CadreReglage from '@/features/parametres/CadreReglage';
import { Section } from '@/features/profil/Reglages';
import BadgeSanction from '@/features/absences/stagiaires/BadgeSanction';
import { Synthese } from '@/features/absences/stagiaires/FicheStagiaire';
import { chargerMesAbsences } from './api';

/**
 * « Mes absences » — sessions consultatives formateur & stagiaire (F14).
 *
 * (2026-09-24, demande du porteur : « au lieu qu'elle soit dans la page
 * Compte, met dans une nouvelle page ».) Le contenu ne change pas — c'est le
 * MÊME appel serveur (`GET /consultation/absences`, scopé au matricule du
 * jeton) — seul l'emplacement change : une page à elle, comme « Mon emploi du
 * temps » et « Mon avancement », plutôt qu'une section de plus sous « Compte ».
 *
 *   - formateur : ses absences au registre et leur rattrapage ;
 *   - stagiaire : sa note de discipline, puis ses absences, retards et indisciplines.
 *
 * Lecture seule : justifier ou sanctionner reste l'affaire de l'encadrement.
 */
export default function PageMesAbsences() {
  const requete = useQuery({
    queryKey: ['mes-absences'],
    queryFn: chargerMesAbsences,
    retry: false,
  });

  const donnees = requete.data;
  const estStagiaire = donnees?.role === ROLES.STAGIAIRE;

  return (
    <CadreReglage
      titre="Mes absences"
      chargement={requete.isLoading}
      erreur={requete.isError ? requete.error.message : null}
    >
      {donnees && !estStagiaire && (
        <Section titre={`Registre (${donnees.absences.length})`}>
          {donnees.absences.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Aucune absence enregistrée cette année.</p>
          ) : (
            donnees.absences.map((absence) => (
              <div key={absence.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {dateLisible(absence.dateAbsence)} · {absence.seance}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {[absence.groupe, absence.module, absence.moduleIntitule].filter(Boolean).join(' · ')}
                  </p>
                  {absence.observation && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{absence.observation}</p>
                  )}
                </div>
                {absence.dateRattrapage ? (
                  <Badge variant="outline" className="border-success/30 text-success">
                    Rattrapée le {dateLisible(absence.dateRattrapage)}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-warning/30 text-warning">
                    Non rattrapée
                  </Badge>
                )}
              </div>
            ))
          )}
        </Section>
      )}

      {donnees && estStagiaire && (
        <>
          <Section titre="Note de discipline">
            <div className="py-4">
              <Synthese note={donnees.note} />
            </div>
          </Section>

          <Section titre={`Absences et retards (${donnees.absences.length})`}>
            {donnees.absences.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">Aucune absence ni retard cette année.</p>
            ) : (
              donnees.absences.map((absence) => (
                <div key={absence.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {dateLisible(absence.date)} · {absence.seance}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {[absence.module, absence.motif].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Badge variant="outline" className="font-normal">
                      {absence.type === 'retard' ? 'Retard' : 'Absence'}
                    </Badge>
                    {absence.justifiee ? (
                      <Badge variant="outline" className="border-success/30 text-success">Justifiée</Badge>
                    ) : (
                      <Badge variant="outline" className="border-destructive/30 text-destructive">Non justifiée</Badge>
                    )}
                  </div>
                </div>
              ))
            )}
          </Section>

          <Section titre={`Indisciplines (${donnees.indisciplines.length})`}>
            {donnees.indisciplines.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">Aucune indiscipline signalée.</p>
            ) : (
              donnees.indisciplines.map((ind) => (
                <div key={ind.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{dateLisible(ind.date)}</div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {[ind.motif, ind.observation].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <BadgeSanction sanction={ind.sanction} />
                </div>
              ))
            )}
          </Section>
        </>
      )}
    </CadreReglage>
  );
}

/** « 2026-09-23 » → « mer. 23 sept. 2026 ». */
function dateLisible(jour) {
  if (!jour) return '—';
  const date = new Date(`${String(jour).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(jour);
  return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
