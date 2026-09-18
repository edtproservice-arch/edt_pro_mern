import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Jours fériés de l'année scolaire — panneau replié par défaut.
 * ← la liste de badges de l'étape 3
 *
 * ═══ POURQUOI REPLIÉ, ET POURQUOI EN BAS ═══
 * Ces dates sont chargées automatiquement et ne se modifient pas ici : c'est de
 * la RÉFÉRENCE, pas une action. Déployée, la liste occupait la moitié de
 * l'écran et repoussait le seul geste de l'étape — ajouter une période de
 * vacances — hors de vue. Le compte reste visible en permanence, ce qui suffit
 * à vérifier que le chargement a réussi.
 *
 * Groupés par MOIS plutôt qu'en liste continue : on cherche « qu'y a-t-il en
 * mai ? », jamais « quel est le 23ᵉ férié de l'année ».
 */
export default function PanneauJoursFeries({ jours }) {
  const [deplie, setDeplie] = useState(false);

  const parMois = useMemo(() => grouperParMois(jours), [jours]);
  const estimes = jours.filter((jour) => jour.estime).length;

  if (jours.length === 0) return null;

  return (
    <section className="rounded-lg border">
      <button
        type="button"
        onClick={() => setDeplie(!deplie)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50"
      >
        {deplie ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {jours.length} jour{jours.length > 1 ? 's' : ''} férié
            {jours.length > 1 ? 's' : ''}
          </span>
          <span className="block text-xs text-muted-foreground">
            Chargés automatiquement, rien à saisir
            {estimes > 0 && ` · ${estimes} date(s) estimée(s)`}
          </span>
        </span>

        <span className="text-xs text-muted-foreground">{deplie ? 'Masquer' : 'Voir'}</span>
      </button>

      {deplie && (
        <div className="space-y-4 border-t p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {parMois.map(({ mois, jours: duMois }) => (
              <div key={mois}>
                <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {mois}
                </h4>
                <ul className="space-y-1">
                  {duMois.map((jour) => (
                    <li key={`${jour.date}-${jour.intitule}`} className="flex gap-2 text-sm">
                      <span className="w-6 shrink-0 tabular-nums text-muted-foreground">
                        {jour.date.slice(8, 10)}
                      </span>
                      <span className="min-w-0">
                        <span className="block">
                          {jour.intitule}
                          {jour.estime && (
                            <span className="ml-1 text-xs text-muted-foreground">(estimé)</span>
                          )}
                        </span>
                        {/* `dir="rtl"` : sinon chiffres et parenthèses se rendent à l'envers. */}
                        {jour.intituleAr && (
                          <span dir="rtl" lang="ar" className="block text-xs text-muted-foreground">
                            {jour.intituleAr}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {estimes > 0 && (
            <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Les fêtes religieuses suivent le calendrier lunaire : leur date n&apos;est confirmée
                que quelques jours avant. Vous pourrez les décaler depuis la carte
                d&apos;établissement — votre correction ne sera pas écrasée au prochain
                rafraîchissement.
              </span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Regroupe par mois, dans l'ordre de l'année scolaire (septembre en tête). */
function grouperParMois(jours) {
  const groupes = new Map();

  for (const jour of jours) {
    const cle = jour.date.slice(0, 7);
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        mois: new Date(`${jour.date}T12:00:00`).toLocaleDateString('fr-FR', {
          month: 'long',
          year: 'numeric',
        }),
        jours: [],
      });
    }
    groupes.get(cle).jours.push(jour);
  }

  // Les jours arrivent déjà triés du serveur : l'ordre d'insertion des clés
  // suffit, et il suit l'année scolaire.
  return [...groupes.values()];
}
