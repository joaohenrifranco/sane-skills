/**
 * Command registry: the single source of truth for dispatch and `help`.
 * Zero side effects; safe to import from tests.
 */

export const READ_COMMANDS = new Set([
  'text', 'html', 'links', 'forms', 'accessibility',
  'js', 'eval', 'css', 'attrs',
  'console', 'network', 'storage', 'perf',
  'dialog', 'is',
]);

export const WRITE_COMMANDS = new Set([
  'goto', 'back', 'forward', 'reload',
  'click', 'fill', 'select', 'hover', 'type', 'press', 'scroll', 'wait',
  'viewport', 'cookie', 'cookie-import', 'header', 'useragent',
  'upload', 'dialog-accept', 'dialog-dismiss', 'tap', 'swipe',
]);

export const META_COMMANDS = new Set([
  'tabs', 'tab', 'newtab', 'closetab',
  'status', 'stop', 'restart',
  'screenshot', 'pdf', 'responsive',
  'chain', 'diff',
  'url', 'snapshot', 'frame',
  'handoff', 'resume',
  'cookies', 'cookie-import-browser', 'state',
  'device', 'download',
]);

/** Commands the CLI answers itself, without a running browser. */
export const LOCAL_COMMANDS = new Set(['help', 'doctor']);

export const ALL_COMMANDS = new Set([...READ_COMMANDS, ...WRITE_COMMANDS, ...META_COMMANDS]);

export const COMMAND_DESCRIPTIONS: Record<string, { category: string; description: string; usage?: string }> = {
  // Navigation
  'goto':    { category: 'Navigation', description: 'Navigate to URL', usage: 'goto <url>' },
  'back':    { category: 'Navigation', description: 'History back' },
  'forward': { category: 'Navigation', description: 'History forward' },
  'reload':  { category: 'Navigation', description: 'Reload page' },
  'url':     { category: 'Navigation', description: 'Print current URL' },
  // Reading
  'text':    { category: 'Reading', description: 'Visible page text, one block per line' },
  'html':    { category: 'Reading', description: 'innerHTML of selector, or full page HTML', usage: 'html [selector]' },
  'links':   { category: 'Reading', description: 'All links as "text → href"' },
  'forms':   { category: 'Reading', description: 'Form fields as JSON (passwords redacted)' },
  'accessibility': { category: 'Reading', description: 'Full ARIA tree' },
  // Inspection
  'js':      { category: 'Inspection', description: 'Run a JavaScript expression in the page (or selected frame)', usage: 'js <expr>' },
  'eval':    { category: 'Inspection', description: 'Run JavaScript from a file', usage: 'eval <file>' },
  'css':     { category: 'Inspection', description: 'Computed CSS value', usage: 'css <sel> <prop>' },
  'attrs':   { category: 'Inspection', description: 'Element attributes as JSON', usage: 'attrs <sel|@ref>' },
  'is':      { category: 'Inspection', description: 'State check: visible|hidden|enabled|disabled|checked|editable|focused', usage: 'is <prop> <sel>' },
  'console': { category: 'Inspection', description: 'Console messages', usage: 'console [--clear|--errors]' },
  'network': { category: 'Inspection', description: 'Network requests', usage: 'network [--clear]' },
  'dialog':  { category: 'Inspection', description: 'Captured alert/confirm/prompt dialogs', usage: 'dialog [--clear]' },
  'storage': { category: 'Inspection', description: 'localStorage + sessionStorage as JSON (secrets redacted), or set a localStorage key', usage: 'storage [set <k> <v>]' },
  'perf':    { category: 'Inspection', description: 'Page load timings' },
  // Interaction
  'click':   { category: 'Interaction', description: 'Click element', usage: 'click <sel|@ref>' },
  'fill':    { category: 'Interaction', description: 'Fill input', usage: 'fill <sel|@ref> <value>' },
  'select':  { category: 'Interaction', description: 'Select option by value, label, or text', usage: 'select <sel|@ref> <value>' },
  'hover':   { category: 'Interaction', description: 'Hover element', usage: 'hover <sel|@ref>' },
  'type':    { category: 'Interaction', description: 'Type into the focused element', usage: 'type <text>' },
  'press':   { category: 'Interaction', description: 'Press a key (Enter, Tab, Escape, Shift+Enter, ...)', usage: 'press <key>' },
  'scroll':  { category: 'Interaction', description: 'Scroll element into view, or to page bottom', usage: 'scroll [sel|@ref]' },
  'wait':    { category: 'Interaction', description: 'Wait for element, network idle, or load (default 15s)', usage: 'wait <sel|@ref|--networkidle|--load|--domcontentloaded> [ms]' },
  'upload':  { category: 'Interaction', description: 'Set files on a file input', usage: 'upload <sel|@ref> <file> [file2...]' },
  'viewport':{ category: 'Interaction', description: 'Set viewport size', usage: 'viewport <WxH>' },
  'dialog-accept':  { category: 'Interaction', description: 'Accept later dialogs; optional prompt response', usage: 'dialog-accept [text]' },
  'dialog-dismiss': { category: 'Interaction', description: 'Dismiss later dialogs' },
  // Mobile
  'device':  { category: 'Mobile', description: 'Emulate a phone/tablet on this tab', usage: 'device <name> [--landscape] | off | --list' },
  'tap':     { category: 'Mobile', description: 'Tap an element or point (needs device)', usage: 'tap <sel|@ref|x y>' },
  'swipe':   { category: 'Mobile', description: 'One-finger swipe (needs device)', usage: 'swipe <sel|@ref|x y> <up|down|left|right> [--distance px] [--ms n]' },
  // Session
  'cookies': { category: 'Session', description: 'List, import from Chrome/Brave/Edge/Arc/Firefox, clear, or pick cookies', usage: 'cookies [--domain d] [--values] | sources | import [browser] --domain d [--profile P] [--verify-auth <sel>[=<text>]] | clear [--domain d] | picker' },
  'state':   { category: 'Session', description: 'Save or load cookies + localStorage', usage: 'state save|load <name|file.json> | list | rm <name>' },
  'cookie':  { category: 'Session', description: 'Set a cookie on the current domain', usage: 'cookie <name>=<value>' },
  'cookie-import': { category: 'Session', description: 'Load cookies from a JSON array file', usage: 'cookie-import <file.json>' },
  'cookie-import-browser': { category: 'Session', description: 'Alias of "cookies import" (with --domain) or "cookies picker"', usage: 'cookie-import-browser [browser] [--domain d] [--profile P]' },
  'header':  { category: 'Session', description: 'Set an extra request header (sensitive values redacted)', usage: 'header <name>:<value>' },
  'useragent': { category: 'Session', description: 'Override the user agent (reopens tabs)', usage: 'useragent <string>' },
  // Visual
  'screenshot': { category: 'Visual', description: 'Save a screenshot: full page, viewport, element, or clip', usage: 'screenshot [--viewport] [--clip x,y,w,h] [--selector <sel>|@ref] [--out <path>|<path.png>]' },
  'pdf':     { category: 'Visual', description: 'Save page as PDF', usage: 'pdf [--out <path>|<path.pdf>]' },
  'responsive': { category: 'Visual', description: 'Screenshots at 375x812, 768x1024, 1280x720', usage: 'responsive [prefix]' },
  'diff':    { category: 'Visual', description: 'Text diff between two URLs', usage: 'diff <url1> <url2>' },
  'download':{ category: 'Visual', description: 'Download a URL (with browser cookies) or the file a click produces', usage: 'download <url|sel|@ref> [--out <path>]' },
  // Snapshot
  'snapshot':{ category: 'Snapshot', description: 'Accessibility tree with @e refs (lists iframes too)', usage: 'snapshot [-i] [-c] [-d N] [-s sel] [-D] [-a] [-o path] [-C]' },
  'frame':   { category: 'Snapshot', description: 'Act inside an iframe, or back to the page', usage: 'frame <sel|@ref|--name n|--url pattern|main>' },
  'chain':   { category: 'Snapshot', description: 'Run commands from JSON stdin, stop at first error', usage: 'chain  (stdin: [["cmd","arg"],...])' },
  // Tabs
  'tabs':    { category: 'Tabs', description: 'List open tabs' },
  'tab':     { category: 'Tabs', description: 'Switch to tab', usage: 'tab <id>' },
  'newtab':  { category: 'Tabs', description: 'Open new tab', usage: 'newtab [url]' },
  'closetab':{ category: 'Tabs', description: 'Close tab', usage: 'closetab [id]' },
  // Handoff
  'handoff': { category: 'Handoff', description: 'Open a visible browser for the user (CAPTCHA, MFA, login); --until blocks until done, then resumes', usage: 'handoff [message] [--until url:<s>|url:/re/|selector:<css>|closed] [--stay-headed]' },
  'resume':  { category: 'Handoff', description: 'End a handoff (back to headless) and snapshot', usage: 'resume [--stay-headed]' },
  // Server
  'status':  { category: 'Server', description: 'Mode, profile, URL, tabs' },
  'stop':    { category: 'Server', description: 'Stop the browser' },
  'restart': { category: 'Server', description: 'Restart the browser' },
};

const allCmds = new Set([...READ_COMMANDS, ...WRITE_COMMANDS, ...META_COMMANDS]);
for (const cmd of allCmds) {
  if (!(cmd in COMMAND_DESCRIPTIONS)) throw new Error(`COMMAND_DESCRIPTIONS missing entry for: ${cmd}`);
}
for (const key of Object.keys(COMMAND_DESCRIPTIONS)) {
  if (!allCmds.has(key)) throw new Error(`COMMAND_DESCRIPTIONS has unknown command: ${key}`);
}

export const CATEGORY_ORDER = ['Navigation', 'Reading', 'Interaction', 'Inspection', 'Snapshot', 'Visual', 'Mobile', 'Session', 'Tabs', 'Handoff', 'Server'];

export const GLOBAL_OPTIONS = [
  ['--headed', 'Start a visible browser (BROWSE_HEADED=1)'],
  ['--profile <name|path>', 'Persistent profile to use (default: one per project; BROWSE_PROFILE)'],
  ['--ephemeral', 'In-memory profile; nothing saved (BROWSE_EPHEMERAL=1)'],
  ['--proxy <url>', 'HTTP(S)/SOCKS proxy (BROWSE_PROXY_URL, HTTPS_PROXY, ...; "direct" disables)'],
  ['--session <name>', 'Act in this session\'s own tab (BROWSE_SESSION)'],
  ['--timeout <ms>', 'Timeout for wait/handoff --until and the CLI request'],
  ['--json', 'Print {"ok":…} JSON instead of plain text'],
] as const;

export function generateHelpText(snapshotFlags: Array<{ short: string; long: string; valueHint?: string }>): string {
  const groups = new Map<string, string[]>();
  for (const [cmd, meta] of Object.entries(COMMAND_DESCRIPTIONS)) {
    const list = groups.get(meta.category) || [];
    list.push(`  ${(meta.usage || cmd)}\n      ${meta.description}`);
    groups.set(meta.category, list);
  }
  const lines = ['browse — headless/headed browser for AI agents', '', 'Usage: browse [global options] <command> [args]', '', 'Global options:'];
  for (const [flag, desc] of GLOBAL_OPTIONS) lines.push(`  ${flag.padEnd(24)}${desc}`);
  lines.push('', 'Local commands:', '  doctor [--fix]\n      Check bun, Playwright, Chromium, profile and cookie sources', '  help\n      This text');
  for (const cat of CATEGORY_ORDER) {
    const cmds = groups.get(cat);
    if (!cmds) continue;
    lines.push('', `${cat}:`, ...cmds);
  }
  lines.push('', 'Snapshot flags:');
  for (const f of snapshotFlags) lines.push(`  ${(f.valueHint ? `${f.short} ${f.valueHint}` : f.short).padEnd(12)}${f.long}`);
  lines.push('', 'Refs: after "snapshot", use @e1, @e2 (and @c1 from -C) anywhere a selector is accepted.');
  lines.push('Exit codes: 0 ok, 1 failed, 2 usage error, 3 needs the user (CAPTCHA, login, Keychain).');
  return lines.join('\n');
}
