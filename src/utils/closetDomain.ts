import {
  Category,
  ClosetData,
  ClosetItem,
  SceneMode,
  WifeNgPair,
  RecommendationResult,
  ItemCompatibilityStats,
  WardrobeAnalysisResult,
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

/**
 * 既存アイテム群から指定カテゴリの次の連番IDを算出する (最大値 + 1)
 */
export function getNextSequentialId(items: ClosetItem[], category: Category): string {
  const prefix = category === 'shirt' ? 'S' : 'P';
  const regex = new RegExp(`^${prefix}(\\d+)$`, 'i');
  let maxNum = 0;

  for (const item of items) {
    if (item.category === category) {
      const match = item.id.match(regex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  }

  return `${prefix}${maxNum + 1}`;
}

/**
 * Gemini 等から出力された単一アイテム JSON のスキーマ・型・参照整合性を厳密に検証する。
 */
export function validateSingleClosetItem(
  item: unknown,
  existingData: ClosetData
): { valid: boolean; item?: ClosetItem; error?: string } {
  if (!item || typeof item !== 'object') {
    return { valid: false, error: 'アイテムがオブジェクト形式ではありません。' };
  }

  let candidate = item as Partial<ClosetItem>;

  if (!candidate.id || typeof candidate.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(candidate.id)) {
    return {
      valid: false,
      error: `アイテムID "${candidate.id}" が不正です（英数字、ハイフン、アンダースコアのみ）。`,
    };
  }

  // 大文字に正規化 (例: s10 -> S10, p16 -> P16)
  const normalizedId = candidate.id.trim().toUpperCase();
  candidate = { ...candidate, id: normalizedId };

  if (candidate.category !== 'shirt' && candidate.category !== 'pants') {
    return {
      valid: false,
      error: `カテゴリ "${candidate.category}" が不正です（"shirt" または "pants"）。`,
    };
  }

  // 同一IDの既存アイテムが存在する場合、カテゴリの一致を必須とする（異カテゴリ上書きによるデータ破壊防止）
  const existingSameId = existingData.items.find((i) => i.id === normalizedId);
  if (existingSameId && existingSameId.category !== candidate.category) {
    return {
      valid: false,
      error: `ID "${normalizedId}" は既にカテゴリ "${existingSameId.category}" として存在するため、カテゴリ "${candidate.category}" での上書きはできません。`,
    };
  }

  // カテゴリとID接頭辞の一致チェック (shirt なら S + 正の整数、pants なら P + 正の整数)
  const expectedPrefix = candidate.category === 'shirt' ? 'S' : 'P';
  const idPattern = new RegExp(`^${expectedPrefix}[1-9]\\d*$`);
  if (!idPattern.test(normalizedId)) {
    return {
      valid: false,
      error: `カテゴリ "${candidate.category}" に対してアイテムID "${normalizedId}" の形式が一致しません（"${expectedPrefix}" + 正の整数、例: ${expectedPrefix}10 である必要があります）。`,
    };
  }

  if (!candidate.name || typeof candidate.name !== 'string' || candidate.name.trim() === '') {
    return { valid: false, error: `[${candidate.id}] のアイテム名 (name) が未設定です。` };
  }

  if (typeof candidate.imageUrl !== 'string') {
    return { valid: false, error: `[${candidate.id}] の imageUrl は文字列である必要があります。` };
  }

  if (typeof candidate.notes !== 'string') {
    return { valid: false, error: `[${candidate.id}] の notes は文字列である必要があります。` };
  }

  if (typeof candidate.seasonSleeve !== 'string') {
    return { valid: false, error: `[${candidate.id}] の seasonSleeve は文字列である必要があります。` };
  }

  if (typeof candidate.dressScore !== 'number' || candidate.dressScore < 1 || candidate.dressScore > 5) {
    return {
      valid: false,
      error: `[${candidate.id}] の dressScore は 1.0 〜 5.0 の数値である必要があります（現在: ${candidate.dressScore}）。`,
    };
  }

  if (typeof candidate.comfortScore !== 'number' || candidate.comfortScore < 1 || candidate.comfortScore > 5) {
    return {
      valid: false,
      error: `[${candidate.id}] の comfortScore は 1.0 〜 5.0 の数値である必要があります（現在: ${candidate.comfortScore}）。`,
    };
  }

  if (typeof candidate.ngReason !== 'string') {
    return { valid: false, error: `[${candidate.id}] の ngReason は文字列である必要があります。` };
  }

  if (
    !Array.isArray(candidate.officeRecommendIds) ||
    !candidate.officeRecommendIds.every((id) => typeof id === 'string')
  ) {
    return { valid: false, error: `[${candidate.id}] の officeRecommendIds は文字列配列である必要があります。` };
  }

  if (
    !Array.isArray(candidate.remoteRecommendIds) ||
    !candidate.remoteRecommendIds.every((id) => typeof id === 'string')
  ) {
    return { valid: false, error: `[${candidate.id}] の remoteRecommendIds は文字列配列である必要があります。` };
  }

  if (!Array.isArray(candidate.ngIds) || !candidate.ngIds.every((id) => typeof id === 'string')) {
    return { valid: false, error: `[${candidate.id}] の ngIds は文字列配列である必要があります。` };
  }

  // 参照先 ID の整合性検査（反対カテゴリのみを参照しているか、かつ既存データに存在するか）
  const targetCategory = candidate.category === 'shirt' ? 'pants' : 'shirt';
  const validTargetIds = new Set(
    existingData.items.filter((i) => i.category === targetCategory).map((i) => i.id)
  );

  const checkList = (list: string[], fieldName: string) => {
    for (const refId of list) {
      if (!validTargetIds.has(refId)) {
        return `[${candidate.id}] の ${fieldName} に指定されたID "${refId}" は、現存する有効な ${targetCategory} ではありません。`;
      }
    }
    return null;
  };

  const errOffice = checkList(candidate.officeRecommendIds, 'officeRecommendIds');
  if (errOffice) return { valid: false, error: errOffice };

  const errRemote = checkList(candidate.remoteRecommendIds, 'remoteRecommendIds');
  if (errRemote) return { valid: false, error: errRemote };

  const errNg = checkList(candidate.ngIds, 'ngIds');
  if (errNg) return { valid: false, error: errNg };

  // 推薦と NG の重複矛盾検査
  const recSet = new Set([...candidate.officeRecommendIds, ...candidate.remoteRecommendIds]);
  for (const ngId of candidate.ngIds) {
    if (recSet.has(ngId)) {
      return {
        valid: false,
        error: `[${candidate.id}] のID "${ngId}" が推薦リストと ngIds の両方に含まれており矛盾しています。`,
      };
    }
  }

  return { valid: true, item: candidate as ClosetItem };
}

/**
 * 既存アイテム間の相性配列を一切破壊せず、単一アイテムとその相手アイテムの双方向リンクのみを決定論的にマージする
 */
export function mergeSingleItemIntoClosetData(
  existingData: ClosetData,
  newItem: ClosetItem
): ClosetData {
  const newId = newItem.id;
  const officeRecSet = new Set(newItem.officeRecommendIds);
  const remoteRecSet = new Set(newItem.remoteRecommendIds);
  const ngSet = new Set(newItem.ngIds);

  let itemReplaced = false;

  const updatedItems = existingData.items.map((existingItem) => {
    // 1. 同一IDのアイテムが存在する場合は、新アイテムで置き換える
    if (existingItem.id === newId) {
      itemReplaced = true;
      return newItem;
    }

    // 2. 同一カテゴリの別アイテムの場合：既存ペアの相性配列は一切変更しない（不変性保証）
    if (existingItem.category === newItem.category) {
      return existingItem;
    }

    // 3. 相手カテゴリのアイテムの場合：newItem との双方向リンクのみを決定論的に反映
    const peer = existingItem;
    const peerId = peer.id;

    // 一旦 newId を除いた配列を作成（再インポート時などの重複防止）
    const baseOffice = peer.officeRecommendIds.filter((id) => id !== newId);
    const baseRemote = peer.remoteRecommendIds.filter((id) => id !== newId);
    const baseNg = peer.ngIds.filter((id) => id !== newId);

    if (ngSet.has(peerId)) {
      // newItem が peer を NG に指定している場合：peer 側の ngIds にも newId を追加
      return {
        ...peer,
        officeRecommendIds: baseOffice,
        remoteRecommendIds: baseRemote,
        ngIds: [...baseNg, newId],
      };
    }

    // NG でない場合：推薦指定があれば peer 側にも newId を追加
    const nextOffice = officeRecSet.has(peerId) ? [...baseOffice, newId] : baseOffice;
    const nextRemote = remoteRecSet.has(peerId) ? [...baseRemote, newId] : baseRemote;

    return {
      ...peer,
      officeRecommendIds: nextOffice,
      remoteRecommendIds: nextRemote,
      ngIds: baseNg,
    };
  });

  // 既存データ内に同一IDが存在しなかった場合は、新規アイテムを追加
  if (!itemReplaced) {
    updatedItems.push(newItem);
  }

  return {
    items: updatedItems,
    updatedAt: existingData.updatedAt,
  };
}

/**
 * 全シャツ・全パンツの相性を走査し、ボトルネックや孤立アイテムを動的に集計する
 */
export function analyzeWardrobeStats(
  shirts: ClosetItem[],
  pants: ClosetItem[],
  itemMap: Map<string, ClosetItem>,
  wifeNgPairs: WifeNgPair[]
): WardrobeAnalysisResult {
  const shirtStats: ItemCompatibilityStats[] = [];
  const pantsStats: ItemCompatibilityStats[] = [];
  const bottleneckShirts: ItemCompatibilityStats[] = [];
  const bottleneckPants: ItemCompatibilityStats[] = [];

  // 1. シャツごとの分析
  for (const shirt of shirts) {
    const officeRecommendIds: string[] = [];
    const remoteRecommendIds: string[] = [];
    const acceptableIds: string[] = [];
    const ngIds: string[] = [];
    const wifeNgIds: string[] = [];

    for (const p of pants) {
      const ngCheck = checkIsNgPair(shirt.id, p.id, itemMap, wifeNgPairs);
      if (ngCheck.isNg) {
        ngIds.push(p.id);
        if (ngCheck.isWifeNg) {
          wifeNgIds.push(p.id);
        }
        continue;
      }

      // 出社適合（ドレス度3.0以上）かつ推薦に含まれるか
      const isOfficeRec =
        (shirt.officeRecommendIds.includes(p.id) || p.officeRecommendIds.includes(shirt.id)) &&
        p.dressScore >= 3.0;
      const isRemoteRec =
        shirt.remoteRecommendIds.includes(p.id) || p.remoteRecommendIds.includes(shirt.id);

      if (isOfficeRec) {
        officeRecommendIds.push(p.id);
      }
      if (isRemoteRec) {
        remoteRecommendIds.push(p.id);
      }
      if (!isOfficeRec && !isRemoteRec) {
        acceptableIds.push(p.id);
      }
    }

    // 出社推奨が2本以下、またはNGが過半数のシャツをボトルネックと判定
    const isBottleneck =
      officeRecommendIds.length <= 2 || ngIds.length > pants.length / 2;
    let bottleneckReason: string | undefined;
    if (officeRecommendIds.length <= 2) {
      bottleneckReason = `出社可能な相棒が${officeRecommendIds.length}本と不足しています`;
    } else if (ngIds.length > pants.length / 2) {
      bottleneckReason = `NG判定が${ngIds.length}本（過半数）と多く着回しが制限されています`;
    }

    const stat: ItemCompatibilityStats = {
      item: shirt,
      officeRecommendIds,
      remoteRecommendIds,
      acceptableIds,
      ngIds,
      wifeNgIds,
      isBottleneck,
      bottleneckReason,
    };

    shirtStats.push(stat);
    if (isBottleneck) {
      bottleneckShirts.push(stat);
    }
  }

  // 2. パンツごとの分析
  for (const p of pants) {
    const officeRecommendIds: string[] = [];
    const remoteRecommendIds: string[] = [];
    const acceptableIds: string[] = [];
    const ngIds: string[] = [];
    const wifeNgIds: string[] = [];

    for (const shirt of shirts) {
      const ngCheck = checkIsNgPair(shirt.id, p.id, itemMap, wifeNgPairs);
      if (ngCheck.isNg) {
        ngIds.push(shirt.id);
        if (ngCheck.isWifeNg) {
          wifeNgIds.push(shirt.id);
        }
        continue;
      }

      const isOfficeRec =
        (shirt.officeRecommendIds.includes(p.id) || p.officeRecommendIds.includes(shirt.id)) &&
        p.dressScore >= 3.0;
      const isRemoteRec =
        shirt.remoteRecommendIds.includes(p.id) || p.remoteRecommendIds.includes(shirt.id);

      if (isOfficeRec) {
        officeRecommendIds.push(shirt.id);
      }
      if (isRemoteRec) {
        remoteRecommendIds.push(shirt.id);
      }
      if (!isOfficeRec && !isRemoteRec) {
        acceptableIds.push(shirt.id);
      }
    }

    // 合わせられるシャツ（NG以外）が3着以下、またはNGが過半数のパンツをボトルネックと判定
    const availableShirtCount = shirts.length - ngIds.length;
    const isBottleneck =
      availableShirtCount <= 3 || ngIds.length > shirts.length / 2;
    let bottleneckReason: string | undefined;
    if (availableShirtCount <= 3) {
      bottleneckReason = `合わせられるシャツが${availableShirtCount}着のみで孤立気味です`;
    } else if (ngIds.length > shirts.length / 2) {
      bottleneckReason = `NG指定シャツが${ngIds.length}着と多く、合わせる相手を選びます`;
    }

    const stat: ItemCompatibilityStats = {
      item: p,
      officeRecommendIds,
      remoteRecommendIds,
      acceptableIds,
      ngIds,
      wifeNgIds,
      isBottleneck,
      bottleneckReason,
    };

    pantsStats.push(stat);
    if (isBottleneck) {
      bottleneckPants.push(stat);
    }
  }

  const officeAcePants = pants.filter((p) => p.dressScore >= 3.5);

  return {
    shirtStats,
    pantsStats,
    bottleneckShirts,
    bottleneckPants,
    officeAcePants,
  };
}

/**
 * 下書きアイテムの種別 (shirt ↔ pants) を切り替える純粋関数 (条件2)
 * - category を targetCategory に更新
 * - id を targetCategory の次連番 (getNextSequentialId) に更新
 * - imageUrl を `/images/${newId}.jpg` に更新
 * - 3つの相性リスト (officeRecommendIds, remoteRecommendIds, ngIds) を [] に自動クリア
 * - ngReason を 'なし' に初期化
 */
export function switchDraftItemCategory(
  draftItem: Partial<ClosetItem>,
  targetCategory: Category,
  existingItems: ClosetItem[]
): Partial<ClosetItem> {
  const newId = getNextSequentialId(existingItems, targetCategory);
  return {
    ...draftItem,
    category: targetCategory,
    id: newId,
    imageUrl: `/images/${newId}.jpg`,
    officeRecommendIds: [],
    remoteRecommendIds: [],
    ngIds: [],
    ngReason: 'なし',
  };
}
