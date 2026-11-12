import { googleAuthUrl, googleConfigured } from '../src/google';
import { putLoginState } from '../src/oauth';
import { clearCookie, dashboardPage, loadDatasets, sessionUser } from '../src/dashboard';
import { Req, Res, header, html, issuerOf, noStore, page, param } from './_http';

/**
 * /dashboard            the Performance OS page (Google sign-in required)
 * /dashboard/data       its data, as JSON, for the signed-in person
 * /dashboard/login      starts Google sign-in; returns via /auth/callback
 * /dashboard/logout     forgets the session on this browser
 *
 * Access is the same gate as the connector: ALLOWED_EMAILS (or an address
 * already admitted). The session is an HttpOnly cookie signed with JWT_SECRET.
 */
export default async function handler(req: Req, res: Res) {
  const issuer = issuerOf(req);
  const part = param(req, 'part') ?? 'page';

  if (part === 'logout') {
    res.setHeader('Set-Cookie', clearCookie());
    res.setHeader('Location', '/dashboard');
    return res.status(302).end();
  }

  if (part === 'login') {
    if (!googleConfigured()) {
      return html(res, 503, page('Not configured', 'Google sign-in is not configured on this deployment.'));
    }
    const state = await putLoginState({ intent: 'dashboard' });
    res.setHeader('Location', googleAuthUrl(issuer, state));
    return res.status(302).end();
  }

  const user = sessionUser(header(req, 'cookie'), issuer);

  if (part === 'data') {
    noStore(res);
    if (!user) return res.status(401).json({ error: 'signed_out' });
    const datasets = await loadDatasets(user);
    return res.status(200).json({ at: new Date().toISOString(), datasets });
  }

  if (!user) {
    return html(
      res,
      200,
      page(
        'Performance OS',
        'Painel pessoal de treino, recuperação e alimentação.',
        `<a class="btn" href="/dashboard/login">Entrar com Google</a>`
      )
    );
  }

  noStore(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(dashboardPage());
}
