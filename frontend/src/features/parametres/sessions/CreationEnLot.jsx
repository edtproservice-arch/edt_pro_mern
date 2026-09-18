import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motDePasseValide } from 'shared/schemas';
import Alerte from '@/components/common/Alerte';
import ReglesMotDePasse from '@/components/common/ReglesMotDePasse';
import { chargerCandidats, creerComptesEnLot } from '../comptesApi';
import ListeCandidats from './ListeCandidats';

/**
 * Création de comptes en masse pour un rôle.
 * ← create_user_account.php + le formulaire `#sessionForm` de profile.html
 *
 * Le mot de passe est COMMUN au lot, comme dans l'existant : on ne distribue pas
 * 38 mots de passe différents à la main. Chacun le changera depuis « Mon
 * profil » — c'est précisément ce que `PATCH /auth/mot-de-passe` a ajouté.
 */
export default function CreationEnLot({ role, libelle, aide, aideVide }) {
  const cache = useQueryClient();
  const [selection, setSelection] = useState([]);
  const [motDePasse, setMotDePasse] = useState('');
  const [bilan, setBilan] = useState(null);

  const candidats = useQuery({
    queryKey: ['comptes-candidats', role],
    queryFn: () => chargerCandidats(role),
    retry: false,
  });

  const creation = useMutation({
    mutationFn: () => creerComptesEnLot({ role, matricules: selection, motDePasse }),
    onSuccess: (resultat) => {
      setBilan(resultat);
      setSelection([]);
      setMotDePasse('');
      // La liste porte « compte existant » : elle est fausse dès la création.
      cache.invalidateQueries({ queryKey: ['comptes-candidats', role] });
      cache.invalidateQueries({ queryKey: ['comptes'] });

      toast.success(`${resultat.crees.length} compte(s) créé(s)`, {
        description:
          resultat.ignores.length > 0
            ? `${resultat.ignores.length} déjà existant(s), ignoré(s).`
            : undefined,
      });
    },
    onError: (erreur) => toast.error('Création impossible', { description: erreur.message }),
  });

  const personnes = candidats.data?.personnes ?? [];

  /*
   * ⚠️ `motDePasse.length >= 8` ne suffisait PAS : le serveur exige aussi une
   * majuscule, une minuscule et un chiffre. Le bouton s'activait donc sur
   * « aaaaaaaa », et l'envoi partait pour échouer en validation. On interroge
   * désormais la MÊME règle que le schéma.
   */
  const pret = selection.length > 0 && motDePasseValide(motDePasse);

  return (
    <div className="space-y-4">
      <Alerte type="info" titre={`Créez les comptes ${libelle.toLowerCase()}s`}>
        {aide}
      </Alerte>

      {/*
        ⚠️ L'ERREUR REMPLACE LA LISTE, elle ne s'ajoute pas à elle. Affichés
        ensemble, l'échec et le « Aucun formateur dans la base » de la liste vide
        se contredisent — et c'est la seconde phrase qu'on croit, parce qu'elle
        est affirmative. Un directeur en conclurait que sa base est vide.
      */}
      {candidats.isError ? (
        <Alerte type="erreur" titre="Liste indisponible">
          {candidats.error.message}
        </Alerte>
      ) : candidats.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <ListeCandidats
          personnes={personnes}
          selection={selection}
          onChange={setSelection}
          libelle={libelle}
          anneeScolaire={candidats.data?.anneeScolaire}
          aideVide={aideVide}
        />
      )}

      <div className="space-y-2 rounded-lg border p-4">
        <Label htmlFor="mot-de-passe-lot" className="flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          Mot de passe initial
        </Label>

        {/*
          ⚠️ Le champ et le bouton forment leur PROPRE rangée, et les textes
          d'aide passent dessous. Quand l'aide vivait dans la même colonne que le
          champ, `items-end` alignait le bouton sur le bas de cette aide : il
          flottait sous la ligne de saisie, décalé de deux lignes.
        */}
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="mot-de-passe-lot"
            type="text"
            value={motDePasse}
            onChange={(evenement) => setMotDePasse(evenement.target.value)}
            placeholder="8 caractères minimum"
            autoComplete="off"
            className="min-w-[14rem] flex-1"
          />

          <Button disabled={!pret || creation.isPending} onClick={() => creation.mutate()}>
            <UserPlus className="h-4 w-4" />
            {creation.isPending ? 'Création…' : `Créer ${selection.length} compte(s)`}
          </Button>
        </div>

        <ReglesMotDePasse valeur={motDePasse} />

        {/*
          En clair, et volontairement : le directeur doit pouvoir le lire pour le
          communiquer. Le masquer sur un mot de passe qu'il vient de choisir et
          qu'il va dicter n'apporte rien.
        */}
        <p className="text-xs text-muted-foreground">
          Le même pour tout le lot. Chacun pourra le changer depuis « Mon profil ».
        </p>
      </div>

      {/*
        Le bilan reste à l'écran, il ne part pas en toast : « 3 ignorés » et
        « 2 échecs » se lisent et se recoupent avec la liste, ce qu'un message
        qui disparaît ne permet pas.
      */}
      {bilan && (
        <Alerte
          type={bilan.echecs.length > 0 ? 'avertissement' : 'succes'}
          titre={`${bilan.crees.length} compte(s) créé(s)`}
        >
          <ul className="space-y-0.5">
            {bilan.ignores.length > 0 && (
              <li>{bilan.ignores.length} déjà existant(s), ignoré(s) — rien n&apos;a été écrasé.</li>
            )}
            {bilan.echecs.map((echec) => (
              <li key={echec.identifiant}>
                {echec.identifiant} — {echec.raison}
              </li>
            ))}
          </ul>
        </Alerte>
      )}
    </div>
  );
}
