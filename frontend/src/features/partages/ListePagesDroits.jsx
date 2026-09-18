import {
  PAGES_COLLABORATIVES,
  PAGES_PARTAGEABLES,
  grouperPages,
  libellePage,
  pagePrete,
} from 'shared/domain';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { cn } from '@/lib/utils';

/*
 * « Aucun » en tête : c'est l'état de la plupart des pages, et le premier choix
 * lu doit être celui qui ne donne rien.
 */
const CHOIX = [
  { valeur: null, libelle: 'Aucun' },
  { valeur: 'consulter', libelle: 'Consulter' },
  { valeur: 'modifier', libelle: 'Modifier' },
];

/**
 * Les pages partageables, chacune avec SON droit — « Aucun · Consulter · Modifier »
 * (2026-09-13, demande du porteur : « pour chaque invité, le directeur
 * sélectionne les pages qu'il peut consulter, avec leur permission pour chaque
 * page »).
 *
 * ⚠️ UN SEUL COMPOSANT POUR LES DEUX GESTES — inviter (le panneau « Pages » de
 * la boîte) et régler un invité existant (« Gérer ses pages ») : deux listes
 * écrites chacune de son côté finiraient par ne pas éteindre les mêmes choix.
 *
 * ⚠️ UN CHOIX EXCLUSIF PAR PAGE, DONC UN `ButtonGroup` — la seule forme que la
 * charte lui réserve. « Modifier » est ÉTEINT sur une page en lecture seule
 * (Avancement, Documents, Sessions) : proposé, il accorderait « Consulter » en
 * silence (aucune des trois pages partageables ne l'est aujourd'hui ; la règle
 * reste pour le jour où une page en lecture seule rouvrirait).
 *
 * Seul un droit ACCORDÉ se colore en bleu : c'est ce qu'on vient chercher en
 * parcourant la liste. Un « Aucun » plein sur dix lignes ferait une colonne
 * d'accents qui ne disent rien.
 *
 * @param {{
 *   valeurs: Record<string, 'modifier'|'consulter'|null>,
 *   onChanger: (page: string, droit: string|null) => void,
 *   obligatoire?: string,          page qui ne peut pas passer à « Aucun »
 *   notes?: Record<string, string>, précision sous le nom d'une page
 *   desactive?: boolean,
 * }} props
 */
export default function ListePagesDroits({ valeurs, onChanger, obligatoire, notes = {}, desactive = false }) {
  /*
   * ⚠️ LES SEULES PAGES QUI SE PARTAGENT (2026-09-14 : Emploi, Chronogramme,
   * Affectations). Les autres ne sont pas « bientôt » disponibles : elles ne se
   * partagent pas. Onze lignes éteintes feraient chercher ce qui les rallume.
   */
  const colonnes = grouperPages(PAGES_COLLABORATIVES.filter(pagePrete).map((page) => ({ page })));

  return (
    <div className="space-y-3">
      {colonnes.map((colonne) => (
        <section key={colonne.cle} aria-label={colonne.libelle}>
          <p className="mb-1 text-[0.7rem] font-semibold text-muted-foreground">{colonne.libelle}</p>
          <ul className="divide-y rounded-md border">
            {colonne.entrees.map(({ page }) => {
              const lectureSeule = PAGES_PARTAGEABLES[page]?.droitMax === 'consulter';
              const valeur = valeurs[page] ?? null;
              const note = [notes[page], lectureSeule && 'Lecture seule'].filter(Boolean).join(' · ');

              return (
                <li key={page} className="flex items-center gap-2 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{libellePage(page)}</div>
                    {note && <div className="truncate text-[0.65rem] text-muted-foreground">{note}</div>}
                  </div>
                  <ButtonGroup aria-label={`Accès à « ${libellePage(page)} »`}>
                    {CHOIX.map((choix) => {
                      const actif = valeur === choix.valeur;
                      const interdit =
                        desactive ||
                        (choix.valeur === 'modifier' && lectureSeule) ||
                        (choix.valeur === null && page === obligatoire);
                      return (
                        <Button
                          key={choix.libelle}
                          type="button"
                          size="sm"
                          variant={actif && choix.valeur ? 'default' : 'outline'}
                          aria-pressed={actif}
                          disabled={interdit}
                          onClick={() => !actif && onChanger(page, choix.valeur)}
                          className={cn(
                            'h-6 px-2 text-[0.65rem]',
                            actif && !choix.valeur && 'bg-muted font-medium text-foreground'
                          )}
                        >
                          {choix.libelle}
                        </Button>
                      );
                    })}
                  </ButtonGroup>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
