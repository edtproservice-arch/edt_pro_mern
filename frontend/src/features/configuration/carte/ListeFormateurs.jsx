import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Plus, UserRoundPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ImportFormateurs from './ImportFormateurs';

/** Au-delà de ce nombre, la liste des formateurs part repliée. */
const SEUIL_REPLI = 12;

/**
 * Formateurs disponibles pour l'affectation.
 * ← le bloc 2 de public/partials/affectation-carte.html:246-268
 *
 * L'existant les importait d'un classeur Excel (colonnes Mle, Nom & Prénom,
 * MHS Annuelle) via une modale de canevas. La saisie directe est faite ici ;
 * l'import du canevas reste à porter.
 *
 * La masse horaire demandée est la masse STATUTAIRE ANNUELLE — pas la somme des
 * heures affectées. L'écran d'origine le signalait en rouge, parce que la
 * confusion fausse tous les taux de charge (F7).
 */
export default function ListeFormateurs({
  formateurs,
  groupes,
  onAjouter,
  onRetirer,
  onRemplacer,
}) {
  const [nom, setNom] = useState('');
  const [matricule, setMatricule] = useState('');
  const [masseHoraire, setMasseHoraire] = useState('');

  /** Au-delà d'une douzaine, la liste occupe tout l'écran : elle part repliée. */
  const [deplie, setDeplie] = useState(formateurs.length <= SEUIL_REPLI);
  const [filtre, setFiltre] = useState('');

  const recherche = filtre.trim().toUpperCase();
  const visibles = recherche
    ? formateurs.filter(
        (formateur) =>
          formateur.nom.includes(recherche) ||
          String(formateur.matricule ?? '').toUpperCase().includes(recherche)
      )
    : formateurs;

  const ajouter = () => {
    const propre = nom.trim().toUpperCase();
    if (!propre) return;

    // Le doublon est écarté silencieusement par le hook : le dire évite au
    // directeur de croire que sa saisie a été perdue.
    if (formateurs.some((formateur) => formateur.nom === propre)) {
      toast.info(`${propre} est déjà dans la liste`);
      return;
    }

    onAjouter({
      nom,
      matricule: matricule.trim(),
      masseHoraire: masseHoraire === '' ? undefined : Number(masseHoraire),
    });

    toast.success(`${propre} ajouté`, {
      description: masseHoraire ? `${masseHoraire} h statutaires` : 'Masse horaire non renseignée',
    });

    setNom('');
    setMatricule('');
    setMasseHoraire('');
  };

  const retirer = (formateur) => {
    onRetirer(formateur.nom);
    toast.success(`${formateur.nom} retiré`, {
      description: 'Ses affectations sur la carte ont été libérées.',
    });
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
          2
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-medium">Formateurs disponibles</h3>
          <p className="text-sm text-muted-foreground">
            La masse horaire attendue est la masse <strong>statutaire annuelle</strong>, pas le
            total des heures affectées.
          </p>
        </div>

        <ImportFormateurs
          formateurs={formateurs}
          groupes={groupes}
          onFusion={onRemplacer}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
        <div>
          <Label className="mb-1.5 block">Nom complet</Label>
          <Input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ajouter()}
            placeholder="AHMED CHERKAOUI"
          />
        </div>
        <div>
          <Label className="mb-1.5 block">Matricule</Label>
          <Input
            value={matricule}
            onChange={(e) => setMatricule(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ajouter()}
            placeholder="9863"
          />
        </div>
        <div>
          <Label className="mb-1.5 block">Masse horaire</Label>
          <Input
            type="number"
            min={0}
            max={2000}
            value={masseHoraire}
            onChange={(e) => setMasseHoraire(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ajouter()}
            placeholder="720"
          />
        </div>
        <Button onClick={ajouter} disabled={!nom.trim()}>
          <Plus className="h-4 w-4" />
          Ajouter
        </Button>
      </div>

      {formateurs.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <UserRoundPlus className="h-4 w-4" />
          Aucun formateur. Sans eux, les modules resteront non affectés.
        </div>
      ) : (
        <div className="space-y-3">
          {/*
            La liste est repliable, et repliée d'office au-delà d'une douzaine :
            29 formateurs occupaient tout l'écran et repoussaient la carte hors
            de vue. ← le bouton « Voir la liste des formateurs » de
            affectation-carte.html:262
          */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeplie(!deplie)}>
              {deplie ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {deplie ? 'Masquer la liste' : 'Voir la liste'}
              <span className="text-muted-foreground">({formateurs.length})</span>
            </Button>

            {deplie && (
              <Input
                value={filtre}
                onChange={(e) => setFiltre(e.target.value)}
                placeholder="Filtrer…"
                className="h-8 max-w-[220px] flex-1"
              />
            )}
          </div>

          {deplie &&
            (visibles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun formateur ne correspond à « {filtre} ».
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {visibles.map((formateur) => (
                  <span
                    key={formateur.nom}
                    className="inline-flex items-center gap-1.5 rounded-md bg-muted py-1 pl-3 pr-1.5 text-sm"
                  >
                    {formateur.nom}
                    {formateur.matricule && (
                      <span className="text-muted-foreground">· {formateur.matricule}</span>
                    )}
                    {formateur.masseHoraire ? (
                      <span className="text-muted-foreground">· {formateur.masseHoraire} h</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => retirer(formateur)}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                      aria-label={`Retirer ${formateur.nom}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
