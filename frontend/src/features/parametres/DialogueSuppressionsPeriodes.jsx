import ConfirmationAction from '@/components/common/ConfirmationAction';

/**
 * La question posée quand une nouvelle période — stage, formation, vacances —
 * supprimerait des séances déjà planifiées (2026-09-23, `modules/fermetures`).
 *
 * ⚠️ DES CHIFFRES, PAS « ÊTES-VOUS SÛR ? ». Le serveur n'a rien écrit ; le
 * directeur décide sur ce qui partirait réellement — combien de séances, dont
 * combien de rattrapages et d'EFM, combien d'heures de chronogramme, et quels
 * groupes. C'est la règle déjà tenue au retrait d'un groupe de la carte.
 *
 * @param {{details: object|null, onConfirmer: () => void, onRenoncer: () => void}} props
 *   `details` : le résumé rendu par le serveur, `null` quand rien n'est demandé
 */
export default function DialogueSuppressionsPeriodes({ details, onConfirmer, onRenoncer }) {
  const d = details ?? {};
  const motifs = [
    d.parMotif?.stage > 0 && `${d.parMotif.stage} par un stage`,
    d.parMotif?.formation > 0 && `${d.parMotif.formation} par une formation`,
    d.parMotif?.vacances > 0 && `${d.parMotif.vacances} par des vacances`,
  ].filter(Boolean);
  const particulieres = [
    d.rattrapages > 0 && `${d.rattrapages} rattrapage(s) — l'absence redeviendra « à rattraper »`,
    d.efm > 0 && `${d.efm} surveillance(s) d'EFM`,
    d.absences > 0 && `${d.absences} séance(s) marquée(s) absente(s) — l'absence partira avec`,
  ].filter(Boolean);

  return (
    <ConfirmationAction
      ouvert={details !== null}
      onOpenChange={(ouvert) => !ouvert && onRenoncer()}
      titre="Cette période supprime des séances déjà planifiées"
      description={
        <span className="block space-y-2">
          <span className="block">
            Enregistrer supprimera définitivement :
          </span>
          <span className="block space-y-1 text-xs">
            {d.seances > 0 && (
              <span className="block">
                <strong>{d.seances} séance(s)</strong> de l'emploi du temps
                {motifs.length > 0 && ` (${motifs.join(', ')})`}
              </span>
            )}
            {particulieres.map((ligne) => (
              <span key={ligne} className="block pl-3">
                dont {ligne}
              </span>
            ))}
            {d.cellules > 0 && (
              <span className="block">
                <strong>{d.heures} h</strong> de chronogramme, sur {d.cellules} semaine(s) désormais
                entièrement fermée(s)
              </span>
            )}
            {d.groupes?.length > 0 && (
              <span className="block text-muted-foreground">
                Groupe(s) : {d.groupes.slice(0, 12).join(', ')}
                {d.groupes.length > 12 && ` et ${d.groupes.length - 12} autre(s)`}
              </span>
            )}
          </span>
          {d.nonPlacees > 0 && (
            <span className="block text-xs">
              Les {d.nonPlacees} cours supprimés passeront en <strong>séances non placées</strong>,
              pour être replacés.
            </span>
          )}
          <span className="block text-xs">
            « Annuler » abandonne la modification : la liste revient à ce qui est enregistré.
          </span>
        </span>
      }
      libelleConfirmation="Supprimer et enregistrer"
      destructive
      onConfirmer={onConfirmer}
    />
  );
}
