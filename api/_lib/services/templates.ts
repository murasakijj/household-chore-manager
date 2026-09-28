/**
 * 設計書 §18 の家事項目例(AI不要のフォールバック)。実際の頻度は家庭に合わせて
 * 変更する前提の参考値であり、医学的・衛生的基準ではない。
 */
export interface InitialChoreTemplate {
  name: string;
  areaName: string;
  intervalDays: number;
}

export const INITIAL_CHORE_TEMPLATES: InitialChoreTemplate[] = [
  { name: "掃除機をかける", areaName: "リビング", intervalDays: 3 },
  { name: "風呂の排水溝を掃除する", areaName: "浴室", intervalDays: 7 },
  { name: "シーツを交換する", areaName: "寝室", intervalDays: 14 },
  { name: "冷蔵庫を整理する", areaName: "キッチン", intervalDays: 30 },
  { name: "換気扇を掃除する", areaName: "キッチン", intervalDays: 90 },
  { name: "犬用品を洗う", areaName: "犬用品", intervalDays: 14 },
  {
    name: "赤ちゃん用品を棚卸しする",
    areaName: "赤ちゃん用品",
    intervalDays: 7,
  },
];

export function listInitialChoreTemplates(): InitialChoreTemplate[] {
  return INITIAL_CHORE_TEMPLATES;
}
