import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Alerte from '@/components/common/Alerte';

/**
 * Saisie manuelle d'une ligne de répartition — création et modification.
 *
 * ═══ ⚠️ CETTE SAISIE N'EXISTAIT NULLE PART ═══
 * L'existant n'avait qu'un import Excel (`upload_repartition.php`) et une
 * suppression en ligne de commande. Corriger une seule masse horaire supposait
 * donc de fabriquer un classeur — ou d'éditer la base à la main.
 *
 * ⚠️ L'IDENTITÉ EST SIGNALÉE COMME TELLE : filière, année et code de module
 * forment la clé unique. Les modifier ne change pas la ligne, cela la fait
 * changer de PLACE — et peut la faire entrer en collision avec une autre. Le
 * serveur refuse alors en le nommant ; l'écran prévient avant.
 */
const CHAMPS_TEXTE = [
  { nom: 'secteur', libelle: 'Secteur', requis: true, large: true },
  { nom: 'niveauFormation', libelle: 'Niveau de formation', exemple: 'TS, T, Q, FQ…' },
  { nom: 'typeFormation', libelle: 'Type de formation', exemple: 'Diplômante…' },
  { nom: 'creneau', libelle: 'Créneau', exemple: 'RES, CDS…' },
  { nom: 'intituleFiliere', libelle: 'Intitulé de la filière', large: true },
  { nom: 'codeFiliereCarte', libelle: 'Code filière carte' },
  { nom: 'filiere', libelle: 'Filière (libellé carte)', large: true },
  { nom: 'metier', libelle: 'Métier', large: true },
];

const MASSES = [
  { nom: 'mhpS1', libelle: 'MHP S1' },
  { nom: 'mhsynS1', libelle: 'MHSYN S1' },
  { nom: 'mhasynS1', libelle: 'MHASYN S1' },
  { nom: 'mhpS2', libelle: 'MHP S2' },
  { nom: 'mhsynS2', libelle: 'MHSYN S2' },
  { nom: 'mhasynS2', libelle: 'MHASYN S2' },
  { nom: 'mhpTotale', libelle: 'MHP totale' },
  { nom: 'mhdTotale', libelle: 'MHD totale' },
];

const VIDE = {
  secteur: '',
  niveauFormation: '',
  typeFormation: '',
  creneau: '',
  codeFiliereDrif: '',
  intituleFiliere: '',
  codeFiliereCarte: '',
  filiere: '',
  anneeFormation: 1,
  codeModule: '',
  module: '',
  mhpS1: 0,
  mhsynS1: 0,
  mhasynS1: 0,
  mhpS2: 0,
  mhsynS2: 0,
  mhasynS2: 0,
  mhpTotale: 0,
  mhdTotale: 0,
  efmRegional: false,
  metier: '',
};

export default function FormulaireLigne({ ouvert, ligne, defauts, enCours, erreur, onFermer, onEnregistrer }) {
  const [valeurs, setValeurs] = useState(VIDE);

  /*
   * ⚠️ LES VALEURS SE POSENT À L'OUVERTURE, pas à chaque rendu : sans cette
   * dépendance sur `ouvert`, une frappe serait écrasée par la ligne d'origine au
   * rendu suivant, et le champ paraîtrait refuser la saisie.
   */
  useEffect(() => {
    if (!ouvert) return;
    setValeurs({ ...VIDE, ...(defauts ?? {}), ...(ligne ?? {}) });
  }, [ouvert, ligne, defauts]);

  const modifier = (nom, valeur) => setValeurs((actuelles) => ({ ...actuelles, [nom]: valeur }));

  const complet =
    valeurs.secteur.trim() !== '' &&
    valeurs.codeFiliereDrif.trim() !== '' &&
    valeurs.codeModule.trim() !== '' &&
    valeurs.module.trim() !== '';

  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{ligne ? 'Modifier la ligne' : 'Ajouter une ligne'}</DialogTitle>
          <DialogDescription>
            Une ligne = un module, pour une filière et une année. Ce référentiel est national :
            la modification vaut pour tous les établissements.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
          {erreur && (
            <Alerte type="erreur" titre="Enregistrement refusé">
              {erreur.message}
            </Alerte>
          )}

          <Section titre="Identité" aide="Filière, année et code du module : c'est ce triplet qui identifie la ligne. Deux lignes ne peuvent pas le partager.">
            <Champ
              libelle="Code filière DRIF"
              requis
              valeur={valeurs.codeFiliereDrif}
              onChange={(v) => modifier('codeFiliereDrif', v)}
              exemple="AE_IRMC_FQ_RCDS"
            />
            <div className="space-y-1.5">
              <Label htmlFor="anneeFormation">Année de formation</Label>
              <Input
                id="anneeFormation"
                type="number"
                min={1}
                max={5}
                value={valeurs.anneeFormation}
                onChange={(e) => modifier('anneeFormation', Number(e.target.value) || 1)}
              />
            </div>
            <Champ
              libelle="Code module"
              requis
              valeur={valeurs.codeModule}
              onChange={(v) => modifier('codeModule', v)}
              exemple="M101"
            />
            <Champ
              libelle="Intitulé du module"
              requis
              large
              valeur={valeurs.module}
              onChange={(v) => modifier('module', v)}
            />
          </Section>

          <Section titre="Filière">
            {CHAMPS_TEXTE.map((champ) => (
              <Champ
                key={champ.nom}
                libelle={champ.libelle}
                requis={champ.requis}
                large={champ.large}
                exemple={champ.exemple}
                valeur={valeurs[champ.nom] ?? ''}
                onChange={(v) => modifier(champ.nom, v)}
              />
            ))}
          </Section>

          <Section
            titre="Masses horaires"
            aide="En heures. Le présentiel et le synchrone se comptent séparément — l'emploi du temps les mesure chacun à sa propre masse."
          >
            {MASSES.map((masse) => (
              <div key={masse.nom} className="space-y-1.5">
                <Label htmlFor={masse.nom}>{masse.libelle}</Label>
                <Input
                  id={masse.nom}
                  type="number"
                  min={0}
                  step="0.5"
                  value={valeurs[masse.nom] ?? 0}
                  onChange={(e) => modifier(masse.nom, Number(e.target.value) || 0)}
                />
              </div>
            ))}
          </Section>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <Label htmlFor="efmRegional" className="text-sm font-medium">
                EFM régional
              </Label>
              <p className="text-xs text-muted-foreground">
                L&apos;examen de fin de module est organisé au niveau régional.
              </p>
            </div>
            <Switch
              id="efmRegional"
              checked={Boolean(valeurs.efmRegional)}
              onCheckedChange={(v) => modifier('efmRegional', v)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFermer} disabled={enCours}>
            Annuler
          </Button>
          <Button onClick={() => onEnregistrer(valeurs)} disabled={!complet || enCours}>
            {enCours ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ titre, aide, children }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{titre}</h3>
        {aide && <p className="text-xs text-muted-foreground">{aide}</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function Champ({ libelle, valeur, onChange, requis = false, large = false, exemple }) {
  const id = libelle.replace(/\s/g, '-').toLowerCase();

  return (
    <div className={`space-y-1.5 ${large ? 'sm:col-span-2' : ''}`}>
      <Label htmlFor={id}>
        {libelle}
        {requis && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <Input
        id={id}
        value={valeur}
        placeholder={exemple}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
