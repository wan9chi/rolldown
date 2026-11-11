// Fork-verification stand-in for the Void platform API. It accepts the OIDC exchange and the
// project lookup, records the asset manifest `void deploy` sends at preflight, then rejects the
// request for upload URLs, so the deploy fails before any file is uploaded.
import { appendFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const port = Number(process.env.MOCK_VOID_PORT ?? 8787);
const logFile = process.env.MOCK_VOID_LOG ?? 'mock-void-api.log';
const manifestFile = process.env.MOCK_VOID_MANIFEST ?? 'mock-void-manifest.txt';

function log(line) {
  appendFileSync(logFile, `${line}\n`);
}

function claims(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    const { repository, ref, event_name, aud, environment } = payload;
    return JSON.stringify({ repository, ref, event_name, aud, environment });
  } catch {
    return '(not a JWT)';
  }
}

http
  .createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://mock');
    const send = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.method === 'GET' && url.pathname === '/.well-known/void-platform') {
      return send(200, {
        apiUrl: `http://127.0.0.1:${port}`,
        applicationDomain: 'void.app',
        authenticationProviders: ['github'],
        capabilities: {
          ai: false,
          customDomains: false,
          email: false,
          githubActions: true,
          githubOAuth: true,
          googleOAuth: false,
          managedBuilds: false,
          sandbox: false,
        },
        displayName: 'Mock Void (fork verification)',
        installationId: null,
        platformVersion: '1.7.0',
        proxyUrl: `http://127.0.0.1:${port}`,
        usageProtocolVersion: 2,
        schemaVersion: 1,
        directWorkerUpload: true,
      });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/auth/github-oidc')) {
      const { project, oidcToken } = JSON.parse(body);
      log(`OIDC exchange for project "${project}", token claims ${claims(oidcToken)}`);
      return send(200, { token: 'mock-deploy-token' });
    }
    if (req.method === 'GET' && url.pathname.endsWith('/projects/resolve')) {
      const slug = url.searchParams.get('slug');
      log(`Resolve project "${slug}"`);
      return send(200, { project: { id: 'mock-project', slug, role: 'owner' } });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/deploy/preflight')) {
      const paths = Object.keys(JSON.parse(body).assetManifest).sort();
      writeFileSync(manifestFile, `${paths.join('\n')}\n`);
      log(`Preflight: void deploy hashed ${paths.length} files`);
      return send(200, { needed: paths, total: paths.length, skipped: 0 });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/deploy/upload-urls')) {
      const { assets } = JSON.parse(body);
      log(`Upload URLs requested for ${assets.length} assets; rejecting the deploy`);
      return send(503, { error: `mock Void API: rejected the upload of ${assets.length} assets` });
    }
    log(`Unhandled ${req.method} ${url.pathname}`);
    return send(404, { error: 'mock Void API: not implemented' });
  })
  .listen(port, '127.0.0.1');
