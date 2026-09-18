import { toast } from 'sonner';
import EtapeEspaces from '@/features/configuration/etapes/EtapeEspaces';
import { enregistrerEspaces } from '@/features/configuration/api';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { useDroitPage } from '@/features/partages/useDroitPage';
import { proprietesEnregistrement } from '@/lib/useBrouillonVersionne';
import CadreReglage from './CadreReglage';
import { useListeEtablissement } from './useListeEtablissement';

/**
 * Réglage des espaces (salles).
 * ← api/profile/save_espaces.php + le panneau « espaces » de profile.html
 *
 * Réutilise `EtapeEspaces`, l'écran de l'assistant : une salle se saisit de la
 * même façon qu'on soit en configuration initiale ou en cours d'année. En
 * écrire un second créerait deux comportements à tenir cohérents.
 *
 * ═══ PARTAGEABLE (Phase 5bis, étape d3) ═══ Un invité « peut modifier » y
 * écrit, « peut consulter » la lit. La liste part avec sa version : si un
 * collègue l'a enregistrée entre-temps, le serveur refuse et la page recharge
 * — voir `useBrouillonVersionne`.
 */
export default function PageEspaces() {
  const { lectureSeule } = useDroitPage('espaces');
  const liste = useListeEtablissement('espaces', enregistrerEspaces, {
    onSucces: (resultat) =>
      toast.success('Espaces enregistrés', { description: `${resultat.valeur.length} espace(s).` }),
  });

  return (
    <>
      <EnTetePartage page="espaces" clesARelire={[['etablissement-courant']]} />
      <CadreReglage
        titre="Espaces"
        chargement={liste.contexte.isLoading || !liste.charge}
        erreur={liste.contexte.isError ? liste.contexte.error.message : null}
        {...proprietesEnregistrement(liste, lectureSeule)}
      >
        <EtapeEspaces
          valeur={liste.brouillon ?? []}
          onChange={liste.setBrouillon}
          lectureSeule={lectureSeule}
        />
      </CadreReglage>
    </>
  );
}
