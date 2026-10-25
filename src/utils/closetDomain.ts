import {
  ClosetData,
  ClosetItem,
  SceneMode,
  WifeNgPair,
  RecommendationResult,
} from '../types/closet';

/**
 * ランタイムで ClosetData のスキーマ・型・参照整合性を厳密に検証する。
 * 不正な JSON の適用によるアプリクラッシュ（文鎮化）を防止する。
 */
export function validateClosetDataSchema(data: unknown): {
  valid: boolean;
  data?: ClosetData;
  error?: string;
} {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'データがオブジェクトではありません。' };
  }

  const candidate = data as Partial<ClosetData>;
  if (!Array.isArray(candidate.items)) {
    return { valid: false, error: 'JSONには "items" 配列が必要です。' };
  }

  if (candidate.items.length === 0) {
    return { valid: false, error: '"items" 配列が空です。最低1点以上の服が必要です。' };
  }

  // updatedAt が存在する場合は数値（タイムスタンプ）であることを確認
  if (candidate.updatedAt !== undefined && typeof candidate.updatedAt !== 'number') {
    return { valid: false, error: 'updatedAt は数値（タイムスタンプ）である必要があります。' };
  }

  const idSet = new Set<string>();
  const shirtIds = new Set<string>();
  const pantsIds = new Set<string>();

  // 1. 各アイテムの基本プロパティ・型検査
  for (let i = 0; i < candidate.items.length; i++) {
    const item = candidate.items[i];
    if (!item || typeof item !== 'object') {
      return { valid: false, error: `アイテム[${i}]の形式が不正です。` };
    }

    if (!item.id || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(item.id)) {
      return {
        valid: false,
        error: `アイテム[${i}]のID "${item.id}" が不正です（英数字、ハイフン、アンダースコアのみ）。`,
      };
    }

    if (idSet.has(item.id)) {
      return { valid: false, error: `アイテムID "${item.id}" が重複しています。` };
    }
    idSet.add(item.id);

    if (item.category === 'shirt') {
      shirtIds.add(item.id);
    } else if (item.category === 'pants') {
      pantsIds.add(item.id);
    } else {
      return {
        valid: false,
        error: `[${item.id}] のカテゴリ "${item.category}" が不正です（"shirt" または "pants"）。`,
      };
    }

    if (!item.name || typeof item.name !== 'string') {
      return { valid: false, error: `[${item.id}] のアイテム名 (name) が未設定です。` };
    }

    if (typeof item.imageUrl !== 'string') {
      return { valid: false, error: `[${item.id}] の imageUrl は文字列である必要があります。` };
    }

    if (typeof item.notes !== 'string') {
      return { valid: false, error: `[${item.id}] の notes は文字列である必要があります。` };
    }

    if (typeof item.dressScore !== 'number' || item.dressScore < 1 || item.dressScore > 5) {
      return {
        valid: false,
        error: `[${item.id}] の dressScore は 1.0 〜 5.0 の数値である必要があります（現在: ${item.dressScore}）。`,
      };
    }

    if (typeof item.comfortScore !== 'number' || item.comfortScore < 1 || item.comfortScore > 5) {
      return {
        valid: false,
        error: `[${item.id}] の comfortScore は 1.0 〜 5.0 の数値である必要があります（現在: ${item.comfortScore}）。`,
      };
    }

    if (typeof item.seasonSleeve !== 'string') {
      return { valid: false, error: `[${item.id}] の seasonSleeve は文字列である必要があります。` };
    }

    if (typeof item.ngReason !== 'string') {
      return { valid: false, error: `[${item.id}] の ngReason は文字列である必要があります。` };
    }

    if (!Array.isArray(item.officeRecommendIds) || !item.officeRecommendIds.every((id) => typeof id === 'string')) {
      return { valid: false, error: `[${item.id}] の officeRecommendIds は文字列配列である必要があります。` };
    }

    if (!Array.isArray(item.remoteRecommendIds) || !item.remoteRecommendIds.every((id) => typeof id === 'string')) {
      return { valid: false, error: `[${item.id}] の remoteRecommendIds は文字列配列である必要があります。` };
    }

    if (!Array.isArray(item.ngIds) || !item.ngIds.every((id) => typeof id === 'string')) {
      return { valid: false, error: `[${item.id}] の ngIds は文字列配列である必要があります。` };
    }
  }

  // 2. 参照関係の整合性検査 (相互カテゴリ整合 & 存在チェック & 推薦とNGの非重複)
  for (const item of candidate.items) {
    const isShirt = item.category === 'shirt';
    const targetCategory = isShirt ? 'pants' : 'shirt';
    const validTargetIds = isShirt ? pantsIds : shirtIds;

    const checkList = (list: string[], fieldName: string) => {
      for (const refId of list) {
        if (!idSet.has(refId)) {
          return `[${item.id}] の ${fieldName} が存在しないID "${refId}" を参照しています。`;
        }
        if (!validTargetIds.has(refId)) {
          return `[${item.id}] の ${fieldName} が ${targetCategory} 以外のID "${refId}" を参照しています。`;
        }
      }
      return null;
    };

    const errOffice = checkList(item.officeRecommendIds, 'officeRecommendIds');
    if (errOffice) return { valid: false, error: errOffice };

    const errRemote = checkList(item.remoteRecommendIds, 'remoteRecommendIds');
    if (errRemote) return { valid: false, error: errRemote };

    const errNg = checkList(item.ngIds, 'ngIds');
    if (errNg) return { valid: false, error: errNg };

    const recSet = new Set([...item.officeRecommendIds, ...item.remoteRecommendIds]);
    for (const ngId of item.ngIds) {
      if (recSet.has(ngId)) {
        return {
          valid: false,
          error: `[${item.id}] のID "${ngId}" が推薦リストと ngIds の両方に含まれており矛盾しています。`,
        };
      }
    }
  }

  return { valid: true, data: candidate as ClosetData };
}

/**
 * 奥様NGペアをマージした ClosetData を生成する
 */
export function mergeClosetDataWithWifeNg(
  closetData: ClosetData,
  wifeNgPairs: WifeNgPair[]
): ClosetData {
  if (wifeNgPairs.length === 0) return closetData;

  return {
    items: closetData.items.map((item) => {
      const relatedNgs = wifeNgPairs.filter((pair) =>
        item.category === 'shirt' ? pair.shirtId === item.id : pair.pantsId === item.id
      );
      if (relatedNgs.length === 0) return item;

      const additionalIds = relatedNgs.map((pair) =>
        item.category === 'shirt' ? pair.pantsId : pair.shirtId
      );
      const additionalSet = new Set(additionalIds);
      const mergedNgIds = Array.from(new Set([...item.ngIds, ...additionalIds]));
      const filteredOfficeRecommendIds = item.officeRecommendIds.filter(
        (id) => !additionalSet.has(id)
      );
      const filteredRemoteRecommendIds = item.remoteRecommendIds.filter(
        (id) => !additionalSet.has(id)
      );
      const hasNoNgText = item.ngReason.startsWith('なし');
      const mergedReason = hasNoNgText
        ? `奥様NG指定（${additionalIds.join(', ')}）`
        : item.ngReason.includes('奥様NG')
        ? item.ngReason
        : `${item.ngReason} / 奥様NG指定（${additionalIds.join(', ')}）`;

      return {
        ...item,
        officeRecommendIds: filteredOfficeRecommendIds,
        remoteRecommendIds: filteredRemoteRecommendIds,
        ngIds: mergedNgIds,
        ngReason: mergedReason,
      };
    }),
  };
}

/**
 * シャツとパンツのペアがNGかどうかを判定する
 */
export function checkIsNgPair(
  shirtId: string,
  pantsId: string,
  itemMap: Map<string, ClosetItem>,
  wifeNgPairs: WifeNgPair[]
): { isNg: boolean; reason: string; isWifeNg: boolean } {
  const wifeNg = wifeNgPairs.find(
    (p) => p.shirtId === shirtId && p.pantsId === pantsId
  );
  if (wifeNg) {
    return { isNg: true, reason: wifeNg.reason || '奥様NG指定', isWifeNg: true };
  }

  const shirt = itemMap.get(shirtId);
  if (shirt && shirt.ngIds.includes(pantsId)) {
    return { isNg: true, reason: shirt.ngReason || '相性NG', isWifeNg: false };
  }

  const p = itemMap.get(pantsId);
  if (p && p.ngIds.includes(shirtId)) {
    return { isNg: true, reason: p.ngReason || '相性NG', isWifeNg: false };
  }

  return { isNg: false, reason: '', isWifeNg: false };
}

/**
 * コーディネートの相性理由テキストを生成する
 */
export function getAffinityReason(
  shirt: ClosetItem,
  pantsItem: ClosetItem,
  scene: SceneMode
): string {
  if (scene === 'office') {
    if (shirt.id === 'S2' || shirt.id === 'S4' || shirt.id === 'S7') {
      return `${pantsItem.name} の質感を清潔な白シャツが最大限に引き立てる王道オフィススタイル。`;
    }
    if (pantsItem.id === 'P8') {
      return `濃紺スラックスの端正なシルエットが、${shirt.name} を上品に引き締めます。`;
    }
    if (pantsItem.id === 'P9') {
      return `ミディアムグレーの万能性が発揮され、誠実さとこなれ感を両立する組み合わせ。`;
    }
    if (pantsItem.id === 'P3') {
      return `グレージュの柔らかなトーンが寒色シャツと美しく調和し、好印象を与えます。`;
    }
    return `ドレス度 ${((shirt.dressScore + pantsItem.dressScore) / 2).toFixed(1)}。出社・対面業務に最適な清潔感ある配色です。`;
  } else {
    if (pantsItem.comfortScore >= 4.5) {
      return `快適度 ${pantsItem.comfortScore.toFixed(1)}。長時間のデスクワークやリモートでもストレスフリーです。`;
    }
    return `リラックス感と画面越しの清潔感を両立できるスマートカジュアル。`;
  }
}

/**
 * 選択されたシャツに対するおすすめパンツ、その他のパンツ、NGパンツを算出する
 */
export function calculateRecommendationsForShirt(
  shirtId: string,
  scene: SceneMode,
  itemMap: Map<string, ClosetItem>,
  pants: ClosetItem[],
  wifeNgPairs: WifeNgPair[],
  yesterdayWornPantsIds: Set<string>
): {
  recommended: RecommendationResult[];
  otherOk: RecommendationResult[];
  ngList: { pants: ClosetItem; reason: string; isWifeNg: boolean }[];
} {
  const shirt = itemMap.get(shirtId);
  if (!shirt) {
    return { recommended: [], otherOk: [], ngList: [] };
  }

  const recommended: RecommendationResult[] = [];
  const otherOk: RecommendationResult[] = [];
  const ngList: { pants: ClosetItem; reason: string; isWifeNg: boolean }[] = [];

  pants.forEach((p) => {
    const ngCheck = checkIsNgPair(shirt.id, p.id, itemMap, wifeNgPairs);
    if (ngCheck.isNg) {
      ngList.push({
        pants: p,
        reason: ngCheck.reason,
        isWifeNg: ngCheck.isWifeNg,
      });
      return;
    }

    // オフィス出社モード時は、ドレス度 3.0 未満（スウェット・ジョガー系）を出社候補から除外
    if (scene === 'office' && p.dressScore < 3.0) {
      ngList.push({
        pants: p,
        reason: `オフィス出社不適合（ドレス度 ${p.dressScore}：スウェット・ジョガー系）`,
        isWifeNg: false,
      });
      return;
    }

    const isYesterdayWorn = yesterdayWornPantsIds.has(p.id);
    const isOfficeRec = shirt.officeRecommendIds.includes(p.id);
    const isRemoteRec = shirt.remoteRecommendIds.includes(p.id);
    const isPrimaryRec = scene === 'office' ? isOfficeRec : isRemoteRec;
    const isSecondaryRec =
      scene === 'office'
        ? p.officeRecommendIds.includes(shirt.id)
        : p.remoteRecommendIds.includes(shirt.id);

    const score =
      scene === 'office'
        ? (p.dressScore * 1.5 + p.comfortScore) * (isPrimaryRec ? 1.5 : isSecondaryRec ? 1.2 : 1.0)
        : (p.comfortScore * 1.5 + p.dressScore) * (isPrimaryRec ? 1.5 : isSecondaryRec ? 1.2 : 1.0);

    const reason = getAffinityReason(shirt, p, scene);

    const result: RecommendationResult = {
      pants: p,
      rank: 0,
      isYesterdayWorn,
      score,
      affinityReason: reason,
      dressScore: p.dressScore,
      comfortScore: p.comfortScore,
      isOfficeRecommend: isOfficeRec,
      isRemoteRecommend: isRemoteRec,
    };

    if (isPrimaryRec || isSecondaryRec) {
      recommended.push(result);
    } else {
      otherOk.push(result);
    }
  });

  const sortFn = (a: RecommendationResult, b: RecommendationResult) => {
    if (a.isYesterdayWorn !== b.isYesterdayWorn) {
      return a.isYesterdayWorn ? 1 : -1;
    }
    return b.score - a.score;
  };

  recommended.sort(sortFn);
  otherOk.sort(sortFn);

  recommended.forEach((rec, idx) => {
    rec.rank = idx + 1;
  });

  return {
    recommended,
    otherOk,
    ngList,
  };
}
