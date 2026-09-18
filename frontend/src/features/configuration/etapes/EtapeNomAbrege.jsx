import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Alerte from '@/components/common/Alerte';
import { cn } from '@/lib/utils';
import { propositionsNomAbrege } from 'shared/domain';
import { chargerEtablissementCourant } from '../api';

/** Ce que le serveur accepte — même bornes que `nomAbregeSchema`. */
const MINIMUM = 2;
const MAXIMUM = 30;

/**
 * Étape 5 — nom abrégé de l'établissement.
 *
 * ═══ POURQUOI CETTE ÉTAPE EXISTE ═══
 * Le nom officiel — « Institut Spécialisé de Technologie Appliquée NTIC Sidi
 * Maârouf » — ne tient ni dans l'en-tête d'une grille d'emploi du temps, ni sur
 * une carte de stagiaire, ni dans le pied d'une liste d'émargement. C'est la
 * forme courte qui y figure. Le champ existait en base depuis le début
 * (`etablissements.nom_abrege`) mais aucun écran ne le renseignait : les
 * documents retombaient donc sur le nom complet, et débordaient.
 */
export default function EtapeNomAbrege({ valeur, onChange }) {
  const etablissement = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    retry: false,
  });

  const courant = etablissement.data?.etablissement;
  const [initialise, setInitialise] = useState(false);

  /*
   * Reprise de la valeur déjà en base, une seule fois : sans le drapeau, chaque
   * rafraîchissement de la requête écraserait la saisie en cours.
   */
  useEffect(() => {
    if (initialise || !courant) return;
    setInitialise(true);
    if (courant.nomAbrege) onChange(courant.nomAbrege);
  }, [courant, initialise, onChange]);

  /*
   * Plusieurs formes proposées, pas une seule : un établissement se désigne
   * tantôt par son sigle, tantôt par son quartier. La règle vit dans le
   * domaine, testée sur des intitulés réels.
   */
  const propositions = courant ? propositionsNomAbrege(courant.nom) : [];
  const trop = valeur.trim().length > MAXIMUM;
  const court = valeur.trim().length > 0 && valeur.trim().length < MINIMUM;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Comment nommer votre établissement en abrégé ?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cette forme courte figure sur les documents imprimés — en-têtes de grille, cartes de
          stagiaire, listes d&apos;émargement — là où le nom complet ne tient pas.
        </p>
      </div>

      {courant && (
        <div className="flex gap-3 rounded-lg border p-4">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Nom officiel
            </div>
            <div className="mt-0.5 text-sm font-medium">{courant.nom}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {courant.complexe} · {courant.region}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-md space-y-1.5">
        <Label htmlFor="nom-abrege">Nom abrégé</Label>
        <Input
          id="nom-abrege"
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          placeholder="ISTA NTIC"
          maxLength={MAXIMUM}
          aria-invalid={trop || court}
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {MINIMUM} à {MAXIMUM} caractères.
          </p>
          {/* Le compteur n'apparaît qu'à l'approche de la limite : affiché en
              permanence, il transforme un champ libre en exercice de comptage. */}
          {valeur.length > MAXIMUM - 10 && (
            <p className="text-xs tabular-nums text-muted-foreground">
              {valeur.length} / {MAXIMUM}
            </p>
          )}
        </div>

        {/*
          Aucune proposition n'est appliquée d'office : un nom abrégé est un
          choix d'établissement, souvent porté par un usage local que le nom
          officiel ne laisse pas deviner.
        */}
        {propositions.length > 0 && (
          <div className="space-y-1.5 pt-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Propositions — les mots administratifs sont réduits à leur initiale
            </p>
            <div className="flex flex-wrap gap-2">
              {propositions.map((proposition) => {
                const retenue = proposition === valeur.trim();

                return (
                  <Button
                    key={proposition}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onChange(proposition)}
                    aria-pressed={retenue}
                    /*
                      La proposition retenue se signale par sa BORDURE et une
                      coche, pas par un aplat indigo : le design system réserve
                      cette couleur à un seul moment fort par page, et ici c'est
                      le bouton « Terminer » qui le porte.
                    */
                    className={cn('gap-2', retenue && 'border-primary bg-primary/5 text-primary')}
                  >
                    {retenue && <Check className="h-3.5 w-3.5" />}
                    {proposition}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {court && (
        <Alerte type="avertissement" titre="Nom abrégé trop court">
          Il doit compter au moins {MINIMUM} caractères.
        </Alerte>
      )}

      {valeur.trim() === '' && (
        <Alerte type="info" titre="Ce champ est obligatoire">
          Sans nom abrégé, les documents imprimés reprendraient le nom complet et déborderaient de
          leur cadre.
        </Alerte>
      )}
    </div>
  );
}
