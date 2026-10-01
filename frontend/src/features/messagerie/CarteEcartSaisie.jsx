import CarteModuleEcart, { dateCourte } from '@/features/app/CarteModuleEcart';
import { nombre } from '@/lib/nombres';

/**
 * L'état d'écart de saisie e-note joint à un message (2026-10-01, demande du
 * porteur : « en message, le même style d'affichage que le panneau »). Le
 * formateur y lit, comme le directeur dans son panneau, l'écart total puis
 * chaque module en manque avec ses séances à vérifier.
 *
 * Rien à afficher pour un message qui n'en porte pas.
 */
export default function CarteEcartSaisie({ message }) {
  const etat = message.ecartSaisie;
  if (!etat) return null;

  return (
    <section className="mx-4 mb-4 shrink-0 space-y-3 rounded-lg border bg-muted/20 p-3">
      <header className="space-y-0.5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          Écart de saisie e-note — S{etat.semaine}
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-destructive">
            {nombre(etat.ecart)} h
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          Séances du {etat.debut ? dateCourte(etat.debut) : 'début d’année'} au {dateCourte(etat.fin)} ·
          E-note {nombre(etat.enote)} h · EDT {nombre(etat.edt)} h
        </p>
      </header>

      <p className="text-xs text-muted-foreground">
        E-note ne dit pas quelle séance a été saisie, seulement des heures par groupe et module :
        pour chaque module en manque, voici les séances à vérifier.
      </p>

      {(etat.lignes ?? []).map((ligne) => (
        <CarteModuleEcart key={`${ligne.groupe}||${ligne.module}`} ligne={ligne} />
      ))}
    </section>
  );
}
