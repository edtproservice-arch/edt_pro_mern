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
 */
export default function OngletStagiaires({ encadrement }) {
  return (
    <Tabs defaultValue="appel" className="space-y-3">
      <TabsList>
        <TabsTrigger value="appel" className="text-xs">Faire l’appel</TabsTrigger>
        <TabsTrigger value="registre" className="text-xs">Registre</TabsTrigger>
        {encadrement && <TabsTrigger value="notes" className="text-xs">Notes de discipline</TabsTrigger>}
      </TabsList>
      <TabsContent value="appel">
        <AppelParGrille />
      </TabsContent>
      <TabsContent value="registre">
        <RegistreStagiaires encadrement={encadrement} />
      </TabsContent>
      {encadrement && (
        <TabsContent value="notes">
          <NotesDiscipline />
        </TabsContent>
      )}
    </Tabs>
  );
}
