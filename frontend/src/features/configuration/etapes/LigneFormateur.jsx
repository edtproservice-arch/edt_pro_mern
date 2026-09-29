import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ColonneContraintes } from './ContraintesFormateurs';

/**
 * Un formateur, en LISTE plutôt qu'en tableau — comme la carte d'affectations.
 *
 * ═══ ⚠️ REPLIÉ D'OFFICE, ET DÉMONTÉ QUAND IL L'EST ═══
 * La leçon est écrite plusieurs fois dans ce projet : ce qu'on ne regarde qu'un à
 * la fois ne se monte pas pour tous. Quarante formateurs en tableau, c'étaient cent
 * vingt champs de saisie et autant de boutons montés d'un coup, alors qu'on n'en
 * corrige qu'un. L'en-tête porte déjà ce qu'on parcourt pour CHOISIR lequel ouvrir
 * — nom, matricule, masse, salles, indisponibilités — et les champs n'existent
 * qu'ouverts.
 *
 * ⚠️ LES CHAMPS À REMPLIR SE VOIENT SANS OUVRIR. Un matricule vide ou une masse à
 * zéro s'écrivent en rouge dans l'en-tête : sans cela, les repérer imposait
 * d'ouvrir les quarante blocs.
 *
 * ⚠️ LE RÉSUMÉ « SALLES / INDISPONIBILITÉS » EST UN FRÈRE DU BOUTON qui déplie,
 * pas son enfant : un bouton dans un bouton est invalide, et il ouvre la modale
 * de disponibilité — le geste le plus fréquent de cette page — sans passer par
 * le dépliage.
 */
export default function LigneFormateur({
  formateur,
  ouvert,
  onBasculer,
  valeur,
  corriger,
  lectureSeule,
  avecContraintes,
  contraintes,
  salles,
  onRetirer,
  mutualise,
}) {
  const cle = formateur.nomComplet;
  const matricule = String(valeur(cle, 'matricule', formateur.matricule)).trim();
  const email = String(valeur(cle, 'email', formateur.email)).trim();
  const masse = Number(valeur(cle, 'masseHoraire', formateur.masseHoraire)) || 0;

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={onBasculer}
          aria-expanded={ouvert}
          className="flex min-w-0 flex-1 basis-72 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
        >
          {ouvert ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate font-medium">{formateur.nomComplet}</span>
              {formateur.nomUnique !== formateur.nomComplet && (
                <Badge variant="outline" className="font-normal">
                  affiché : {formateur.nomUnique}
                </Badge>
              )}
              {/* Affecté dans d'autres établissements : détecté par le serveur (2026-09-21). */}
              {mutualise && (
                <Badge
                  variant="secondary"
                  className="font-normal"
                  title={mutualise.avec.map((e) => e.nom).join(', ')}
                >
                  Mutualisé · {mutualise.avec.length} autre{mutualise.avec.length > 1 ? 's' : ''}
                </Badge>
              )}
            </span>

            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
              <span className={matricule ? 'text-muted-foreground' : 'text-destructive'}>
                {matricule || 'Matricule manquant'}
              </span>
              {email && <span className="truncate text-muted-foreground">{email}</span>}
              <span
                className={cn('tabular-nums', masse > 0 ? 'text-muted-foreground' : 'text-destructive')}
              >
                {masse > 0 ? `${masse} h` : 'Masse horaire à 0'}
              </span>
            </span>
          </span>
        </button>

        {avecContraintes && (
          <div className="w-full shrink-0 px-2 pb-2 sm:w-60 sm:border-l sm:pb-0 sm:pl-2">
            <ColonneContraintes
              formateur={formateur}
              contraintes={contraintes}
              salles={salles}
              lectureSeule={lectureSeule}
            />
          </div>
        )}
      </div>

      {/* ⚠️ DÉMONTÉ, PAS MASQUÉ : c'est ce démontage qui fait tout le gain. */}
      {ouvert && (
        <div className="grid gap-3 border-t p-4 sm:grid-cols-[160px_1fr_140px]">
          <div className="space-y-1.5">
            <Label htmlFor={`matricule-${cle}`}>Matricule</Label>
            <Input
              id={`matricule-${cle}`}
              value={valeur(cle, 'matricule', formateur.matricule)}
              onChange={(e) => corriger(cle, 'matricule', e.target.value)}
              placeholder="—"
              disabled={lectureSeule}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`email-${cle}`}>Adresse e-mail</Label>
            <Input
              id={`email-${cle}`}
              type="email"
              value={valeur(cle, 'email', formateur.email)}
              onChange={(e) => corriger(cle, 'email', e.target.value)}
              placeholder="prenom.nom@ofppt.ma"
              disabled={lectureSeule}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`masse-${cle}`}>Masse horaire</Label>
            <Input
              id={`masse-${cle}`}
              type="number"
              min={0}
              max={2000}
              className="text-right"
              value={valeur(cle, 'masseHoraire', formateur.masseHoraire)}
              onChange={(e) => corriger(cle, 'masseHoraire', e.target.value)}
              disabled={lectureSeule}
            />
          </div>

          {/* ⚠️ LE RETRAIT SE DEMANDE DEPUIS LE BLOC OUVERT, pas depuis l'en-tête : à
              côté d'un clic qui déplie, un bouton qui supprime se déclencherait par
              erreur. La confirmation, elle, est tenue par la liste. */}
          {onRetirer && !lectureSeule && (
            <div className="flex justify-end sm:col-span-full">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
                onClick={onRetirer}
              >
                <Trash2 className="size-3.5" />
                Retirer ce formateur
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
