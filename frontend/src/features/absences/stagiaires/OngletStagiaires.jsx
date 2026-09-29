import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AppelParGrille from './AppelParGrille';
import NotesDiscipline from './NotesDiscipline';
import RegistreStagiaires from './RegistreStagiaires';

/**
 * Les absences des stagiaires : faire l'appel, le registre, les notes de
 * discipline (F9, 2026-09-14).
 *
 * ⚠️ LE FORMATEUR N'A PAS L'ONGLET DES NOTES : la grille réserve les sanctions
 * au surveillant général, au directeur et au Conseil de discipline — il fait
 * l'appel de ses séances et voit ce qu'il y a marqué, rien de plus. Le serveur
 * le refuse de toute façon (403) ; l'onglet absent évite de le lui proposer.
 *
 * ⚠️ `TabsContent` DÉMONTE ce qu'il cache : chaque onglet recharge sa donnée à
 * l'ouverture — exactement ce qu'on veut après un appel enregistré.
 *
 * ⚠️ `?groupe=…` OUVRE UN ONGLET SUR CE GROUPE (2026-09-29, demande du
 * porteur : « si je clique envoie directement en groupe en page absence ») —
 * les listes « Groupes les plus absents/en retard » de l'accueil mènent au
 * Registre, « Groupes les plus indisciplinés » aux Notes de discipline
 * (`?onglet=notes`) ; sans lui, le Registre par défaut.
 */
export default function OngletStagiaires({ encadrement }) {
  const [parametres] = useSearchParams();
  const groupe = parametres.get('groupe');
  const ongletVoulu = parametres.get('onglet');
  const defaut = groupe ? (ongletVoulu === 'notes' ? 'notes' : 'registre') : 'appel';

  return (
    <Tabs defaultValue={defaut} className="space-y-3">
      <TabsList>
        <TabsTrigger value="appel" className="text-xs">Faire l’appel</TabsTrigger>
        <TabsTrigger value="registre" className="text-xs">Registre</TabsTrigger>
        {encadrement && <TabsTrigger value="notes" className="text-xs">Notes de discipline</TabsTrigger>}
      </TabsList>
      <TabsContent value="appel">
        <AppelParGrille encadrement={encadrement} />
      </TabsContent>
      <TabsContent value="registre">
        <RegistreStagiaires encadrement={encadrement} groupeInitial={groupe} />
      </TabsContent>
      {encadrement && (
        <TabsContent value="notes">
          <NotesDiscipline groupeInitial={groupe} />
        </TabsContent>
      )}
    </Tabs>
  );
}
