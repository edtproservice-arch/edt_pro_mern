import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Briefcase, GraduationCap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { chargerEtablissementCourant } from '@/features/configuration/api';

/**
 * ═══ « À VENIR » — STAGES ET FORMATIONS DE LA SEMAINE QUI VIENT ═══
 * (2026-10-10, demande du porteur : « en accueil chez le directeur ajoute (à
 * venir) pour afficher les stages des groupes et formations des formateurs à
 * venir d'une semaine d'avance, et chez le gestionnaire ».)
 *
 * Les périodes qui COMMENCENT dans les 7 prochains jours (aujourd'hui compris) :
 * le moment de prévenir un groupe qu'il part, ou de trouver qui remplacera un
 * formateur. Une période déjà commencée n'y est plus — elle se lit dans
 * Paramètres → Stages / Formations.
 *
 * Partagé entre les deux accueils, comme `StatistiquesAbsencesDiscipline`.
 * La lecture est celle de l'établissement courant (`/etablissements/courant`),
 * ouverte à tout compte de la direction — le gestionnaire compris.
 *
 * @param {boolean} [liens] — un lien vers les pages de saisie. ⚠️ FAUX pour le
 *   gestionnaire : Stages et Formations ne font pas partie de ses pages
 *   (`URLS_GESTIONNAIRE`), le lien mènerait à un écran refusé.
 */
const HORIZON_JOURS = 7;

export default function AVenirPeriodes({ liens = true }) {
  const contexte = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    retry: false,
  });

  if (contexte.isLoading || contexte.isError) return null;

  const aujourdhui = enTexte(new Date());
  const limite = enTexte(new Date(Date.now() + HORIZON_JOURS * 86400000));
  const prochaines = (liste) =>
    (liste ?? [])
      .filter((periode) => periode.debut >= aujourdhui && periode.debut <= limite)
      .sort((a, b) => a.debut.localeCompare(b.debut));

  const stages = prochaines(contexte.data?.etablissement?.stages);
  const formations = prochaines(contexte.data?.etablissement?.formations);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">À venir</h3>
        <span className="text-xs text-muted-foreground">les {HORIZON_JOURS} prochains jours</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Bloc
          titre="Stages des groupes"
          icone={Briefcase}
          vide="Aucun groupe ne part en stage cette semaine."
          vers={liens ? '/app/parametres/stages' : null}
          lignes={stages.map((stage) => ({
            cle: `${stage.groupe}-${stage.debut}`,
            nom: stage.groupe,
            ...stage,
          }))}
          aujourdhui={aujourdhui}
        />
        <Bloc
          titre="Formations des formateurs"
          icone={GraduationCap}
          vide="Aucun formateur ne part en formation cette semaine."
          vers={liens ? '/app/parametres/formations' : null}
          lignes={formations.map((formation) => ({
            cle: `${formation.matriculeFormateur}-${formation.debut}`,
            nom: formation.nomFormateur || formation.matriculeFormateur,
            ...formation,
          }))}
          aujourdhui={aujourdhui}
        />
      </div>
    </section>
  );
}

function Bloc({ titre, icone: Icone, vide, vers, lignes, aujourdhui }) {
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icone className="size-4 text-muted-foreground" />
          {titre}
          {lignes.length > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs tabular-nums">
              {lignes.length}
            </Badge>
          )}
        </div>
        {vers && (
          <Link
            to={vers}
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Voir tout
            <ArrowUpRight className="size-3" />
          </Link>
        )}
      </div>

      {lignes.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">{vide}</p>
      ) : (
        <ul className="max-h-64 divide-y overflow-y-auto">
          {lignes.map((ligne) => {
            const dans = ecart(aujourdhui, ligne.debut);
            return (
              <li key={ligne.cle} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{ligne.nom}</div>
                  <div className="text-xs tabular-nums text-muted-foreground">
                    {afficher(ligne.debut)} → {afficher(ligne.fin)} · {ecart(ligne.debut, ligne.fin) + 1} j
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={dans <= 1 ? 'border-warning/50 bg-warning/15 text-foreground' : 'border-primary/40 text-primary'}
                >
                  {dans === 0 ? "Aujourd'hui" : dans === 1 ? 'Demain' : `Dans ${dans} j`}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** « AAAA-MM-JJ » en heure LOCALE — `toISOString()` décalerait d'un jour. */
function enTexte(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

const afficher = (jour) =>
  new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });

/** Jours entre deux « AAAA-MM-JJ » — midi évite tout décalage d'heure d'été. */
const ecart = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
