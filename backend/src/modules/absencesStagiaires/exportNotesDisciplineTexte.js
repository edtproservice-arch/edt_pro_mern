/** Ce que les trois formats des notes de discipline partagent : les colonnes. */

/** Les colonnes, communes aux trois formats. `passage` : la colonne /20 en plus. */
export function colonnesNotes(passage) {
  const sanction = (s) => (s ? `${s.libelle} (${s.autorite})` : '—');
  const colonnes = [
    { id: 'numero', entete: 'N°', poids: 3, valeur: (s, index) => index + 1 },
    { id: 'matricule', entete: 'Matricule', poids: 11, valeur: (s) => s.matricule },
    { id: 'nom', entete: 'Nom et prénom', poids: 15, gauche: true, valeur: (s) => s.nom },
    { id: 'absencesNJ', entete: 'Absences non justifiées (séances)', poids: 7, valeur: (s) => s.absencesNJ },
    { id: 'absencesJ', entete: 'Absences justifiées (séances)', poids: 7, valeur: (s) => s.absencesJ },
    { id: 'retardsNJ', entete: 'Retards non justifiés', poids: 6, valeur: (s) => s.retardsNJ },
    { id: 'retardsJ', entete: 'Retards justifiés', poids: 6, valeur: (s) => s.retardsJ },
    { id: 'assiduite', entete: 'Assiduité /10', poids: 6, note: true, valeur: (s) => s.note.assiduite.note },
    { id: 'sanctionAssiduite', entete: 'Sanction assiduité', poids: 12, gauche: true, valeur: (s) => sanction(s.note.assiduite.sanction) },
    { id: 'indisciplines', entete: 'Indisciplines', poids: 8, valeur: (s) => s.indisciplines },
    { id: 'comportement', entete: 'Comportement /5', poids: 9, note: true, valeur: (s) => s.note.comportement.note },
    { id: 'sanctionComportement', entete: 'Sanction comportement', poids: 12, gauche: true, valeur: (s) => sanction(s.note.comportement.sanction) },
    { id: 'note15', entete: 'Note /15', poids: 6, note: true, valeur: (s) => s.note.note15 },
  ];
  if (passage) colonnes.push({ id: 'note20', entete: 'Note /20', poids: 6, note: true, valeur: (s) => s.note.note20 });
  return colonnes;
}
