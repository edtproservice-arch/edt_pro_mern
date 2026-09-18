/**
 * Les marquages du registre, réunis par GROUPE (2026-09-14, registre en liste
 * de groupes).
 *
 * ⚠️ POUR LE FORMATEUR SEULEMENT : la liste des groupes de la base Konosys
 * (`GET /groupes`) est réservée à l'encadrement. Le registre d'un formateur ne
 * porte que ses séances — il est court, et ses groupes se déduisent de ce qu'il
 * contient.
 *
 * ⚠️ LE GROUPE DU STAGIAIRE, pas celui de la séance : c'est lui qui porte la
 * note, et une fusion (« GM101 GM102 ») n'est le groupe de personne.
 *
 * @param {Array} absences — telles que `GET /absences-stagiaires` les rend.
 * @returns {Array<{groupe, absences}>} triés par nom de groupe ; chaque liste
 *   garde l'ordre du serveur (du plus récent au plus ancien).
 */
export function grouperParGroupe(absences = []) {
  const parGroupe = new Map();
  for (const absence of absences) {
    const groupe = absence.groupe || '—';
    if (!parGroupe.has(groupe)) parGroupe.set(groupe, { groupe, absences: [] });
    parGroupe.get(groupe).absences.push(absence);
  }
  return [...parGroupe.values()].sort((a, b) => a.groupe.localeCompare(b.groupe, 'fr'));
}
