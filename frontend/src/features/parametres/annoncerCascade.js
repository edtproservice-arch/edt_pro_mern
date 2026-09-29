import { toast } from 'sonner';

/**
 * Dit, APRÈS l'enregistrement, ce qu'une nouvelle période a supprimé
 * (2026-09-23). Le directeur l'a confirmé, mais une cascade ne passe pas en
 * silence : entre la question et le résultat, il peut s'être trompé de groupe.
 *
 * @param {object|null|undefined} cascade  `cascade` renvoyé par le serveur
 */
export function annoncerCascade(cascade) {
  if (!cascade) return;

  const parties = [
    cascade.seances > 0 && `${cascade.seances} séance(s) supprimée(s)`,
    cascade.heures > 0 && `${cascade.heures} h retirées du chronogramme`,
    cascade.nonPlacees > 0 && `${cascade.nonPlacees} à replacer (séances non placées)`,
  ].filter(Boolean);

  if (parties.length === 0) return;
  toast.warning('Planning mis à jour', { description: `${parties.join(' · ')}.` });
}
