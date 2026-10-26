import type { GarmentCropBox, UploadImageRequest, UploadImageResponse } from '../types/closet';

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
