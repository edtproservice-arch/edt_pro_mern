import { useMemo } from 'react';
import { useWatch } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { chargerEtablissements } from '../api';

/**
 * Cascade Région → Complexe → Établissement.
 *
 * ← register.html (selects `regionSelect` / `complexeSelect` / `etablissementSelect`).
 * Le référentiel vient de `GET /api/v2/reseau` — une route PUBLIQUE, puisque
 * l'inscription précède toute session — et garde la forme
 * `{ région: { complexe: [établissements] } }` qu'avait le fichier JSON.
 *
 * `FormField` de shadcn encapsule déjà `Controller` : c'est lui qui pilote ces
 * composants contrôlés externes, que `register()` ne sait pas gérer.
 */
export default function SelecteurEtablissement({ control, setValue }) {
  const { data: referentiel, isLoading } = useQuery({
    queryKey: ['referentiel-etablissements'],
    queryFn: chargerEtablissements,
    staleTime: Infinity,
  });

  const [region, complexe] = useWatch({ control, name: ['region', 'complexe'] });

  const regions = useMemo(() => Object.keys(referentiel ?? {}).sort(), [referentiel]);
  const complexes = useMemo(
    () => (region ? Object.keys(referentiel?.[region] ?? {}).sort() : []),
    [referentiel, region]
  );
  const etablissements = useMemo(
    () => referentiel?.[region]?.[complexe] ?? [],
    [referentiel, region, complexe]
  );

  /** Un niveau change → les niveaux inférieurs sont vidés, sinon on garderait
   *  un établissement qui n'appartient plus au complexe sélectionné. */
  const vider = (...champs) => {
    for (const champ of champs) setValue(champ, '', { shouldValidate: false });
  };

  return (
    <>
      <ChampSelect
        control={control}
        nom="region"
        label="Région"
        options={regions}
        placeholder="Sélectionnez une région"
        disabled={isLoading}
        isLoading={isLoading}
        apresChangement={() => vider('complexe', 'nomEtablissement')}
      />

      <ChampSelect
        control={control}
        nom="complexe"
        label="Complexe de formation"
        options={complexes}
        placeholder={region ? 'Sélectionnez un complexe' : "Sélectionnez d'abord une région"}
        disabled={!region}
        apresChangement={() => vider('nomEtablissement')}
      />

      <ChampSelect
        control={control}
        nom="nomEtablissement"
        label="Établissement"
        options={etablissements}
        placeholder={complexe ? 'Sélectionnez un établissement' : "Sélectionnez d'abord un complexe"}
        disabled={!complexe}
      />
    </>
  );
}

function ChampSelect({
  control,
  nom,
  label,
  options,
  placeholder,
  disabled,
  isLoading = false,
  apresChangement,
}) {
  return (
    <FormField
      control={control}
      name={nom}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          {/* `value` doit rester une chaîne : passer `undefined` ferait repasser
              Radix en mode non contrôlé, et le champ garderait l'ancien libellé
              après une réinitialisation en cascade au lieu du placeholder. */}
          <Select
            value={field.value ?? ''}
            onValueChange={(valeur) => {
              field.onChange(valeur);
              apresChangement?.();
            }}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger>
                {isLoading ? (
                  <>
                    <span className="flex flex-1 justify-center">
                      <IndicateurChargement className="size-4" label="Chargement des régions" />
                    </span>
                  </>
                ) : (
                  <SelectValue placeholder={placeholder} />
                )}
              </SelectTrigger>
            </FormControl>
            <SelectContent className="max-h-72">
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
