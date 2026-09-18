import { Construction } from 'lucide-react';

/**
 * Écran d'attente d'un module pas encore migré.
 *
 * ═══ POURQUOI PLUTÔT QU'UN LIEN DÉSACTIVÉ ═══
 * Le menu montre l'application ENTIÈRE, pas seulement ce qui est déjà porté :
 * un directeur doit voir où il va atterrir. Un lien grisé ne dit ni ce que
 * l'écran fera ni quand il arrivera ; une page blanche laisse croire à une
 * panne. Celle-ci nomme le module et sa phase.
 */
export default function ModuleAVenir({ titre, phase }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Construction className="mx-auto h-8 w-8 text-muted-foreground" />

      <h2 className="mt-4 text-lg font-medium">{titre}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Ce module n&apos;est pas encore migré. Il arrive en <strong>phase {phase}</strong> du plan
        de migration. En attendant, il reste accessible depuis l&apos;ancienne application.
      </p>
    </div>
  );
}
