import test from 'node:test';
import assert from 'node:assert/strict';
import { getLoginItemState, changeLoginItemState, isHiddenLoginLaunch } from '../../desktop/login-items.mjs';

function fakeApp(_platform = 'darwin') {
  let value = { openAtLogin: false, status: 'not-registered', wasOpenedAtLogin: false };
  const calls = [];
  return {
    isPackaged: true,
    calls,
    getLoginItemSettings(options) {
      calls.push(['get', options]);
      return { ...value };
    },
    setLoginItemSettings(settings) {
      calls.push(['set', settings]);
      value = {
        ...value,
        openAtLogin: settings.openAtLogin,
        status: settings.openAtLogin ? 'enabled' : 'not-registered'
      };
    },
    launched() {
      value.wasOpenedAtLogin = true;
    }
  };
}
test('Autostart available only for the installed desktop app', () => {
  const a = fakeApp();
  a.isPackaged = false;
  assert.equal(getLoginItemState(a, 'darwin').available, false);
  assert.equal(changeLoginItemState(a, true, 'darwin').ok, false);
  assert.equal(a.calls.length, 0);
});
test('macOS: opt-in autostart sets LoginItem, preserves initial state', () => {
  const a = fakeApp();
  assert.equal(getLoginItemState(a, 'darwin').enabled, false);
  assert.equal(changeLoginItemState(a, true, 'darwin').ok, true);
  assert.equal(getLoginItemState(a, 'darwin').enabled, true);
  assert.equal(changeLoginItemState(a, false, 'darwin').ok, true);
  assert.equal(getLoginItemState(a, 'darwin').enabled, false);
});
test('Windows: --hidden is used identically for autostart and queries', () => {
  const a = fakeApp();
  assert.equal(changeLoginItemState(a, true, 'win32', 'C:/Levuvo Mail.exe').ok, true);
  assert.deepEqual(a.calls.find(([name]) => name === 'set')[1], {
    openAtLogin: true,
    path: 'C:/Levuvo Mail.exe',
    args: ['--hidden']
  });
  assert.ok(
    a.calls.some(([name, opts]) => name === 'get' && opts.path === 'C:/Levuvo Mail.exe' && opts.args[0] === '--hidden')
  );
});
test('Hidden login start, but a normal start shows the window', () => {
  const a = fakeApp();
  assert.equal(isHiddenLoginLaunch(a, [], 'darwin'), false);
  a.launched();
  assert.equal(isHiddenLoginLaunch(a, [], 'darwin'), true);
  assert.equal(isHiddenLoginLaunch(a, ['app', '--hidden'], 'win32'), true);
  assert.equal(isHiddenLoginLaunch(a, ['app'], 'win32'), false);
});
test('API error disables autostart without throwing', () => {
  const a = {
    isPackaged: true,
    getLoginItemSettings() {
      throw Error('blocked');
    },
    setLoginItemSettings() {
      throw Error('blocked');
    }
  };
  assert.equal(getLoginItemState(a, 'darwin').available, false);
  assert.equal(changeLoginItemState(a, true, 'darwin').ok, false);
});
