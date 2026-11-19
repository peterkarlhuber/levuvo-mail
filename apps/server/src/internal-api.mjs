// Named internal operations of the app's own API (ARC-LEV-002, second step). The AI routes, the
// MCP tools and the approvals call these instead of building URLs; every method runs through
// ctx.internalRequest, i.e. the same handlers, account resolution and action checks as a request
// from the app. The URL and the action header of each operation live only here.
const q = encodeURIComponent;

/** `request(method, url, body, action)` is ctx.internalRequest. */
export function createInternalApi(request) {
  const get = url => request('GET', url);
  const post = (url, body, action) => request('POST', url, body, action);
  return {
    folders: account => get(`/api/folders?account=${q(account)}`),
    messages: (account, { folder = 'INBOX', limit = 20 } = {}) =>
      get(`/api/messages?folder=${q(folder)}&limit=${Number(limit)}&account=${q(account)}`),
    message: (account, folder, uid) => get(`/api/messages/${Number(uid)}?folder=${q(folder)}&account=${q(account)}`),
    attachmentText: (account, folder, uid) =>
      get(`/api/messages/${Number(uid)}/attachment-text?folder=${q(folder)}&account=${q(account)}`),
    searchLocal: (query, account = '') =>
      get(`/api/search/local?q=${q(query)}${account ? `&account=${q(account)}` : ''}`),
    events: (from, to) => get(`/api/calendar/events?from=${q(from)}&to=${q(to)}`),
    calendars: () => get('/api/calendar/calendars'),
    contacts: () => get('/api/contacts/list'),
    saveDraft: (account, draft) => post(`/api/drafts/save?account=${q(account)}`, draft, 'draft-v1'),
    messageAction: (account, uid, body) =>
      post(`/api/messages/${Number(uid)}/action?account=${q(account)}`, body, 'mail-v1'),
    snooze: (account, body) => post(`/api/messages/snooze?account=${q(account)}`, body, 'mail-v1'),
    send: (account, message) => post(`/api/messages/send?account=${q(account)}`, message, 'send-v1'),
    saveEvent: payload => post('/api/calendar/events/save', payload, 'calendar-v1'),
    saveContact: payload => post('/api/contacts/save', payload, 'contacts-v1')
  };
}

/** The internal API of one app instance (created on first use from ctx.internalRequest). */
export function internalApi(ctx) {
  ctx.internal ||= createInternalApi((...args) => ctx.internalRequest(...args));
  return ctx.internal;
}
