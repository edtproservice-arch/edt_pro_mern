import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, ShieldCheck, ShieldOff, Trash2, UserPlus } from 'lucide-react';
import { creationDirecteurComplexeSchema, motDePasseValide } from 'shared/schemas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Alerte from '@/components/common/Alerte';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import ReglesMotDePasse from '@/components/common/ReglesMotDePasse';
import {
  autoriserCompteComplexe,
  chargerComptesComplexe,
  creerCompteComplexe,
  retirerCompteComplexe,
  supprimerCompteComplexe,
} from '../comptesApi';

/**
 * ═══ DIRECTEUR DE COMPLEXE, DANS « SESSIONS » (2026-10-27, demande du porteur) ═══
 *
 * Le directeur de complexe CONSULTE, en lecture seule, les établissements de son
 * complexe qui l'y ont autorisé. Ici, le directeur de CET établissement :
 *   - crée un compte (il est aussitôt autorisé sur son établissement) ;
 *   - autorise ou retire, pour SON établissement, chaque compte du complexe —
 *     un accord GLOBAL : tout l'établissement en lecture, ou rien ;
 *   - supprime un compte qu'il a créé.
 *
 * ⚠️ DES CHIFFRES SEULEMENT POUR LES STAGIAIRES : aucune liste nominative ne lui
 * est ouverte. L'écran le dit, pour qu'autoriser se fasse en connaissance de cause.
 */
export default function SectionDirecteurComplexe() {
  const cache = useQueryClient();
  const comptes = useQuery({ queryKey: ['comptes-complexe'], queryFn: chargerComptesComplexe });
  const [aSupprimer, setASupprimer] = useState(null);

  const relire = () => cache.invalidateQueries({ queryKey: ['comptes-complexe'] });

  const autoriser = useMutation({
    mutationFn: autoriserCompteComplexe,
    onSuccess: (r) => {
      relire();
      toast.success('Accès accordé', { description: `${r.compte?.nomComplet} consulte désormais votre établissement.` });
    },
    onError: (e) => toast.error('Autorisation impossible', { description: e.message }),
  });

  const retirer = useMutation({
    mutationFn: retirerCompteComplexe,
    onSuccess: (r) => {
      relire();
      toast.success('Accès retiré', { description: `${r.compte?.nomComplet} ne voit plus votre établissement.` });
    },
    onError: (e) => toast.error('Retrait impossible', { description: e.message }),
  });

  const supprimer = useMutation({
    mutationFn: supprimerCompteComplexe,
    onSuccess: () => {
      relire();
      setASupprimer(null);
      toast.success('Compte supprimé');
    },
    onError: (e) => toast.error('Suppression impossible', { description: e.message }),
  });

  const liste = comptes.data ?? [];

  return (
    <div className="space-y-6">
      <Alerte type="info" titre="Un regard de complexe, en lecture seule">
        Le directeur de complexe consulte les établissements de votre complexe qui l&apos;ont autorisé —
        emploi du temps publié et avancement —, sans rien pouvoir modifier. Pour les stagiaires, il ne voit
        que des chiffres, jamais de noms. Chaque établissement décide pour lui-même, et peut retirer son
        accès à tout moment.
      </Alerte>

      <CreationCompteComplexe onCree={relire} />

      <div className="space-y-3 border-t pt-6">
        <h3 className="text-sm font-semibold">Comptes du complexe</h3>

        {comptes.isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : comptes.isError ? (
          <Alerte type="erreur" titre="Comptes non chargés">{comptes.error.message}</Alerte>
        ) : liste.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Aucun directeur de complexe pour votre complexe. Créez-en un ci-dessus.
          </p>
        ) : (
          <ul className="space-y-2">
            {liste.map((compte) => (
              <li key={compte.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {compte.nomComplet}
                    {compte.autorise ? (
                      <Badge className="border-accent-green bg-accent-green/15 text-accent-green-deep" variant="outline">
                        Autorisé sur votre établissement
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Non autorisé
                      </Badge>
                    )}
                    {compte.creeParMoi && <Badge variant="secondary">Créé par vous</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">{compte.email}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    {compte.etablissements.length > 0
                      ? `Consulte : ${compte.etablissements.join(' · ')}`
                      : 'Aucun établissement ne l’autorise pour l’instant'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {compte.autorise ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => retirer.mutate(compte.id)}
                      disabled={retirer.isPending}
                    >
                      <ShieldOff className="h-4 w-4" />
                      Retirer l&apos;accès
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => autoriser.mutate(compte.id)} disabled={autoriser.isPending}>
                      <ShieldCheck className="h-4 w-4" />
                      Autoriser l&apos;accès
                    </Button>
                  )}
                  {compte.creeParMoi && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Supprimer le compte de ${compte.nomComplet}`}
                      onClick={() => setASupprimer(compte)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmationAction
        ouvert={Boolean(aSupprimer)}
        onOpenChange={(ouvert) => !ouvert && setASupprimer(null)}
        titre="Supprimer ce compte ?"
        description={
          aSupprimer
            ? `${aSupprimer.nomComplet} ne pourra plus se connecter, et perd l’accès à tous les établissements du complexe — pas seulement au vôtre.`
            : ''
        }
        libelleConfirmation="Supprimer"
        destructive
        onConfirmer={() => aSupprimer && supprimer.mutate(aSupprimer.id)}
      />
    </div>
  );
}

function CreationCompteComplexe({ onCree }) {
  const [nomComplet, setNomComplet] = useState('');
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [soucis, setSoucis] = useState(null);

  const creation = useMutation({
    mutationFn: creerCompteComplexe,
    onSuccess: (resultat) => {
      onCree();
      setNomComplet('');
      setEmail('');
      setMotDePasse('');
      setSoucis(null);
      toast.success('Compte directeur de complexe créé', {
        description: `${resultat.compte?.nomComplet} consulte déjà votre établissement. Les autres directeurs du complexe décident pour le leur.`,
      });
    },
    onError: (erreur) => toast.error('Création impossible', { description: erreur.message }),
  });

  const pret = nomComplet.trim().length >= 3 && email.trim() !== '' && motDePasseValide(motDePasse);

  const envoyer = (evenement) => {
    evenement.preventDefault();
    const resultat = creationDirecteurComplexeSchema.safeParse({
      nomComplet: nomComplet.trim(),
      email: email.trim().toLowerCase(),
      motDePasse,
    });
    if (!resultat.success) {
      setSoucis(resultat.error.issues.map((souci) => souci.message));
      return;
    }
    creation.mutate(resultat.data);
  };

  return (
    <form onSubmit={envoyer} className="space-y-4">
      {soucis && (
        <Alerte type="erreur" titre="Vérifiez la saisie">
          <ul className="space-y-0.5">
            {soucis.map((souci) => (
              <li key={souci}>{souci}</li>
            ))}
          </ul>
        </Alerte>
      )}

      <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="complexe-nom">Nom complet</Label>
          <Input
            id="complexe-nom"
            value={nomComplet}
            onChange={(evenement) => setNomComplet(evenement.target.value)}
            placeholder="Nom et prénom"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="complexe-email">Adresse e-mail</Label>
          <Input
            id="complexe-email"
            type="email"
            value={email}
            onChange={(evenement) => setEmail(evenement.target.value)}
            placeholder="prenom.nom@ofppt.ma"
            autoComplete="off"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="complexe-mot-de-passe">Mot de passe initial</Label>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="complexe-mot-de-passe"
              type="text"
              value={motDePasse}
              onChange={(evenement) => setMotDePasse(evenement.target.value)}
              placeholder="8 caractères minimum"
              autoComplete="off"
              className="min-w-[14rem] flex-1"
            />
            <Button type="submit" disabled={creation.isPending || !pret}>
              <UserPlus className="h-4 w-4" />
              {creation.isPending ? 'Création…' : 'Créer le compte'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Son adresse e-mail lui sert d&apos;identifiant. Il est aussitôt autorisé sur votre établissement.
          </p>
          <ReglesMotDePasse valeur={motDePasse} />
        </div>
      </div>
    </form>
  );
}
