import React, { useState, useEffect } from 'react';
import { ClosetItem } from '../types/closet';
import { getImageBlob } from '../utils/imageStore';

interface ItemImageProps {
  item: ClosetItem;
  className?: string;
  imgClassName?: string;
  showBadge?: boolean;
}

// Map garment names to realistic aesthetic colors for SVG fallback
function getColorForGarment(name: string, category: 'shirt' | 'pants'): { fill: string; stroke: string; accent: string } {
  const n = name.toLowerCase();
  if (n.includes('白無地') || n.includes('白地') || n.includes('白×')) {
    return { fill: '#f8fafc', stroke: '#cbd5e1', accent: '#3b82f6' };
  }
  if (n.includes('濃インディゴ') || n.includes('濃ネイビ') || n.includes('濃紺')) {
    return { fill: '#1e293b', stroke: '#0f172a', accent: '#60a5fa' };
  }
  if (n.includes('サックス') || n.includes('淡青')) {
    return { fill: '#bae6fd', stroke: '#7dd3fc', accent: '#0284c7' };
  }
  if (n.includes('生成り')) {
    return { fill: '#fef08a', stroke: '#fde047', accent: '#a16207' };
  }
  if (n.includes('グレージュ') || n.includes('ライトグレー')) {
    return { fill: '#cbd5e1', stroke: '#94a3b8', accent: '#475569' };
  }
  if (n.includes('オリーブ')) {
    return { fill: '#3f6212', stroke: '#365314', accent: '#84cc16' };
  }
  if (n.includes('チャコール') || n.includes('ミディアムグレー')) {
    return { fill: '#475569', stroke: '#334155', accent: '#94a3b8' };
  }
  if (n.includes('黒')) {
    return { fill: '#09090b', stroke: '#27272a', accent: '#71717a' };
  }
  if (n.includes('ブルーデニム') || n.includes('ブルーウォッシュ')) {
    return { fill: '#38bdf8', stroke: '#0284c7', accent: '#0369a1' };
  }

  return category === 'shirt'
    ? { fill: '#e2e8f0', stroke: '#cbd5e1', accent: '#2563eb' }
    : { fill: '#334155', stroke: '#1e293b', accent: '#38bdf8' };
}

export const ItemImage: React.FC<ItemImageProps> = ({
  item,
  className = '',
  imgClassName = '',
  showBadge = true,
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobError, setBlobError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);
  const colors = getColorForGarment(item.name, item.category);

  // 1. IndexedDB から Blob を非同期取得して ObjectURL を発行 (決定5・仕様5)
  useEffect(() => {
    let isMounted = true;
    let currentUrl: string | null = null;

    setBlobError(false);
    getImageBlob(item.id)
      .then((blob) => {
        if (!isMounted) return;
        if (blob) {
          currentUrl = URL.createObjectURL(blob);
          setBlobUrl(currentUrl);
        } else {
          setBlobUrl(null);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn(`[ItemImage] Failed to load image from IndexedDB for ${item.id}:`, err);
        setBlobUrl(null);
      });

    return () => {
      isMounted = false;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [item.id]);

  // 2. 移行期間フォールバック用: 既存の imageUrl を解決 (Vite BASE_URL 考慮)
  const fallbackImageUrl = (() => {
    if (!item.imageUrl) return '';
    if (item.imageUrl.startsWith('http://') || item.imageUrl.startsWith('https://')) {
      return item.imageUrl;
    }
    const baseUrl = import.meta.env.BASE_URL || '/';
    const cleanPath = item.imageUrl.startsWith('/') ? item.imageUrl.slice(1) : item.imageUrl;
    return `${baseUrl}${cleanPath}`;
  })();

  // 3段階優先順位解決 (1. Blob URL -> 2. 既存 imageUrl -> 3. SVG フォールバック)
  // 指摘A対応: Blob用と fallback用のエラー状態を完全分離し、Blobがfallbackエラーに影響されないようにする
  const shouldUseBlob = Boolean(blobUrl && !blobError);
  const shouldUseFallback = Boolean(!shouldUseBlob && fallbackImageUrl && !fallbackError);
  const activeImageSrc = shouldUseBlob ? blobUrl : (shouldUseFallback ? fallbackImageUrl : '');

  const handleImageError = () => {
    if (shouldUseBlob) {
      setBlobError(true);
    } else {
      setFallbackError(true);
    }
  };

  return (
    <div className={`relative overflow-hidden bg-slate-800/80 rounded-xl flex items-center justify-center ${className}`}>
      {activeImageSrc ? (
        <img
          src={activeImageSrc}
          alt={item.name}
          className={`w-full h-full object-contain transition-transform duration-300 ${imgClassName}`}
          onError={handleImageError}
          loading="lazy"
        />
      ) : (
        /* Fallback SVG with high fidelity garment silhouette */
        <div className="w-full h-full flex flex-col items-center justify-center p-2 bg-gradient-to-b from-slate-800 to-slate-900">
          <svg viewBox="0 0 100 100" className="w-4/5 h-4/5 max-h-24 drop-shadow-md">
            {item.category === 'shirt' ? (
              <g>
                {/* Shirt Body */}
                <path
                  d="M32 20 L40 28 L60 28 L68 20 L84 34 L74 46 L68 40 L68 84 L32 84 L32 40 L26 46 L16 34 Z"
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                {/* Collar */}
                <path
                  d="M40 28 L50 40 L60 28 L50 22 Z"
                  fill={colors.stroke}
                  stroke={colors.accent}
                  strokeWidth="1.5"
                />
                {/* Placket */}
                <line x1="50" y1="40" x2="50" y2="84" stroke={colors.accent} strokeWidth="1.5" strokeDasharray="1 6" />
              </g>
            ) : (
              <g>
                {/* Pants Body */}
                <path
                  d="M30 22 L70 22 L72 32 L66 86 L53 86 L50 42 L47 86 L34 86 L28 32 Z"
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                {/* Waistband */}
                <line x1="30" y1="26" x2="70" y2="26" stroke={colors.accent} strokeWidth="2" />
                {/* Pockets */}
                <line x1="34" y1="30" x2="42" y2="38" stroke={colors.accent} strokeWidth="1" />
                <line x1="66" y1="30" x2="58" y2="38" stroke={colors.accent} strokeWidth="1" />
              </g>
            )}
          </svg>
          <span className="text-[10px] text-slate-400 font-medium tracking-tight mt-1 truncate max-w-full px-1">
            {item.id}
          </span>
        </div>
      )}

      {showBadge && (
        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-slate-900/80 backdrop-blur-md text-white border border-slate-700 shadow-sm">
          {item.id}
        </span>
      )}
    </div>
  );
};
