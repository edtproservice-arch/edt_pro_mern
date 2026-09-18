import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import Alerte from '@/components/common/Alerte';
import { chargerBase, enregistrerFormations } from '@/features/configuration/api';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { useDroitPage } from '@/features/partages/useDroitPage';
import { proprietesEnregistrement } from '@/lib/useBrouillonVersionne';
import { useAnneeActive } from '@/lib/anneeActive';
import CadreReglage from './CadreReglage';
import ListePeriodes from './ListePeriodes';
import { useListeEtablissement } from './useListeEtablissement';

/**
 * Formations suivies par les formateurs.
 * ← table `formations` + le panneau « formations » de profile.html
 *
 * Un formateur en formation est indisponible : le générateur (Phase 6) ne doit
 * rien lui placer sur la période.
 */
export default function PageFormations() {
  /*
   * ═══ PARTAGEABLE (Phase 5bis, étape d3) ═══ La liste part avec sa version :
   * si un collègue l'a enregistrée entre-temps, le serveur refuse et la page
   * recharge — voir `useBrouillonVersionne`. Un invité « peut consulter » la lit.
   */
  const { lectureSeule } = useDroitPage('formations');
  const liste = useListeEtablissement('formations', enregistrerFormations, {
    onSucces: (resultat) =>
      toast.success('Formations enregistrées', { description: `${resultat.valeur.length} période(s).` }),
  });
  const { contexte, brouillon: formations, setBrouillon: setFormations } = liste;

  const choisie = useAnneeActive();

  const base = useQuery({ queryKey: ['base'], queryFn: chargerBase, retry: false });


  const annee = choisie ?? contexte.data?.anneeScolaire ?? null;



  /*
   * Seuls les formateurs qui PORTENT UN MATRICULE sont proposés : l'appariement
   * se fait dessus. Un formateur sans matricule ne serait reconnaissable que par
   * son nom — appariement que le domaine refuse depuis qu'une valeur vide y
   * rendait TOUS les formateurs indisponibles sur la période.
   */
  const formateurs = (base.data?.base?.formateurs ?? [])
    .filter((formateur) => String(formateur.matricule ?? '').trim() !== '')
    .map((formateur) => ({
      valeur: formateur.matricule,
      libelle: `${formateur.nomComplet} · ${formateur.matricule}`,
      nom: formateur.nomComplet,
    }));

  const sansMatricule = (base.data?.base?.formateurs ?? []).length - formateurs.length;

  return (
    <>
    <EnTetePartage page="formations" clesARelire={[['etablissement-courant'], ['base']]} />
    <CadreReglage
      titre="Formations"
      chargement={contexte.isLoading || !liste.charge}
      erreur={contexte.isError ? contexte.error.message : null}
      {...proprietesEnregistrement(liste, lectureSeule)}
    >
      {/* <Alerte type="info" titre="Déclarez les formations des formateurs">
        Un formateur en formation est indisponible : aucune séance ne lui sera placée sur la
        période.
      </Alerte> */}

      {sansMatricule > 0 && (
        <Alerte type="avertissement" titre={`${sansMatricule} formateur(s) sans matricule`}>
          Ils ne peuvent pas être sélectionnés ici : la période s&apos;applique par matricule.
          Renseignez-le depuis « Formateurs ».
        </Alerte>
      )}

      <ListePeriodes
        periodes={formations ?? []}
        onChange={setFormations}
        lectureSeule={lectureSeule}
        sujets={formateurs}
        cle={(sujet) => ({ matriculeFormateur: sujet.valeur, nomFormateur: sujet.nom })}
        couleur="gris"
        anneeScolaire={annee}
        libelleSujet="Formateur"
        libelleVide="Aucune formation déclarée."
        aideVide="Tous les formateurs restent disponibles toute l'année."
      />
    </CadreReglage>
    </>
  );
}
