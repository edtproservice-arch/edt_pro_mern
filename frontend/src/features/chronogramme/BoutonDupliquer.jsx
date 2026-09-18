import { useState } from 'react';
import { Ban, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Duplication d'un chronogramme vers d'autres groupes.
 * ← la modale de duplication de profil-principal.js + get_chrono_duplicate_targets.php
 *
 * ═══ LES REFUSÉS SONT AFFICHÉS, PAS MASQUÉS ═══
 * C'est le choix de l'existant, et il est juste : un groupe simplement absent
 * de la liste laisse croire à un oubli, et on cherche pourquoi il « n'apparaît
 * pas ». Nommé avec sa raison — « module EGTS105 absent », « masse horaire
 * différente : M101 (30 h ≠ 40 h) » — il envoie corriger la carte
 * d'établissement, là où est vraiment le problème.
 *
 * ⚠️ Ne sont comparés que les groupes DÉJÀ RETENUS à l'écran : leur maquette est
 * chargée, donc comparable. Proposer les vingt autres demanderait de charger
 * vingt grilles pour en refuser dix-huit.
 */
export default function BoutonDupliquer({ source, cibles, vide, onDupliquer }) {
  const [retenues, setRetenues] = useState([]);

  const compatibles = cibles.filter((cible) => cible.compatible);
  const refusees = cibles.filter((cible) => !cible.compatible && !cible.enAttente);
  const enAttente = cibles.filter((cible) => cible.enAttente);

  const basculer = (groupe) =>
    setRetenues((courantes) =>
      courantes.includes(groupe)
        ? courantes.filter((autre) => autre !== groupe)
        : [...courantes, groupe]
    );

  return (
    <Popover onOpenChange={(ouvert) => ouvert && setRetenues(compatibles.map((c) => c.groupe))}>
      {/*
        ⚠️ LE BOUTON RESTE AFFICHÉ MÊME QUAND IL NE PEUT RIEN FAIRE. Masqué, il
        laissait croire que la duplication n'existe pas sur cet écran — alors
        qu'il suffit souvent de cocher un second groupe. Désactivé, il dit à la
        fois qu'elle existe ET pourquoi elle n'est pas disponible ici.

        Copier une grille VIDE reste refusé : cela n'ajouterait rien et
        effacerait la grille d'en face.
      */}
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={vide || cibles.length === 0}
          title={
            vide
              ? 'Cette grille est vide — il n’y a rien à copier'
              : cibles.length === 0
                ? 'Cochez un second groupe en haut de page pour pouvoir y copier cette grille'
                : undefined
          }
        >
          <Copy className="size-3.5" />
          Dupliquer
          {compatibles.length > 0 && (
            <span className="text-muted-foreground">({compatibles.length})</span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-3">
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Copier la grille de {source} vers</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Seuls les groupes de même filière, même année et même maquette peuvent la recevoir.
            </p>
          </div>

          {compatibles.length === 0 ? (
            <p className="rounded-md bg-muted px-2 py-2 text-xs text-muted-foreground">
              Aucun groupe retenu ne partage cette maquette. Cochez d’autres groupes en haut de
              page pour les comparer.
            </p>
          ) : (
            <div className="space-y-1">
              {compatibles.map((cible) => (
                <label
                  key={cible.groupe}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={retenues.includes(cible.groupe)}
                    onCheckedChange={() => basculer(cible.groupe)}
                  />
                  <span className="min-w-0 flex-1 truncate">{cible.groupe}</span>
                </label>
              ))}
            </div>
          )}

          {/*
            ⚠️ Le rappel de ce qu'on écrase : la copie REMPLACE la grille de la
            cible. Sans cette phrase, « dupliquer » se lit comme un ajout.
          */}
          {retenues.length > 0 && (
            <p className="text-xs text-warning">
              La grille actuelle de {retenues.length === 1 ? 'ce groupe' : 'ces groupes'} sera
              remplacée.
            </p>
          )}

          <Button
            size="sm"
            className="w-full"
            disabled={retenues.length === 0}
            onClick={() => onDupliquer(retenues)}
          >
            Copier sur {retenues.length} groupe(s)
          </Button>

          {refusees.length > 0 && (
            <div className="space-y-1 border-t pt-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Ban className="size-3.5" />
                Ne peuvent pas recevoir cette grille
              </p>

              {refusees.map((cible) => (
                <p key={cible.groupe} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{cible.groupe}</span> —{' '}
                  {cible.raisons.join(' ; ')}
                </p>
              ))}
            </div>
          )}

          {enAttente.length > 0 && (
            <p className="border-t pt-2 text-xs text-muted-foreground">
              {enAttente.length} grille(s) encore en chargement — leur maquette n’a pas pu être
              comparée.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
