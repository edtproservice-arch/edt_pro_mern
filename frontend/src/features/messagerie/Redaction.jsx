import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Send, Trash2, X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import Alerte from '@/components/common/Alerte';
import { libelleRole, teinteRole } from '@/features/admin/components/roles';
import { initiales } from '@/lib/initiales';
import {
  chargerCorrespondants,
  enregistrerBrouillon,
  envoyerMessage,
  supprimerBrouillon,
} from './api';

/**
 * Rédaction d'un message.
 * ← la modale « Nouveau message » de inbox.html
 *
 * ⚠️ LA LISTE DES DESTINATAIRES VIENT DU SERVEUR. Elle applique la matrice de
 * `shared/domain`, la même que le contrôle d'envoi : proposer plus large ferait
 * découvrir le refus après le clic, proposer moins large cacherait des
 * correspondants légitimes.
 *
 * ═══ ⚠️ LE CHOIX DU DESTINATAIRE, « COMME DANS GMAIL » ═══ (2026-09-03,
 * demande du porteur, maquette fournie.) Les destinataires retenus deviennent
 * des PUCES retirables ; en dessous, une recherche et la liste de ceux qui
 * restent à choisir — avatar, nom, adresse, rôle — CELUI DÉJÀ CHOISI EN DISPARAÎT
 * : c'est le même signal que la puce elle-même, redondant s'il restait aussi
 * dans la liste.
 *
 * ⚠️ LA RECHERCHE PASSE PAR `Command`, DÉJÀ EMPLOYÉ POUR LE MÊME BESOIN dans
 * `ChoixCherchable` (filière, métier) : `keywords` élargit ce qu'un mot tapé
 * peut atteindre — nom, adresse OU rôle — sans qu'on ait à réécrire un filtre.
 * Un second mécanisme aurait divergé du premier au prochain ajustement.
 */
export default function Redaction({ initial, onFermer, onEnvoye, onSupprimerBrouillon }) {
  const [destinataires, setDestinataires] = useState(initial.destinataires ?? []);
  const [sujet, setSujet] = useState(initial.sujet ?? '');
  /* ⚠️ Le corps vient de `initial` : reprendre un brouillon doit rendre ce qu'on
     avait écrit, sinon le dossier ne sert à rien. */
  const [corps, setCorps] = useState(initial.corps ?? '');
  /*
   * ⚠️ CONTRÔLÉE, ET VIDÉE À CHAQUE CHOIX — comme dans Gmail : une adresse
   * ajoutée à la liste des puces ne doit pas laisser sa recherche derrière
   * elle, sinon la liste semble vide au prochain caractère tapé par erreur.
   */
  const [recherche, setRecherche] = useState('');
  /* L'identifiant du brouillon, s'il en existe déjà un — pour le METTRE À JOUR
     plutôt que d'en créer un nouveau à chaque enregistrement. */
  const [brouillonId, setBrouillonId] = useState(initial.id ?? null);

  const contacts = useQuery({
    queryKey: ['messages', 'correspondants'],
    queryFn: chargerCorrespondants,
    retry: false,
  });

  const envoi = useMutation({
    mutationFn: async () => {
      const bilan = await envoyerMessage({ destinataires, sujet, corps, reponseA: initial.reponseA });

      /*
       * ⚠️ LE BROUILLON PART UNE FOIS LE MESSAGE ENVOYÉ, et pas avant : si
       * l'envoi échoue, on doit pouvoir reprendre son texte. L'ordre inverse
       * perdrait le travail au moment précis où il compte.
       */
      if (brouillonId) await supprimerBrouillon(brouillonId);
      return bilan;
    },
    onSuccess: (bilan) => {
      /*
       * ⚠️ CE QUI N'EST PAS PARTI EST NOMMÉ. `send.php` ignorait en silence les
       * destinataires refusés et répondait « envoyé » : on croyait avoir écrit à
       * cinq personnes, trois l'avaient reçu.
       */
      if (bilan.refuses?.length > 0) {
        toast.warning(`${bilan.envoyes} envoyé(s), ${bilan.refuses.length} refusé(s)`, {
          description: bilan.refuses.map((r) => r.nom ?? r.id).join(', '),
        });
      } else {
        toast.success(`${bilan.envoyes} message(s) envoyé(s)`);
      }
      onEnvoye();
    },
    onError: (erreur) => toast.error('Envoi impossible', { description: erreur.message }),
  });

  /**
   * Enregistre le travail en cours.
   *
   * ⚠️ UN BROUILLON N'EXIGE RIEN — ni destinataire, ni sujet, ni corps. Le
   * contraindre reviendrait à interdire de s'interrompre, ce qui est exactement
   * ce à quoi il sert.
   */
  const brouillon = useMutation({
    mutationFn: () =>
      enregistrerBrouillon({ id: brouillonId ?? undefined, destinataires, sujet, corps, reponseA: initial.reponseA }),
    onSuccess: (bilan) => {
      setBrouillonId(bilan.id);
      toast.success('Brouillon enregistré');
      onEnvoye();
    },
    onError: (erreur) => toast.error('Enregistrement impossible', { description: erreur.message }),
  });

  const liste = contacts.data?.correspondants ?? [];

  /*
   * ⚠️ CHOISIS D'ABORD, PAS CHOISIS ET LE RESTE MÊLÉS. Les puces se composent
   * dans l'ORDRE DE SÉLECTION (`destinataires`), pas dans l'ordre alphabétique
   * du serveur — c'est l'ordre dans lequel on les a ajoutés qu'on reconnaît.
   */
  const choisis = destinataires
    .map((id) => liste.find((contact) => contact.id === id))
    .filter(Boolean);

  /*
   * ⚠️ UN DESTINATAIRE DÉJÀ CHOISI DISPARAÎT DE LA LISTE : c'est le signal de
   * Gmail — la puce EST la coche, la répéter dans la liste juste en dessous ne
   * ferait que demander où est passée la personne qu'on vient d'ajouter.
   */
  const proposables = liste.filter((contact) => !destinataires.includes(contact.id));

  const basculer = (id) => {
    setDestinataires((courants) =>
      courants.includes(id) ? courants.filter((autre) => autre !== id) : [...courants, id]
    );
    // Comme dans Gmail : la recherche se vide dès qu'on choisit quelqu'un.
    setRecherche('');
  };

  const tousChoisis = liste.length > 0 && liste.every((contact) => destinataires.includes(contact.id));

  const complet = destinataires.length > 0 && sujet.trim() !== '' && corps.trim() !== '';

  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial.reponseA ? 'Répondre' : 'Nouveau message'}</DialogTitle>
          <DialogDescription>
            Vous n’écrivez qu’aux personnes que votre rôle vous autorise à joindre.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Destinataires ({destinataires.length})</Label>

            {contacts.isError ? (
              <Alerte type="erreur" titre="Liste indisponible">
                {contacts.error.message}
              </Alerte>
            ) : liste.length === 0 && !contacts.isLoading ? (
              /* ⚠️ On NOMME le cas vide : une liste sans entrée laisserait croire
                 à une panne, alors que le rôle ne joint personne pour l'instant. */
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Aucun correspondant. Votre rôle ne permet d’écrire à personne dans cet
                établissement pour l’instant.
              </p>
            ) : (
              <Command className="rounded-md border">
                {/*
                  ⚠️ « À » PUIS LES PUCES, COMME GMAIL : le mot seul annonce ce
                  que la ligne contient, avant même qu'il y ait une seule puce.
                */}
                <div className="flex flex-wrap items-center gap-1.5 border-b p-2">
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">À</span>

                  {choisis.map((contact) => (
                    <Badge
                      key={contact.id}
                      variant="secondary"
                      className="gap-1 rounded-full py-1 pl-2.5 pr-1 font-normal"
                    >
                      {contact.nom}
                      <button
                        type="button"
                        onClick={() => basculer(contact.id)}
                        aria-label={`Retirer ${contact.nom}`}
                        className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}

                  {/*
                    ⚠️ ELLE PORTE SUR LA LISTE ENTIÈRE, PAS SUR CE QUE LA
                    RECHERCHE LAISSE VOIR : contrairement à un « tout cocher »
                    de filtre, celle-ci sert à écrire d'un geste à TOUT LE
                    MONDE qu'on peut joindre — un directeur qui diffuse à ses
                    formateurs, un admin à tous les directeurs.
                  */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 shrink-0 rounded-full px-2.5 text-xs"
                    onClick={() =>
                      setDestinataires(tousChoisis ? [] : liste.map((contact) => contact.id))
                    }
                  >
                    {tousChoisis ? 'Aucun' : 'Tous'}
                  </Button>
                </div>

                <CommandInput
                  value={recherche}
                  onValueChange={setRecherche}
                  placeholder="Destinataires…"
                  className="h-9 text-sm"
                />

                <CommandList className="max-h-56">
                  <CommandEmpty className="py-4 text-xs text-muted-foreground">
                    {liste.length === choisis.length
                      ? 'Tout le monde est déjà dans la liste.'
                      : 'Aucun correspondant ne correspond à cette recherche.'}
                  </CommandEmpty>

                  <CommandGroup>
                    {proposables.map((contact) => (
                      <CommandItem
                        key={contact.id}
                        /*
                          ⚠️ NOM + ADRESSE, JAMAIS LE SEUL NOM : deux personnes
                          peuvent porter le même nom, et `value` sert de clé
                          interne à cmdk — une valeur dupliquée y ferait
                          diverger sélection et surbrillance.
                        */
                        value={`${contact.nom} ${contact.email}`}
                        keywords={[contact.nom, contact.email, libelleRole(contact.role)].filter(
                          Boolean
                        )}
                        onSelect={() => basculer(contact.id)}
                        className="gap-3 py-2"
                      >
                        <Avatar aria-hidden="true" className="h-8 w-8 shrink-0">
                          <AvatarFallback
                            className={`text-[0.65rem] font-semibold ${teinteRole(contact.role)}`}
                          >
                            {initiales(contact.nom)}
                          </AvatarFallback>
                        </Avatar>

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{contact.nom}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {contact.email}
                          </div>
                        </div>

                        <Badge variant="outline" className="shrink-0 font-normal">
                          {libelleRole(contact.role)}
                        </Badge>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sujet" className="text-xs">
              Sujet
            </Label>
            <Input
              id="sujet"
              value={sujet}
              onChange={(evenement) => setSujet(evenement.target.value)}
              maxLength={255}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="corps" className="text-xs">
              Message
            </Label>
            <Textarea
              id="corps"
              value={corps}
              onChange={(evenement) => setCorps(evenement.target.value)}
              rows={8}
              className="text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            {/*
              ⚠️ « SUPPRIMER » N'APPARAÎT QUE SUR UN BROUILLON DÉJÀ ENREGISTRÉ :
              sur un message neuf, « Annuler » suffit — il n'y a rien à
              supprimer, et deux boutons pour le même geste font hésiter.
            */}
            {brouillonId && onSupprimerBrouillon && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onSupprimerBrouillon(brouillonId)}
              >
                <Trash2 className="size-3.5" />
                Supprimer
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-8 gap-1.5 text-xs"
              disabled={brouillon.isPending}
              onClick={() => brouillon.mutate()}
            >
              <FileText className="size-3.5" />
              {brouillon.isPending ? 'Enregistrement…' : 'Brouillon'}
            </Button>

            <Button variant="secondary" size="sm" className="h-8 text-xs" onClick={onFermer}>
              Annuler
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={!complet || envoi.isPending}
              onClick={() => envoi.mutate()}
            >
              <Send className="size-3.5" />
              {envoi.isPending ? 'Envoi…' : 'Envoyer'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
