// Fake CalDAV server for the task sync tests (discovery, REPORT, PUT/DELETE with ETags).
import { createTodoIcs } from '../../src/task-sync-caldav.mjs';

export const BASE = 'https://dav.example.test';
export const HOME = `${BASE}/dav/calendars/peter/`;
export const LIST = `${HOME}tasks/`;
export const AUTH = `Basic ${Buffer.from('peter:geheim').toString('base64')}`;

export function fakeCaldav() {
  const objects = new Map(); // url → { data, etag }
  let n = 0;
  const calls = [];
  const state = { failPut: 0, preconditionOnce: false, onReport: null, emptyReport: false, evilHref: false };
  const etag = () => `"e${++n}"`;
  const multi = body =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`;
  const ok = props => `<d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`;
  const res = (status, body = '', headers = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: k => headers[k.toLowerCase()] ?? null },
    text: async () => body,
    json: async () => JSON.parse(body)
  });
  const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  async function fetchImpl(url, init = {}) {
    const method = init.method || 'GET';
    calls.push({ url, method, headers: init.headers || {}, body: init.body });
    if (init.headers?.Authorization !== AUTH) return res(401);
    if (method === 'PROPFIND' && url === `${BASE}/dav/`)
      return res(
        207,
        multi(
          `<d:response><d:href>/dav/</d:href>${ok('<d:current-user-principal><d:href>/dav/principals/peter/</d:href></d:current-user-principal>')}<d:propstat><d:prop><c:calendar-home-set/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>`
        )
      );
    if (method === 'PROPFIND' && url === `${BASE}/dav/principals/peter/`)
      return res(
        207,
        multi(
          `<d:response><d:href>/dav/principals/peter/</d:href>${ok(`<c:calendar-home-set><d:href>${HOME}</d:href></c:calendar-home-set>`)}</d:response>`
        )
      );
    if (method === 'PROPFIND' && url === HOME)
      return res(
        207,
        multi(
          [
            `<d:response><d:href>/dav/calendars/peter/</d:href>${ok('<d:resourcetype><d:collection/></d:resourcetype>')}</d:response>`,
            `<d:response><d:href>/dav/calendars/peter/tasks/</d:href>${ok('<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Aufgaben &amp; To-dos</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>')}</d:response>`,
            `<d:response><d:href>/dav/calendars/peter/personal/</d:href>${ok('<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Persönlich</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>')}</d:response>`,
            `<d:response><d:href>https://evil.example.org/steal/</d:href>${ok('<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Fremd</d:displayname>')}</d:response>`
          ].join('')
        )
      );
    if (method === 'REPORT' && url === LIST) {
      if (state.onReport) await state.onReport();
      if (state.emptyReport) return res(207, multi(''));
      const rows = [...objects]
        .filter(([u]) => u.startsWith(LIST))
        .map(
          ([u, o]) =>
            `<d:response><d:href>${new URL(u).pathname}</d:href>${ok(`<d:getetag>${o.etag}</d:getetag><c:calendar-data>${escape(o.data)}</c:calendar-data>`)}</d:response>`
        );
      if (state.evilHref)
        rows.push(
          `<d:response><d:href>https://evil.example.org/x.ics</d:href>${ok(`<d:getetag>"x"</d:getetag><c:calendar-data>${escape(createTodoIcs({ title: 'Fremd' }))}</c:calendar-data>`)}</d:response>`
        );
      return res(207, multi(rows.join('')));
    }
    if (method === 'PUT') {
      if (state.failPut > 0) {
        state.failPut--;
        return res(500);
      }
      const existing = objects.get(url);
      if (init.headers['If-None-Match'] === '*' && existing) return res(412);
      if (init.headers['If-Match'] && (!existing || existing.etag !== init.headers['If-Match'])) return res(412);
      if (state.preconditionOnce && init.headers['If-Match']) {
        state.preconditionOnce = false;
        return res(412);
      }
      const e = etag();
      objects.set(url, { data: init.body, etag: e });
      return res(existing ? 204 : 201, '', { etag: e });
    }
    if (method === 'DELETE') {
      const existing = objects.get(url);
      if (!existing) return res(404);
      if (init.headers['If-Match'] && existing.etag !== init.headers['If-Match']) return res(412);
      objects.delete(url);
      return res(204);
    }
    return res(404);
  }
  const put = (name, ics) => {
    const url = `${LIST}${name}.ics`;
    objects.set(url, { data: ics, etag: etag() });
    return url;
  };
  const edit = (url, fn) => {
    const o = objects.get(url);
    objects.set(url, { data: fn(o.data), etag: etag() });
  };
  return { fetchImpl, calls, objects, put, edit, state };
}
