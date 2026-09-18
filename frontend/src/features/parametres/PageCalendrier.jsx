import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import EtapeCalendrier from '@/features/configuration/etapes/EtapeCalendrier';
import {
  chargerCalendrier,
  chargerEtablissementCourant,
  enregistrerCalendrier,
} from '@/features/configuration/api';
import { useAnneeActive } from '@/lib/anneeActive';
import { proprietesEnregistrement, useBrouillonVersionne } from '@/lib/useBrouillonVersionne';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { useDroitPage } from '@/features/partages/useDroitPage';
import CadreReglage from './CadreReglage';

/**
 * Réglage du calendrier : périodes de vacances et fériés.
 * ← le panneau « calendrier » de profile.html
 *
 * L'année vient du sélecteur de la barre latérale : changer d'année ici doit
 * montrer LES FÉRIÉS DE CETTE ANNÉE, sinon on déclare des vacances sur un
 * calendrier qui n'est pas le bon.
 */
export default function PageCalendrier() {
  const { lectureSeule } = useDroitPage('calendrier');
  const choisie = useAnneeActive();

  const contexte = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    retry: false,
  });

  const enregistre = useQuery({
    queryKey: ['calendrier'],
    queryFn: chargerCalendrier,
    retry: false,
  });

  const annee = choisie ?? contexte.data?.anneeScolaire ?? null;

  /*
   * ⚠️ LES DEUX LISTES FORMENT LA VALEUR COMPARÉE. N'en surveiller qu'une
   * laisserait « Enregistrer » éteint après avoir écarté une période
   * nationale : le geste paraîtrait sans effet, et il serait perdu en
   * quittant la page.
   *
   * ═══ PARTAGEABLE (Phase 5bis, étape d3) ═══ Le calendrier part avec sa
   * version : si un collègue l'a enregistré entre-temps, le serveur refuse et
   * la page recharge — voir `useBrouillonVersionne`.
   */
  const lireCalendrier = (donnees) => ({
    vacances: donnees?.vacances ?? [],
    // Les périodes du réseau mises de côté par cet établissement.
    vacancesEcartees: donnees?.ecartees ?? [],
  });

  const edition = useBrouillonVersionne({
    donnees: enregistre.data,
    extraire: (donnees) => ({ valeur: lireCalendrier(donnees), version: donnees?.version ?? 0 }),
    enregistrer: async (valeur, version) => {
      const reponse = await enregistrerCalendrier({ anneeScolaire: annee, ...valeur, version });
      return { valeur: lireCalendrier(reponse), version: reponse.version };
    },
    relire: async () => (await enregistre.refetch()).data,
    onSucces: (resultat) =>
      toast.success('Calendrier enregistré', {
        description: `${resultat.valeur.vacances.length} période(s) de vacances.`,
      }),
  });
  const { brouillon: calendrier, setBrouillon: setCalendrier } = edition;

  return (
    <>
    <EnTetePartage page="calendrier" clesARelire={[['calendrier'], ['jours-feries']]} />
    <CadreReglage
      titre="Calendrier"
      chargement={enregistre.isLoading || !edition.charge || annee === null}
      /*
        Les DEUX requêtes comptent : sans l'établissement on ignore l'année, et
        un calendrier sans année afficherait les fériés d'une autre.
      */
      erreur={
        enregistre.isError
          ? enregistre.error.message
          : contexte.isError
            ? contexte.error.message
            : null
      }
      {...proprietesEnregistrement(edition, lectureSeule)}
    >
      {/*
        ═══ ⚠️ UNE SEULE LISTE, PLUS DE PANNEAU SÉPARÉ ═══
        (2026-09-03, demande du porteur : « supprime la partie vacances du réseau
        pour libérer l'espace ».) Les périodes du réseau rejoignent « Périodes
        déclarées » et se colorent dans le calendrier comme les autres — elles
        ferment bel et bien l'établissement.

        ⚠️ ELLES GARDENT LEUR ACTION PROPRE : « Écarter », jamais la corbeille.
        Une période nationale supprimée réapparaîtrait au prochain
        enregistrement de l'administrateur ; c'est `EtapeCalendrier` qui tient
        cette distinction, ligne par ligne.

        ⚠️ `EtapeCalendrier` NE RENVOIE QUE `vacances` : on ÉTALE sa réponse sur
        l'état courant, sinon chaque saisie de période effacerait les mises de
        côté.
      */}
      <EtapeCalendrier
        anneeScolaire={annee}
        valeur={calendrier ?? {}}
        onChange={(valeur) => setCalendrier((actuel) => ({ ...actuel, ...valeur }))}
        lectureSeule={lectureSeule}
        periodesReseau={enregistre.data?.nationales ?? []}
        ecartees={calendrier?.vacancesEcartees ?? []}
        onEcarter={lectureSeule ? undefined : (nom) =>
          setCalendrier((actuel) => {
            const deja = actuel?.vacancesEcartees ?? [];
            const identifiant = nom.trim().toLowerCase();
            return {
              ...actuel,
              vacancesEcartees: deja.some((autre) => autre.trim().toLowerCase() === identifiant)
                ? deja.filter((autre) => autre.trim().toLowerCase() !== identifiant)
                : [...deja, nom],
            };
          })
        }
      />
    </CadreReglage>
    </>
  );
}
