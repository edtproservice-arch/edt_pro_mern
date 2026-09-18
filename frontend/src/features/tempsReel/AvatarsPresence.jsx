import { libelleSemaine } from 'shared/domain';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { libelleRole } from '@/features/admin/components/roles';
import { initiales } from '@/lib/initiales';
import { cn } from '@/lib/utils';
import { couleurPresence } from './couleurs';

const LIBELLES_DROIT = { modifier: 'peut modifier', consulter: 'peut consulter' };

/** Au-delà, on compte : une pile de dix avatars mangerait la rangée d'outils. */
const VISIBLES = 4;

const ETATS = {
  connecte: { point: 'bg-success', libelle: 'En direct' },
  connexion: { point: 'bg-warning', libelle: 'Connexion…' },
  reconnexion: { point: 'bg-warning animate-pulse', libelle: 'Reconnexion…' },
  arrete: { point: 'bg-muted-foreground/50', libelle: 'Hors ligne' },
  inactif: { point: 'bg-muted-foreground/50', libelle: 'Hors ligne' },
};

function detailVue(vue, semaineCourante, droit) {
  // ⚠️ Le DROIT prime sur l'écran : quelqu'un qui ne peut que consulter ne
  // « modifie » pas, même depuis l'écran de saisie.
  const morceaux = [vue?.ecran === 'edition' || droit === 'consulter' ? 'Consulte' : 'Modifie'];
  if (vue?.semaine) {
    const court = libelleSemaine(vue.semaine, { court: true });
    morceaux.push(vue.semaine === semaineCourante ? `${court} — la même semaine que vous` : court);
  }
  if (vue?.periode === 'soir') morceaux.push('grille du soir');
  return morceaux.join(' · ');
}

/**
 * Qui d'autre est sur la page — la pile d'avatars de Notion, en tête d'écran.
 *
 * ⚠️ SOI-MÊME N'Y FIGURE PAS : on sait qu'on est là. Seuls les AUTRES
 * apprennent quelque chose à l'écran, et une pile qui ne contient que son
 * propre avatar se lirait comme « quelqu'un d'autre est connecté ».
 *
 * ⚠️ UN COLLÈGUE SUR UNE AUTRE SEMAINE EST ESTOMPÉ, pas retiré : il est bien
 * sur l'emploi du temps — ses écritures changent les taux de l'année — mais il
 * ne risque pas de modifier la case qu'on regarde.
 */
export default function AvatarsPresence({ membres, utilisateurId, statut, semaine, compact = false, className }) {
  const autres = membres.filter((m) => m.id !== utilisateurId);
  const etat = ETATS[statut] ?? ETATS.inactif;
  const visibles = autres.slice(0, VISIBLES);
  const reste = autres.length - visibles.length;

  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn('flex items-center gap-2', className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              aria-label={`Collaboration : ${etat.libelle}`}
            >
              <span className={cn('size-2 rounded-full', etat.point)} aria-hidden="true" />
              {/* Le libellé seul quand il n'y a personne : sans avatar à côté, un
                  point coloré isolé ne dirait rien. */}
              {/* ⚠️ `compact` : dans une rangée déjà pleine (Emploi, avec « Partager »),
                  le libellé repoussait le compteur et la bascule d'axe sur deux
                  lignes. Le point reste, et son infobulle dit l'état. */}
              {autres.length === 0 && !compact && etat.libelle}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {statut === 'connecte'
              ? autres.length === 0
                ? 'Personne d’autre sur l’emploi du temps. Les modifications des collègues apparaîtront ici en direct.'
                : 'Les modifications des collègues apparaissent en direct.'
              : statut === 'arrete'
                ? 'La collaboration en direct est interrompue. Rechargez la page pour la rétablir.'
                : 'Rétablissement de la collaboration en direct…'}
          </TooltipContent>
        </Tooltip>

        {autres.length > 0 && (
          <ul className="flex items-center -space-x-2" aria-label={`${autres.length} autre(s) personne(s) sur la page`}>
            {visibles.map((membre) => {
              const couleur = couleurPresence(membre.id);
              const ailleurs = semaine && membre.vue?.semaine && membre.vue.semaine !== semaine;

              return (
                // Fond OPAQUE sous la pastille translucide : les avatars se
                // chevauchent, et l'un se lirait à travers l'autre.
                <li key={membre.id} className="rounded-full bg-background">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          'flex size-7 items-center justify-center rounded-full text-[0.65rem] font-semibold ring-2 ring-background transition-opacity',
                          couleur.pastille,
                          ailleurs && 'opacity-40'
                        )}
                        aria-label={`${membre.nom}, ${detailVue(membre.vue, semaine, membre.droit)}`}
                      >
                        {initiales(membre.nom)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64">
                      <p className="font-semibold">{membre.nom}</p>
                      <p className="opacity-80">
                        {libelleRole(membre.role)}
                        {/* Ce qu'il PEUT faire sur la page : un invité « peut consulter »
                            regarde, il ne modifiera rien sous vos yeux. */}
                        {membre.droit && membre.droit !== 'proprietaire' && ` · ${LIBELLES_DROIT[membre.droit] ?? ''}`}
                      </p>
                      <p className="opacity-80">{detailVue(membre.vue, semaine, membre.droit)}</p>
                      {membre.onglets > 1 && <p className="opacity-80">{membre.onglets} onglets ouverts</p>}
                      {/* ⚠️ Une session usurpée est DITE : ce n'est pas le
                          directeur lui-même qui regarde, c'est l'administration. */}
                      {membre.usurpePar && (
                        <p className="opacity-80">Via l’administration ({membre.usurpePar})</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
            {reste > 0 && (
              <li>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex size-7 items-center justify-center rounded-full bg-muted text-[0.65rem] font-semibold text-muted-foreground ring-2 ring-background">
                      +{reste}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {autres
                      .slice(VISIBLES)
                      .map((m) => m.nom)
                      .join(', ')}
                  </TooltipContent>
                </Tooltip>
              </li>
            )}
          </ul>
        )}
      </div>
    </TooltipProvider>
  );
}
