interface Env {
  GAS_WEB_APP_URL?: string;
  GAS_SECRET_TOKEN?: string;
  /**
   * カンマ区切りの許可メールアドレス一覧（必須）
   * 例: "tahosook@gmail.com"（将来家族共有時は "tahosook@gmail.com,family@example.com"）
   */
  ALLOWED_EMAILS?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

const NO_STORE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
};

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const { request, env } = context;

  // 1. Production 環境変数の存在確認
  // Preview 環境など Secret (GAS_WEB_APP_URL / GAS_SECRET_TOKEN / ALLOWED_EMAILS) が未登録の環境では 404 を返し、手入力へフォールバックさせる
  const webAppUrl = env.GAS_WEB_APP_URL?.trim() || '';
  const secretToken = env.GAS_SECRET_TOKEN?.trim() || '';
  const rawAllowedEmails = env.ALLOWED_EMAILS?.trim() || '';

  if (
    !webAppUrl ||
    !webAppUrl.startsWith('https://script.google.com/') ||
    !secretToken ||
    !rawAllowedEmails
  ) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Bootstrap configuration is not enabled in this environment',
      }),
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  // 2. Cloudflare Access が付与する認証済みメールアドレスヘッダーの検証 (Fail-Closed)
  // ※ CF_Authorization Cookie のみでは通過させず、メールヘッダーの存在を必須とする
  const authenticatedEmail = request.headers
    .get('Cf-Access-Authenticated-User-Email')
    ?.trim()
    .toLowerCase();

  if (!authenticatedEmail) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Unauthorized: Cf-Access-Authenticated-User-Email header required',
      }),
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  // 3. 許可メールアドレス一覧 (ALLOWED_EMAILS) との必須照合
  const allowedSet = new Set(
    rawAllowedEmails
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!allowedSet.has(authenticatedEmail)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Forbidden: User email is not permitted',
      }),
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      webAppUrl,
      secretToken,
      userEmail: authenticatedEmail,
    }),
    { status: 200, headers: NO_STORE_HEADERS }
  );
};
