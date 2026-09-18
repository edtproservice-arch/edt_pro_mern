import { useQuery } from '@tanstack/react-query';
import { ROLES } from 'shared/constants';
import { pagePrete } from 'shared/domain';
import { PortailEnTete } from '@/components/layout/enTetePage';
import { recupererSession } from '@/features/auth/api';
import AvatarsPresence from '@/features/tempsReel/AvatarsPresence';
import { useSallePage } from '@/features/tempsReel/useSallePage';
import { useAnneeActive } from '@/lib/anneeActive';
import BoutonPartager from './BoutonPartager';

/**
 * Avatars de présence et « Partager », dans la barre du haut, pour une page
 * partagée autre que l'emploi du temps (Phase 5bis, étape d).
 *
 * ⚠️ UN COMPOSANT POUR TOUTES LES PAGES : Absences, Chronogramme, EFM… Recopier
 * dans chacune la salle, les avatars et la boîte, c'était dix exemplaires de la
 * même barre — le §4.2 appliqué à un en-tête. L'emploi du temps garde le sien :
 * sa salle porte la semaine, les curseurs et la publication.
 *
 * @param {{ page: string, anneeScolaire?: number, clesARelire?: unknown[][] }} props
 */
export default function EnTetePartage({ page, anneeScolaire, clesARelire, salle }) {
  /*
   * ⚠️ UNE SALLE FOURNIE PAR LA PAGE (2026-09-13) : le chronogramme a besoin de
   * la sienne pour envoyer ses curseurs. Une seule entrée par page est possible
   * (`entrer` : « la dernière l'emporte ») — en rejoindre une seconde ici
   * l'aurait fait sortir de la première.
   */
  if (salle) return <AvatarsEtPartage page={page} salle={salle} />;
  return <EnTeteAutonome page={page} anneeScolaire={anneeScolaire} clesARelire={clesARelire} />;
}

function EnTeteAutonome({ page, anneeScolaire, clesARelire }) {
  const anneeActive = useAnneeActive();
  const salle = useSallePage(page, {
    anneeScolaire: anneeScolaire ?? anneeActive,
    clesARelire,
    /*
     * ⚠️ UNE ANNÉE ACTIVE VIDE N'EST PAS « PAS ENCORE CONNUE » : elle se lit
     * d'un coup dans le stockage local, et vide veut dire qu'aucune n'a jamais
     * été choisie — les requêtes partent alors SANS en-tête `X-Annee-Scolaire`,
     * et le serveur retient l'année par défaut de l'établissement. La salle
     * rejoint la même. Attendre une année qui ne viendra pas, c'était rester
     * « Hors ligne » : le formateur n'a même pas de sélecteur, et un directeur
     * qui n'y a jamais touché non plus (trouvé en vérifiant l'étape d2).
     */
    anneeParDefaut: true,
  });

  return <AvatarsEtPartage page={page} salle={salle} />;
}

function AvatarsEtPartage({ page, salle }) {
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const utilisateur = session.data?.utilisateur;

  return (
    <PortailEnTete>
      <AvatarsPresence membres={salle.membres} utilisateurId={salle.utilisateurId} statut={salle.statut} compact />
      {/* Au directeur seul : il est le seul à partager — le serveur refuse de toute façon.
          ⚠️ Et seulement sur une page qui se PARTAGE (2026-09-14 : Emploi,
          Chronogramme, Affectations) : ailleurs, la boîte n'aurait rien à ouvrir. */}
      {utilisateur?.role === ROLES.DIRECTEUR && pagePrete(page) && <BoutonPartager page={page} moi={utilisateur} />}
    </PortailEnTete>
  );
}
