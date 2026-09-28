import { createArea, listAreas, patchArea } from "../../lib/api";
import MasterListEditor from "../../components/MasterListEditor";

export default function AreasSettings() {
  return (
    <MasterListEditor
      title="場所の管理"
      list={listAreas}
      create={createArea}
      patch={patchArea}
    />
  );
}
