import { Repartition } from '../models/Repartition.js';

/**
 * Code de module → intitulé complet, lu dans la répartition DRIF.
 * ← demande du porteur (2026-09-04) : la vue Agenda n'avait que le CODE
 * (« M205 »), et c'est le nom complet qu'on vient lire.
 *
 * ⚠️ SORTI DE `consultation.service` (2026-09-17) pour servir aussi les absences
 * de formateurs : l'importer depuis là créait un cycle (consultation → séances →
 * absences → consultation).
 *
 * ⚠️ LE CHAMP LISIBLE S'APPELLE `module`, PAS `intitule` — `codeModule` porte le code.
 */
export async function intitulesModules(codes) {
  if (codes.length === 0) return {};
  const references = await Repartition.find({ codeModule: { $in: codes } })
    .select('codeModule module')
    .lean();
  return Object.fromEntries(references.map((r) => [r.codeModule, r.module]));
}
