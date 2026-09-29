import { useEffect, useMemo, useState } from 'react';
import { DoorOpen } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { estTeams } from '../etapes/filtresFormateurs';
import { cn } from '@/lib/utils';

/**
 * Les salles où un module se donne, POUR UN GROUPE.
 *
 * ═══ ⚠️ AUCUN ÉQUIVALENT DANS L'ANCIEN EDT PRO ═══ (2026-09-23)
 * Vérifié avant d'écrire : `save_affectations.php` ne porte aucune salle,
 * l'ancienne génération n'en connaissait qu'au niveau du FORMATEUR
 * (`autoGenConstraints[formateur].spaces`), et le format e-note n'a pas de
 * colonne de salle. C'est une capacité NOUVELLE, pas un portage.
 *
 * ═══ ⚠️ UNE CONSIGNE, PAS UNE INTERDICTION ═══
 * La génération automatique place ici tant qu'elle peut, puis ailleurs
 * **plutôt que de ne pas placer la séance** — et le rapport nomme alors les
 * séances concernées. C'est mot pour mot l'arbitrage retenu le 2026-09-21 pour
 * les créneaux « à éviter » : une séance non placée n'est pas arbitrée non
 * plus, elle est perdue. Le texte du panneau le dit, parce qu'un directeur qui
 * croirait la salle garantie prendrait le repli pour un défaut.
 *
 * ═══ ⚠️ DANS LA CELLULE DU GROUPE ═══ (correction du porteur, 2026-09-23)
 * J'avais d'abord posé ce sélecteur sur la ligne du module, en raisonnant que
 * « l'atelier tient à la MATIÈRE ». **C'est faux dans les faits** : deux groupes
 * de la même filière suivent le même module dans des salles différentes — et ne
 * peuvent de toute façon pas occuper le même atelier au même moment.
 *
 * ⚠️ LE COÛT DE SAISIE EST RÉEL — 19 modules × 6 groupes — et c'est le bouton
 *    « copier » d'une colonne qui l'absorbe : il emporte désormais les salles
 *    avec les formateurs. La ligne du module, elle, ne montre plus qu'un
 *    RÉSUMÉ : deux chemins d'écriture pour une même donnée finissent toujours
 *    par se contredire à l'écran.
 */
export default function ChoixSallesModule({
  salles,
  /**
   * Locaux attribués au formateur de CETTE cellule, d'après ses contraintes
   * (Paramètres → Formateurs) — voir `EspacesFormateurCarte`. Vide : aucune
   * attribution connue, le sélecteur reste sur l'établissement entier, comme
   * avant.
   */
  espacesAttribues = [],
  valeur = [],
  onChange,
  lectureSeule,
}) {
  const [ouvert, setOuvert] = useState(false);
  const [filtre, setFiltre] = useState('');

  const choisies = useMemo(() => new Set(valeur ?? []), [valeur]);

  /*
   * ═══ SEULEMENT LES LOCAUX DE CE FORMATEUR (2026-09-27, demande du porteur)
   * ═══ Sans attribution connue, la liste reste celle de l'établissement — un
   * formateur qu'on n'a pas encore restreint n'a pas à perdre le choix.
   * « TEAMS » reste toujours proposé, comme dans le filtre de la page
   * Formateurs (`peutUtiliser`) : un cours à distance n'a pas de local à
   * réserver, aucune attribution ne devrait donc le masquer.
   */
  const sallesPermises = useMemo(() => {
    if (espacesAttribues.length === 0) return salles;
    return salles.filter((salle) => espacesAttribues.includes(salle) || estTeams(salle));
  }, [salles, espacesAttribues]);

  const visibles = useMemo(() => {
    const cherche = filtre.trim().toLowerCase();
    if (!cherche) return sallesPermises;
    return sallesPermises.filter((salle) => salle.toLowerCase().includes(cherche));
  }, [sallesPermises, filtre]);

  /*
   * ⚠️ UN SEUL LOCAL ATTRIBUÉ : IMPOSÉ D'OFFICE (2026-09-27, demande du
   * porteur) — la case vide n'a alors qu'un choix possible, le lui faire
   * cocher à la main n'aurait rien évité. `salles.includes` garde le repli
   * sûr : un local retiré de l'établissement depuis ne s'impose pas tout seul.
   */
  useEffect(() => {
    if (lectureSeule || valeur.length > 0 || espacesAttribues.length !== 1) return;
    const seul = espacesAttribues[0];
    if (salles.includes(seul)) onChange([seul]);
  }, [lectureSeule, valeur.length, espacesAttribues, salles, onChange]);

  /*
   * ⚠️ AUCUN ESPACE DÉCLARÉ : on n'affiche pas un panneau vide où le directeur
   *    chercherait ce qu'il a mal fait. On dit où aller.
   */
  if (salles.length === 0) {
    if (valeur.length === 0) return null;
    return (
      <p className="mt-1.5 text-xs text-muted-foreground">
        Salle déclarée : {valeur.join(', ')} — introuvable dans les espaces.
      </p>
    );
  }

  const basculer = (salle, coche) => {
    const suivantes = new Set(choisies);
    if (coche) suivantes.add(salle);
    else suivantes.delete(salle);
    onChange([...suivantes]);
  };

  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={lectureSeule}
          className={cn(
            'mt-1.5 h-7 gap-1.5 px-2 text-xs font-normal',
            valeur.length === 0 ? 'text-muted-foreground' : 'text-success'
          )}
          title="Salles où ce module se donne — une consigne, pas une obligation"
        >
          <DoorOpen className="h-3.5 w-3.5" />
          {valeur.length === 0 ? (
            'Salle au choix'
          ) : (
            <span className="flex flex-wrap items-center gap-1">
              {valeur.slice(0, 2).map((salle) => (
                <Badge
                  key={salle}
                  variant="outline"
                  className="border-success/30 bg-success/10 font-normal text-success"
                >
                  {salle}
                </Badge>
              ))}
              {valeur.length > 2 && <span>+{valeur.length - 2}</span>}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 space-y-2 p-3">
        <div>
          <p className="text-sm font-medium">Salles de ce module</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pour ce groupe seulement. La génération automatique les emploie en
            priorité&nbsp;; si elles sont occupées, elle pose la séance ailleurs plutôt
            que de la perdre — et vous le signale dans son rapport.
          </p>
        </div>

        {sallesPermises.length > 8 && (
          <Input
            value={filtre}
            onChange={(evenement) => setFiltre(evenement.target.value)}
            placeholder="Filtrer les salles"
            className="h-8 text-xs"
          />
        )}

        <div className="max-h-56 space-y-1 overflow-y-auto">
          {visibles.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">Aucune salle.</p>
          ) : (
            visibles.map((salle) => {
              const choisie = choisies.has(salle);
              return (
                <label
                  key={salle}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted',
                    choisie && 'bg-success/10 text-success hover:bg-success/15'
                  )}
                >
                  <Checkbox
                    checked={choisie}
                    onCheckedChange={(coche) => basculer(salle, coche === true)}
                  />
                  <span className="min-w-0 flex-1 truncate">{salle}</span>
                </label>
              );
            })
          )}
        </div>

        {valeur.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-full text-xs"
            onClick={() => onChange([])}
          >
            Aucune salle imposée
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
