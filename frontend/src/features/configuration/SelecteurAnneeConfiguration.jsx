import { CalendarRange, Lock } from 'lucide-react';
import { libelleAnneeScolaire } from 'shared/domain';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Année scolaire que l'assistant est en train de configurer.
 *
 * ═══ POURQUOI EN TÊTE, ET PAS À L'ÉTAPE 3 ═══
 * Depuis la règle « chaque étape écrit la sienne », l'étape 1 a DÉJÀ enregistré
 * la base sous `(établissement, année)` quand on arrive au calendrier. Choisir
 * l'année à l'étape 3 laisserait la base sur une année et les vacances sur une
 * autre — un établissement coupé en deux, sans le moindre message d'erreur.
 * Elle se choisit donc avant la première écriture.
 *
 * ═══ POURQUOI UN CHOIX, ALORS QU'ELLE EST DÉDUITE ═══
 * `anneeScolaireAPreparer()` répond juste dans la plupart des cas — septembre et
 * octobre pour l'année qui s'ouvre, juin à août pour celle qui vient. Mais de
 * novembre à mai, rien ne distingue un établissement en retard sur l'année en
 * cours d'un établissement en avance sur la suivante. Plutôt que d'ajouter une
 * fenêtre où l'assistant pose une question et trois où il n'en pose pas, le
 * sélecteur est TOUJOURS là : seul son défaut change.
 *
 * ═══ POURQUOI IL SE VERROUILLE ═══
 * Une fois la base importée, changer d'année ne la déplacerait pas : elle
 * resterait sous l'ancienne, et l'assistant repartirait sur une année vide en
 * laissant croire à une perte. Le verrou dit ce qui s'est passé au lieu de
 * laisser découvrir le trou plus tard.
 */
export default function SelecteurAnneeConfiguration({ annee, onChange, verrouille }) {
  // Trois choix suffisent : l'année déduite et ses deux voisines couvrent le
  // retard d'un an comme l'anticipation d'un an. Au-delà, ce n'est plus une
  // configuration initiale.
  const choix = [annee - 1, annee, annee + 1];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarRange className="h-4 w-4" />
        <span>Vous configurez l&apos;année</span>
      </div>

      {verrouille ? (
        <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted px-2.5 py-1 text-sm font-medium">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          {libelleAnneeScolaire(annee)}
        </span>
      ) : (
        <Select value={String(annee)} onValueChange={(valeur) => onChange(Number(valeur))}>
          <SelectTrigger className="h-9 w-[10.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choix.map((candidate) => (
              <SelectItem key={candidate} value={String(candidate)}>
                {libelleAnneeScolaire(candidate)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <p className="text-xs text-muted-foreground">
        {verrouille
          ? 'Fixée par l’import de votre base — tout le parcours s’enregistre sur cette année.'
          : 'Modifiable tant que rien n’est importé.'}
      </p>
    </div>
  );
}
