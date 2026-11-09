// Cloudflare entry point: every request is forwarded to the review app's Docker container
// (server/index.mjs with ffmpeg). One instance runs at a time and sleeps when idle.
import { Container, getContainer } from '@cloudflare/containers';

// Worker secrets/variables passed through to the container's process environment.
const passThrough = [
  'CLOUDFLARE_ACCOUNT_ID', 'D1_DATABASE_ID', 'CLOUDFLARE_D1_TOKEN',
  'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'WORKSPACE_PASSWORD_REQUIRED', 'MAX_UPLOAD_MB', 'APP_URL',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_ENCRYPTION_KEY',
  'B2_KEY_ID', 'B2_APPLICATION_KEY', 'B2_BUCKET_ID',
];

export class ReviewApp extends Container {
  defaultPort = 3001;
  sleepAfter = '15m';
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = Object.fromEntries(passThrough.filter(name => typeof env[name] === 'string' && env[name] !== '').map(name => [name, env[name]]));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // The app trusts one proxy hop: tell it the real client address and that the visitor used HTTPS.
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
    const client = request.headers.get('cf-connecting-ip');
    if (client) headers.set('x-forwarded-for', client); else headers.delete('x-forwarded-for');
    return getContainer(env.REVIEW_APP).fetch(new Request(request, { headers }));
  },
};
