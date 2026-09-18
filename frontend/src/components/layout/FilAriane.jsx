import { Link } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { NAVIGATION } from './navigation';

/**
 * Fil d'Ariane de l'en-tête — « Paramètres › Affectations ».
 *
 * ═══ POURQUOI IL REMPLACE LE TITRE SEUL ═══
 * Le sous-menu des Paramètres compte dix entrées. Arrivé sur « Formations », le
 * seul titre ne dit pas si l'on est dans un réglage d'établissement ou dans un
 * écran de travail — et rien ne ramène au groupe. La barre latérale le montre,
 * mais elle se replie, et sur mobile elle est fermée par défaut.
 *
 * ⚠️ Le chemin est DÉDUIT de `navigation.js`, LA définition unique du menu : il
 * n'est écrit dans aucune page. Une entrée déplacée d'un sous-menu à l'autre
 * change donc de fil toute seule, au lieu d'en garder un faux jusqu'à ce que
 * quelqu'un le remarque.
 *
 * ⚠️ Le titre reste un `h1`, quel que soit le nombre de maillons : c'est le
 * repère de structure de la page pour les lecteurs d'écran, et il ne doit pas
 * disparaître parce qu'un parent s'ajoute devant.
 */
export default function FilAriane({ courante }) {
  const titre = courante?.titre ?? 'Accueil';

  const parent = NAVIGATION.find((entree) =>
    entree.sousMenu?.some((sous) => sous.url === courante?.url)
  );

  return (
    <Breadcrumb>
      <BreadcrumbList className="sm:gap-1.5">
        {parent && (
          <>
            <BreadcrumbItem>
              {/*
                Le parent est un LIEN, et c'est la moitié de l'intérêt du fil :
                il mène à l'accueil des Paramètres, qui liste les dix réglages
                avec leur résumé.
              */}
              <BreadcrumbLink asChild className="text-sm font-medium">
                <Link to={parent.url}>{parent.titre}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>

            <BreadcrumbSeparator />
          </>
        )}

        <BreadcrumbItem>
          <BreadcrumbPage asChild>
            <h1 className="text-sm font-medium">{titre}</h1>
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
