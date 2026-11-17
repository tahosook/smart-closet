interface Env {
  GAS_WEB_APP_URL?: string;
  GAS_SECRET_TOKEN?: string;
  /**
   * カンマ区切りの許可メールアドレス一覧（必須）
   * 例: "tahosook@gmail.com"（将来家族共有時は "tahosook@gmail.com,family@example.com"）
   */
  ALLOWED_EMAILS?: string;
  /**
   * Cloudflare Access チームドメイン（必須）
   * 例: "https://smart-closet-djw-pages.cloudflareaccess.com"
   */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /**
   * Cloudflare Access Application Audience (AUD) Tag（必須）
   */
  CF_ACCESS_AUD?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
  fetchFn?: typeof fetch;
  nowMs?: number;
}

interface JwksCacheEntry {
  fetchedAt: number;
  keysByKid: Map<string, JsonWebKey>;
}

type JwtVerifyResult =
  | { ok: true; email: string }
  | { ok: false; status: number; error: string };

const NO_STORE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
};

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SEC = 60;
const jwksCache = new Map<string, JwksCacheEntry>();

export const clearJwksCache = (): void => {
  jwksCache.clear();
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function jsonError(status: number, error: string): Response {
  return jsonResponse({ ok: false, error }, status);
}

function normalizeTeamDomain(raw?: string): string | null {
  const trimmed = raw?.trim().replace(/\/+$/, '') || '';
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname.endsWith('.cloudflareaccess.com') ||
      parsed.hostname.length <= '.cloudflareaccess.com'.length ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function extractAccessJwt(request: Request): string | null {
  const headerJwt = request.headers.get('Cf-Access-Jwt-Assertion')?.trim();
  if (headerJwt) {
    return headerJwt;
  }

  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = part.slice(0, eqIdx).trim();
    if (name !== 'CF_Authorization') continue;
    const rawValue = part.slice(eqIdx + 1).trim();
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function decodeBase64UrlToBytes(input: string): Uint8Array | null {
  if (!input || !/^[A-Za-z0-9_-]+$/.test(input) || input.length % 4 === 1) {
    return null;
  }
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function decodeBase64UrlJson(input: string): Record<string, unknown> | null {
  const bytes = decodeBase64UrlToBytes(input);
  if (!bytes) return null;
  try {
    const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(jsonText);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchJwksForTeam(
  teamDomain: string,
  fetchImpl: typeof fetch,
  nowMs: number
): Promise<Map<string, JsonWebKey>> {
  const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetchImpl(certsUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`JWKS fetch failed with status ${res.status}`);
  }

  const data: unknown = await res.json();
  if (data === null || typeof data !== 'object' || !Array.isArray((data as { keys?: unknown }).keys)) {
    throw new Error('Invalid JWKS payload');
  }

  const keysByKid = new Map<string, JsonWebKey>();
  for (const rawKey of (data as { keys: unknown[] }).keys) {
    if (rawKey === null || typeof rawKey !== 'object') continue;
    const key = rawKey as JsonWebKey & { kid?: unknown; use?: unknown };
    const kid = typeof key.kid === 'string' ? key.kid.trim() : '';
    if (!kid) continue;
    if (key.kty !== 'RSA' || typeof key.n !== 'string' || typeof key.e !== 'string') continue;
    if (key.alg && key.alg !== 'RS256') continue;
    if (key.use && key.use !== 'sig') continue;
    keysByKid.set(kid, key);
  }

  if (keysByKid.size === 0) {
    throw new Error('No usable RSA keys in JWKS');
  }

  jwksCache.set(teamDomain, { fetchedAt: nowMs, keysByKid });
  return keysByKid;
}

async function getSigningKeyByKid(
  teamDomain: string,
  kid: string,
  fetchImpl: typeof fetch,
  nowMs: number
): Promise<JsonWebKey | null> {
  const cached = jwksCache.get(teamDomain);
  if (cached && nowMs - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    const cachedKey = cached.keysByKid.get(kid);
    if (cachedKey) {
      return cachedKey;
    }
  }

  // キャッシュ未命中・期限切れ・鍵ローテーション(未知の kid)時は最新の公開鍵を取得
  const freshKeys = await fetchJwksForTeam(teamDomain, fetchImpl, nowMs);
  return freshKeys.get(kid) ?? null;
}

async function verifyAccessJwt(params: {
  token: string;
  teamDomain: string;
  aud: string;
  fetchImpl: typeof fetch;
  nowMs: number;
}): Promise<JwtVerifyResult> {
  const { token, teamDomain, aud, fetchImpl, nowMs } = params;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { ok: false, status: 401, error: 'Unauthorized: Invalid Access JWT format' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeBase64UrlJson(headerB64);
  const payload = decodeBase64UrlJson(payloadB64);
  if (!header || !payload) {
    return { ok: false, status: 401, error: 'Unauthorized: Malformed Access JWT' };
  }

  const kid = typeof header.kid === 'string' ? header.kid.trim() : '';
  if (header.alg !== 'RS256' || !kid) {
    return { ok: false, status: 401, error: 'Unauthorized: Unsupported Access JWT header' };
  }

  const signatureBytes = decodeBase64UrlToBytes(signatureB64);
  if (!signatureBytes) {
    return { ok: false, status: 401, error: 'Unauthorized: Invalid Access JWT signature encoding' };
  }

  let jwk: JsonWebKey | null;
  try {
    jwk = await getSigningKeyByKid(teamDomain, kid, fetchImpl, nowMs);
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'Service Unavailable: Unable to fetch Cloudflare Access public keys',
    };
  }

  if (!jwk) {
    return { ok: false, status: 401, error: 'Unauthorized: Unknown Access signing key' };
  }

  let isValidSignature = false;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signatureCopy = new Uint8Array(signatureBytes);
    isValidSignature = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureCopy,
      signingInput
    );
  } catch {
    isValidSignature = false;
  }

  if (!isValidSignature) {
    return { ok: false, status: 401, error: 'Unauthorized: Invalid Access JWT signature' };
  }

  const iss = typeof payload.iss === 'string' ? payload.iss.trim().replace(/\/+$/, '') : '';
  if (iss !== teamDomain) {
    return { ok: false, status: 401, error: 'Unauthorized: Invalid Access JWT issuer' };
  }

  const audClaim = payload.aud;
  const audMatches =
    (typeof audClaim === 'string' && audClaim === aud) ||
    (Array.isArray(audClaim) && audClaim.some((item) => typeof item === 'string' && item === aud));
  if (!audMatches) {
    return { ok: false, status: 403, error: 'Forbidden: Access JWT audience mismatch' };
  }

  const nowSec = Math.floor(nowMs / 1000);
  if (
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp) ||
    nowSec >= payload.exp + CLOCK_SKEW_SEC
  ) {
    return { ok: false, status: 401, error: 'Unauthorized: Access JWT expired' };
  }

  if (
    payload.nbf !== undefined &&
    (typeof payload.nbf !== 'number' ||
      !Number.isFinite(payload.nbf) ||
      nowSec + CLOCK_SKEW_SEC < payload.nbf)
  ) {
    return { ok: false, status: 401, error: 'Unauthorized: Access JWT not yet valid' };
  }

  const jwtEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!jwtEmail) {
    return { ok: false, status: 401, error: 'Unauthorized: Access JWT missing email claim' };
  }

  return { ok: true, email: jwtEmail };
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const { request, env } = context;
  const fetchImpl = context.fetchFn ?? globalThis.fetch;
  const nowMs = context.nowMs ?? Date.now();

  // 1. Production 環境変数の存在・形式確認 (Fail-Closed)
  // Preview 環境など Secret が未登録の環境では 404 を返し、手入力へフォールバックさせる
  const webAppUrl = env.GAS_WEB_APP_URL?.trim() || '';
  const secretToken = env.GAS_SECRET_TOKEN?.trim() || '';
  const rawAllowedEmails = env.ALLOWED_EMAILS?.trim() || '';
  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const accessAud = env.CF_ACCESS_AUD?.trim() || '';

  if (
    !webAppUrl ||
    !webAppUrl.startsWith('https://script.google.com/') ||
    !secretToken ||
    !rawAllowedEmails ||
    !teamDomain ||
    !accessAud
  ) {
    return jsonError(404, 'Bootstrap configuration is not enabled in this environment');
  }

  // 2. Cloudflare Access JWT (Cf-Access-Jwt-Assertion 優先、フォールバックとして CF_Authorization Cookie) の抽出
  const accessJwt = extractAccessJwt(request);
  if (!accessJwt) {
    return jsonError(401, 'Unauthorized: Cloudflare Access JWT required');
  }

  // 3. Access JWT の RS256 署名検証および iss / aud / exp / nbf / email クレーム検証
  const jwtResult = await verifyAccessJwt({
    token: accessJwt,
    teamDomain,
    aud: accessAud,
    fetchImpl,
    nowMs,
  });

  if (!jwtResult.ok) {
    return jsonError(jwtResult.status, jwtResult.error);
  }

  // 4. Cf-Access-Authenticated-User-Email ヘッダーが付与されている場合は JWT 内の email との一致を検証
  const headerEmail =
    request.headers.get('Cf-Access-Authenticated-User-Email')?.trim().toLowerCase() || '';
  if (headerEmail && headerEmail !== jwtResult.email) {
    return jsonError(403, 'Forbidden: Authenticated email header mismatch');
  }

  // 5. 許可メールアドレス一覧 (ALLOWED_EMAILS) との必須照合
  const allowedSet = new Set(
    rawAllowedEmails
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!allowedSet.has(jwtResult.email)) {
    return jsonError(403, 'Forbidden: User email is not permitted');
  }

  return jsonResponse(
    {
      ok: true,
      webAppUrl,
      secretToken,
      userEmail: jwtResult.email,
    },
    200
  );
};
