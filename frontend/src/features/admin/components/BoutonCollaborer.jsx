import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Users } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { Button } from '@/components/ui/button';
import { definirAnneeActive } from '@/lib/anneeActive';
import { collaborerAvec } from '../api';

/**
 * « Collaborer » — à côté de « Se connecter » (2026-09-14, demande du porteur).
 *
 * ═══ CE QUI LE DISTINGUE DE « SE CONNECTER » ═══
 * « Se connecter » prend la PLACE du compte ; « Collaborer » rejoint son
 * établissement EN SON NOM : les collègues voient « Administrateur » dans la pile
 * d'avatars, et l'admin n'a que le droit d'un invité « peut modifier » sur
 * l'emploi du temps, le chronogramme et les affectations — ni publier, ni
 * importer, ni partager.
 *
 * ⚠️ PAS SUR UN ADMINISTRATEUR, NI SUR UN COMPTE SANS ÉTABLISSEMENT (un
 * directeur encore en attente) : le serveur les refuse, et une action offerte
 * qui échoue toujours est un défaut.
 *
 * ⚠️ LE CACHE EST VIDÉ : les listes d'administration n'ont rien à faire dans la
 * session de collaboration, et l'inverse au retour.
 */
export default function BoutonCollaborer({ compte, desactive = false }) {
  const navigate = useNavigate();
  const cache = useQueryClient();

  const collaborer = useMutation({
    mutationFn: () => collaborerAvec(compte.id),
    onSuccess: (reponse) => {
      /*
       * ⚠️ L'ANNÉE ACTIVE EST REMISE À ZÉRO : celle qu'une usurpation précédente a
       * laissée dans ce navigateur partirait avec chaque requête, et pourrait ne
       * pas être celle de cet établissement — les pages s'ouvriraient vides.
       * Sans elle, le serveur retient l'année de l'établissement.
       */
      definirAnneeActive(null);
      cache.clear();
      toast.success(`Collaboration avec ${reponse.etablissement?.nom ?? 'l’établissement'}`);
      navigate('/app/emploi');
    },
    onError: (erreur) => toast.error('Collaboration impossible', { description: erreur.message }),
  });

  if (compte.role === ROLES.ADMIN || !(compte.nombreEtablissements > 0)) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={desactive || collaborer.isPending}
      onClick={() => collaborer.mutate()}
      title="Rejoindre les pages collaboratives de son établissement, en votre nom"
    >
      <Users />
      Collaborer
    </Button>
  );
}
