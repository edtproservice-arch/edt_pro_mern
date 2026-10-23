import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TYPES } from 'shared/domain';
import Alerte from '@/components/common/Alerte';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fixerBasculeReaffectation } from './api';

/** « Bascule lue dans l'emploi » ne se choisit pas comme une semaine : une valeur à part. */
const DEPUIS_EMPLOI = 'emploi';
/** « Ce n'était pas une réaffectation » (2026-10-23) : un remplaçant, à écarter. */
const IGNORER = 'ignorer';

const dateFr = (valeur) => (valeur ? new Date(valeur).toLocaleDateString('fr-FR') : null);

/** D'où vient la bascule, et qui l'a dit. */
function provenance(ancien) {
  if (ancien.source === 'manuel') return `fixée à la main${ancien.auteur ? ` par ${ancien.auteur}` : ''}`;
  const lue = "lue dans l'emploi du temps";
  if (ancien.source === 'journal') {
    const quand = dateFr(ancien.date);
    return `${lue} — réaffecté${quand ? ` le ${quand}` : ''}${ancien.auteur ? ` par ${ancien.auteur}` : ''}`;
  }
  return `${lue} (réaffectation antérieure au journal)`;
}

/**
 * ═══ LA TRACE D'UN MODULE RÉAFFECTÉ (2026-10-22, demande du porteur) ═══
 * Au-dessus de la grille d'un groupe : qui avait le module, qui l'a repris, à
 * partir de quelle semaine, et d'où vient cette bascule. Elle se corrige ici
 * quand l'emploi du temps se trompe — la ligne de chacun suit aussitôt.
 */
export default function JournalReaffectations({ groupe, lignes, semaines, lectureSeule }) {
  const cache = useQueryClient();
  const fixer = useMutation({
    /*
     * ⚠️ UNE LIGNE PORTE PARFOIS LES DEUX TYPES (présentiel et synchrone repris
     *    ensemble, à la même semaine) : la bascule se fixe alors sur chacun.
     */
    mutationFn: async ({ types, ...reste }) => {
      for (const type of types) await fixerBasculeReaffectation({ ...reste, type });
    },
    onSuccess: () => {
      cache.invalidateQueries({ queryKey: ['chronogramme', groupe] });
      cache.invalidateQueries({ queryKey: ['chronogramme-formateur'] });
      toast.success('Bascule enregistrée');
    },
    onError: (erreur) => toast.error('Bascule non enregistrée', { description: erreur.message }),
  });

  const reprises = lignes.filter((ligne) => ligne.reprisDe?.length > 0);
  if (reprises.length === 0) return null;

  const derniere = Math.max(...semaines.map((semaine) => semaine.numero), 1);

  return (
    <Alerte type="info" titre="Modules réaffectés en cours d'année">
      <ul className="mt-1 space-y-1.5">
        {reprises.flatMap((ligne) =>
          ligne.reprisDe.map((ancien) => {
            const masses = ligne.massesTotales ?? ligne.masses ?? {};
            const types = ligne.typeSeul
              ? [ligne.typeSeul]
              : [TYPES.PRESENTIEL, TYPES.SYNCHRONE].filter(
                  (type) => (type === TYPES.SYNCHRONE ? masses.synchrone : masses.presentiel) > 0
                );
            return (
              <li
                key={`${ligne.code}-${types.join('')}-${ancien.ancien}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1"
              >
                <span>
                  <strong>{ligne.code}</strong>
                  {ligne.typeSeul ? ` (${ligne.typeSeul === TYPES.SYNCHRONE ? 'synchrone' : 'présentiel'})` : ''} :{' '}
                  {ancien.nom} → {ligne.formateurs?.join(' · ')} — bascule après <strong>S{ancien.derniereSemaine}</strong>
                </span>
                <span className="text-muted-foreground">({provenance(ancien)})</span>
                {!lectureSeule && (
                  <Select
                    value={ancien.source === 'manuel' ? String(ancien.derniereSemaine) : DEPUIS_EMPLOI}
                    disabled={fixer.isPending}
                    onValueChange={(valeur) =>
                      fixer.mutate({
                        groupe,
                        module: ligne.code,
                        types,
                        ancien: ancien.ancien,
                        derniereSemaine: valeur === DEPUIS_EMPLOI || valeur === IGNORER ? null : Number(valeur),
                        ignoree: valeur === IGNORER,
                      })
                    }
                  >
                    <SelectTrigger className="h-7 w-auto gap-1 px-2 text-xs" aria-label="Corriger la bascule">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEPUIS_EMPLOI}>D’après l’emploi du temps</SelectItem>
                      {Array.from({ length: derniere }, (_, rang) => rang + 1).map((numero) => (
                        <SelectItem key={numero} value={String(numero)}>
                          Fin en S{numero}
                        </SelectItem>
                      ))}
                      <SelectItem value={IGNORER}>Ce n’était pas une réaffectation (remplacement)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </li>
            );
          })
        )}
      </ul>
    </Alerte>
  );
}
