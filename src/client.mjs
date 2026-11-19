/** Small API client with a cookie jar and CSRF handling. Used by tests and the demo seeder. */
export class ApiClient {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }

  async req(method, path, body, { raw = false, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (method !== 'GET') { h['X-TTA-Client'] = h['X-TTA-Client'] ?? 'web'; if (this.csrf) h['X-CSRF-Token'] = this.csrf; }
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(this.base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) { const [pair] = set.split(';'); this.cookie = pair.endsWith('=') ? '' : pair; }
    if (raw) return res;
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (data && data.csrf) this.csrf = data.csrf;
    return { status: res.status, data };
  }
  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b = {}, o) { return this.req('POST', p, b, o); }

  /** POST and throw unless 2xx. */
  async ok(p, b = {}) {
    const r = await this.post(p, b);
    if (r.status >= 300) throw new Error(`${p} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
  async getOk(p) {
    const r = await this.get(p);
    if (r.status >= 300) throw new Error(`${p} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
  async login(email, password) {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.data)}`);
    return r;
  }
}
