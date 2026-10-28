import { createHash, timingSafeEqual } from 'node:crypto';

export function deploymentAccess(env, port) {
  const external = env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL;
  const cloud = !!external || env.RENDER === 'true' || env.NODE_ENV === 'production';
  if (!cloud) return { bind: '127.0.0.1', hosts: new Set([`127.0.0.1:${port}`, `localhost:${port}`]), origins: new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]), authorize: () => true };
  const origin = new URL(external || '');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin');
  if (!env.SITE_PASSWORD || env.SITE_PASSWORD.length < 20) throw new Error('Set SITE_PASSWORD to a random password of at least 20 characters before public deployment');
  const digest = value => createHash('sha256').update(value).digest();
  const expected = digest(`flightlab:${env.SITE_PASSWORD}`);
  return { bind: '0.0.0.0', hosts: new Set([origin.host]), origins: new Set([origin.origin]), authorize: req => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ') || header.length > 2048) return false;
    return timingSafeEqual(expected, digest(Buffer.from(header.slice(6), 'base64').toString('utf8')));
  } };
}
