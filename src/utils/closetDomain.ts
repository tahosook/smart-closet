import type {
  Category,
  ClosetData,
  ClosetItem,
  SceneMode,
  WifeNgPair,
  RecommendationResult,
  ItemCompatibilityStats,
  WardrobeAnalysisResult,
  GarmentColor,
  GarmentMeasurements,
  GarmentCropBox,
  BatchColorUpdatesPayload,
  ColorUpdateItem,
  BatchGarmentDraftItem,
  BatchGarmentsPayload,
  BatchGarmentItemResult,
  BatchGarmentsMergeResult,
} from '../types/closet';

/**
 * 標準色パレット（全12色、青の濃淡3段：濃紺（ネイビー含む）／ブルー／淡青）
 * 奥さんのNG判定3類型（濃紺×濃紺、淡青×ブルー/淡青、生成り×淡色）を再現する語彙
 */
export const GARMENT_COLOR_PALETTE = [
  '白',
  '生成り',
  '黒',
  'チャコール',
  'ミディアムグレー',
  'ライトグレー',
  'グレージュ',
  '濃紺',
  'ブルー',
  '淡青',
  'オリーブ',
  'ブラウン',
] as const;

/**
 * 登録相談プロンプトおよび一括色相談プロンプト共通の色判定アンカー
 * A4用紙を基準とした隣接色の境界基準を定義
 */
export const GARMENT_COLOR_ANCHOR_GUIDE = `【12色パレットの判定アンカーと基準】
選択肢（全12色）: 白, 生成り, 黒, チャコール, ミディアムグレー, ライトグレー, グレージュ, 濃紺, ブルー, 淡青, オリーブ, ブラウン
※「ネイビー」「インディゴ」「サックス」等は単独の色名として出力せず、必ず上記12色のいずれかに分類してください。

1. 白と生成りの境界:
   - A4用紙と同じ系統の白さ（純白・オフホワイト地、白ベースの細ストライプや小紋柄を含む）なら「白」。
   - A4用紙と比べて明確に黄み・クリーム色・エクリュの温かみを感じれば「生成り」。
2. 淡青・ブルー・濃紺の境界（青の濃淡3段）:
   - 白に近い明るい青（サックスブルー・水色・ライトブルー等）は「淡青」。
   - 一般的な色落ちデニム程度の標準的〜中間の青は「ブルー」。
   - 標準的なネイビーから黒に近い深い紺・濃インディゴ（ワンウォッシュ／リジッドデニム、紺ストライプ等）はすべて「濃紺」。※ネイビーは濃紺に統合。
3. 濃紺と黒の境界:
   - 暗い色調でもわずかにでも青み（ネイビー／インディゴ感）が読み取れれば「濃紺」。
   - 青みが一切読み取れない純粋な暗さ（ブラック）は「黒」。
4. グレー各色（チャコール／ミディアムグレー／ライトグレー／グレージュ）の境界:
   - A4白用紙と黒の間の明度を基準に、黒に近い濃灰は「チャコール」、標準的な中間調の灰は「ミディアムグレー」、白に近い明るい薄灰（杢グレー・アイスグレー等）は「ライトグレー」。
   - グレーに明確なベージュみ・茶み・黄みが混じる中間色（トープ等）は「グレージュ」。`;

/**
 * まとめ撮り一括登録の最大着数（推奨2〜3着、ハード上限3着）
 */
export const MAX_BATCH_GARMENTS = 3;

/**
 * 12色パレット外の色名が指定された場合に、情報欠損を防ぐため notes の末尾に目安を決定論的に追記する純粋関数
 * 既に同一の追記が含まれる場合は二重追記しない。
 */
export function appendUnconfirmedColorNote(notes: string, unconfirmedColor: string): string {
  const trimmedColor = (unconfirmedColor || '').trim();
  if (!trimmedColor) return notes;
  const noteSnippet = `（色の目安：${trimmedColor} ※12色パレット外のため未確定）`;
  if (notes.includes(noteSnippet)) {
    return notes;
  }
  const trimmedNotes = notes.trim();
  if (!trimmedNotes) {
    return noteSnippet;
  }
  return `${trimmedNotes} ${noteSnippet}`;
}

/**
 * 指定された値が12色パレットに含まれる有効な色であるかを判定する
 */
export function isValidGarmentColor(val: unknown): val is GarmentColor {
  return typeof val === 'string' && (GARMENT_COLOR_PALETTE as readonly string[]).includes(val);
}

/**
 * アイテム名やメモから表示用の色を推定する純粋関数（表示・SVGフォールバック専用）
 * 重要: この関数が返す値は「表示専用の暫定値」であり、ClosetItem.color として
 * localStorage や Google スプレッドシートへ永続化・同期してはならない。
 */
export function inferGarmentColor(
  name: string,
  notes?: string,
  category?: Category
): GarmentColor {
  const text = `${name || ''} ${notes || ''}`.toLowerCase();

  // 1. 生成り
  if (
    text.includes('生成り') ||
    text.includes('エクリュ') ||
    text.includes('キナリ') ||
    text.includes('アイボリー') ||
    text.includes('クリーム')
  ) {
    return '生成り';
  }

  // 2. 白
  if (text.includes('白') || text.includes('ホワイト') || text.includes('white')) {
    return '白';
  }

  // 3. 黒
  if (text.includes('黒') || text.includes('ブラック') || text.includes('black')) {
    return '黒';
  }

  // 4. チャコール / グレー系
  if (text.includes('チャコール') || text.includes('charcoal')) {
    return 'チャコール';
  }
  if (
    text.includes('グレージュ') ||
    text.includes('トープ') ||
    text.includes('greige') ||
    text.includes('taupe')
  ) {
    return 'グレージュ';
  }
  if (
    text.includes('ライトグレー') ||
    text.includes('薄灰') ||
    text.includes('アイスグレー') ||
    text.includes('杢グレー')
  ) {
    return 'ライトグレー';
  }
  if (
    text.includes('ミディアムグレー') ||
    text.includes('グレー') ||
    text.includes('灰') ||
    text.includes('gray') ||
    text.includes('grey')
  ) {
    return 'ミディアムグレー';
  }

  // 5. 青系（青の濃淡3段：濃紺 / ブルー / 淡青）
  // 濃紺（ネイビー、濃インディゴ、ヒッコリー、ピンストライプ含む）
  if (
    text.includes('濃紺') ||
    text.includes('濃インディゴ') ||
    text.includes('ネイビー') ||
    text.includes('navy') ||
    text.includes('ダークネイビー') ||
    text.includes('ワンウォッシュ') ||
    text.includes('リジッド') ||
    text.includes('ヒッコリー') ||
    text.includes('ピンストライプ')
  ) {
    return '濃紺';
  }

  // 淡青（サックスブルー、水色、ライトブルー）
  if (
    text.includes('サックス') ||
    text.includes('淡青') ||
    text.includes('水色') ||
    text.includes('ライトブルー')
  ) {
    return '淡青';
  }

  // ブルー（標準的な青、デニム、インディゴ柄）
  if (
    text.includes('ブルー') ||
    text.includes('インディゴ') ||
    text.includes('青') ||
    text.includes('デニム') ||
    text.includes('blue')
  ) {
    return 'ブルー';
  }

  // 6. アースカラー
  if (
    text.includes('オリーブ') ||
    text.includes('カーキ') ||
    text.includes('グリーン') ||
    text.includes('緑') ||
    text.includes('olive')
  ) {
    return 'オリーブ';
  }
  if (
    text.includes('ブラウン') ||
    text.includes('モカ') ||
    text.includes('キャメル') ||
    text.includes('茶') ||
    text.includes('ベージュ') ||
    text.includes('brown')
  ) {
    return 'ブラウン';
  }

  // デフォルト（シャツは白、パンツは濃紺、その他はミディアムグレー）
  if (category === 'shirt') return '白';
  if (category === 'pants') return '濃紺';
  return 'ミディアムグレー';
}

/**
 * 服の寸法オブジェクトを検証・正規化する純粋関数
 * 10cm〜200cmの範囲の有限数値を0.5cm刻みに丸めて格納する。
 * 有効な数値が1つも含まれない場合は undefined を返す。
 */
export function validateGarmentMeasurements(
  val: unknown,
  category?: Category
): GarmentMeasurements | undefined {
  if (!val || typeof val !== 'object') return undefined;
  const candidate = val as Record<string, unknown>;
  const result: GarmentMeasurements = {};

  const sanitizeNumber = (num: unknown): number | undefined => {
    if (typeof num === 'number' && Number.isFinite(num) && num >= 10 && num <= 200) {
      return Math.round(num * 2) / 2;
    }
    return undefined;
  };

  if (!category || category === 'shirt') {
    const bodyLength = sanitizeNumber(candidate.bodyLength);
    const chestWidth = sanitizeNumber(candidate.chestWidth);
    const shoulderWidth = sanitizeNumber(candidate.shoulderWidth);
    const sleeveLength = sanitizeNumber(candidate.sleeveLength);
    if (bodyLength !== undefined) result.bodyLength = bodyLength;
    if (chestWidth !== undefined) result.chestWidth = chestWidth;
    if (shoulderWidth !== undefined) result.shoulderWidth = shoulderWidth;
    if (sleeveLength !== undefined) result.sleeveLength = sleeveLength;
  }

  if (!category || category === 'pants') {
    const waist = sanitizeNumber(candidate.waist);
    const inseam = sanitizeNumber(candidate.inseam);
    const totalLength = sanitizeNumber(candidate.totalLength);
    const hemWidth = sanitizeNumber(candidate.hemWidth);
    if (waist !== undefined) result.waist = waist;
    if (inseam !== undefined) result.inseam = inseam;
    if (totalLength !== undefined) result.totalLength = totalLength;
    if (hemWidth !== undefined) result.hemWidth = hemWidth;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * 服領域の正規化座標 (0〜1000) を検証・クランプする純粋関数
 * 不正値や極小領域の場合は undefined を返す。
 */
export function normalizeCropBox(val: unknown): GarmentCropBox | undefined {
  if (!val || typeof val !== 'object') return undefined;
  const box = val as Partial<GarmentCropBox>;
  const { ymin, xmin, ymax, xmax } = box;

  if (
    typeof ymin !== 'number' ||
    typeof xmin !== 'number' ||
    typeof ymax !== 'number' ||
    typeof xmax !== 'number' ||
    !Number.isFinite(ymin) ||
    !Number.isFinite(xmin) ||
    !Number.isFinite(ymax) ||
    !Number.isFinite(xmax)
  ) {
    return undefined;
  }

  const clampedYmin = Math.max(0, Math.min(1000, Math.round(ymin)));
  const clampedXmin = Math.max(0, Math.min(1000, Math.round(xmin)));
  const clampedYmax = Math.max(0, Math.min(1000, Math.round(ymax)));
  const clampedXmax = Math.max(0, Math.min(1000, Math.round(xmax)));

  const width = clampedXmax - clampedXmin;
  const height = clampedYmax - clampedYmin;

  // 面積が極小（幅・高さが50未満、または面積が全体の2.5%未満）なら無効
  if (width < 50 || height < 50 || width * height < 25000) {
    return undefined;
  }

  return {
    ymin: clampedYmin,
    xmin: clampedXmin,
    ymax: clampedYmax,
    xmax: clampedXmax,
  };
}

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
  const sanitizedItems: ClosetItem[] = [];

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

    if (item.archived !== undefined && typeof item.archived !== 'boolean') {
      return { valid: false, error: `[${item.id}] の archived は真偽値である必要があります。` };
    }

    // color の正規化・検証（未設定やパレット外値でも読み込みを失敗させず、undefined として安全に保持）
    // 注意: 表示用の inferGarmentColor はここでは呼ばず、データ上は未確定 (undefined) のまま維持する
    const rawColor = item.color as unknown;
    let itemColor: GarmentColor | undefined = undefined;
    if (typeof rawColor === 'string' && rawColor.trim() !== '') {
      if (isValidGarmentColor(rawColor)) {
        itemColor = rawColor;
      }
      // 不正値（'ネイビー' や古い独自文字列等）の場合は undefined にサニタイズ（全体の読み込みは失敗させない）
    }

    // measurements の正規化（不正なフィールドは除去し、有効な測定値のみ保持）
    const itemMeasurements = item.measurements
      ? validateGarmentMeasurements(item.measurements, item.category as Category)
      : undefined;

    // 一時プロパティ (cropBox, garmentBox 等) を除外したクリーンな ClosetItem を作成
    sanitizedItems.push({
      id: item.id,
      category: item.category,
      name: item.name,
      imageUrl: item.imageUrl,
      seasonSleeve: item.seasonSleeve,
      dressScore: item.dressScore,
      comfortScore: item.comfortScore,
      officeRecommendIds: item.officeRecommendIds,
      remoteRecommendIds: item.remoteRecommendIds,
      ngIds: item.ngIds,
      ngReason: item.ngReason,
      notes: item.notes,
      color: itemColor,
      ...(itemMeasurements ? { measurements: itemMeasurements } : {}),
      ...(item.archived === true ? { archived: true } : {}),
    });
  }

  // 2. 参照関係の整合性検査 (相互カテゴリ整合 & 存在チェック & 推薦とNGの非重複)
  for (const item of sanitizedItems) {
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

  return {
    valid: true,
    data: {
      ...candidate,
      items: sanitizedItems,
    } as ClosetData,
  };
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
  if (!shirt || shirt.archived) {
    return { recommended: [], otherOk: [], ngList: [] };
  }

  const recommended: RecommendationResult[] = [];
  const otherOk: RecommendationResult[] = [];
  const ngList: { pants: ClosetItem; reason: string; isWifeNg: boolean }[] = [];

  pants.forEach((p) => {
    if (p.archived) return;
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
 * Gemini 等から出力された単一アイテム JSON のスキーマ・型・参照整合性を検証する。
 * 色（color）がパレット外または未指定の場合は警告（color=undefined）として登録を通し、
 * パレット外色名は notes 末尾に目安を決定論的に追記する（色以外の検証は従来どおり厳密にエラーとする）。
 */
export function validateSingleClosetItem(
  item: unknown,
  existingData: ClosetData
): {
  valid: boolean;
  item?: ClosetItem;
  error?: string;
  warning?: string;
  unconfirmedColorHint?: string;
} {
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

  // imageUrl を確定した ID（大文字正規化後の ID）に基づく標準パス (/images/${normalizedId}.jpg) へ正規化
  candidate = { ...candidate, imageUrl: `/images/${normalizedId}.jpg` };

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

  if (candidate.archived !== undefined && typeof candidate.archived !== 'boolean') {
    return { valid: false, error: `[${candidate.id}] の archived は真偽値である必要があります。` };
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

  // 寸法（measurements）の範囲チェック（指定された対象カテゴリ寸法は 10〜200cm の有限数値であること）
  if (candidate.measurements && typeof candidate.measurements === 'object') {
    const m = candidate.measurements as Record<string, unknown>;
    const targetKeys = candidate.category === 'shirt'
      ? ['bodyLength', 'chestWidth', 'shoulderWidth', 'sleeveLength']
      : ['waist', 'inseam', 'totalLength', 'hemWidth'];
    for (const k of targetKeys) {
      const val = m[k];
      if (val !== undefined && val !== null) {
        if (typeof val !== 'number' || !Number.isFinite(val) || val < 10 || val > 200) {
          return {
            valid: false,
            error: `[${candidate.id}] の寸法 "${k}" (${val}) は 10〜200cm の範囲である必要があります。`,
          };
        }
      }
    }
  }

  // measurements の検証・正規化 (0.5cm刻み)
  const validatedMeasurements = candidate.measurements
    ? validateGarmentMeasurements(candidate.measurements, candidate.category)
    : undefined;

  // 色の検証（非ブロッキング化: パレット外・欠落でも登録を止めず警告扱い、notes に目安追記）
  const rawColor = candidate.color as unknown;
  let finalColor: GarmentColor | undefined = undefined;
  let warning: string | undefined = undefined;
  let unconfirmedColorHint: string | undefined = undefined;
  let updatedNotes = candidate.notes;

  if (typeof rawColor === 'string' && rawColor.trim() !== '') {
    const trimmedColor = rawColor.trim();
    if (isValidGarmentColor(trimmedColor)) {
      finalColor = trimmedColor;
    } else {
      finalColor = undefined;
      unconfirmedColorHint = trimmedColor;
      updatedNotes = appendUnconfirmedColorNote(updatedNotes, trimmedColor);
      warning = `色「${trimmedColor}」は12色パレット外のため未確定として登録します（メモに目安を記録済み）。`;
    }
  } else {
    finalColor = undefined;
    warning = '色が未設定のため「未確定」として扱います（後から色の一括相談で確定可能）。';
  }

  // 一時プロパティ (cropBox, garmentBox 等) を除外したクリーンな ClosetItem を返却
  const candidateItem = candidate as ClosetItem;
  const finalItem: ClosetItem = {
    id: candidateItem.id,
    category: candidateItem.category,
    name: candidateItem.name,
    imageUrl: candidateItem.imageUrl,
    seasonSleeve: candidateItem.seasonSleeve,
    dressScore: candidateItem.dressScore,
    comfortScore: candidateItem.comfortScore,
    officeRecommendIds: candidateItem.officeRecommendIds,
    remoteRecommendIds: candidateItem.remoteRecommendIds,
    ngIds: candidateItem.ngIds,
    ngReason: candidateItem.ngReason,
    notes: updatedNotes,
    ...(finalColor !== undefined ? { color: finalColor } : {}),
    ...(validatedMeasurements ? { measurements: validatedMeasurements } : {}),
    ...(candidateItem.archived === true ? { archived: true } : {}),
  };

  return {
    valid: true,
    item: finalItem,
    ...(warning ? { warning } : {}),
    ...(unconfirmedColorHint ? { unconfirmedColorHint } : {}),
  };
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
 * - measurements を undefined に自動クリア
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
    measurements: undefined,
  };
}

/**
 * 指定アイテムがアクティブ（片付けていない）かどうかを判定する純粋関数
 */
export function isGarmentActive(item: ClosetItem): boolean {
  return !item.archived;
}

/**
 * 指定されたアイテムの「片付ける（archived: true）」「出す（archived: undefined）」を切り替える純粋関数
 * 対象アイテム以外のプロパティや相性配列、他アイテムのデータは1ビットも変更せず不変性を保証する。
 */
export function setGarmentArchived(
  data: ClosetData,
  itemId: string,
  archived: boolean,
  updatedAt?: number
): ClosetData {
  const normId = itemId.trim().toUpperCase();
  let itemFound = false;

  const updatedItems = data.items.map((item) => {
    if (item.id.trim().toUpperCase() !== normId) {
      return item;
    }
    itemFound = true;
    if (archived) {
      return { ...item, archived: true };
    } else {
      const { archived: _archived, ...rest } = item;
      return rest;
    }
  });

  if (!itemFound) {
    return data;
  }

  return {
    ...data,
    items: updatedItems,
    updatedAt: updatedAt !== undefined ? updatedAt : Date.now(),
  };
}

/**
 * 既存アイテム間の相性配列やスコア、名称（name）を一切破壊せず、全着の color のみを安全に一括更新する純粋関数
 */
export function applyBatchColorUpdates(
  existingData: ClosetData,
  payload: BatchColorUpdatesPayload | ColorUpdateItem[] | unknown
): {
  valid: boolean;
  data?: ClosetData;
  error?: string;
  updatedCount?: number;
} {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: '一括色更新ペイロードがオブジェクトまたは配列ではありません。' };
  }

  // { colorUpdates: [...] } または 素配列 [...] の両方を受理
  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any).colorUpdates)
    ? (payload as any).colorUpdates
    : null;

  if (!rawList) {
    return { valid: false, error: 'ペイロードに "colorUpdates" 配列または更新アイテム配列が含まれていません。' };
  }
  if (rawList.length === 0) {
    return { valid: false, error: '一括色更新の配列が空です。' };
  }

  const existingMap = new Map(existingData.items.map((it) => [it.id, it]));
  const seenIds = new Set<string>();

  for (let i = 0; i < rawList.length; i++) {
    const update = rawList[i];
    if (!update || typeof update !== 'object') {
      return { valid: false, error: `colorUpdates[${i}] の形式が不正です。` };
    }
    const id = typeof update.id === 'string' ? update.id.trim().toUpperCase() : '';
    if (!id) {
      return { valid: false, error: `colorUpdates[${i}] の ID が未指定です。` };
    }
    if (!existingMap.has(id)) {
      return { valid: false, error: `ID "${id}" は現在のワードローブに存在しません。` };
    }
    if (seenIds.has(id)) {
      return { valid: false, error: `ID "${id}" の色更新が重複して指定されています。` };
    }
    seenIds.add(id);

    const rawColor = update.color as unknown;
    if (rawColor === 'ネイビー') {
      return {
        valid: false,
        error: `ID "${id}" の色「ネイビー」はパレット上「濃紺」に統合されています。「濃紺」を指定してください。`,
      };
    }
    if (!isValidGarmentColor(rawColor)) {
      return {
        valid: false,
        error: `ID "${id}" の色 "${String(rawColor)}" は無効です。12色パレット（${GARMENT_COLOR_PALETTE.join(', ')}）から指定してください。`,
      };
    }
  }

  const updateMap = new Map<string, ColorUpdateItem>(
    rawList.map((u: any) => [u.id.trim().toUpperCase(), u as ColorUpdateItem])
  );
  let updatedCount = 0;

  const newItems = existingData.items.map((item) => {
    const update = updateMap.get(item.id);
    if (!update) return item;
    updatedCount++;
    return {
      ...item,
      color: update.color,
    };
  });

  return {
    valid: true,
    data: {
      ...existingData,
      items: newItems,
      updatedAt: Date.now(),
    },
    updatedCount,
  };
}

/**
 * バッチ内の仮IDや未確定IDなど、現有ワードローブに存在しない相手IDを相性配列から安全に除外する純粋関数（案B確定）
 */
export function sanitizeDraftPeerReferences(
  draft: Partial<ClosetItem>,
  existingData: ClosetData
): Partial<ClosetItem> {
  if (!draft || typeof draft !== 'object') return draft;
  const targetCategory = draft.category === 'shirt' ? 'pants' : 'shirt';
  const validTargetIds = new Set(
    existingData.items.filter((i) => i.category === targetCategory).map((i) => i.id)
  );

  const filterList = (list: unknown): string[] => {
    if (!Array.isArray(list)) return [];
    return list.filter((id): id is string => typeof id === 'string' && validTargetIds.has(id));
  };

  return {
    ...draft,
    officeRecommendIds: filterList(draft.officeRecommendIds),
    remoteRecommendIds: filterList(draft.remoteRecommendIds),
    ngIds: filterList(draft.ngIds),
  };
}

/**
 * 確認パネル表示・プレビュー用に、対象着に対してカテゴリ別の次連番IDとimageUrlを決定論的に割り当てる純粋関数
 * includedFlags[i] === false のアイテムは除外（ID繰り上げの消費を行わない）
 */
export function assignSequentialIdsForBatch(
  existingItems: ClosetItem[],
  drafts: BatchGarmentDraftItem[],
  includedFlags?: boolean[]
): BatchGarmentDraftItem[] {
  let currentShirts = existingItems.filter((i) => i.category === 'shirt');
  let currentPants = existingItems.filter((i) => i.category === 'pants');

  return drafts.map((draft, idx) => {
    const isIncluded = includedFlags ? includedFlags[idx] !== false : true;
    if (!isIncluded) {
      return { ...draft };
    }
    if (draft.category === 'shirt') {
      const nextId = getNextSequentialId(currentShirts, 'shirt');
      currentShirts = [...currentShirts, { id: nextId, category: 'shirt' } as ClosetItem];
      return {
        ...draft,
        id: nextId,
        category: 'shirt',
        imageUrl: `/images/${nextId}.jpg`,
      };
    } else if (draft.category === 'pants') {
      const nextId = getNextSequentialId(currentPants, 'pants');
      currentPants = [...currentPants, { id: nextId, category: 'pants' } as ClosetItem];
      return {
        ...draft,
        id: nextId,
        category: 'pants',
        imageUrl: `/images/${nextId}.jpg`,
      };
    }
    return { ...draft };
  });
}

/**
 * まとめ撮り（1〜3着）の服配列を検証し、既存データへ決定論的連番IDで順次マージする純粋関数
 * - 色パレット外・欠落は警告通過とし、パレット外色名は notes 末尾に目安を追記する
 * - 色以外のエラーは拒否し、部分適用時は成功着のみマージして失敗着は remainingDrafts に格納する
 */
export function validateAndMergeBatchGarments(
  existingData: ClosetData,
  payload: BatchGarmentsPayload | BatchGarmentDraftItem[] | unknown,
  includedFlags?: boolean[]
): BatchGarmentsMergeResult {
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      results: [],
      appliedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      remainingDrafts: [],
      error: 'まとめ撮り一括登録のペイロードが不正です。',
    };
  }

  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any).garments)
    ? (payload as any).garments
    : null;

  if (!rawList) {
    return {
      valid: false,
      results: [],
      appliedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      remainingDrafts: [],
      error: 'ペイロードに "garments" 配列または服アイテム配列が含まれていません。',
    };
  }

  if (rawList.length === 0) {
    return {
      valid: false,
      results: [],
      appliedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      remainingDrafts: [],
      error: '登録するアイテムがありません。1〜3着のアイテムを指定してください。',
    };
  }

  if (rawList.length > MAX_BATCH_GARMENTS) {
    return {
      valid: false,
      results: [],
      appliedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      remainingDrafts: rawList as BatchGarmentDraftItem[],
      error: `一度に登録できるのは最大${MAX_BATCH_GARMENTS}着までです（現在: ${rawList.length}着）。`,
    };
  }

  let workingData: ClosetData = {
    items: [...existingData.items],
    updatedAt: existingData.updatedAt,
  };

  const results: BatchGarmentItemResult[] = [];
  const remainingDrafts: BatchGarmentDraftItem[] = [];
  let appliedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < rawList.length; i++) {
    const draft = rawList[i] as BatchGarmentDraftItem;
    const isIncluded = includedFlags ? includedFlags[i] !== false : true;

    if (!isIncluded) {
      skippedCount++;
      results.push({
        index: i,
        status: 'skipped',
        name: draft?.name,
        category: draft?.category,
        cropBox: draft?.cropBox,
      });
      continue;
    }

    if (!draft || typeof draft !== 'object') {
      failedCount++;
      remainingDrafts.push(draft);
      results.push({
        index: i,
        status: 'failed',
        error: `アイテム[${i}] の形式が不正です。`,
      });
      continue;
    }

    // 既存アイテムIDとの重複防止チェック（修正4）
    if (typeof (draft as any).id === 'string' && (draft as any).id.trim() !== '') {
      const explicitId = String((draft as any).id).trim().toUpperCase();
      if (existingData.items.some((it) => it.id.trim().toUpperCase() === explicitId)) {
        failedCount++;
        remainingDrafts.push(draft);
        results.push({
          index: i,
          status: 'failed',
          name: draft.name,
          category: draft.category,
          cropBox: draft.cropBox,
          error: `既存アイテム（ID: ${explicitId}）と重複しています。まとめ撮り一括登録は新規服の追加専用です。`,
        });
        continue;
      }
    }

    if (draft.category !== 'shirt' && draft.category !== 'pants') {
      failedCount++;
      remainingDrafts.push(draft);
      results.push({
        index: i,
        status: 'failed',
        name: draft.name,
        category: draft.category,
        cropBox: draft.cropBox,
        error: `カテゴリ "${draft.category}" が不正です（"shirt" または "pants"）。`,
      });
      continue;
    }

    // 決定論的連番IDの採番（前の着が失敗しても歯抜けにならないよう現在の workingData.items から採番）
    const assignedId = getNextSequentialId(workingData.items, draft.category);
    const candidate: BatchGarmentDraftItem = {
      ...draft,
      id: assignedId,
      imageUrl: `/images/${assignedId}.jpg`,
    };

    // 案B確定: バッチ開始時点の確定済み既存データ (existingData) を基準に未確定IDを安全にストリップ
    const sanitized = sanitizeDraftPeerReferences(candidate, existingData);

    // 単一アイテムバリデータで検証（色の未確定は警告通過、色以外のエラーは拒否）
    const validation = validateSingleClosetItem(sanitized, workingData);

    if (validation.valid && validation.item) {
      workingData = mergeSingleItemIntoClosetData(workingData, validation.item);
      appliedCount++;

      // 双方向リンクで更新された相手着数を算出
      const targetCat = validation.item.category === 'shirt' ? 'pants' : 'shirt';
      const updatedPeersCount = workingData.items.filter(
        (it) =>
          it.category === targetCat &&
          (it.officeRecommendIds.includes(validation.item!.id) ||
            it.remoteRecommendIds.includes(validation.item!.id) ||
            it.ngIds.includes(validation.item!.id))
      ).length;

      results.push({
        index: i,
        status: 'applied',
        assignedId,
        name: validation.item.name,
        category: validation.item.category,
        item: validation.item,
        cropBox: draft.cropBox,
        updatedPeersCount,
        warning: validation.warning,
        unconfirmedColorHint: validation.unconfirmedColorHint,
      });
    } else {
      failedCount++;
      remainingDrafts.push(draft);
      results.push({
        index: i,
        status: 'failed',
        name: draft.name,
        category: draft.category,
        cropBox: draft.cropBox,
        error: validation.error || 'バリデーションエラー',
      });
    }
  }

  const valid = appliedCount > 0;
  let overallError: string | undefined = undefined;
  if (appliedCount === 0) {
    if (skippedCount === rawList.length) {
      overallError = '登録対象として選択されたアイテムがありません。';
    } else {
      overallError = 'すべてのアイテムの検証に失敗しました。';
    }
  }

  return {
    valid,
    data: valid ? { ...workingData, updatedAt: Date.now() } : undefined,
    results,
    appliedCount,
    failedCount,
    skippedCount,
    remainingDrafts,
    ...(overallError ? { error: overallError } : {}),
  };
}

export interface ParsedSyncInput {
  kind: 'single' | 'batch_color' | 'batch_garments' | 'invalid';
  item?: Partial<ClosetItem>;
  cropBox?: GarmentCropBox | null;
  batchColorUpdates?: ColorUpdateItem[];
  batchGarments?: BatchGarmentDraftItem[];
  error?: string;
  existingIdConflict?: string;
}

/**
 * 貼り付けられた JSON テキストから単一アイテム、一括色更新、またはまとめ撮り一括服オブジェクトを安全に解析するヘルパー
 * - まとめ撮り配列（Array.isArray）判定では要素に id が無いことを必須とする（既存アイテム配列の誤登録を防止）
 * - 要素に既存アイテムと重複する id が含まれる場合は警告して登録に進ませない
 */
export function parseSyncInputJson(
  rawText: string,
  existingItems?: ClosetItem[]
): ParsedSyncInput {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { kind: 'invalid', error: 'JSONテキストを貼り付けてください。' };
  }

  let clean = trimmed;
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(clean);

    // 1. 一括色更新形式: { "colorUpdates": [...] } または 配列
    if (parsed && typeof parsed === 'object') {
      const candidates = Array.isArray((parsed as any).colorUpdates)
        ? (parsed as any).colorUpdates
        : Array.isArray(parsed) &&
          parsed.length > 0 &&
          typeof (parsed[0] as any)?.id === 'string' &&
          (parsed[0] as any)?.color !== undefined &&
          (parsed[0] as any)?.category === undefined
        ? parsed
        : null;

      if (candidates) {
        const batchList: ColorUpdateItem[] = [];
        for (const c of candidates) {
          if (c && typeof c.id === 'string' && typeof c.color === 'string') {
            batchList.push({ id: c.id.trim().toUpperCase(), color: c.color.trim() as any });
          }
        }
        if (batchList.length > 0) {
          return { kind: 'batch_color', batchColorUpdates: batchList };
        }
      }
    }

    // 2. まとめ撮り服形式: { "garments": [...] } または 服ドラフト配列
    if (parsed && typeof parsed === 'object') {
      const hasGarmentsProp = Array.isArray((parsed as any).garments);
      const isRawArray = Array.isArray(parsed);

      let batchCandidates: any[] | null = null;

      if (hasGarmentsProp) {
        // 正系フロー: { "garments": [...] }
        batchCandidates = (parsed as any).garments;
      } else if (isRawArray && parsed.length > 0) {
        // 修正4: 服ドラフト配列ショートカットの場合、「要素に id が無いこと」を必須とする
        const hasAnyId = parsed.some(
          (item: any) => item && typeof item.id === 'string' && item.id.trim() !== ''
        );
        if (hasAnyId) {
          return {
            kind: 'invalid',
            error:
              'ID付きの服配列はまとめ撮り一括登録できません。まとめ撮りは新規服の追加用です。IDを含めない形式（{ "garments": [...] }）で入力してください。',
          };
        }

        const isDraftArray =
          (parsed[0] as any)?.category === 'shirt' ||
          (parsed[0] as any)?.category === 'pants' ||
          (parsed[0] as any)?.name !== undefined;

        if (isDraftArray) {
          batchCandidates = parsed;
        }
      }

      if (batchCandidates && batchCandidates.length > 0) {
        // 修正4: 要素の id が既存ワードローブに存在する場合は警告して登録に進ませない
        if (existingItems && existingItems.length > 0) {
          const existingIdSet = new Set(existingItems.map((it) => it.id.trim().toUpperCase()));
          for (const item of batchCandidates) {
            if (item && typeof item.id === 'string' && item.id.trim() !== '') {
              const upperId = item.id.trim().toUpperCase();
              if (existingIdSet.has(upperId)) {
                return {
                  kind: 'invalid',
                  error: `既存アイテム（ID: ${upperId}）が含まれています。まとめ撮り一括登録は新規服の追加用です。既存アイテムの再登録・上書きはできません。`,
                  existingIdConflict: upperId,
                };
              }
            }
          }
        }

        return {
          kind: 'batch_garments',
          batchGarments: batchCandidates as BatchGarmentDraftItem[],
        };
      }
    }

    // 3. 単一アイテム形式
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof parsed.id === 'string' &&
      (parsed.category === 'shirt' || parsed.category === 'pants')
    ) {
      const cropBox = normalizeCropBox(parsed.cropBox) ?? null;
      return { kind: 'single', item: parsed, cropBox };
    }

    return {
      kind: 'invalid',
      error:
        '単一アイテム形式（id と category）、まとめ撮り形式（garments 配列）、または一括色更新形式（colorUpdates）を満たしていません。',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '構文エラー';
    return { kind: 'invalid', error: `JSON構文が不正または不完全です: ${msg}` };
  }
}

export const FAILED_DRIVE_UPLOADS_STORAGE_KEY = 'smart_closet_failed_drive_uploads';

export interface FailedDriveUploadItem {
  itemId: string;
  label: string;
  failedAt?: number;
}

/**
 * 失敗したドライブ画像アップロードリストを安全にパース・検証するヘルパー
 */
export function parseFailedDriveUploads(rawJson: string | null): FailedDriveUploadItem[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    const validList: FailedDriveUploadItem[] = [];
    const seenIds = new Set<string>();
    for (const item of parsed) {
      if (item && typeof item.itemId === 'string' && item.itemId.trim()) {
        const normId = item.itemId.trim().toUpperCase();
        if (!seenIds.has(normId)) {
          seenIds.add(normId);
          validList.push({
            itemId: normId,
            label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : '3:4正規化版',
            ...(typeof item.failedAt === 'number' ? { failedAt: item.failedAt } : {}),
          });
        }
      }
    }
    return validList;
  } catch {
    return [];
  }
}

/**
 * localStorage または ストレージ互換オブジェクトへ失敗リストを永続化（空ならキーを削除）
 */
export function saveFailedDriveUploadsToStorage(
  storage: { setItem: (k: string, v: string) => void; removeItem: (k: string) => void },
  items: FailedDriveUploadItem[]
): void {
  if (!storage) return;
  if (!items || items.length === 0) {
    storage.removeItem(FAILED_DRIVE_UPLOADS_STORAGE_KEY);
  } else {
    storage.setItem(FAILED_DRIVE_UPLOADS_STORAGE_KEY, JSON.stringify(items));
  }
}

/**
 * localStorage または ストレージ互換オブジェクトから失敗リストを復元
 */
export function loadFailedDriveUploadsFromStorage(
  storage: { getItem: (k: string) => string | null }
): FailedDriveUploadItem[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(FAILED_DRIVE_UPLOADS_STORAGE_KEY);
    return parseFailedDriveUploads(raw);
  } catch {
    return [];
  }
}

export interface RetryUploadResult {
  succeededItemIds: string[];
  failedItemIds: string[];
  missingImageItemIds: string[];
  readErrorItemIds: string[];
}

/**
 * Google ドライブ画像アップロード再試行の直列処理
 * - 各アイテムの画像は必ず IndexedDB（確定IDの個別3:4正規化画像）から取得する
 * - IndexedDB に個別画像が存在しない場合、複数着が写った元写真（previewDataUrl）へのフォールバックを
 *   厳格に禁止し、画像取り違え（他人の服や複数着写真の誤アップロード）を防止する
 * - IndexedDB 読み出しや FileReader が reject した場合もアイテム単位で例外を捕捉し、
 *   後続アイテムの処理や UI 状態復元を中断させない
 */
export async function processDriveRetryUploads(
  items: FailedDriveUploadItem[],
  getImageDataUrlFn: (id: string) => Promise<string | null>,
  uploadFn: (payload: { itemId: string; dataUrl: string }) => Promise<{ ok: boolean; error?: string }>
): Promise<RetryUploadResult> {
  const succeededItemIds: string[] = [];
  const failedItemIds: string[] = [];
  const missingImageItemIds: string[] = [];
  const readErrorItemIds: string[] = [];

  for (const item of items) {
    let targetDataUrl: string | null = null;
    try {
      targetDataUrl = await getImageDataUrlFn(item.itemId);
    } catch {
      readErrorItemIds.push(item.itemId);
      failedItemIds.push(item.itemId);
      continue;
    }

    if (!targetDataUrl) {
      missingImageItemIds.push(item.itemId);
      failedItemIds.push(item.itemId);
      continue;
    }

    try {
      const res = await uploadFn({ itemId: item.itemId, dataUrl: targetDataUrl });
      if (res && res.ok) {
        succeededItemIds.push(item.itemId);
      } else {
        failedItemIds.push(item.itemId);
      }
    } catch {
      failedItemIds.push(item.itemId);
    }
  }

  return {
    succeededItemIds,
    failedItemIds,
    missingImageItemIds,
    readErrorItemIds,
  };
}
