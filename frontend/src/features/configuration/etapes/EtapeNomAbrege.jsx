import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Alerte from '@/components/common/Alerte';
import { chargerEtablissementCourant } from '../api';

/** Ce que le serveur accepte — même bornes que `nomAbregeSchema`. */
const MINIMUM = 2;
const MAXIMUM = 30;

/**
 * Étape 5 — nom abrégé de l'établissement.
 *
 * ═══ SANS PROPOSITIONS (2026-09-19, demande du porteur) ═══
 * L'étape suggérait des formes courtes déduites du nom officiel (« CFP MGD HASSANIA »…).
 * Elle ne le fait plus : le directeur saisit lui-même le nom qu'il veut voir sur ses
 * documents. Le calcul (`propositionsNomAbrege`) reste dans le domaine partagé.
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
