import { useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ImportFormateurs from '../carte/ImportFormateurs';

/**
 * Ajout d'un formateur, à la main ou depuis un classeur Excel.
 * ← le bloc « Formateurs disponibles » de la carte d'affectations, dont c'est
 *   le déménagement (2026-09-19, demande du porteur) : ajouter un formateur est
 *   un geste de la page Formateurs, pas de la matrice d'affectation.
 *
 * ⚠️ LE FORMULAIRE NE SE VIDE QU'UNE FOIS L'ÉCRITURE FAITE. Le bloc d'origine
 * écrivait dans un état local, donc « ajouté » était vrai à l'instant du clic.
 * Ici le formateur part au serveur : vider le champ avant la réponse ferait
 * perdre la saisie si l'enregistrement est refusé.
 *
 * ⚠️ LE DOUBLON EST DIT, pas écarté en silence : c'est la règle de la carte, pour
 * qu'on ne croie pas sa saisie perdue.
 *
 * ⚠️ « PROTÉGÉS » = LES FORMATEURS ENCORE AFFECTÉS. L'import en mode « remplacer »
 * retire ceux qui manquent au fichier, sauf eux — ce que la carte tirait de ses
 * groupes, et que cette page tire des affectations de la base.
 *
 * @param {object} props
 * @param {Array<{nom: string, matricule?: string, email?: string, masseHoraire?: number}>} props.formateurs
 *   la liste actuelle, à la forme de la carte
 * @param {string[]} props.proteges  noms portant encore une affectation
 * @param {boolean} props.enCours    une écriture est en vol
 * @param {(formateur) => Promise<unknown>} props.onAjouter
 * @param {({resultat, lus}) => Promise<unknown>} props.onImport
 */
export default function AjoutFormateur({ formateurs, proteges, enCours, onAjouter, onImport }) {
  const [nom, setNom] = useState('');
  const [matricule, setMatricule] = useState('');
  const [masseHoraire, setMasseHoraire] = useState('');

  const ajouter = async () => {
    const propre = nom.trim().replace(/\s+/g, ' ').toUpperCase();
    if (!propre || enCours) return;

    if (formateurs.some((formateur) => formateur.nom.trim().toUpperCase() === propre)) {
      toast.info(`${propre} est déjà dans la liste`);
      return;
    }

    try {
      await onAjouter({
        nom: propre,
        matricule: matricule.trim(),
        masseHoraire: masseHoraire === '' ? undefined : Number(masseHoraire),
      });
    } catch {
      // L'appelant a déjà dit pourquoi ; la saisie reste là pour être reprise.
      return;
    }

    setNom('');
    setMatricule('');
    setMasseHoraire('');
  };

  const touche = (evenement) => {
    if (evenement.key === 'Enter') ajouter();
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h3 className="text-sm font-medium">Ajouter un formateur</h3>
          <p className="text-sm text-muted-foreground">
            La masse horaire attendue est la masse <strong>statutaire annuelle</strong>, pas le
            total des heures affectées.
          </p>
        </div>

        <ImportFormateurs
          formateurs={formateurs}
          groupes={[]}
          proteges={proteges}
          surFusion={onImport}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="ajout-formateur-nom" className="mb-1.5 block">
            Nom complet
          </Label>
          <Input
            id="ajout-formateur-nom"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            onKeyDown={touche}
            placeholder="AHMED CHERKAOUI"
          />
        </div>
        <div>
          <Label htmlFor="ajout-formateur-matricule" className="mb-1.5 block">
            Matricule
          </Label>
          <Input
            id="ajout-formateur-matricule"
            value={matricule}
            onChange={(e) => setMatricule(e.target.value)}
            onKeyDown={touche}
            placeholder="9863"
          />
        </div>
        <div>
          <Label htmlFor="ajout-formateur-masse" className="mb-1.5 block">
            Masse horaire
          </Label>
          <Input
            id="ajout-formateur-masse"
            type="number"
            min={0}
            max={2000}
            value={masseHoraire}
            onChange={(e) => setMasseHoraire(e.target.value)}
            onKeyDown={touche}
            placeholder="720"
          />
        </div>
        <Button onClick={ajouter} disabled={!nom.trim() || enCours}>
          <Plus className="h-4 w-4" />
          Ajouter
        </Button>
      </div>
    </div>
  );
}
