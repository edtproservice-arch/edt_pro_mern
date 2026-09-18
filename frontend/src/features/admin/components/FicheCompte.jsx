import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { apparenceStatut, formaterDate } from './statutCompte';
import { libelleRole } from './roles';

/**
 * Fiche détaillée d'un compte, ouverte par le bouton « Consulter ».
 *
 * Aucun appel supplémentaire : la liste renvoie déjà tous ces champs
 * (`presenterPourAdmin`). Ouvrir une fiche ne coûte donc aucune requête.
 */
export default function FicheCompte({ compte, onOpenChange }) {
  const ouvert = Boolean(compte);
  const apparence = compte ? apparenceStatut(compte.statut) : null;

  return (
    <Sheet open={ouvert} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {compte && (
          <>
            <SheetHeader>
              <SheetTitle>{compte.nomComplet}</SheetTitle>
              <SheetDescription>{compte.email}</SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={apparence.variant} className="gap-1.5">
                  <apparence.Icone className={`h-3.5 w-3.5 ${apparence.couleur}`} />
                  {apparence.libelle}
                </Badge>
                <Badge variant="outline">{libelleRole(compte.role)}</Badge>
                {compte.essai?.demande && <Badge variant="outline">Essai demandé</Badge>}
                {!compte.estActif && <Badge variant="destructive">Désactivé</Badge>}
              </div>

              <Separator />

              <Section titre="Identité">
                <Ligne libelle="Nom complet" valeur={compte.nomComplet} />
                <Ligne libelle="Adresse e-mail" valeur={compte.email} />
                <Ligne libelle="Téléphone" valeur={compte.telephone || '—'} />
                <Ligne
                  libelle="Adresse vérifiée"
                  valeur={compte.estVerifie ? 'Oui' : 'Non — le compte ne peut pas se connecter'}
                />
              </Section>

              <Separator />

              <Section titre="Accès">
                <Ligne libelle="Rôle" valeur={libelleRole(compte.role)} />
                <Ligne libelle="Statut" valeur={apparence.libelle} />
                <Ligne
                  libelle="Période d'essai"
                  valeur={
                    compte.essai?.dateFin
                      ? `Jusqu'au ${formaterDate(compte.essai.dateFin)}`
                      : compte.essai?.demande
                        ? 'Demandée, non accordée'
                        : 'Aucune'
                  }
                />
                <Ligne libelle="Établissements" valeur={compte.nombreEtablissements} />
              </Section>

              <Separator />

              <Section titre="Activité">
                <Ligne libelle="Inscription" valeur={formaterDate(compte.dateInscription)} />
                <Ligne
                  libelle="Dernière connexion"
                  valeur={
                    compte.derniereConnexion ? formaterDate(compte.derniereConnexion) : 'Jamais'
                  }
                />
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ titre, children }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{titre}</h3>
      <dl className="space-y-2">{children}</dl>
    </section>
  );
}

function Ligne({ libelle, valeur }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="shrink-0 text-muted-foreground">{libelle}</dt>
      <dd className="text-right font-medium">{valeur}</dd>
    </div>
  );
}
