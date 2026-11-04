import type {
  Category,
  ClosetData,
  ClosetItem,
  SceneMode,
  WearRecord,
  WifeNgPair,
  RecommendationResult,
  ItemCompatibilityStats,
  WardrobeAnalysisResult,
  GarmentColor,
  GarmentMeasurements,
  GarmentCropBox,
  BatchColorUpdatesPayload,
  ColorUpdateItem,
  BatchOuterwearUpdatesPayload,
  OuterwearUpdateItem,
  BatchGarmentDraftItem,
  BatchGarmentsPayload,
  BatchGarmentItemResult,
  BatchGarmentsMergeResult,
  SyncTombstones,
  DuplicateGroupCandidate,
  DuplicateMergeSelection,
  DuplicateMergePreview,
  DuplicateMergeExecutionResult,
  RebuildCandidateItem,
  RebuildFieldKey,
  RebuildFieldSelection,
  RebuildItemDiff,
  RebuildApplyResult,
  RebuildValidationResult,
} from '../types/closet';

/**
 * 標準色パレット（全13色、青の濃淡3段：濃紺（ネイビー含む）／ブルー／淡青、淡色：白／生成り／ベージュ／グレージュ等）
 * 奥さんのNG判定3類型（濃紺×濃紺、淡青×ブルー/淡青、生成り・ベージュ×淡色）を再現する語彙
 */
export const GARMENT_COLOR_PALETTE = [
  '白',
  '生成り',
  'ベージュ',
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
 * 登録相談プロンプトおよび全件リビルドプロンプト共通の色判定アンカー
 * A4用紙を基準とした隣接色の境界基準を定義
 */
export const GARMENT_COLOR_ANCHOR_GUIDE = `【13色パレットの判定アンカーと基準】
選択肢（全13色）: 白, 生成り, ベージュ, 黒, チャコール, ミディアムグレー, ライトグレー, グレージュ, 濃紺, ブルー, 淡青, オリーブ, ブラウン
※「ネイビー」「インディゴ」「サックス」「キャメル」等は単独の色名として出力せず、必ず上記13色のいずれかに分類してください。

1. 白・生成り・ベージュの境界:
   - 白: A4用紙と同等の混じりけのない純白（白ベースの細ストライプや小紋柄を含む）。
   - 生成り: 白に近いが、ごくわずかに黄み・温かみ・綿本来の柔らかさがある極薄色（オフホワイト・エクリュ）。白の代用となる高明度。
   - ベージュ: 白や生成りより一段濃く、明確に色づいた淡い黄褐色・サンド色・小麦色。白の代用にはならない。
2. 生成り・ベージュ・グレージュ・ブラウンの境界:
   - グレージュ: グレーとベージュの中間。灰み（くすみ感・スモーキー感）が強く、黄みが抜けて都会的な中間色（トープ等）。
   - ブラウン: ベージュよりも明確に暗く濃い茶色・キャメル・ダークブラウン。
3. 淡青・ブルー・濃紺の境界（青の濃淡3段）:
   - 白に近い明るい青（サックスブルー・水色・ライトブルー等）は「淡青」。
   - 一般的な色落ちデニム程度の標準的〜中間の青は「ブルー」。
   - 標準的なネイビーから黒に近い深い紺・濃インディゴ（ワンウォッシュ／リジッドデニム、紺ストライプ等）はすべて「濃紺」。※ネイビーは濃紺に統合。
4. 濃紺と黒の境界:
   - 暗い色調でもわずかにでも青み（ネイビー／インディゴ感）が読み取れれば「濃紺」。
   - 青みが一切読み取れない純粋な暗さ（ブラック）は「黒」。
5. グレー各色（チャコール／ミディアムグレー／ライトグレー／グレージュ）の境界:
   - A4白用紙と黒の間の明度を基準に、黒に近い濃灰は「チャコール」、標準的な中間調の灰は「ミディアムグレー」、白に近い明るい薄灰（杢グレー・アイスグレー等）は「ライトグレー」。
   - グレーに明確なベージュみ・茶み・黄みが混じる中間色は「グレージュ」。
6. 配色物・柄物・杢（メランジ）の主色決定ルール:
   - 2色以上で構成される服（ボーダー、バイカラー、柄物、メランジなど）は、面積の70%以上を占める地色（ベースカラー）を color とする。
   - 70%を超える単一の地色がない場合は、全体の印象を最も支配しているベーストーンを採用する。
   - 配色・柄などの特徴は name や notes に明記する。`;

/**
 * まとめ撮り一括登録の最大着数（推奨2〜3着、ハード上限3着）
 */
export const MAX_BATCH_GARMENTS = 3;

/**
 * 13色パレット外の色名が指定された場合に、情報欠損を防ぐため notes の末尾に目安を決定論的に追記する純粋関数
 * 既に同一の追記が含まれる場合は二重追記しない。
 */
export function appendUnconfirmedColorNote(notes: string, unconfirmedColor: string): string {
  const trimmedColor = (unconfirmedColor || '').trim();
  if (!trimmedColor) return notes;
  const noteSnippet = `（色の目安：${trimmedColor} ※13色パレット外のため未確定）`;
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

  // 6. アースカラー・ベージュ・ブラウン
  if (
    text.includes('ベージュ') ||
    text.includes('beige') ||
    text.includes('サンド') ||
    text.includes('sand') ||
    text.includes('小麦')
  ) {
    return 'ベージュ';
  }
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

    if (item.isOuterwear !== undefined && typeof item.isOuterwear !== 'boolean') {
      return { valid: false, error: `[${item.id}] の isOuterwear は真偽値である必要があります。` };
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
      ...(item.category === 'shirt' && item.isOuterwear === true ? { isOuterwear: true } : {}),
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

  if (candidate.isOuterwear !== undefined && typeof candidate.isOuterwear !== 'boolean') {
    return { valid: false, error: `[${candidate.id}] の isOuterwear は真偽値である必要があります。` };
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
      warning = `色「${trimmedColor}」は13色パレット外のため未確定として登録します（メモに目安を記録済み）。`;
    }
  } else {
    finalColor = undefined;
    warning = '色が未設定のため「未確定」として扱います（後から写真からの全件リビルドで確定可能）。';
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
    ...(candidateItem.category === 'shirt' && candidateItem.isOuterwear === true ? { isOuterwear: true } : {}),
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
    ...(targetCategory === 'pants' ? { isOuterwear: undefined } : {}),
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
        error: `ID "${id}" の色 "${String(rawColor)}" は無効です。13色パレット（${GARMENT_COLOR_PALETTE.join(', ')}）から指定してください。`,
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
 * 指定されたシャツの「羽織り（isOuterwear: true）」「1枚もの（isOuterwear: undefined）」を切り替える純粋関数
 * 対象アイテム以外のプロパティや相性配列、他アイテムのデータは1ビットも変更せず不変性を保証する。
 */
export function setShirtOuterwear(
  data: ClosetData,
  itemId: string,
  isOuterwear: boolean,
  updatedAt?: number
): ClosetData {
  const normId = itemId.trim().toUpperCase();
  let itemFound = false;

  const updatedItems = data.items.map((item) => {
    if (item.id.trim().toUpperCase() !== normId) {
      return item;
    }
    // パンツは羽織り対象外（不変でそのまま返す）
    if (item.category !== 'shirt') {
      return item;
    }
    itemFound = true;
    if (isOuterwear) {
      return { ...item, isOuterwear: true };
    } else {
      const { isOuterwear: _isOuterwear, ...rest } = item;
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
 * 既存アイテム間の相性配列やスコア、名称（name）を一切破壊せず、全シャツの isOuterwear のみを安全に一括更新する純粋関数
 */
export function applyBatchOuterwearUpdates(
  existingData: ClosetData,
  payload: BatchOuterwearUpdatesPayload | OuterwearUpdateItem[] | unknown
): {
  valid: boolean;
  data?: ClosetData;
  error?: string;
  updatedCount?: number;
} {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: '一括羽織り更新ペイロードがオブジェクトまたは配列ではありません。' };
  }

  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any).outerwearUpdates)
    ? (payload as any).outerwearUpdates
    : null;

  if (!rawList) {
    return { valid: false, error: 'ペイロードに "outerwearUpdates" 配列または更新アイテム配列が含まれていません。' };
  }
  if (rawList.length === 0) {
    return { valid: false, error: '一括羽織り更新の配列が空です。' };
  }

  const existingMap = new Map(existingData.items.map((it) => [it.id, it]));
  const seenIds = new Set<string>();

  for (let i = 0; i < rawList.length; i++) {
    const update = rawList[i];
    if (!update || typeof update !== 'object') {
      return { valid: false, error: `outerwearUpdates[${i}] の形式が不正です。` };
    }
    const id = typeof update.id === 'string' ? update.id.trim().toUpperCase() : '';
    if (!id) {
      return { valid: false, error: `outerwearUpdates[${i}] の ID が未指定です。` };
    }
    const targetItem = existingMap.get(id);
    if (!targetItem) {
      return { valid: false, error: `ID "${id}" は現在のワードローブに存在しません。` };
    }
    if (targetItem.category !== 'shirt') {
      return { valid: false, error: `ID "${id}" はパンツです。羽織り分類はシャツのみに設定できます。` };
    }
    if (seenIds.has(id)) {
      return { valid: false, error: `ID "${id}" の羽織り分類更新が重複して指定されています。` };
    }
    seenIds.add(id);

    if (typeof update.isOuterwear !== 'boolean') {
      return { valid: false, error: `ID "${id}" の isOuterwear は真偽値である必要があります。` };
    }
  }

  const updateMap = new Map<string, OuterwearUpdateItem>(
    rawList.map((u: any) => [u.id.trim().toUpperCase(), u as OuterwearUpdateItem])
  );
  let updatedCount = 0;

  const newItems = existingData.items.map((item) => {
    const update = updateMap.get(item.id);
    if (!update) return item;
    updatedCount++;
    if (update.isOuterwear) {
      return { ...item, isOuterwear: true };
    } else {
      const { isOuterwear: _isOuterwear, ...rest } = item;
      return rest;
    }
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
 * 既存の全シャツ一覧を埋め込み、Gemini 相談で羽織りか1枚ものかを一括判定させるプロンプトを生成する純粋関数
 */
export function buildBatchOuterwearAssessmentPrompt(items: ClosetItem[]): string {
  const shirts = items.filter((it) => it.category === 'shirt');

  const shirtsList = shirts
    .map((s) => {
      const currentCategory = s.isOuterwear ? '羽織り' : '1枚もの';
      const status = s.archived ? '（保管中）' : '';
      return `- [${s.id}] ${s.name} ${status}(現在区分: ${currentCategory}, 色: ${s.color || '未設定'}, 季節袖丈: ${s.seasonSleeve || '通年'}, メモ: ${s.notes || 'なし'})`;
    })
    .join('\n');

  return `あなたは40代男性専属のプロスタイリストAIです。
以下は私のクローゼットに登録されているすべてのシャツ・トップス（全${shirts.length}着）の一覧です。
アイテム名、色、季節袖丈、メモ（および写真一覧がある場合はその写真）から、各アイテムが「羽織り（アウター・中間着）」か「1枚もの（インナー・トップス）」かを判定してください。

### 分類基準
1. **羽織り（isOuterwear: true）**:
   - カーディガン（前開き・ボタン留め）
   - ジップアップ、ジップパーカー、フルジップ/ハーフジップ
   - ニットジャケット、シャツジャケット、ブルゾン
   - インナーの上に重ねて着る前提のアイテム
2. **1枚もの（isOuterwear: false）**:
   - 通常の長袖・半袖シャツ（ドレスシャツ、カジュアルシャツ、オックスフォード等）
   - Tシャツ、ロンT、ポロシャツ
   - プルオーバーニット、スウェット（前開きでないかぶりもの）

### 対象シャツ一覧（全${shirts.length}着）
${shirtsList}

### 出力フォーマット指示
必ず以下のJSON形式のみを出力してください。Markdownの説明文や前置きは不要です。全${shirts.length}着のIDを漏らさず含めてください。
\`\`\`json
{
  "outerwearUpdates": [
    { "id": "S1", "isOuterwear": false },
    { "id": "S10", "isOuterwear": true }
  ]
}
\`\`\``;
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
  kind: 'single' | 'batch_color' | 'batch_outerwear' | 'batch_garments' | 'invalid';
  item?: Partial<ClosetItem>;
  cropBox?: GarmentCropBox | null;
  batchColorUpdates?: ColorUpdateItem[];
  batchOuterwearUpdates?: OuterwearUpdateItem[];
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

    // 2. 一括羽織り分類更新形式: { "outerwearUpdates": [...] } または 配列
    if (parsed && typeof parsed === 'object') {
      const candidates = Array.isArray((parsed as any).outerwearUpdates)
        ? (parsed as any).outerwearUpdates
        : Array.isArray(parsed) &&
          parsed.length > 0 &&
          typeof (parsed[0] as any)?.id === 'string' &&
          (parsed[0] as any)?.isOuterwear !== undefined &&
          (parsed[0] as any)?.category === undefined
        ? parsed
        : null;

      if (candidates) {
        const batchList: OuterwearUpdateItem[] = [];
        for (const c of candidates) {
          if (c && typeof c.id === 'string' && typeof c.isOuterwear === 'boolean') {
            batchList.push({ id: c.id.trim().toUpperCase(), isOuterwear: c.isOuterwear });
          }
        }
        if (batchList.length > 0) {
          return { kind: 'batch_outerwear', batchOuterwearUpdates: batchList };
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
        '単一アイテム形式（id と category）、まとめ撮り形式（garments 配列）、一括色更新形式（colorUpdates）、または一括羽織り更新形式（outerwearUpdates）を満たしていません。',
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

/**
 * 買い足し相談プロンプト生成の入力型
 */
export interface ShoppingConsultationPromptInput {
  items: ClosetItem[];
  wifeNgPairs: WifeNgPair[];
  wearHistory?: WearRecord[];
  userMemo?: string;
}

/**
 * Gemini 買い足し相談用の対話プロンプトを生成する純粋関数
 * - 現役アイテム（!archived）を主データとして属性・相性・着用回数を埋め込む
 * - 片付けた服（archived）は相談のベースには含めず別枠で記載し、「出す」提案や重複購入防止に活用できるようにする
 * - 奥様NG・相性NGは着用禁止ではなく「ダメ出し回避のための注意喚起（おすすめ除外対象）」として正確に伝える
 * - 新しい集計・計算ロジックは作らず、既存のアイテム属性と wearHistory の単純カウントのみを出力する
 * - 人間が読みやすい対話形式（自然言語）での回答を指示する
 */
export function buildShoppingConsultationPrompt(
  input: ShoppingConsultationPromptInput
): string {
  const { items, wifeNgPairs, wearHistory = [], userMemo = '' } = input;

  // 1. 各アイテムの着用回数を集計（既存の wearHistory から単純カウント、羽織り追加着用も加算）
  const wearCountMap = new Map<string, number>();
  for (const record of wearHistory) {
    if (record.shirtId) {
      wearCountMap.set(record.shirtId, (wearCountMap.get(record.shirtId) || 0) + 1);
    }
    if (record.pantsId) {
      wearCountMap.set(record.pantsId, (wearCountMap.get(record.pantsId) || 0) + 1);
    }
    if (record.outerwearId && record.outerwearId !== record.shirtId) {
      wearCountMap.set(record.outerwearId, (wearCountMap.get(record.outerwearId) || 0) + 1);
    }
  }

  // 2. 現役アイテムと片付けた服を分離
  const activeShirts = items.filter((item) => item.category === 'shirt' && !item.archived);
  const activePants = items.filter((item) => item.category === 'pants' && !item.archived);
  const archivedItems = items.filter((item) => Boolean(item.archived));

  const activeOuterwearShirts = activeShirts.filter((s) => Boolean(s.isOuterwear));
  const activeSingleShirts = activeShirts.filter((s) => !s.isOuterwear);

  const activeShirtIdSet = new Set(activeShirts.map((s) => s.id));
  const activePantsIdSet = new Set(activePants.map((p) => p.id));

  const formatMeasurementsSummary = (item: ClosetItem): string => {
    if (!item.measurements) return '';
    const m = item.measurements;
    if (item.category === 'shirt') {
      const parts: string[] = [];
      if (m.bodyLength !== undefined) parts.push(`着丈${m.bodyLength}cm`);
      if (m.chestWidth !== undefined) parts.push(`身幅${m.chestWidth}cm`);
      if (m.shoulderWidth !== undefined) parts.push(`肩幅${m.shoulderWidth}cm`);
      if (m.sleeveLength !== undefined) parts.push(`袖丈${m.sleeveLength}cm`);
      return parts.length > 0 ? `、実寸: [${parts.join(', ')}]` : '';
    } else {
      const parts: string[] = [];
      if (m.waist !== undefined) parts.push(`ウエスト${m.waist}cm`);
      if (m.inseam !== undefined) parts.push(`股下${m.inseam}cm`);
      if (m.totalLength !== undefined) parts.push(`総丈${m.totalLength}cm`);
      if (m.hemWidth !== undefined) parts.push(`裾幅${m.hemWidth}cm`);
      return parts.length > 0 ? `、実寸: [${parts.join(', ')}]` : '';
    }
  };

  const formatActiveItem = (item: ClosetItem): string => {
    const wearCount = wearCountMap.get(item.id) || 0;
    const measurementsStr = formatMeasurementsSummary(item);

    // 片付けた服（archived）のIDを相性行から除外
    const validPeerSet = item.category === 'shirt' ? activePantsIdSet : activeShirtIdSet;
    const filteredOffice = item.officeRecommendIds.filter((id) => validPeerSet.has(id));
    const filteredRemote = item.remoteRecommendIds.filter((id) => validPeerSet.has(id));
    const filteredNg = item.ngIds.filter((id) => validPeerSet.has(id));

    const officeStr = filteredOffice.length > 0 ? filteredOffice.join(', ') : 'なし';
    const remoteStr = filteredRemote.length > 0 ? filteredRemote.join(', ') : 'なし';
    const ngStr = filteredNg.length > 0 ? `${filteredNg.join(', ')}（${item.ngReason || '相性NG'}）` : 'なし';
    const categoryTypeStr = item.category === 'shirt' ? `、区分: ${item.isOuterwear ? '羽織り' : '1枚もの'}` : '';

    return `- [${item.id}] ${item.name}（色: ${item.color ?? '未設定'}${categoryTypeStr}、${item.seasonSleeve}、ドレス度${item.dressScore}、快適度${item.comfortScore}、着用回数: ${wearCount}回${measurementsStr}）
  - 出社推奨: ${officeStr}
  - リモート推奨: ${remoteStr}
  - NG相手: ${ngStr}
  - メモ: ${item.notes || 'なし'}`;
  };

  const activeShirtsList =
    activeShirts.length > 0
      ? activeShirts.map(formatActiveItem).join('\n')
      : '（現在登録されている現役シャツはありません）';

  const activePantsList =
    activePants.length > 0
      ? activePants.map(formatActiveItem).join('\n')
      : '（現在登録されている現役パンツはありません）';

  // 3. 現役アイテム間の登録済み奥様NGペア
  const activeWifeNgPairs = wifeNgPairs.filter(
    (ng) => activeShirtIdSet.has(ng.shirtId) && activePantsIdSet.has(ng.pantsId)
  );

  const wifeNgList =
    activeWifeNgPairs.length > 0
      ? activeWifeNgPairs
          .map((ng) => `- ${ng.shirtId} × ${ng.pantsId}: ${ng.reason || '奥様NG指定'}`)
          .join('\n')
      : 'なし';

  // 4. 片付けた服のフォーマット
  const archivedList =
    archivedItems.length > 0
      ? archivedItems
          .map((item) => {
            const wearCount = wearCountMap.get(item.id) || 0;
            const catName = item.category === 'shirt' ? (item.isOuterwear ? 'シャツ・羽織り' : 'シャツ・1枚もの') : 'パンツ';
            return `- [${item.id}] ${item.name}（${catName}、色: ${item.color ?? '未設定'}、${item.seasonSleeve}、ドレス度${item.dressScore}、快適度${item.comfortScore}、過去着用回数: ${wearCount}回）: ${item.notes || 'メモなし'}`;
          })
          .join('\n')
      : 'なし';

  const userMemoSection = userMemo.trim()
    ? userMemo.trim()
    : '特になし（現在のワードローブの相性・着用状況から、おすすめの買い足し候補や片付けた服の活用を提案してください）';

  return `あなたは40代後半男性（オフィス出社・リモートワーク併用）専属のプロスタイリストAIです。
以下は現在の私のクローゼット（スマートクローゼット）に登録されている服の全データです。
私のワードローブの組み合わせ相性・着用回数・奥様NG情報・片付けている服を把握したうえで、新しく買い足すべき服について【対話形式】で相談に乗ってください。
※JSONコードではなく、人間が読みやすい自然言語の対話形式でアドバイスしてください。

### 相談者のプロフィール＆利用環境
- 40代後半男性、ハイブリッド勤務（週2〜3日出社、残りはリモートワーク）。
- 目標: 「妻からのファッションダメ出し（NG）」を100%回避し、毎朝ストレスなく清潔感ある着こなしができること。
- 出社時は清潔感・きれいめ（ドレス度3.0以上、特にスラックス）を重視。
- リモートワーク時は快適さ・リラックス感を重視。

### 相談したい条件・悩み（ユーザーメモ）
${userMemoSection}

### 【主データ】現在着用している現役ワードローブ一覧
※相性の相手ID、着用実績（着用回数）、NG相手が記載されています。

【シャツ・トップス（全${activeShirts.length}着：1枚もの${activeSingleShirts.length}着 / 羽織り${activeOuterwearShirts.length}着）】
${activeShirtsList}

【パンツ・ボトムス（全${activePants.length}着）】
${activePantsList}

### 【注意喚起】登録済みの奥様NGペア（全${activeWifeNgPairs.length}件）
※過去に妻から実際にダメ出しされた組み合わせです。おすすめから除外する注意喚起として扱ってください。
${wifeNgList}

### 【参考・別枠】現在片付けている服（保管中・全${archivedItems.length}着）
※片付けた服は現在の現役ローテーション（主データ）には含めていません。
${archivedList}

### スタイリング絶対原則（奥様ダメ出し回避ルール）
1. **同系色・濃紺同士の禁止**: 上下ともに濃紺・インディゴになる組み合わせ（例: 濃紺シャツ × 濃紺パンツ）は作業着・パジャマに見えるためNG。
2. **淡青×青デニムの禁止**: サックス（淡青）にブルーデニム（ブルー）を合わせると全身が水色で繋がり休日のおじさん感が出るためNG。
3. **淡色×淡色の膨張禁止**: 生成り・ベージュシャツに淡いグレージュやライトグレー、白、ベージュのパンツを合わせると輪郭がぼやけて膨張して見えるためNG。
4. **柄×柄の完全禁止**: チェック・ストライプ・小紋柄シャツと柄パンツはNG。柄パンツは白無地シャツで消化すること。
5. **TPO分離と出社スウェット除外**:
   - 出社時: パンツのドレス度3.5以上を優先。スウェット・ジョガー系（ドレス度3.0未満）は出社候補から除外。
   - リモート時: 快適度4.0以上を優先。
6. **NG判定の位置づけ**:
   - Wife NG や相性NGは、服の着用自体の絶対禁止ではなく「奥様からのダメ出しを回避するための注意喚起（おすすめ候補からの除外対象）」です。買い足し提案では、手持ち服とNG衝突を起こしにくく、着回し相手の少ない服や着用回数の少ない服を救済できるアイテムを優先してください。

### AIへの回答・相談指示
1. **買い足し候補の提案**:
   - 優先して買い足すべきアイテムのカテゴリ、色、素材感、シルエット、仕様の目安（例: ノータック〜ワンタック、ポリエステル混紡、ドレス度など）。
   - それを導入することで、手持ちのどの服と新しくコーデが組めるようになるか（特に着用回数が少ない服や相棒が不足している服の救済）。
   - 逆に避けるべきアイテム（手持ち服とNG衝突しやすい色・柄・素材など）。
2. **片付けた服の活用提案（重要）**:
   - 新しく購入しなくても、現在片付けている服の中に適したものがある場合は、「新しく買うより、片付けている [ID] 〇〇 を出す方がよい」と提案してください。
   - また、片付けている服とほぼ同一のアイテムを重複して買い足し提案することは避けてください。
3. **対話形式での対応**:
   - 一度の回答で完結させる必要はありません。まずは優先度の高い提案を行い、こちらの質問（予算、具体的なブランド/ショップの傾向、季節の切り替えなど）や条件変更に対話で応じてください。`;
}

/**
 * クリップボードコピー結果のフィードバック状態
 */
export type CopyFeedbackStatus = 'idle' | 'success' | 'error';

/**
 * クリップボードへのテキスト書き込みと成否判定を行う純粋非同期ヘルパー関数
 * navigator.clipboard.writeText が成功した場合のみ true を返し、
 * 権限拒否、非対応環境、例外発生時は false を返す（呼び出し元へ例外を漏らさない）。
 */
export async function copyTextToClipboard(
  text: string,
  clipboard: { writeText?: (data: string) => Promise<void> } | undefined =
    typeof navigator !== 'undefined' ? navigator.clipboard : undefined
): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return false;
  }
  try {
    await clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    return false;
  }
}

// ----------------------------------------------------
// 重複検出・統合ロジック
// ----------------------------------------------------

/**
 * 64-bit 16進数文字列 (16文字) のハミング距離（異なるビット数）を計算する純粋関数
 */
export function computeHammingDistance(hexA: string, hexB: string): number {
  if (!hexA || !hexB) return 64;
  const a = hexA.trim().toLowerCase();
  const b = hexB.trim().toLowerCase();
  if (a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const vA = parseInt(a[i], 16);
    const vB = parseInt(b[i], 16);
    if (isNaN(vA) || isNaN(vB)) return 64;
    let xor = vA ^ vB;
    while (xor > 0) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

/**
 * ID番号を数値として抽出するヘルパー（S36 -> 36, P2 -> 2）
 */
function extractIdNumber(id: string): number {
  const match = id.match(/\d+/);
  return match ? parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * ワードローブ内の重複登録候補グループを検出する純粋関数
 */
export function detectDuplicateGarmentGroups(params: {
  items: ClosetItem[];
  imageHashes?: Record<string, { sha256?: string; dhash?: string }>;
  dhashThreshold?: number;
}): DuplicateGroupCandidate[] {
  const { items, imageHashes = {}, dhashThreshold = 5 } = params;
  if (!items || items.length < 2) return [];

  // カテゴリごとにグループ化して比較
  const categories: Category[] = ['shirt', 'pants'];
  const candidates: DuplicateGroupCandidate[] = [];

  for (const cat of categories) {
    const catItems = items.filter((it) => it.category === cat);
    if (catItems.length < 2) continue;

    // 隣接関係を保持するグラフ
    const adj = new Map<string, Array<{ id: string; reason: 'exact_photo' | 'similar_photo' | 'identical_details'; detail: string }>>();
    for (const it of catItems) {
      adj.set(it.id, []);
    }

    for (let i = 0; i < catItems.length; i++) {
      for (let j = i + 1; j < catItems.length; j++) {
        const itemA = catItems[i];
        const itemB = catItems[j];
        const hashA = imageHashes[itemA.id];
        const hashB = imageHashes[itemB.id];

        let matched = false;
        let reason: 'exact_photo' | 'similar_photo' | 'identical_details' = 'identical_details';
        let detail = '';

        // 1. 画像のハッシュ比較
        if (hashA && hashB) {
          if (hashA.sha256 && hashB.sha256 && hashA.sha256 === hashB.sha256) {
            matched = true;
            reason = 'exact_photo';
            detail = `画像SHA256完全一致 (${itemA.id}, ${itemB.id})`;
          } else if (hashA.dhash && hashB.dhash) {
            const dist = computeHammingDistance(hashA.dhash, hashB.dhash);
            if (dist <= dhashThreshold) {
              matched = true;
              reason = 'similar_photo';
              detail = `画像dHash距離 ${dist} (閾値${dhashThreshold})`;
            }
          }
        }

        // 2. 詳細属性の完全一致比較（画像がない場合やすべて一致している場合）
        if (!matched) {
          const isIdentical =
            itemA.name.trim() === itemB.name.trim() &&
            itemA.color === itemB.color &&
            itemA.seasonSleeve === itemB.seasonSleeve &&
            itemA.dressScore === itemB.dressScore &&
            itemA.comfortScore === itemB.comfortScore &&
            (itemA.notes || '').trim() === (itemB.notes || '').trim();
          if (isIdentical) {
            matched = true;
            reason = 'identical_details';
            detail = `詳細属性が完全一致 (${itemA.id}, ${itemB.id})`;
          }
        }

        if (matched) {
          adj.get(itemA.id)!.push({ id: itemB.id, reason, detail });
          adj.get(itemB.id)!.push({ id: itemA.id, reason, detail });
        }
      }
    }

    // 連結成分（グループ）の探索
    const visited = new Set<string>();
    for (const it of catItems) {
      if (visited.has(it.id)) continue;
      const neighbors = adj.get(it.id) || [];
      if (neighbors.length === 0) continue;

      const groupIds: string[] = [];
      const queue: string[] = [it.id];
      visited.add(it.id);
      let bestReason: 'exact_photo' | 'similar_photo' | 'identical_details' = 'identical_details';
      const details: string[] = [];

      while (queue.length > 0) {
        const curr = queue.shift()!;
        groupIds.push(curr);
        for (const edge of adj.get(curr) || []) {
          if (edge.reason === 'exact_photo') {
            bestReason = 'exact_photo';
          } else if (edge.reason === 'similar_photo' && bestReason !== 'exact_photo') {
            bestReason = 'similar_photo';
          }
          if (!details.includes(edge.detail)) {
            details.push(edge.detail);
          }
          if (!visited.has(edge.id)) {
            visited.add(edge.id);
            queue.push(edge.id);
          }
        }
      }

      if (groupIds.length > 1) {
        // IDの数値昇順でソート（S36, S41 など）
        groupIds.sort((a, b) => {
          const numA = extractIdNumber(a);
          const numB = extractIdNumber(b);
          if (numA !== numB) return numA - numB;
          return a.localeCompare(b);
        });

        const defaultSurvivorId = groupIds[0];
        candidates.push({
          groupId: `dup_${cat}_${groupIds.join('_')}`,
          category: cat,
          itemIds: groupIds,
          defaultSurvivorId,
          reason: bestReason,
          similarityDetail: details.join(', '),
        });
      }
    }
  }

  return candidates;
}

/**
 * 重複マージ実行前の影響範囲を算出する純粋関数
 */
export function previewDuplicateMerge(params: {
  closetData: ClosetData;
  wearHistory: WearRecord[];
  wifeNgPairs: WifeNgPair[];
  selections: DuplicateMergeSelection[];
}): DuplicateMergePreview {
  const { closetData, wearHistory, wifeNgPairs, selections } = params;
  const activeSelections = selections.filter((s) => s.included && s.removedIds.length > 0);

  const removedSet = new Set<string>();
  for (const sel of activeSelections) {
    for (const id of sel.removedIds) {
      removedSet.add(id);
    }
  }

  const totalRemovedCount = removedSet.size;

  let affectedWearRecordsCount = 0;
  for (const rec of wearHistory) {
    if (
      removedSet.has(rec.shirtId) ||
      removedSet.has(rec.pantsId) ||
      (rec.outerwearId && removedSet.has(rec.outerwearId))
    ) {
      affectedWearRecordsCount++;
    }
  }

  let affectedWifeNgCount = 0;
  for (const pair of wifeNgPairs) {
    if (removedSet.has(pair.shirtId) || removedSet.has(pair.pantsId)) {
      affectedWifeNgCount++;
    }
  }

  let affectedPeerItemsCount = 0;
  for (const it of closetData.items) {
    if (removedSet.has(it.id)) continue;
    const hasRef =
      (it.officeRecommendIds || []).some((id) => removedSet.has(id)) ||
      (it.remoteRecommendIds || []).some((id) => removedSet.has(id)) ||
      (it.ngIds || []).some((id) => removedSet.has(id));
    if (hasRef) {
      affectedPeerItemsCount++;
    }
  }

  return {
    totalRemovedCount,
    affectedWearRecordsCount,
    affectedWifeNgCount,
    affectedPeerItemsCount,
    itemsAfterCount: Math.max(0, closetData.items.length - totalRemovedCount),
  };
}

/**
 * 重複マージを実行する純粋関数
 * 【重要不変条件】
 * 1. 着用履歴の record.date は絶対に書き換えない！
 * 2. 参照IDを survivorId に差し替えたレコードは、他端末へLWWで伝播させるため timestamp: record.timestamp + 1 とし、新ID `${record.date}_${record.timestamp + 1}` を付与。
 * 3. 旧レコードIDは tombstones.deletedWearMap に登録して旧レコードの復活を防止。
 * 4. 削除された服IDは tombstones.deletedGarmentIds に登録。
 */
export function executeDuplicateMerge(params: {
  closetData: ClosetData;
  wearHistory: WearRecord[];
  wifeNgPairs: WifeNgPair[];
  selections: DuplicateMergeSelection[];
  currentTombstones?: SyncTombstones;
}): DuplicateMergeExecutionResult {
  const { closetData, wearHistory, wifeNgPairs, selections, currentTombstones } = params;
  const activeSelections = selections.filter((s) => s.included && s.removedIds.length > 0);

  if (activeSelections.length === 0) {
    return {
      ok: false,
      closetData,
      wearHistory,
      wifeNgPairs,
      tombstones: currentTombstones || { deletedWearMap: {}, deletedWifeNgMap: {} },
      mergedCount: 0,
      removedItemIds: [],
      error: 'マージ対象として選択されたグループがありません。',
    };
  }

  const replacementMap = new Map<string, string>();
  const removedSet = new Set<string>();

  for (const sel of activeSelections) {
    for (const remId of sel.removedIds) {
      replacementMap.set(remId, sel.survivorId);
      removedSet.add(remId);
    }
  }

  const removedItemIds = Array.from(removedSet);

  // 1. WearRecord のID差し替え（dateは不変、timestamp+1、新ID付与、旧IDはdeletedWearMapへ）
  const newDeletedWearMap: Record<string, number> = {
    ...(currentTombstones?.deletedWearMap || {}),
  };

  const updatedWearHistory: WearRecord[] = wearHistory.map((rec) => {
    const shirtNeedsReplace = replacementMap.has(rec.shirtId);
    const pantsNeedsReplace = replacementMap.has(rec.pantsId);
    const outerwearNeedsReplace = Boolean(rec.outerwearId && replacementMap.has(rec.outerwearId));

    if (!shirtNeedsReplace && !pantsNeedsReplace && !outerwearNeedsReplace) {
      return rec;
    }

    const newShirtId = replacementMap.get(rec.shirtId) || rec.shirtId;
    const newPantsId = replacementMap.get(rec.pantsId) || rec.pantsId;
    let newOuterwearId = rec.outerwearId ? (replacementMap.get(rec.outerwearId) || rec.outerwearId) : undefined;
    if (newOuterwearId === newShirtId) {
      newOuterwearId = undefined;
    }
    const newTimestamp = (rec.timestamp || 0) + 1;
    const newId = `${rec.date}_${newTimestamp}`;

    // 旧レコードIDの墓標を立てる
    if (rec.id) {
      newDeletedWearMap[rec.id] = newTimestamp;
    }

    return {
      ...rec,
      id: newId,
      shirtId: newShirtId,
      pantsId: newPantsId,
      ...(newOuterwearId ? { outerwearId: newOuterwearId } : (rec.outerwearId ? { outerwearId: undefined } : {})),
      timestamp: newTimestamp,
      // rec.date は絶対に維持！
    };
  });

  // 2. wifeNgPairs のID差し替えと重複除去
  const newDeletedWifeNgMap: Record<string, number> = {
    ...(currentTombstones?.deletedWifeNgMap || {}),
  };
  const seenPairKeys = new Set<string>();
  const updatedWifeNgPairs: WifeNgPair[] = [];

  for (const pair of wifeNgPairs) {
    const shirtNeedsReplace = replacementMap.has(pair.shirtId);
    const pantsNeedsReplace = replacementMap.has(pair.pantsId);
    const newShirtId = replacementMap.get(pair.shirtId) || pair.shirtId;
    const newPantsId = replacementMap.get(pair.pantsId) || pair.pantsId;
    const key = `${newShirtId}_${newPantsId}`;

    if (shirtNeedsReplace || pantsNeedsReplace) {
      const oldKey = `${pair.shirtId}_${pair.pantsId}`;
      newDeletedWifeNgMap[oldKey] = Date.now();
    }

    if (!seenPairKeys.has(key)) {
      seenPairKeys.add(key);
      updatedWifeNgPairs.push({
        shirtId: newShirtId,
        pantsId: newPantsId,
        reason: pair.reason || '重複統合による更新',
        createdAt: pair.createdAt || new Date().toISOString(),
      });
    }
  }

  // 3. closetData.items の更新
  // 削除対象アイテムの相性情報を survivor にマージするためのマップを準備
  const removedItemsMap = new Map<string, ClosetItem>();
  for (const it of closetData.items) {
    if (removedSet.has(it.id)) {
      removedItemsMap.set(it.id, it);
    }
  }

  const updatedItems: ClosetItem[] = [];

  for (const it of closetData.items) {
    if (removedSet.has(it.id)) {
      continue; // 削除対象
    }

    // 他アイテム参照IDの差し替え関数
    const replaceAndFilterIds = (ids: string[] | undefined, selfId: string): string[] => {
      if (!ids) return [];
      const res = new Set<string>();
      for (const id of ids) {
        const mapped = replacementMap.get(id) || id;
        if (mapped !== selfId && !removedSet.has(mapped)) {
          res.add(mapped);
        }
      }
      return Array.from(res);
    };

    let officeRecs = replaceAndFilterIds(it.officeRecommendIds, it.id);
    let remoteRecs = replaceAndFilterIds(it.remoteRecommendIds, it.id);
    let ngs = replaceAndFilterIds(it.ngIds, it.id);

    // もしこのアイテムが survivor の場合、対応する removedItems の相性も安全に統合
    const matchedSelections = activeSelections.filter((s) => s.survivorId === it.id);
    for (const sel of matchedSelections) {
      for (const remId of sel.removedIds) {
        const remItem = removedItemsMap.get(remId);
        if (remItem) {
          const remOffice = replaceAndFilterIds(remItem.officeRecommendIds, it.id);
          const remRemote = replaceAndFilterIds(remItem.remoteRecommendIds, it.id);
          const remNg = replaceAndFilterIds(remItem.ngIds, it.id);

          for (const id of remNg) {
            if (!ngs.includes(id)) ngs.push(id);
          }
          for (const id of remOffice) {
            if (!ngs.includes(id) && !officeRecs.includes(id)) officeRecs.push(id);
          }
          for (const id of remRemote) {
            if (!ngs.includes(id) && !remoteRecs.includes(id)) remoteRecs.push(id);
          }
        }
      }
    }

    // 排他性：ngIds にあるものは recommend から除外
    officeRecs = officeRecs.filter((id) => !ngs.includes(id));
    remoteRecs = remoteRecs.filter((id) => !ngs.includes(id));

    updatedItems.push({
      ...it,
      officeRecommendIds: officeRecs,
      remoteRecommendIds: remoteRecs,
      ngIds: ngs,
    });
  }

  // 4. tombstones の更新
  const updatedTombstones: SyncTombstones = {
    ...(currentTombstones || { deletedWearMap: {}, deletedWifeNgMap: {} }),
    deletedWearMap: newDeletedWearMap,
    deletedWifeNgMap: newDeletedWifeNgMap,
  };

  const updatedClosetData: ClosetData = {
    ...closetData,
    items: updatedItems,
    updatedAt: Date.now(),
  };

  return {
    ok: true,
    closetData: updatedClosetData,
    wearHistory: updatedWearHistory,
    wifeNgPairs: updatedWifeNgPairs,
    tombstones: updatedTombstones,
    mergedCount: activeSelections.length,
    removedItemIds,
  };
}

// ----------------------------------------------------
// 全件リビルド・差分比較・選択適用ロジック
// ----------------------------------------------------

/**
 * Geminiに提出する全件リビルド用の分析プロンプトを生成する純粋関数
 */
export function buildWardrobeRebuildPrompt(params: {
  items: ClosetItem[];
  contactSheetsCount: number;
}): string {
  const { items, contactSheetsCount } = params;

  const shirts = items.filter((it) => it.category === 'shirt');
  const pants = items.filter((it) => it.category === 'pants');

  const shirtsList = shirts
    .map(
      (s) =>
        `- [${s.id}] ${s.name} (現在区分: ${s.isOuterwear ? '羽織り' : '1枚もの'}, 現在色: ${s.color || '未設定'}, 季節袖丈: ${s.seasonSleeve || '通年'}, メモ: ${s.notes || 'なし'})`
    )
    .join('\n');

  const pantsList = pants
    .map(
      (p) =>
        `- [${p.id}] ${p.name} (現在色: ${p.color || '未設定'}, 季節袖丈: ${p.seasonSleeve || '通年'}, メモ: ${p.notes || 'なし'})`
    )
    .join('\n');

  return `あなたは40代男性（ハイブリッド勤務：出社＋リモート）専任の骨格・カラープロスタイリストです。
添付された ${contactSheetsCount} 枚のコンタクトシート（全${items.length}着の写真一覧、各服にIDバッジ明記）および以下の現行ワードローブ一覧を正本として、全着の属性（名前、色、季節・袖丈、ドレス度・快適度、メモ、相性・NG）を再分析し、最新のJSONデータとして丸ごと再構築（全件リビルド）してください。

${GARMENT_COLOR_ANCHOR_GUIDE}

### スタイリング絶対原則（奥様ダメ出し回避ルール）
1. 同系色・濃紺同士の禁止: 上下ともに濃紺・インディゴになる組み合わせ（例: 濃紺シャツ × 濃紺パンツ）は作業着・パジャマに見えるためNG。
2. 淡青×青デニムの禁止: サックス（淡青）にブルーデニム（ブルー）を合わせると全身が水色で繋がり休日のおじさん感が出るためNG。
3. 淡色×淡色の膨張禁止: 生成り・ベージュシャツに淡いグレージュやライトグレー、白、ベージュのパンツを合わせると輪郭がぼやけて膨張して見えるためNG。
4. 柄×柄の完全禁止: チェック・ストライプ・小紋柄シャツと柄パンツはNG。柄パンツは白無地シャツで消化すること。
5. TPO分離と出社スウェット除外:
   - 出社時: パンツのドレス度3.5以上を優先。スウェット・ジョガー系（ドレス度3.0未満）は出社候補から除外。
   - リモート時: 快適度4.0以上を優先。

### 対象アイテム一覧
【シャツ・トップス（全${shirts.length}着）】
${shirtsList}

【パンツ・ボトムス（全${pants.length}着）】
${pantsList}

### 出力フォーマット指示
必ず以下のJSON形式のみを出力してください。Markdownの説明文や前置きは不要です。
\`\`\`json
{
  "rebuildItems": [
    {
      "id": "S1",
      "category": "shirt",
      "name": "アイテム名（色・柄・特徴を端的に表現）",
      "color": "確定13色パレットから厳選した1色",
      "isOuterwear": false,
      "seasonSleeve": "長袖・通年 または 春夏・半袖 または 秋冬 など",
      "dressScore": 3.5,
      "comfortScore": 4.0,
      "notes": "着用シーンや素材・シルエットの特徴",
      "officeRecommendIds": ["P3", "P8"],
      "remoteRecommendIds": ["P1", "P2"],
      "ngIds": ["P5"],
      "ngReason": "NGの理由（同系色衝突、柄×柄など）"
    }
  ]
}
\`\`\`

※注意事項:
- isOuterwear はシャツのうち、カーディガン・ジップアップ・ジップパーカー・ニットジャケット等の羽織り系なら true、1枚着なら false を指定してください（パンツは false または省略）。
- officeRecommendIds, remoteRecommendIds, ngIds に指定する相手IDは実在する相手カテゴリのIDのみ（シャツにはパンツのID、パンツにはシャツのID）。
- 同一のIDが recommendIds と ngIds の双方に重複して存在しないようにしてください。`;
}

/**
 * ユーザーが貼り付けたリビルドJSONを検証・パースする純粋関数
 */
export function parseRebuildInputJson(
  jsonStr: string,
  existingItems?: ClosetItem[]
): {
  valid: boolean;
  items?: RebuildCandidateItem[];
  error?: string;
} {
  if (!jsonStr || typeof jsonStr !== 'string') {
    return { valid: false, error: '入力データが空です。' };
  }

  // Markdownのコードフェンス（```json ... ```）を除去
  let cleaned = jsonStr.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return { valid: false, error: `JSONパースエラー: ${(err as Error).message}` };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, error: 'JSONのルートがオブジェクトまたは配列ではありません。' };
  }

  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as any).rebuildItems)
    ? (parsed as any).rebuildItems
    : Array.isArray((parsed as any).items)
    ? (parsed as any).items
    : null;

  if (!rawItems) {
    return { valid: false, error: 'JSONに "rebuildItems" 配列が見つかりません。' };
  }

  if (rawItems.length === 0) {
    return { valid: false, error: 'リビルド対象アイテムの配列が空です。' };
  }

  // 反対カテゴリの有効なID集合（existingItems が渡されている場合）
  const validOppositePantsIds = existingItems
    ? new Set(existingItems.filter((it) => it.category === 'pants').map((it) => it.id))
    : null;
  const validOppositeShirtIds = existingItems
    ? new Set(existingItems.filter((it) => it.category === 'shirt').map((it) => it.id))
    : null;

  const validatedItems: RebuildCandidateItem[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    if (!raw || typeof raw !== 'object') {
      return { valid: false, error: `rebuildItems[${i}] の形式がオブジェクトではありません。` };
    }

    const id = typeof raw.id === 'string' ? raw.id.trim().toUpperCase() : '';
    if (!id || (!id.startsWith('S') && !id.startsWith('P'))) {
      return { valid: false, error: `rebuildItems[${i}] の ID "${raw.id}" が不正です (Sxx または Pxx)。` };
    }

    if (seenIds.has(id)) {
      return { valid: false, error: `ID "${id}" が重複して指定されています。` };
    }
    seenIds.add(id);

    const category: Category = id.startsWith('S') ? 'shirt' : 'pants';
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;

    // 羽織り分類（シャツのみ有効）
    const isOuterwear = category === 'shirt' && typeof raw.isOuterwear === 'boolean' ? raw.isOuterwear : undefined;

    // 色の検証（ネイビーは濃紺へ自動補正）
    let color: GarmentColor | undefined = undefined;
    if (typeof raw.color === 'string') {
      let trimmedColor = raw.color.trim();
      if (trimmedColor === 'ネイビー') {
        trimmedColor = '濃紺';
      }
      if (isValidGarmentColor(trimmedColor)) {
        color = trimmedColor;
      }
    }

    const seasonSleeve = typeof raw.seasonSleeve === 'string' ? raw.seasonSleeve.trim() : '通年';

    // dressScore / comfortScore: 1.0〜5.0 の有限数のみを有効とし、範囲外・不正値はエラー
    if (
      typeof raw.dressScore !== 'number' ||
      !Number.isFinite(raw.dressScore) ||
      raw.dressScore < 1.0 ||
      raw.dressScore > 5.0
    ) {
      return {
        valid: false,
        error: `アイテム [${id}] の dressScore (${raw.dressScore}) が不正です。1.0〜5.0 の数値を指定してください。`,
      };
    }

    if (
      typeof raw.comfortScore !== 'number' ||
      !Number.isFinite(raw.comfortScore) ||
      raw.comfortScore < 1.0 ||
      raw.comfortScore > 5.0
    ) {
      return {
        valid: false,
        error: `アイテム [${id}] の comfortScore (${raw.comfortScore}) が不正です。1.0〜5.0 の数値を指定してください。`,
      };
    }

    const dressScore = raw.dressScore;
    const comfortScore = raw.comfortScore;

    // measurements: validateGarmentMeasurements を通し、不正な場合は undefined
    const measurements = validateGarmentMeasurements(raw.measurements, category);

    // 相性配列の検証と正規化
    const toStringArray = (arr: unknown): string[] => {
      if (!Array.isArray(arr)) return [];
      return arr.map((x) => String(x).trim().toUpperCase()).filter((x) => x.length > 0);
    };

    const targetOppositeIds = category === 'shirt' ? validOppositePantsIds : validOppositeShirtIds;
    const filterOppositeIds = (ids: string[]): string[] => {
      const res: string[] = [];
      const seen = new Set<string>();
      for (const tid of ids) {
        if (seen.has(tid)) continue;
        seen.add(tid);
        const isOpposite = targetOppositeIds
          ? targetOppositeIds.has(tid)
          : category === 'shirt'
          ? tid.startsWith('P')
          : tid.startsWith('S');
        if (isOpposite) {
          res.push(tid);
        }
      }
      return res;
    };

    // 推薦とNGに同じIDが含まれる場合は、NGを優先して推薦側から除外
    const rawNg = toStringArray(raw.ngIds);
    const ngIds = filterOppositeIds(rawNg);
    const ngSet = new Set(ngIds);

    const rawOffice = toStringArray(raw.officeRecommendIds);
    const officeRecommendIds = filterOppositeIds(rawOffice).filter((tid) => !ngSet.has(tid));

    const rawRemote = toStringArray(raw.remoteRecommendIds);
    const remoteRecommendIds = filterOppositeIds(rawRemote).filter((tid) => !ngSet.has(tid));

    const ngReason = typeof raw.ngReason === 'string' ? raw.ngReason.trim() : '';
    const notes = typeof raw.notes === 'string' ? raw.notes.trim() : '';

    validatedItems.push({
      id,
      category,
      name,
      color,
      isOuterwear,
      seasonSleeve,
      dressScore,
      comfortScore,
      measurements,
      officeRecommendIds,
      remoteRecommendIds,
      ngIds,
      ngReason,
      notes,
    });
  }

  return {
    valid: true,
    items: validatedItems,
  };
}

/**
 * 現行アイテムとリビルド候補アイテムの差分を算出し、保護フラグとデフォルト選択状態を決定する純粋関数
 */
export function computeRebuildDiffs(params: {
  currentItems: ClosetItem[];
  rebuildItems: RebuildCandidateItem[];
}): RebuildItemDiff[] {
  const { currentItems, rebuildItems } = params;
  const currentMap = new Map(currentItems.map((it) => [it.id, it]));
  const diffs: RebuildItemDiff[] = [];

  for (const rebuild of rebuildItems) {
    const current = currentMap.get(rebuild.id);
    if (!current) continue;

    const changedFields: RebuildFieldKey[] = [];

    // 1. name
    if (current.name.trim() !== rebuild.name.trim()) {
      changedFields.push('name');
    }

    // 2. color
    if (rebuild.color && current.color !== rebuild.color) {
      changedFields.push('color');
    }

    // 2.5 isOuterwear (シャツのみ)
    if (current.category === 'shirt' && rebuild.isOuterwear !== undefined && Boolean(current.isOuterwear) !== Boolean(rebuild.isOuterwear)) {
      changedFields.push('isOuterwear');
    }

    // 3. seasonSleeve
    if (current.seasonSleeve !== rebuild.seasonSleeve) {
      changedFields.push('seasonSleeve');
    }

    // 4. scores
    if (current.dressScore !== rebuild.dressScore || current.comfortScore !== rebuild.comfortScore) {
      changedFields.push('scores');
    }

    // 5. measurements
    if (rebuild.measurements && JSON.stringify(current.measurements) !== JSON.stringify(rebuild.measurements)) {
      changedFields.push('measurements');
    }

    // 6. notes
    if ((current.notes || '').trim() !== (rebuild.notes || '').trim()) {
      changedFields.push('notes');
    }

    // 7. compatibility (office, remote, ng, ngReason)
    const arrayEqual = (a: string[] = [], b: string[] = []) => {
      if (a.length !== b.length) return false;
      const sortedA = [...a].sort();
      const sortedB = [...b].sort();
      return sortedA.every((v, i) => v === sortedB[i]);
    };

    const hasNgReasonDiff = (current.ngReason || '').trim() !== (rebuild.ngReason || '').trim();

    if (
      !arrayEqual(current.officeRecommendIds, rebuild.officeRecommendIds) ||
      !arrayEqual(current.remoteRecommendIds, rebuild.remoteRecommendIds) ||
      !arrayEqual(current.ngIds, rebuild.ngIds) ||
      hasNgReasonDiff
    ) {
      changedFields.push('compatibility');
    }

    // 保護判定
    const isColorProtected = Boolean(current.color && isValidGarmentColor(current.color));
    const isMeasurementsProtected = Boolean(current.measurements && Object.keys(current.measurements).length > 0);

    // デフォルト選択状態（確定色や既存実寸はデフォルトで保護＝OFF）
    const defaultSelection: RebuildFieldSelection = {
      name: changedFields.includes('name'),
      color: changedFields.includes('color') && !isColorProtected,
      isOuterwear: changedFields.includes('isOuterwear'),
      seasonSleeve: changedFields.includes('seasonSleeve'),
      scores: changedFields.includes('scores'),
      measurements: changedFields.includes('measurements') && !isMeasurementsProtected,
      notes: changedFields.includes('notes'),
      compatibility: changedFields.includes('compatibility'),
    };

    // 仮想的な after アイテム
    const afterItem: ClosetItem = {
      ...current,
      name: rebuild.name,
      color: rebuild.color || current.color,
      isOuterwear: current.category === 'shirt' && rebuild.isOuterwear !== undefined ? rebuild.isOuterwear : current.isOuterwear,
      seasonSleeve: rebuild.seasonSleeve,
      dressScore: rebuild.dressScore,
      comfortScore: rebuild.comfortScore,
      notes: rebuild.notes,
      officeRecommendIds: rebuild.officeRecommendIds,
      remoteRecommendIds: rebuild.remoteRecommendIds,
      ngIds: rebuild.ngIds,
      ngReason: rebuild.ngReason,
      measurements: rebuild.measurements || current.measurements,
    };

    diffs.push({
      id: current.id,
      category: current.category,
      before: current,
      after: afterItem,
      changedFields,
      isColorProtected,
      isMeasurementsProtected,
      defaultSelection,
    });
  }

  return diffs;
}

/**
 * ユーザーが選択したフィールド差分を ClosetData に適用する純粋関数
 */
export function applyRebuildDiffs(params: {
  closetData: ClosetData;
  diffs: RebuildItemDiff[];
  fieldSelections: Record<string, RebuildFieldSelection>;
}): RebuildApplyResult {
  const { closetData, diffs, fieldSelections } = params;
  if (!diffs || diffs.length === 0) {
    return { valid: false, error: '差分データが空です。', appliedItemsCount: 0 };
  }

  const diffMap = new Map(diffs.map((d) => [d.id, d]));
  let appliedItemsCount = 0;

  const updatedItems: ClosetItem[] = closetData.items.map((it) => {
    const diff = diffMap.get(it.id);
    if (!diff) return it;

    const selection = fieldSelections[it.id] || diff.defaultSelection;
    let modified = false;

    const newItem: ClosetItem = { ...it };

    if (selection.name && diff.after.name !== it.name) {
      newItem.name = diff.after.name;
      modified = true;
    }

    if (selection.color && diff.after.color && diff.after.color !== it.color) {
      newItem.color = diff.after.color;
      modified = true;
    }

    if (selection.isOuterwear && diff.after.isOuterwear !== it.isOuterwear) {
      if (it.category === 'shirt') {
        newItem.isOuterwear = diff.after.isOuterwear ? true : undefined;
        modified = true;
      }
    }

    if (selection.seasonSleeve && diff.after.seasonSleeve !== it.seasonSleeve) {
      newItem.seasonSleeve = diff.after.seasonSleeve;
      modified = true;
    }

    if (selection.scores) {
      if (diff.after.dressScore !== it.dressScore || diff.after.comfortScore !== it.comfortScore) {
        newItem.dressScore = diff.after.dressScore;
        newItem.comfortScore = diff.after.comfortScore;
        modified = true;
      }
    }

    if (selection.measurements && diff.after.measurements) {
      newItem.measurements = diff.after.measurements;
      modified = true;
    }

    if (selection.notes && diff.after.notes !== it.notes) {
      newItem.notes = diff.after.notes;
      modified = true;
    }

    if (selection.compatibility) {
      newItem.officeRecommendIds = diff.after.officeRecommendIds;
      newItem.remoteRecommendIds = diff.after.remoteRecommendIds;
      newItem.ngIds = diff.after.ngIds;
      newItem.ngReason = diff.after.ngReason;
      modified = true;
    }

    if (modified) {
      appliedItemsCount++;
    }

    return newItem;
  });

  return {
    valid: true,
    data: {
      ...closetData,
      items: updatedItems,
      updatedAt: Date.now(),
    },
    appliedItemsCount,
  };
}

/**
 * リビルド回答文字列（JSONまたはMarkdownコードフェンス付き）を検証し、
 * 全件完全性チェック（全アイテムの不足・余分なし）と差分計算を行う純粋関数。
 * テキスト貼り付け・ファイル取り込み共通の検証パイプラインとして機能する。
 */
export function validateAndBuildRebuildDiffs(
  rawText: string,
  currentItems: ClosetItem[]
): RebuildValidationResult {
  if (!rawText || !rawText.trim()) {
    return {
      valid: false,
      error: '入力内容が空です。Geminiの回答JSONを指定してください。',
    };
  }

  const parsed = parseRebuildInputJson(rawText, currentItems);
  if (!parsed.valid || !parsed.items) {
    return {
      valid: false,
      error: parsed.error || 'JSONの解析に失敗しました。',
    };
  }

  // 全件の完全性チェック: Gemini 回答のID集合がリビルド対象のID集合と完全一致するか（不足・余分・重複なし）
  const targetItemIds = currentItems.map((it) => it.id);
  const targetIdSet = new Set(targetItemIds);
  const parsedItemIds = parsed.items.map((it) => it.id);
  const parsedIdSet = new Set(parsedItemIds);

  const missingIds = targetItemIds.filter((id) => !parsedIdSet.has(id));
  const extraIds = parsedItemIds.filter((id) => !targetIdSet.has(id));

  if (missingIds.length > 0 || extraIds.length > 0) {
    const errorParts: string[] = [];
    if (missingIds.length > 0) {
      errorParts.push(`不足しているアイテムID (${missingIds.length}着): ${missingIds.join(', ')}`);
    }
    if (extraIds.length > 0) {
      errorParts.push(`対象外の余分なアイテムID (${extraIds.length}着): ${extraIds.join(', ')}`);
    }
    return {
      valid: false,
      error: `リビルド対象（全${targetItemIds.length}着）と回答内容が完全一致しません。\n${errorParts.join('\n')}`,
    };
  }

  const diffs = computeRebuildDiffs({
    currentItems,
    rebuildItems: parsed.items,
  });

  return {
    valid: true,
    diffs,
    items: parsed.items,
  };
}

