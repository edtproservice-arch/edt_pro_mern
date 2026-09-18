import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Search, Trash2, UserX } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Alerte from '@/components/common/Alerte';
import {
  chargerComptes,
  definirActivationCompte,
  reinitialiserMotDePasse,
  supprimerCompte,
} from '../comptesApi';

/**
 * Comptes déjà créés, avec leurs actions.
 * ← get_user_accounts.php + toggle_user_status.php + reset_user_password.php
 *   + delete_user_account.php
 *
 * ═══ POURQUOI SUR LA MÊME PAGE QUE LA CRÉATION ═══
 * « Ai-je déjà créé le compte de X ? » se pose au moment même où l'on coche des
 * noms. Séparer les deux écrans obligerait à naviguer pour répondre — et la
 * liste des candidats ne dit que « compte existant », sans permettre d'agir.
 */
const LIBELLES_ROLE = {
  [ROLES.FORMATEUR]: 'Formateur',
  [ROLES.STAGIAIRE]: 'Stagiaire',
  [ROLES.GESTIONNAIRE]: 'Gestionnaire',
};

/**
 * @param {boolean} [props.lectureSeule]  invité sur « Sessions » (étape d4) : la
 *   colonne « Actions » disparaît et l'état du compte se LIT — un interrupteur
 *   éteint laisserait chercher comment l'allumer.
 */
export default function ListeComptes({ role, lectureSeule = false }) {
  const cache = useQueryClient();
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);

  const comptes = useQuery({
    // Le rôle et la recherche font partie de la CLÉ : sans eux, changer de
    // filtre servirait le résultat précédent depuis le cache.
    queryKey: ['comptes', role, recherche, page],
    queryFn: () => chargerComptes({ role, recherche, page, parPage: 20 }),
    retry: false,
  });

  const rafraichir = () => cache.invalidateQueries({ queryKey: ['comptes'] });

  const activation = useMutation({
    mutationFn: ({ id, actif }) => definirActivationCompte(id, actif),
    onSuccess: (_r, { actif }) => {
      rafraichir();
      toast.success(actif ? 'Compte réactivé' : 'Compte désactivé', {
        description: actif ? undefined : 'Ses sessions ouvertes ont été fermées.',
      });
    },
    onError: (erreur) => toast.error('Action impossible', { description: erreur.message }),
  });

  const reinitialisation = useMutation({
    mutationFn: (id) => reinitialiserMotDePasse(id),
    onSuccess: (resultat) => {
      /*
       * Le mot de passe n'est rendu que pour les adresses fictives
       * « @placeholder.ofppt.ma » — seul cas où aucun autre canal n'existe.
       * Ailleurs il part par e-mail et ne transite jamais par l'écran.
       */
      toast.success('Mot de passe réinitialisé', {
        description: resultat.motDePasse
          ? `Nouveau mot de passe : ${resultat.motDePasse}`
          : 'Il a été envoyé par e-mail.',
        duration: resultat.motDePasse ? 20000 : 5000,
      });
    },
    onError: (erreur) => toast.error('Réinitialisation impossible', { description: erreur.message }),
  });

  const suppression = useMutation({
    mutationFn: (id) => supprimerCompte(id),
    onSuccess: () => {
      rafraichir();
      // La liste des candidats porte « compte existant » : elle devient fausse.
      cache.invalidateQueries({ queryKey: ['comptes-candidats'] });
      toast.success('Compte supprimé');
    },
    onError: (erreur) => toast.error('Suppression impossible', { description: erreur.message }),
  });

  const liste = comptes.data?.comptes ?? [];
  const total = comptes.data?.total ?? 0;
  const pages = comptes.data?.pages ?? 1;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          Comptes {LIBELLES_ROLE[role]?.toLowerCase() ?? ''}s déjà créés
          {total > 0 && <span className="ml-1.5 text-muted-foreground">({total})</span>}
        </h2>

        <div className="relative min-w-[12rem]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={recherche}
            onChange={(evenement) => {
              setRecherche(evenement.target.value);
              // Sans ce retour, une recherche depuis la page 3 afficherait un
              // vide alors que le résultat tient sur une seule page.
              setPage(1);
            }}
            placeholder="Nom, identifiant ou adresse…"
            className="h-9 pl-8"
          />
        </div>
      </div>

      {/*
        ⚠️ L'erreur reste DANS la section, sous son titre. Rendue à la place de
        tout le bloc, elle produisait deux « Liste indisponible » empilés — celui
        des candidats et celui-ci — sans que rien ne dise lequel portait sur
        quoi.
      */}
      {comptes.isError ? (
        <Alerte type="erreur" titre="Comptes non chargés">
          {comptes.error.message}
        </Alerte>
      ) : comptes.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : liste.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <UserX className="h-4 w-4 shrink-0" />
          {recherche
            ? 'Aucun compte ne correspond à cette recherche.'
            : `Aucun compte ${LIBELLES_ROLE[role]?.toLowerCase()} pour l’instant.`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Identifiant</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead className="text-center">Actif</TableHead>
                {!lectureSeule && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>

            <TableBody>
              {liste.map((compte) => (
                <TableRow key={compte.id} className={compte.estActif ? undefined : 'opacity-60'}>
                  <TableCell className="font-medium">{compte.nomComplet}</TableCell>

                  <TableCell className="tabular-nums text-muted-foreground">
                    {compte.identifiant}
                  </TableCell>

                  <TableCell className="text-muted-foreground">
                    {/*
                      Une adresse fictive signale qu'aucun message ne peut lui
                      parvenir : le mot de passe devra être transmis de la main
                      à la main. Le taire ferait croire à un envoi qui n'aura
                      jamais lieu.
                    */}
                    {compte.emailFictif ? (
                      <Badge variant="outline" className="font-normal">
                        sans adresse
                      </Badge>
                    ) : (
                      compte.email
                    )}
                  </TableCell>

                  <TableCell className="text-center">
                    {lectureSeule ? (
                      <span className="text-xs text-muted-foreground">
                        {compte.estActif ? 'Oui' : 'Désactivé'}
                      </span>
                    ) : (
                    <Switch
                      checked={compte.estActif}
                      disabled={activation.isPending}
                      onCheckedChange={(actif) => activation.mutate({ id: compte.id, actif })}
                      aria-label={compte.estActif ? 'Désactiver le compte' : 'Réactiver le compte'}
                    />
                    )}
                  </TableCell>

                  {!lectureSeule && (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Réinitialiser le mot de passe"
                        disabled={reinitialisation.isPending}
                        onClick={() => reinitialisation.mutate(compte.id)}
                      >
                        <KeyRound className="h-4 w-4" />
                        <span className="sr-only">Réinitialiser le mot de passe</span>
                      </Button>

                      {/*
                        Rouge DOUX : la suppression est irréversible mais
                        ordinaire. Un rouge plein attirerait l'œil avant tout le
                        reste du tableau.
                      */}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Supprimer le compte"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={suppression.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Supprimer définitivement le compte de ${compte.nomComplet} ? Cette personne ne pourra plus se connecter.`
                            )
                          ) {
                            suppression.mutate(compte.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Supprimer le compte</span>
                      </Button>
                    </div>
                  </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {page} sur {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Précédent
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Suivant
          </Button>
        </div>
      )}
    </section>
  );
}
