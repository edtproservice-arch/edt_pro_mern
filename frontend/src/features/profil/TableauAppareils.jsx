import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Laptop, Smartphone, Tablet, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { chargerAppareils, revoquerAppareil, revoquerAutresAppareils } from '@/features/auth/api';
import { Ligne, Section } from './Reglages';

/**
 * Appareils connectés, et révocation.
 * ← api/profile/sessions.php + revoke_session.php + revoke_all_sessions.php
 *
 * ═══ POURQUOI CET ÉCRAN COMPTE ═══
 * C'est le seul endroit où l'on voit qu'une session tourne ailleurs. Un
 * directeur connecté depuis un poste partagé n'a pas d'autre moyen de le
 * refermer à distance — et la table `sessions` de l'existant vivait sans
 * qu'aucun écran ne la montre.
 */
export default function TableauAppareils() {
  const cache = useQueryClient();
  const [aRevoquer, setARevoquer] = useState(null);
  const [toutRevoquer, setToutRevoquer] = useState(false);

  const appareils = useQuery({ queryKey: ['appareils'], queryFn: chargerAppareils, retry: false });
  const liste = appareils.data?.appareils ?? [];
  const autres = liste.filter((appareil) => !appareil.courant).length;

  const rafraichir = () => cache.invalidateQueries({ queryKey: ['appareils'] });

  const revocation = useMutation({
    mutationFn: (id) => revoquerAppareil(id),
    onSuccess: () => {
      setARevoquer(null);
      rafraichir();
      toast.success('Appareil déconnecté');
    },
    onError: (erreur) => toast.error('Révocation impossible', { description: erreur.message }),
  });

  const revocationTotale = useMutation({
    mutationFn: revoquerAutresAppareils,
    onSuccess: (resultat) => {
      setToutRevoquer(false);
      rafraichir();
      toast.success(`${resultat.revoques} appareil(s) déconnecté(s)`);
    },
    onError: (erreur) => toast.error('Révocation impossible', { description: erreur.message }),
  });

  return (
    <>
      <Section titre="Appareils">
        <Ligne
          titre="Se déconnecter des autres appareils"
          description="Ferme toutes vos sessions ailleurs. Celle-ci reste ouverte."
          action={
            <Button
              variant="ghost"
              size="sm"
              // Rouge DOUX, pas plein : l'action est irréversible mais
              // ordinaire. Un bouton rouge saturé sur un écran de réglages
              // attire l'œil avant tout le reste.
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
              disabled={autres === 0 || revocationTotale.isPending}
              onClick={() => setToutRevoquer(true)}
            >
              Se déconnecter partout
            </Button>
          }
        />
      </Section>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Nom de l&apos;appareil</th>
              <th className="py-2 font-normal">Dernière activité</th>
              <th className="py-2 font-normal">Adresse IP</th>
              <th className="w-10 py-2" />
            </tr>
          </thead>

          <tbody className="divide-y">
            {liste.map((appareil) => (
              <tr key={appareil.id}>
                <td className="py-3">
                  <div className="flex items-start gap-2.5">
                    <Icone type={appareil.appareil?.type} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {libelleAppareil(appareil.appareil)}
                      </div>
                      {/*
                        Signaler la session COURANTE évite de se déconnecter
                        soi-même en croyant fermer celle d'un autre poste.
                      */}
                      {appareil.courant && (
                        <div className="text-xs text-primary">Cet appareil</div>
                      )}
                    </div>
                  </div>
                </td>

                <td className="py-3 text-muted-foreground">{quand(appareil.derniereActivite)}</td>
                <td className="py-3 text-muted-foreground">{appareil.ip || '—'}</td>

                <td className="py-3 text-right">
                  {!appareil.courant && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setARevoquer(appareil)}
                      disabled={revocation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">
                        Déconnecter {libelleAppareil(appareil.appareil)}
                      </span>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {appareils.isLoading && <div className="flex justify-center py-3"><IndicateurChargement /></div>}

        {appareils.isError && (
          <p className="py-3 text-sm text-muted-foreground">
            La liste n&apos;a pas pu être chargée.
          </p>
        )}

        {!appareils.isLoading && !appareils.isError && liste.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">Aucune session enregistrée.</p>
        )}
      </div>

      <ConfirmationAction
        ouvert={Boolean(aRevoquer)}
        onOpenChange={(ouvert) => !ouvert && setARevoquer(null)}
        titre="Déconnecter cet appareil ?"
        description={
          aRevoquer
            ? `« ${libelleAppareil(aRevoquer.appareil)} » devra se reconnecter. ` +
              `Une saisie en cours sur ce poste serait perdue.`
            : ''
        }
        libelleConfirmation="Déconnecter"
        destructive
        onConfirmer={() => revocation.mutate(aRevoquer.id)}
      />

      <ConfirmationAction
        ouvert={toutRevoquer}
        onOpenChange={setToutRevoquer}
        titre="Se déconnecter de tous les autres appareils ?"
        description={`${autres} session(s) seront fermées. Cet appareil reste connecté, et une saisie en cours ailleurs serait perdue.`}
        libelleConfirmation="Se déconnecter partout"
        destructive
        onConfirmer={() => revocationTotale.mutate()}
      />
    </>
  );
}

/*
 * ⚠️ `appareil` est un SOUS-DOCUMENT `{nom, navigateur, os, type}`, pas une
 * chaîne. Le rendre directement faisait planter React — « Objects are not valid
 * as a React child ». Le serveur remplit ses champs avec « inconnu » quand le
 * client n'envoie rien : ces valeurs sont traitées comme absentes, sans quoi la
 * ligne affichait « inconnu sur inconnu ».
 */
const renseigne = (valeur) => {
  const texte = String(valeur ?? '').trim();
  return texte === '' || texte.toLowerCase() === 'inconnu' ? null : texte;
};

/** « Chrome sur Windows », ou le nom déclaré, ou un repli honnête. */
function libelleAppareil(appareil) {
  const navigateur = renseigne(appareil?.navigateur);
  const os = renseigne(appareil?.os);

  if (navigateur && os) return `${navigateur} sur ${os}`;
  if (navigateur || os) return navigateur ?? os;

  return renseigne(appareil?.nom) ?? 'Appareil inconnu';
}

/** L'icône dit le TYPE de poste : un téléphone n'est pas un bureau. */
function Icone({ type }) {
  const Composant = type === 'mobile' ? Smartphone : type === 'tablet' ? Tablet : Laptop;
  return <Composant className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
}

/** Date lisible, ou un repli quand elle manque. */
function quand(valeur) {
  if (!valeur) return 'inconnue';

  const date = new Date(valeur);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);

  // « À l'instant » plutôt qu'une date : c'est ainsi qu'on reconnaît sa propre
  // session dans la liste.
  if (minutes < 2) return "À l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;

  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
