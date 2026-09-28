import { createCategory, listCategories, patchCategory } from "../../lib/api";
import MasterListEditor from "../../components/MasterListEditor";

export default function CategoriesSettings() {
  return (
    <MasterListEditor
      title="カテゴリの管理"
      list={listCategories}
      create={createCategory}
      patch={patchCategory}
    />
  );
}
