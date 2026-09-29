import { useState } from 'react';
import { Star } from 'lucide-react';
import { TYPES_COURS } from 'shared/constants';
import { avancementModule, cleModule, conflitAvecCollegues, typeDeSeance } from 'shared/domain';
import BadgeAvancement from '@/components/common/BadgeAvancement';
import BadgeSemestre from '@/components/common/BadgeSemestre';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const SALLE_DISTANCIEL = 'TEAMS';

/**
 * Le formulaire d'une case : espace, groupe, module.
 * ← `openManualAdd()` de inbox.html
 *
 * ⚠️ LES GROUPES ET MODULES VIENNENT DES AFFECTATIONS DU FORMATEUR, rendues par
 * le serveur — les mêmes que `poser()` exigera à l'application. Offrir plus
 * ferait envoyer une proposition vouée au refus.
 *
 * ⚠️ UN CONFLIT AVEC UN COLLÈGUE BLOQUE LA VALIDATION (décision du 2026-09-23) :
 * le message le nomme sous les listes, le bouton reste éteint.
 *
 * `salleSeulement` : mode chronogramme — groupe et module viennent de l'import,
 * seule la salle se choisit.
 *
 * ═══ ⭐ · SEMESTRE · AVANCEMENT DANS LA LISTE DES MODULES (2026-09-23) ═══
 * Les repères de la liste de la page Emploi (`CaseEmploi`), avec les mêmes
 * badges et le même calcul (`avancementModule`, rapporté à la masse DU TYPE de
 * la séance — salle ou TEAMS). On choisit un module pour savoir ce qui lui
 * manque : le lire après coup obligerait à revenir en arrière.
 *
 * ═══ LES GROUPES SUIVENT L'ESPACE, COMME DANS LA PAGE EMPLOI (2026-09-23) ═══
 * TEAMS → les libellés FUSIONNÉS seulement ; une salle → les groupes un par un.
 * Changer d'espace vers l'autre nature vide le groupe et le module choisis :
 * « GM101 » n'existe pas en TEAMS, « GM101 GM102 » pas en salle.
 *
 * ⚠️ L'ESPACE D'UNE NOUVELLE SÉANCE EST CELUI ATTRIBUÉ AU FORMATEUR (demande du
 * porteur, 2026-09-23) — saisi page Formateurs — et il peut en changer. Le
 * premier espace de l'établissement n'était qu'un défaut arbitraire.
 */
export default function EditeurSeance({
  jour,
  seance,
  initiale,
  options,
  espaces,
  reservees,
  groupesFq,
  indicateurs,
  espacesAttribues = [],
  salleSeulement = false,
  onValider,
  onAnnuler,
}) {
  const [salle, setSalle] = useState(
    initiale?.salle || espacesAttribues.find((e) => espaces.includes(e)) || espaces[0] || SALLE_DISTANCIEL
  );
  const [groupe, setGroupe] = useState(initiale?.groupe ?? '');
  const [module, setModule] = useState(initiale?.module ?? '');

  const listes =
    typeDeSeance({ salle }) === TYPES_COURS.SYNCHRONE ? options.synchrone : options.presentiel;
  const modules = listes.modulesParGroupe[groupe] ?? [];
  const fiches = new Map(Object.entries(indicateurs?.fiches ?? {}));
  const posees = new Map(Object.entries(indicateurs?.posees ?? {}));
  const type = typeDeSeance({ salle });

  const choisirSalle = (valeur) => {
    setSalle(valeur);
    const suivantes =
      typeDeSeance({ salle: valeur }) === TYPES_COURS.SYNCHRONE ? options.synchrone : options.presentiel;
    if (groupe && !suivantes.groupes.includes(groupe)) {
      setGroupe('');
      setModule('');
    }
  };
  const listeSalles = [SALLE_DISTANCIEL, ...espaces.filter((e) => e !== SALLE_DISTANCIEL)];

  const conflit =
    groupe && module ? conflitAvecCollegues({ jour, seance, groupe, module, salle }, reservees, { groupesFq }) : null;

  const choisirGroupe = (valeur) => {
    setGroupe(valeur);
    // Un seul module possible : on le choisit d'office, comme le ferait la main.
    const possibles = listes.modulesParGroupe[valeur] ?? [];
    setModule(possibles.length === 1 ? possibles[0] : '');
  };

  return (
    <div className="w-64 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">
          {salleSeulement ? 'Choisir l’espace' : initiale ? 'Modifier la séance' : 'Ajouter une séance'}
        </p>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {jour} {seance}
        </span>
      </div>

      <Champ libelle="Espace">
        <Select value={salle} onValueChange={choisirSalle}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {listeSalles.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
      </Champ>

      <Champ libelle="Groupe">
        <Select value={groupe} onValueChange={choisirGroupe} disabled={salleSeulement}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Choisir un groupe" /></SelectTrigger>
          <SelectContent>
            {listes.groupes.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
      </Champ>

      <Champ libelle="Module">
        <Select value={module} onValueChange={setModule} disabled={!groupe || salleSeulement}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Choisir un module" /></SelectTrigger>
          <SelectContent>
            {modules.map((m) => {
              const fiche = fiches.get(cleModule(groupe, m));
              return (
                <SelectItem key={m} value={m}>
                  <span className="flex items-center gap-1.5">
                    {m}
                    {fiche?.estRegional && <Star className="size-2.5 fill-warning text-warning" aria-label="Régional" />}
                    <BadgeSemestre semestre={fiche?.semestre} />
                    <BadgeAvancement avancement={avancementModule(fiches, posees, groupe, m, type)} />
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </Champ>

      {conflit && <p className="text-xs text-destructive">{conflit.message}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onAnnuler}>Annuler</Button>
        <Button
          type="button"
          size="sm"
          disabled={!groupe || !module || Boolean(conflit)}
          onClick={() => onValider({ groupe, module, salle })}
        >
          Valider
        </Button>
      </div>
    </div>
  );
}

const Champ = ({ libelle, children }) => (
  <div className="space-y-1">
    <Label className="text-xs text-muted-foreground">{libelle}</Label>
    {children}
  </div>
);
