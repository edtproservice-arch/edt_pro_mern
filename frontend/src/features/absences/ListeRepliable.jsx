import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** La recherche dès douze entrées, comme la vue par formateur des Affectations. */
const SEUIL_RECHERCHE = 12;

/**
 * ═══ UNE LISTE DE FICHES REPLIABLES ═══ (2026-09-14, demande du porteur : « en
 * absence formateur supprime la vue tableau, laisse les cartes mais change-les
 * en listes comme celle d'affectation formateur — et le même en registre et en
 * note de discipline ».)
 * ← la forme de `configuration/carte/VueFormateurs.jsx` : un en-tête toujours
 * visible qui porte ce qu'on parcourt (le nom, les chiffres), le détail qui se
 * déplie SOUS lui plutôt que dans une modale.
 *
 * ⚠️ UN SEUL COMPOSANT POUR LES TROIS LISTES (absences des formateurs, registre
 * et notes des stagiaires) : trois copies du même repli auraient divergé au
 * premier ajustement — la cause n°1 d'instabilité du §4.2.
 *
 * ⚠️ UNE SEULE FICHE OUVERTE À LA FOIS, et son détail DÉMONTÉ quand elle se
 * replie : les fiches d'absence portent des champs et des boutons, et un groupe
 * compte trente stagiaires.
 *
 * ⚠️ L'EN-TÊTE EST UN BOUTON : `entete()` ne doit rendre AUCUN élément
 * interactif (un bouton dans un bouton est invalide). Les actions vont dans le
 * détail.
 *
 * @param {object} props
 * @param {Array} props.elements
 * @param {(el) => string} props.cleDe
 * @param {(el) => {titre, sousTitre?, droite?, marque?}} props.entete
 * @param {(el) => import('react').ReactNode} props.detail
 * @param {(el) => string} [props.texteRecherche] — sans elle, pas de recherche.
 */
export default function ListeRepliable({
  elements,
  cleDe,
  entete,
  detail,
  texteRecherche,
  placeholder = 'Filtrer par nom…',
  vide,
}) {
  const [recherche, setRecherche] = useState('');
  const [ouvert, setOuvert] = useState(null);

  const visibles = useMemo(() => {
    const terme = recherche.trim().toUpperCase();
    if (terme === '' || !texteRecherche) return elements;
    return elements.filter((element) => String(texteRecherche(element)).toUpperCase().includes(terme));
  }, [elements, recherche, texteRecherche]);

  if (elements.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{vide}</p>
    );
  }

  return (
    <div className="space-y-3">
      {texteRecherche && elements.length > SEUIL_RECHERCHE && (
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder={placeholder}
            className="h-9 pl-8"
          />
        </div>
      )}

      {visibles.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Aucune entrée ne correspond à « {recherche} ».
        </p>
      ) : (
        <ul className="space-y-2">
          {visibles.map((element) => {
            const cle = cleDe(element);
            const estOuvert = ouvert === cle;
            const { titre, sousTitre, droite, marque } = entete(element);

            return (
              /* La marque ambre dit, sans ouvrir la fiche, qu'il reste quelque
                 chose à y traiter — c'était le rôle de la carte ambre. */
              <li key={cle} className={cn('rounded-lg border', marque && 'border-warning/40 bg-warning/5')}>
                <button
                  type="button"
                  onClick={() => setOuvert(estOuvert ? null : cle)}
                  aria-expanded={estOuvert}
                  className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left hover:bg-muted/50"
                >
                  {estOuvert ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{titre}</span>
                    {sousTitre && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">{sousTitre}</span>
                    )}
                  </span>

                  {droite && (
                    <span className="shrink-0 whitespace-nowrap text-right text-sm tabular-nums">{droite}</span>
                  )}
                </button>

                {/* ⚠️ DÉMONTÉ, PAS MASQUÉ. */}
                {estOuvert && <div className="border-t p-4">{detail(element)}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
