import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const BROWSE_DIR = path.resolve(import.meta.dir, '..');
export const CLI = path.join(BROWSE_DIR, 'src', 'cli.ts');

export const FIXTURE_PAGES: Record<string, string> = {
  '/': `<!doctype html><html><head><title>Fixture</title></head><body>
<h1>Fixture</h1><p>Para one.</p><p>Para two.</p>
<form id="f" onsubmit="event.preventDefault();document.getElementById('out').textContent='Saved '+this.email.value">
 <label>Email <input name="email" type="email"></label>
 <label>Plan <select name="plan"><option value="a">Alpha</option><option value="b">Beta</option></select></label>
 <button>Submit</button></form>
<div id="out"></div>
<div class="fake-btn" style="cursor:pointer" onclick="this.textContent='div clicked'">Div button</div>
<button onclick="alert('hi')">Alert</button>
<button id="delayed" onclick="setTimeout(()=>{const d=document.createElement('p');d.id='late';d.textContent='Late content';document.body.append(d)},300)">Delayed</button>
<iframe src="/frame.html" name="inner" title="inner"></iframe>
<a href="/secret.html">Secret</a> <a href="/file.txt" download>Get file</a>
</body></html>`,
  '/frame.html': `<!doctype html><body><button onclick="this.textContent='frame ok'">Frame btn</button></body>`,
  '/secret.html': `<!doctype html><title>Secret</title><h1>Welcome human</h1>`,
  '/echo-cookies': '', // dynamic
  '/file.txt': 'hello file',
};

export function startFixtureServer(): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === '/echo-cookies') return new Response(req.headers.get('cookie') || '(none)');
      if (pathname === '/file.txt') return new Response('hello file', { headers: { 'Content-Disposition': 'attachment; filename="file.txt"' } });
      const body = FIXTURE_PAGES[pathname];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(body, { headers: { 'Content-Type': 'text/html' } });
    },
  });
  // localhost (not 127.0.0.1) so cookie domains match real-world host names
  return { url: `http://localhost:${server.port}`, stop: () => server.stop(true) };
}

export interface Sandbox {
  home: string;
  cwd: string;
  env: Record<string, string>;
  run: (args: string[], opts?: { stdin?: string; env?: Record<string, string> }) => Promise<{ code: number; out: string; err: string }>;
  stop: () => Promise<void>;
}

export function makeSandbox(extraEnv: Record<string, string> = {}): Sandbox {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sane-browse-test-')));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'project');
  fs.mkdirSync(cwd, { recursive: true });
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    BROWSE_HOME: home,
    BROWSE_PROXY_URL: 'direct',
    BROWSE_IDLE_TIMEOUT: '600000',
    ...extraEnv,
  };
  for (const k of ['BROWSE_HEADED', 'BROWSE_PROFILE', 'BROWSE_EPHEMERAL', 'BROWSE_SESSION', 'BROWSE_CONFIG', 'BROWSE_LAUNCH']) {
    if (!(k in extraEnv)) delete env[k];
  }
  const run: Sandbox['run'] = async (args, opts = {}) => {
    const proc = Bun.spawn(['bun', 'run', CLI, ...args], {
      cwd,
      env: { ...env, ...(opts.env || {}) },
      stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, out, err };
  };
  return {
    home, cwd, env, run,
    stop: async () => {
      await run(['stop']);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
