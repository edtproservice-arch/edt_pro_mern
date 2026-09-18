import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Alerte from '@/components/common/Alerte';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { genererNomsGroupes } from 'shared/domain';
import {
  chargerAnnees,
  chargerFilieres,
  chargerModulesFiliere,
  chargerNiveaux,
  chargerSecteurs,
} from '../api';

/**
 * Configuration de la filière et génération des groupes.
 * ← le bloc 1 de public/partials/affectation-carte.html:203-245
 *
 * La cascade descend secteur → niveau → créneau → année → filière. Chaque
 * niveau efface les suivants : garder une année sélectionnée après un
 * changement de secteur produisait une sélection incohérente, silencieusement.
 */
const CRENEAUX = [
  { valeur: 'CDJ', libelle: 'CDJ — Cours du jour' },
  { valeur: 'CDS', libelle: 'CDS — Cours du soir' },
  { valeur: 'ALL', libelle: 'Tous les créneaux' },
];

const MODES = ['Résidentiel', 'Alterné', 'Par apprentissage'];

export default function SelecteurFiliere({ onGenerer, enCours, groupes = [] }) {
  const [secteur, setSecteur] = useState('');
  const [niveau, setNiveau] = useState('');
  const [creneau, setCreneau] = useState('CDJ');
  const [annee, setAnnee] = useState('');
  const [filiere, setFiliere] = useState('');
  const [mode, setMode] = useState('Résidentiel');
  const [nombre, setNombre] = useState(1);

  const secteurs = useQuery({ queryKey: ['drif-secteurs'], queryFn: chargerSecteurs });

  const niveaux = useQuery({
    queryKey: ['drif-niveaux', secteur],
    queryFn: () => chargerNiveaux({ secteur }),
    enabled: Boolean(secteur),
  });

  const annees = useQuery({
    queryKey: ['drif-annees', secteur, niveau, creneau],
    queryFn: () => chargerAnnees({ secteur, niveau, creneau }),
    enabled: Boolean(secteur && niveau),
  });

  const filieres = useQuery({
    queryKey: ['drif-filieres', secteur, niveau, creneau, annee],
    queryFn: () => chargerFilieres({ secteur, niveau, creneau, annee }),
    enabled: Boolean(secteur && niveau && annee),
  });

  const modules = useQuery({
    queryKey: ['drif-modules', filiere, annee],
    queryFn: () => chargerModulesFiliere(filiere, annee),
    enabled: Boolean(filiere && annee),
  });

  // Chaque niveau efface les suivants.
  useEffect(() => {
    setNiveau('');
  }, [secteur]);
  useEffect(() => {
    setAnnee('');
  }, [niveau, creneau]);
  useEffect(() => {
    setFiliere('');
  }, [annee]);

  const filiereChoisie = filieres.data?.filieres?.find((f) => f.code === filiere);
  const nbModules = modules.data?.modules?.length ?? 0;
  const pret = Boolean(filiere && annee && nbModules > 0);

  /*
   * Aperçu des noms : le directeur voit ce qu'il va créer avant de le créer.
   *
   * Produit par `genererNomsGroupes()` — LA MÊME fonction que la génération —
   * et non par un calcul parallèle. Deux conséquences :
   *   - TOUS les noms sont annoncés, pas seulement le premier ;
   *   - la numérotation REPREND après les groupes existants de la filière. Le
   *     calcul d'origine repartait de 01, et annonçait donc « DEVOWFS201 »
   *     là où la génération allait créer « DEVOWFS203 ».
   */
  const noms = useMemo(() => {
    if (!filiere) return [];
    try {
      return genererNomsGroupes({
        codeFiliere: filiere,
        anneeFormation: Number.parseInt(annee, 10) || 1,
        nombre,
        groupesExistants: groupes.map((groupe) => ({
          nom: groupe.nom,
          codeFiliere: groupe.codeFiliere,
        })),
      }).noms;
    } catch {
      // Nombre hors bornes pendant la saisie : l'aperçu attend, le bouton reste
      // le garde-fou.
      return [];
    }
  }, [filiere, annee, nombre, groupes]);

  // Au-delà de trois, la liste complète déborde : on donne les bornes.
  const apercu =
    noms.length === 0
      ? '—'
      : noms.length <= 3
        ? noms.join(', ')
        : `${noms[0]} → ${noms[noms.length - 1]}`;

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
          1
        </span>
        <div>
          <h3 className="text-sm font-medium">Configuration de la filière</h3>
          <p className="text-sm text-muted-foreground">
            Les modules sont chargés depuis la répartition officielle DRIF.
          </p>
        </div>
      </div>

      {/*
        Un menu déroulant vide n'explique rien : le directeur clique, ne voit
        aucune option, et ne sait pas si c'est sa session, le serveur ou le
        référentiel. Les deux cas sont donc nommés.
      */}
      {secteurs.isError && (
        <Alerte type="erreur" titre="Répartition DRIF indisponible">
          {secteurs.error.message} — la carte ne peut pas être construite sans elle.
        </Alerte>
      )}

      {secteurs.isSuccess && (secteurs.data.secteurs?.length ?? 0) === 0 && (
        <Alerte type="erreur" titre="Le référentiel DRIF est vide">
          Aucun secteur n&apos;est enregistré. La collection <code>repartitions</code> doit être
          alimentée avant de pouvoir construire une carte.
        </Alerte>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Champ libelle="Secteur">
          <Liste
            valeur={secteur}
            onChange={setSecteur}
            options={(secteurs.data?.secteurs ?? []).map((s) => ({ valeur: s, libelle: s }))}
            chargement={secteurs.isLoading}
            attente="Choisir un secteur"
          />
        </Champ>

        <Champ libelle="Niveau de formation">
          <Liste
            valeur={niveau}
            onChange={setNiveau}
            disabled={!secteur}
            options={(niveaux.data?.niveaux ?? []).map((n) => ({ valeur: n, libelle: n }))}
            chargement={Boolean(secteur) && niveaux.isLoading}
            attente={secteur ? 'Choisir un niveau' : 'Secteur d’abord'}
          />
        </Champ>

        <Champ libelle="Créneau">
          <Liste
            valeur={creneau}
            onChange={setCreneau}
            options={CRENEAUX.map((c) => ({ valeur: c.valeur, libelle: c.libelle }))}
          />
        </Champ>

        <Champ libelle="Année de formation">
          <Liste
            valeur={annee}
            onChange={setAnnee}
            disabled={!niveau}
            options={(annees.data?.annees ?? []).map((a) => ({
              valeur: String(a),
              libelle: `Année ${a}`,
            }))}
            chargement={Boolean(niveau) && annees.isLoading}
            attente={niveau ? 'Choisir une année' : 'Niveau d’abord'}
          />
        </Champ>

        <Champ libelle="Filière" className="lg:col-span-2">
          <Liste
            valeur={filiere}
            onChange={setFiliere}
            disabled={!annee}
            options={(filieres.data?.filieres ?? []).map((f) => ({
              valeur: f.code,
              // Le code est affiché : un même intitulé peut porter plusieurs
              // codes DRIF (jour / soir, versions successives).
              libelle: `${f.intitule} — ${f.code} (${f.modules} modules)`,
            }))}
            chargement={Boolean(annee) && filieres.isLoading}
            attente={annee ? 'Choisir une filière' : 'Année d’abord'}
          />
        </Champ>

        <Champ libelle="Mode de formation">
          <Liste
            valeur={mode}
            onChange={setMode}
            options={MODES.map((m) => ({ valeur: m, libelle: m }))}
          />
        </Champ>

        <Champ libelle="Nombre de groupes">
          <Input
            type="number"
            min={1}
            max={20}
            value={nombre}
            onChange={(e) => setNombre(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
          />
        </Champ>

        <div className="flex items-end">
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            Nommage : <span className="font-medium">{apercu}</span>
          </div>
        </div>
      </div>

      <Button
        className="w-full"
        disabled={!pret || enCours || modules.isLoading}
        onClick={() =>
          onGenerer({
            filiere: { ...filiereChoisie, ...modules.data.filiere },
            annee: Number.parseInt(annee, 10),
            nombre,
            mode,
            modules: modules.data.modules,
          })
        }
      >
        <Layers className="h-4 w-4" />
        {modules.isLoading
          ? <IndicateurChargement className="text-primary-foreground" label="Chargement des modules" />
          : `Générer ${nombre} groupe(s)${nbModules ? ` · ${nbModules} modules` : ''}`}
      </Button>
    </div>
  );
}

function Champ({ libelle, children, className }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{libelle}</Label>
      {children}
    </div>
  );
}

function Liste({
  valeur,
  onChange,
  options,
  attente = 'Choisir…',
  disabled = false,
  chargement = false,
}) {
  if (chargement) {
    return (
      <div className="flex h-9 items-center rounded-md border px-3 text-sm text-muted-foreground">
        <IndicateurChargement className="size-4" />
      </div>
    );
  }

  // Le cas « activé mais sans option » existe : une année sans filière dans le
  // créneau retenu, par exemple. Le dire vaut mieux qu'un menu vide.
  if (!disabled && options.length === 0) {
    return (
      <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
        Aucun résultat
      </div>
    );
  }

  return (
    // `value ?? ''` et non `|| undefined` : passer `undefined` rend le composant
    // non contrôlé, et l'affichage reste sur l'ancienne valeur après une remise
    // à zéro de la cascade.
    <Select value={valeur ?? ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={attente} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.valeur} value={option.valeur}>
            {option.libelle}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
