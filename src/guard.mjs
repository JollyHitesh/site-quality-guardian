// The read-only guarantee. Label rules can be fooled by a page; this layer cannot,
// because every request from every page and popup in a context passes through it.

const ANALYTICS_HOSTS = [
  'google-analytics.com', 'googletagmanager.com', 'analytics.google.com', 'doubleclick.net',
  'static.cloudflareinsights.com', 'cloudflareinsights.com', 'plausible.io', 'segment.io', 'segment.com',
  'hotjar.com', 'mixpanel.com', 'clarity.ms', 'facebook.net', 'connect.facebook.net', 'posthog.com',
];

const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

export function parseRobots(text, agent = '*') {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === 'user-agent') {
      if (!lastWasAgent) { current = {agents: [], rules: []}; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (field === 'allow' || field === 'disallow') && value) current.rules.push({allow: field === 'allow', path: value});
    }
  }
  const wanted = agent.toLowerCase();
  return (groups.find(g => g.agents.includes(wanted)) || groups.find(g => g.agents.includes('*')))?.rules || [];
}

/** Longest matching rule wins, and an allow rule wins a tie, as RFC 9309 specifies. */
export function robotsAllows(rules, pathname) {
  let best = null;
  for (const rule of rules || []) {
    const source = rule.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    if (!new RegExp(`^${source}`).test(pathname)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

export function createPolicy(config, {robotsRules = [], extraHosts = [], mode = 'audit'} = {}) {
  return {
    mode,
    hosts: new Set([...config.allowedHosts, ...extraHosts]),
    excludePaths: config.excludePaths || [],
    allowPostPaths: config.readOnly?.allowPostPaths || [],
    allowPostBodies: (config.readOnly?.allowPostBodies || []).map(r => ({pathPrefix: r.pathPrefix || '/', pattern: new RegExp(r.bodyMustMatch)})),
    blockHosts: [...ANALYTICS_HOSTS, ...(config.readOnly?.blockHosts || [])],
    robotsRules,
  };
}

const isExcluded = (pathname, list) => list.some(p => pathname === p || pathname.startsWith(`${p.replace(/\/$/, '')}/`));

/** Pure decision for one request, so the safety rules can be tested without a browser. */
export function decideRequest({url, method = 'GET', isMainNavigation = false, postData = null}, policy) {
  let u;
  try { u = new URL(url); } catch { return {allow: false, reason: 'invalid-url'}; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return {allow: true, reason: 'non-network'};
  const first = policy.hosts.has(u.hostname);
  if (policy.blockHosts.some(d => hostMatches(u.hostname, d))) return {allow: false, reason: 'analytics'};
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (first && policy.allowPostPaths.some(p => u.pathname.startsWith(p))) return {allow: true, reason: 'allowlisted-write'};
    // Some frameworks read data over POST. Only a declared, exact body shape may pass.
    if (first && typeof postData === 'string' && policy.allowPostBodies.some(r => u.pathname.startsWith(r.pathPrefix) && r.pattern.test(postData))) return {allow: true, reason: 'allowlisted-read'};
    return {allow: false, reason: 'write-blocked'};
  }
  if (first && isExcluded(u.pathname, policy.excludePaths)) return {allow: false, reason: 'excluded-path'};
  if (isMainNavigation) {
    if (!first) return {allow: false, reason: 'external-navigation'};
    if (u.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(u.hostname)) return {allow: false, reason: 'insecure-navigation'};
    if (policy.mode === 'audit' && !robotsAllows(policy.robotsRules, u.pathname)) return {allow: false, reason: 'robots'};
  }
  return {allow: true, reason: 'ok'};
}

export function createSafetyLog() {
  return {blocked: {}, samples: [], blockedRequests: new WeakSet(), allowedWrites: 0, allowedReads: 0, firstPartyWritesBlocked: 0};
}

export async function installGuard(context, policy, log) {
  await context.route('**/*', async route => {
    const request = route.request();
    let isMainNavigation = false;
    try { isMainNavigation = request.isNavigationRequest() && !request.frame().parentFrame(); } catch { isMainNavigation = request.isNavigationRequest(); }
    const decision = decideRequest({url: request.url(), method: request.method(), isMainNavigation, postData: request.postData()}, policy);
    if (decision.allow) {
      if (decision.reason === 'allowlisted-write') log.allowedWrites++;
      if (decision.reason === 'allowlisted-read') log.allowedReads++;
      return route.continue().catch(() => {});
    }
    log.blockedRequests.add(request);
    log.blocked[decision.reason] = (log.blocked[decision.reason] || 0) + 1;
    if (decision.reason === 'write-blocked' && policy.hosts.has(new URL(request.url()).hostname)) log.firstPartyWritesBlocked++;
    if (log.samples.length < 40 && decision.reason !== 'analytics') log.samples.push({reason: decision.reason, method: request.method(), url: request.url().split('?')[0].slice(0, 160)});
    return route.abort('blockedbyclient').catch(() => {});
  });
}

export async function fetchRobots(origin, userAgent) {
  try {
    const response = await fetch(new URL('/robots.txt', origin), {headers: {'user-agent': userAgent}, signal: AbortSignal.timeout(10000)});
    if (!response.ok) return {rules: [], status: response.status, found: false};
    return {rules: parseRobots(await response.text()), status: response.status, found: true};
  } catch (e) {
    return {rules: [], status: null, found: false, error: String(e.message).slice(0, 120)};
  }
}
