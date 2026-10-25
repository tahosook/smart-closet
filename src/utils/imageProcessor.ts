import { UploadImageRequest, UploadImageResponse } from '../types/closet';

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
