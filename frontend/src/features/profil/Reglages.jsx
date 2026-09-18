import { cn } from '@/lib/utils';

/**
 * Primitives de mise en page des écrans de réglages.
 *
 * ═══ POURQUOI DES SECTIONS ET NON DES CARTES ═══
 * Une carte encadre un objet — un formateur, un groupe, un bilan. Un écran de
 * réglages n'aligne pas des objets mais des DÉCISIONS, souvent d'une ligne
 * chacune. Les enfermer une à une dans un cadre ombré fabrique une pile de
 * boîtes où rien ne ressort. Un titre, un filet, puis des lignes séparées :
 * l'œil descend la colonne au lieu de sauter de cadre en cadre.
 */

/** Titre de section, souligné d'un filet. */
export function Section({ titre, action, children, className }) {
  return (
    <section className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between border-b pb-2">
        <h2 className="text-sm font-medium">{titre}</h2>
        {action && <div>{action}</div>}
      </div>
      <div className="divide-y">{children}</div>
    </section>
  );
}

/**
 * Une ligne de réglage : ce dont il s'agit à gauche, l'action à droite.
 *
 * `action` reste à droite et ne rétrécit pas — un bouton qui se comprime sous
 * une description longue devient illisible avant elle.
 */
export function Ligne({ titre, description, valeur, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{titre}</div>

        {/*
          La VALEUR avant la description : c'est elle qu'on vient lire — le nom
          de l'établissement, l'adresse — et la description la commente.
          L'inverse plaçait « Nom abrégé : CFP MGD » au-dessus du nom officiel.
        */}
        {valeur && <p className="mt-0.5 truncate text-sm">{valeur}</p>}

        {description && (
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
