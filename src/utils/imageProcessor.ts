import type {
  GarmentCropBox,
  UploadImageRequest,
  UploadImageResponse,
  DeleteImagesRequest,
  DeleteImagesResponse,
  ClosetItem,
} from '../types/closet';

function normalizeCropBoxInternal(val: unknown): GarmentCropBox | undefined {
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
 * 登録写真の標準キャンバス仕様 (縦長 3:4、900×1200px)
 */
export const STANDARD_IMAGE_WIDTH = 900;
export const STANDARD_IMAGE_HEIGHT = 1200;
export const STANDARD_STUDIO_BG_COLOR = '#f8fafc';

export interface CropPlacementResult {
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  destX: number;
  destY: number;
  destW: number;
  destH: number;
  canvasWidth: number;
  canvasHeight: number;
  isCropped: boolean;
}

/**
 * 元画像寸法と正規化座標 (0〜1000) から、3:4キャンバスへの切り抜き描画座標を計算する純粋関数
 * - cropBox が有効な場合: 指定矩形に marginRatio (デフォルト 6%) を加えた領域を切り抜き、中央配置
 * - cropBox が無効/未指定の場合: 元画像全体をアスペクト比維持 (contain) で中央配置 (フォールバック)
 */
export function calculateCropAndPlacement(
  imgWidth: number,
  imgHeight: number,
  cropBox?: GarmentCropBox | null,
  marginRatio = 0.06,
  canvasWidth = STANDARD_IMAGE_WIDTH,
  canvasHeight = STANDARD_IMAGE_HEIGHT
): CropPlacementResult {
  const safeImgW = Math.max(1, imgWidth);
  const safeImgH = Math.max(1, imgHeight);

  const normalized = normalizeCropBoxInternal(cropBox);

  if (normalized) {
    const boxW = normalized.xmax - normalized.xmin;
    const boxH = normalized.ymax - normalized.ymin;
    const xPad = Math.round(boxW * marginRatio);
    const yPad = Math.round(boxH * marginRatio);

    const normYmin = Math.max(0, normalized.ymin - yPad);
    const normXmin = Math.max(0, normalized.xmin - xPad);
    const normYmax = Math.min(1000, normalized.ymax + yPad);
    const normXmax = Math.min(1000, normalized.xmax + xPad);

    let srcX = Math.round((normXmin / 1000) * safeImgW);
    let srcY = Math.round((normYmin / 1000) * safeImgH);
    let srcW = Math.max(1, Math.round(((normXmax - normXmin) / 1000) * safeImgW));
    let srcH = Math.max(1, Math.round(((normYmax - normYmin) / 1000) * safeImgH));

    if (srcX + srcW > safeImgW) srcW = Math.max(1, safeImgW - srcX);
    if (srcY + srcH > safeImgH) srcH = Math.max(1, safeImgH - srcY);

    const scale = Math.min(canvasWidth / srcW, canvasHeight / srcH);
    const destW = Math.round(srcW * scale);
    const destH = Math.round(srcH * scale);
    const destX = Math.round((canvasWidth - destW) / 2);
    const destY = Math.round((canvasHeight - destH) / 2);

    return {
      srcX,
      srcY,
      srcW,
      srcH,
      destX,
      destY,
      destW,
      destH,
      canvasWidth,
      canvasHeight,
      isCropped: true,
    };
  }

  // フォールバック: 元画像全体をアスペクト比維持で中央に配置
  const scale = Math.min(canvasWidth / safeImgW, canvasHeight / safeImgH);
  const destW = Math.round(safeImgW * scale);
  const destH = Math.round(safeImgH * scale);
  const destX = Math.round((canvasWidth - destW) / 2);
  const destY = Math.round((canvasHeight - destH) / 2);

  return {
    srcX: 0,
    srcY: 0,
    srcW: safeImgW,
    srcH: safeImgH,
    destX,
    destY,
    destW,
    destH,
    canvasWidth,
    canvasHeight,
    isCropped: false,
  };
}

/**
 * 服の登録写真を 3:4 (900×1200px) の統一規格へ自動切り抜き・正規化する
 * - cropBox がある場合: A4用紙や背景を除いた服領域＋6%余白で切り抜き、#f8fafc キャンバスの中央に配置
 * - cropBox が無い場合: 元画像全体を余白付きで 3:4 キャンバスの中央に収める (フォールバック)
 */
export async function cropAndNormalizeGarmentImage(
  sourceDataUrl: string,
  cropBox?: GarmentCropBox | null,
  marginRatio = 0.06,
  quality = 0.85
): Promise<{ blob: Blob; dataUrl: string; width: number; height: number; isCropped: boolean }> {
  if (typeof document === 'undefined') {
    // 非ブラウザ環境では明示的に失敗させる（空 Blob を成功扱いしない）
    return Promise.reject(new Error('画像の正規化にはブラウザ環境（Canvas）が必要です'));
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('切り抜き対象画像の読み込み・デコードに失敗しました'));
    img.onload = () => {
      const placement = calculateCropAndPlacement(
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        cropBox,
        marginRatio,
        STANDARD_IMAGE_WIDTH,
        STANDARD_IMAGE_HEIGHT
      );

      const canvas = document.createElement('canvas');
      canvas.width = STANDARD_IMAGE_WIDTH;
      canvas.height = STANDARD_IMAGE_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D コンテキストの取得に失敗しました'));
        return;
      }

      // クリーンなスタジオ背景 (#f8fafc) で塗りつぶし
      ctx.fillStyle = STANDARD_STUDIO_BG_COLOR;
      ctx.fillRect(0, 0, STANDARD_IMAGE_WIDTH, STANDARD_IMAGE_HEIGHT);

      // 切り抜き領域を描画
      ctx.drawImage(
        img,
        placement.srcX,
        placement.srcY,
        placement.srcW,
        placement.srcH,
        placement.destX,
        placement.destY,
        placement.destW,
        placement.destH
      );

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('切り抜き JPEG Blob の生成に失敗しました'));
            return;
          }
          resolve({
            blob,
            dataUrl,
            width: STANDARD_IMAGE_WIDTH,
            height: STANDARD_IMAGE_HEIGHT,
            isCropped: placement.isCropped,
          });
        },
        'image/jpeg',
        quality
      );
    };
    img.src = sourceDataUrl;
  });
}

/**
 * ユーザーが選択した画像ファイルをリサイズ・JPEG圧縮して正規化する
 * - 長辺最大 maxDimension (デフォルト 1200px)
 * - MIME: image/jpeg, quality 0.85 (目安 100〜300KB)
 */
export async function processGarmentImage(
  file: File,
  maxDimension = 1200,
  quality = 0.85
): Promise<{ blob: Blob; dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像の読み込み・デコードに失敗しました'));
      img.onload = () => {
        let { width, height } = img;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D コンテキストの取得に失敗しました'));
          return;
        }

        // 白背景で塗りつぶし（透過 PNG を JPEG 化する際の黒化を防止）
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('JPEG Blob の生成に失敗しました'));
              return;
            }
            resolve({ blob, dataUrl, width, height });
          },
          'image/jpeg',
          quality
        );
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * GAS Web App へ画像を直接アップロードする (action: 'uploadImage')
 * - 条件1: token による Fail-Closed 認証が必須
 * - 条件2: 保存先フォルダはサーバー側 meta_config の imageFolderId を強制使用
 */
export async function uploadImageToGas(params: {
  webAppUrl: string;
  secretToken?: string;
  itemId: string;
  dataUrl: string;
}): Promise<UploadImageResponse> {
  const { webAppUrl, secretToken, itemId, dataUrl } = params;

  if (!webAppUrl || !webAppUrl.startsWith('http')) {
    return { ok: false, error: 'GAS Web App URL が設定されていません' };
  }

  // data:image/jpeg;base64,XXXX から純粋な base64 文字列を抽出
  const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

  const payload: UploadImageRequest = {
    action: 'uploadImage',
    token: secretToken || undefined,
    itemId,
    mimeType: 'image/jpeg',
    base64Data,
  };

  try {
    const res = await fetch(webAppUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });

    if (!res.ok) {
      return { ok: false, error: `HTTPエラー ${res.status}` };
    }

    const data: UploadImageResponse = await res.json();
    return data;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '画像アップロード通信エラー';
    return { ok: false, error: message };
  }
}

/**
 * Blob を指定ファイル名で端末にダウンロード保存する
 */
export function downloadBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 画像 Blob から SHA-256 ハッシュ（完全一致用）および 64-bit dHash（類似検出用）を算出する純粋非同期関数
 */
export async function computeImageHashesFromBlob(
  blob: Blob
): Promise<{ sha256: string; dhash: string }> {
  // 1. SHA-256 の計算
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const sha256 = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // 2. dHash (Difference Hash) 64-bit の計算
  // 9x8 グレースケール画像に描画し、各行で隣接ピクセル (左 > 右) を比較
  let dhash = '';
  if (typeof document !== 'undefined') {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(blob);
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = (e) => {
          URL.revokeObjectURL(url);
          reject(e);
        };
        image.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = 9;
      canvas.height = 8;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, 9, 8);
        const imgData = ctx.getImageData(0, 0, 9, 8);
        const data = imgData.data;

        // 各ピクセルの輝度 (Y = 0.299R + 0.587G + 0.114B)
        const gray: number[][] = [];
        for (let y = 0; y < 8; y++) {
          gray[y] = [];
          for (let x = 0; x < 9; x++) {
            const idx = (y * 9 + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            gray[y][x] = 0.299 * r + 0.587 * g + 0.114 * b;
          }
        }

        // 64ビットのビット列を生成
        let bitStr = '';
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            bitStr += gray[y][x] > gray[y][x + 1] ? '1' : '0';
          }
        }

        // 64ビット 2進数を 16進数 16文字に変換
        let hex = '';
        for (let i = 0; i < 64; i += 4) {
          const nibble = parseInt(bitStr.slice(i, i + 4), 2);
          hex += nibble.toString(16);
        }
        dhash = hex;
      }
    } catch {
      // ブラウザ以外や画像破損フォールバック
      dhash = sha256.slice(0, 16);
    }
  }

  return { sha256, dhash: dhash || sha256.slice(0, 16) };
}

export interface RebuildContactSheetResult {
  sheetIndex: number;
  totalSheets: number;
  itemIds: string[];
  blob: Blob;
  dataUrl: string;
}

/**
 * フル見直し用のコンタクトシート（1枚あたり最大12着、3列×4行、IDラベル付き）を Canvas で合成生成する
 */
export async function generateRebuildContactSheets(
  items: ClosetItem[],
  imageBlobs: Map<string, Blob>,
  maxPerSheet = 12,
  quality = 0.85
): Promise<RebuildContactSheetResult[]> {
  if (typeof document === 'undefined') {
    throw new Error('コンタクトシートの生成にはブラウザ環境が必要です');
  }

  if (!items || items.length === 0) {
    return [];
  }

  const results: RebuildContactSheetResult[] = [];
  const totalSheets = Math.ceil(items.length / maxPerSheet);

  const COLS = 3;
  const ROWS = 4;
  const SHEET_WIDTH = 1800;
  const SHEET_HEIGHT = 2400;
  const CELL_WIDTH = SHEET_WIDTH / COLS;   // 600px
  const CELL_HEIGHT = SHEET_HEIGHT / ROWS; // 600px
  const BADGE_HEIGHT = 70;

  for (let s = 0; s < totalSheets; s++) {
    const chunk = items.slice(s * maxPerSheet, (s + 1) * maxPerSheet);
    const canvas = document.createElement('canvas');
    canvas.width = SHEET_WIDTH;
    canvas.height = SHEET_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D コンテキストの取得に失敗しました');
    }

    // 全体背景（薄いグレー）
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT);

    for (let i = 0; i < chunk.length; i++) {
      const item = chunk[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cellX = col * CELL_WIDTH;
      const cellY = row * CELL_HEIGHT;

      // セル枠線と白背景
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cellX + 10, cellY + 10, CELL_WIDTH - 20, CELL_HEIGHT - 20);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.strokeRect(cellX + 10, cellY + 10, CELL_WIDTH - 20, CELL_HEIGHT - 20);

      // 1. 上部 ID ラベルバッジ（黒地、白太字）
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(cellX + 10, cellY + 10, CELL_WIDTH - 20, BADGE_HEIGHT);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelText = `[${item.id}] ${item.name.slice(0, 15)}`;
      ctx.fillText(labelText, cellX + CELL_WIDTH / 2, cellY + 10 + BADGE_HEIGHT / 2);

      // 2. 服画像の描画
      const blob = imageBlobs.get(item.id);
      if (blob) {
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            const url = URL.createObjectURL(blob);
            image.onload = () => {
              URL.revokeObjectURL(url);
              resolve(image);
            };
            image.onerror = (e) => {
              URL.revokeObjectURL(url);
              reject(e);
            };
            image.src = url;
          });

          // 画像表示領域 (CELL_WIDTH - 40, CELL_HEIGHT - BADGE_HEIGHT - 40)
          const availW = CELL_WIDTH - 40;
          const availH = CELL_HEIGHT - BADGE_HEIGHT - 40;
          const imgW = img.naturalWidth || img.width || 1;
          const imgH = img.naturalHeight || img.height || 1;
          const scale = Math.min(availW / imgW, availH / imgH);
          const drawW = imgW * scale;
          const drawH = imgH * scale;
          const drawX = cellX + 20 + (availW - drawW) / 2;
          const drawY = cellY + 10 + BADGE_HEIGHT + 10 + (availH - drawH) / 2;

          ctx.drawImage(img, drawX, drawY, drawW, drawH);
        } catch {
          // 画像ロード失敗時
          ctx.fillStyle = '#94a3b8';
          ctx.font = '24px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('画像読込エラー', cellX + CELL_WIDTH / 2, cellY + CELL_HEIGHT / 2);
        }
      } else {
        // 画像未登録時
        ctx.fillStyle = '#94a3b8';
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('（写真未登録）', cellX + CELL_WIDTH / 2, cellY + CELL_HEIGHT / 2);
      }
    }

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('コンタクトシートの Blob 生成に失敗しました'));
        },
        'image/jpeg',
        quality
      );
    });

    results.push({
      sheetIndex: s + 1,
      totalSheets,
      itemIds: chunk.map((it) => it.id),
      blob,
      dataUrl,
    });
  }

  return results;
}

/**
 * GAS Web App へ画像削除リクエストを送信する (action: 'deleteImages')
 */
export async function deleteImagesFromGas(params: {
  webAppUrl: string;
  secretToken?: string;
  itemIds: string[];
}): Promise<DeleteImagesResponse> {
  const { webAppUrl, secretToken, itemIds } = params;

  if (!webAppUrl || !webAppUrl.startsWith('http')) {
    return { ok: false, error: 'GAS Web App URL が設定されていません' };
  }

  if (!itemIds || itemIds.length === 0) {
    return { ok: true, deletedItemIds: [] };
  }

  const payload: DeleteImagesRequest = {
    action: 'deleteImages',
    token: secretToken || undefined,
    itemIds,
  };

  try {
    const res = await fetch(webAppUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });

    if (!res.ok) {
      return { ok: false, error: `HTTPエラー ${res.status}` };
    }

    const data: DeleteImagesResponse = await res.json();
    return data;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '画像削除通信エラー';
    return { ok: false, error: message };
  }
}
