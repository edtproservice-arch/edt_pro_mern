import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Alerte from '@/components/common/Alerte';
import TableauTriable from '@/components/common/TableauTriable';
import { MARGE_PAGE } from '@/components/common/apparenceGrille';
import { nombre } from '@/lib/nombres';
import { chargerNotes } from './api';
import BadgeSanction from './BadgeSanction';
import FicheStagiaire from './FicheStagiaire';
import { DialogueComportement } from './SaisieComportement';
import ListeGroupes from './ListeGroupes';

/**
 * ═══ LES NOTES DE DISCIPLINE, GROUPE PAR GROUPE ═══ (F9, 2026-09-14)
 * ← `get_notes_discipline.php` et la vue `vue_note_discipline` — mais calculées
 * sur la grille réglementaire (`noteDiscipline` du domaine), pas sur la vue.
 *
 * Les groupes en liste, et chacun se déplie sur le tableau des notes de ses
 * stagiaires (2026-09-14, demande du porteur) — là où il fallait d'abord choisir
 * un groupe dans une liste déroulante.
 *
 * ⚠️ LE CALCUL EST RAPPELÉ EN TÊTE : une note de discipline se CONTESTE, et un
 * chiffre sans sa règle ne se défend pas. La ligne dit ce qui retire des points
 * et ce qui n'en retire pas — le justifié.
 */
export default function NotesDiscipline() {
  const [fiche, setFiche] = useState(null);
  const [comportement, setComportement] = useState(null);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Assiduité sur 10 : −0,5 par séance d’absence, −0,25 par retard — seuls les non justifiés comptent. Comportement
        sur 5 : la n-ième indiscipline porte le retrait à n (mise en garde, avertissement, blâme, exclusion de 2 jours,
        exclusion définitive). 1re année : examen de passage, note sur 20 (× 20/15). 2e et 3e année : examen de fin de
        formation, la note reste sur 15.
      </p>

      <ListeGroupes detail={(groupe) => <NotesDuGroupe groupe={groupe} onOuvrirFiche={setFiche} onComportement={setComportement} />} />

      <FicheStagiaire matricule={fiche} onFermer={() => setFiche(null)} />
      <DialogueComportement matricule={comportement} onFermer={() => setComportement(null)} />
    </div>
  );
}

/** Le tableau des notes d'UN groupe, calculé à l'ouverture. */
function NotesDuGroupe({ groupe, onOuvrirFiche, onComportement }) {
  const notes = useQuery({
    queryKey: ['absences-stagiaires', 'notes', groupe],
    queryFn: () => chargerNotes(groupe),
    retry: false,
  });

  if (notes.error) return <Alerte type="erreur" titre="Notes indisponibles">{notes.error.message}</Alerte>;

  const stagiaires = notes.data?.stagiaires ?? [];
  const passage = notes.data?.examen?.type !== 'fin';
  const sanctionnes = stagiaires.filter((s) => s.note.assiduite.sanction || s.note.comportement.sanction).length;

  return (
    <div className="space-y-2">
      {notes.data && (
        <p className="text-xs text-muted-foreground">
          {stagiaires.length} stagiaire(s) · {sanctionnes} avec une sanction ·{' '}
          {passage ? 'examen de passage (note sur 20)' : 'examen de fin de formation (note sur 15)'}
        </p>
      )}
      <TableauTriable
        cartesSous="xl"
        collant={`-${MARGE_PAGE}px`}
        colonnes={colonnes({ ouvrirFiche: onOuvrirFiche, ouvrirComportement: onComportement, passage })}
        lignes={stagiaires}
        cleLigne={(s) => s.matricule}
        vide={notes.isLoading ? 'Calcul des notes…' : 'Aucun stagiaire dans ce groupe.'}
      />
    </div>
  );
}

const avecJustifiees = (nonJustifiees, justifiees) => (
  <span className="text-xs tabular-nums">
    {nonJustifiees}
    {justifiees > 0 && <span className="text-muted-foreground"> (+{justifiees} just.)</span>}
  </span>
);

function colonnes({ ouvrirFiche, ouvrirComportement, passage }) {
  const liste = [
    {
      id: 'stagiaire',
      entete: 'Stagiaire',
      tri: (s) => s.nom,
      rendu: (s) => (
        <button type="button" className="text-left text-xs hover:underline" onClick={() => ouvrirFiche(s.matricule)}>
          <span className="font-medium">{s.nom}</span>
          <span className="block text-muted-foreground">{s.matricule}</span>
        </button>
      ),
    },
    { id: 'absences', entete: 'Séances d’absence', aligne: 'centre', tri: (s) => s.absencesNJ, rendu: (s) => avecJustifiees(s.absencesNJ, s.absencesJ) },
    { id: 'retards', entete: 'Retards', aligne: 'centre', tri: (s) => s.retardsNJ, rendu: (s) => avecJustifiees(s.retardsNJ, s.retardsJ) },
    {
      id: 'assiduite',
      entete: 'Assiduité /10',
      aligne: 'centre',
      tri: (s) => s.note.assiduite.note,
      rendu: (s) => <span className="text-xs font-semibold tabular-nums">{nombre(s.note.assiduite.note)}</span>,
    },
    {
      id: 'sanctionAssiduite',
      entete: 'Sanction',
      tri: (s) => s.note.assiduite.pointsRetires,
      rendu: (s) => <BadgeSanction sanction={s.note.assiduite.sanction} />,
    },
    {
      id: 'comportement',
      entete: 'Comportement /5',
      aligne: 'centre',
      tri: (s) => s.note.comportement.note,
      rendu: (s) => (
        <span className="text-xs tabular-nums">
          <span className="font-semibold">{s.note.comportement.note}</span>
          {s.indisciplines > 0 && <span className="text-muted-foreground"> ({s.indisciplines} indisc.)</span>}
        </span>
      ),
    },
    {
      id: 'note15',
      entete: 'Note /15',
      aligne: 'centre',
      tri: (s) => s.note.note15,
      rendu: (s) => <span className="text-sm font-bold tabular-nums">{nombre(s.note.note15)}</span>,
    },
  ];
  // Fin de formation (2e et 3e année) : la note reste sur 15, pas de conversion.
  if (passage) {
    liste.push({
      id: 'note20',
      entete: 'Passage /20',
      aligne: 'centre',
      tri: (s) => s.note.note20,
      rendu: (s) => <span className="text-xs font-bold tabular-nums">{nombre(s.note.note20)}</span>,
    });
  }
  liste.push({
    id: 'actions',
    entete: '',
    rendu: (s) => (
      <div className="flex justify-end gap-1.5">
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => ouvrirComportement(s.matricule)}>
          <Plus className="size-3.5" /> Comportement
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => ouvrirFiche(s.matricule)}>
          Fiche
        </Button>
      </div>
    ),
  });
  return liste;
}
