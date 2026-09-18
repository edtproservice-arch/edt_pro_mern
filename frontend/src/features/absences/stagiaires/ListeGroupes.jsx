import { useQuery } from '@tanstack/react-query';
import Alerte from '@/components/common/Alerte';
import ListeRepliable from '../ListeRepliable';
import { chargerGroupes } from './api';

/**
 * ═══ LES GROUPES EN LISTE, LEURS STAGIAIRES DANS LE TABLEAU ═══ (2026-09-14,
 * demande du porteur : « en stagiaire, s'affichent les groupes en liste, puis
 * les stagiaires avec le tableau qui existait précédemment ».) Remplace la liste
 * déroulante « Choisir un groupe » du registre et des notes.
 *
 * ⚠️ CE SONT LES GROUPES DES STAGIAIRES, pas ceux de la carte : un groupe sans
 * stagiaire importé n'aurait personne à montrer, et le proposer mènerait à un
 * tableau vide qu'on mettrait sur le compte de l'écran.
 *
 * ⚠️ LE TABLEAU NE SE CHARGE QU'À L'OUVERTURE du groupe (`ListeRepliable` démonte
 * le détail replié) : trente groupes ouverts d'un coup, ce serait trente
 * requêtes — et trente calculs de notes — pour en lire un.
 *
 * @param {(groupe: string) => import('react').ReactNode} detail
 */
export default function ListeGroupes({ detail }) {
  const groupes = useQuery({ queryKey: ['absences-stagiaires', 'groupes'], queryFn: chargerGroupes, retry: false });

  if (groupes.isLoading) return <p className="text-sm text-muted-foreground">Chargement des groupes…</p>;
  if (groupes.error) return <Alerte type="erreur" titre="Groupes indisponibles">{groupes.error.message}</Alerte>;

  return (
    <ListeRepliable
      elements={groupes.data?.groupes ?? []}
      cleDe={(g) => g.groupe}
      texteRecherche={(g) => g.groupe}
      placeholder="Filtrer par groupe…"
      vide="Aucun stagiaire dans la base de l’année — importez la base Konosys depuis « Documents »."
      entete={(g) => ({
        titre: g.groupe,
        droite: <span className="text-muted-foreground">{g.effectif} stagiaire(s)</span>,
      })}
      detail={(g) => detail(g.groupe)}
    />
  );
}
