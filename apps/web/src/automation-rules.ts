// Automations: types and the plain-language description a rule is checked against before it is
// switched on. The description is built from the rule itself (not by the AI), so what the user
// reads is exactly what will run.

export type AutoField = 'from' | 'to' | 'subject' | 'text' | 'any' | 'attachment';
export type AutoOp = 'contains' | 'not_contains' | 'is' | 'ends_with' | 'yes' | 'no';
export type AutoCondition = { field: AutoField; op: AutoOp; value: string };
export type AutoAction =
  | { type: 'move'; folder: string }
  | { type: 'markRead' }
  | { type: 'flag' }
  | { type: 'task'; title: string; dueDays: number | null; priority?: string };
export type AutoRule = {
  id?: string;
  name: string;
  accountId: string;
  enabled: boolean;
  match: 'all' | 'any';
  conditions: AutoCondition[];
  actions: AutoAction[];
  stop: boolean;
  origin?: 'manual' | 'ai';
  enabledAt?: string | null;
  updatedAt?: string;
};
export type AutoLogEntry = {
  at: string;
  rule: string;
  accountId: string;
  subject: string;
  actions: string[];
  ok: boolean;
  error?: string;
};

type T = (text: string, vars?: Record<string, string | number>) => string;

export const newRule = (accountId: string): AutoRule => ({
  name: '',
  accountId,
  enabled: false,
  match: 'all',
  conditions: [{ field: 'from', op: 'contains', value: '' }],
  actions: [{ type: 'move', folder: '' }],
  stop: true
});

export function conditionText(c: AutoCondition, t: T) {
  if (c.field === 'attachment') return c.op === 'no' ? t('die Mail keine Anhänge hat') : t('die Mail Anhänge hat');
  const field = {
    from: t('der Absender'),
    to: t('der Empfänger'),
    subject: t('der Betreff'),
    text: t('der Text'),
    any: t('Absender, Empfänger, Betreff oder Text'),
    attachment: ''
  }[c.field];
  const op = {
    contains: t('{field} „{value}“ enthält'),
    not_contains: t('{field} „{value}“ nicht enthält'),
    is: t('{field} genau „{value}“ ist'),
    ends_with: t('{field} auf „{value}“ endet'),
    yes: '',
    no: ''
  }[c.op];
  return op.replace('{field}', field).replace('{value}', c.value);
}

export function actionText(a: AutoAction, t: T) {
  switch (a.type) {
    case 'move':
      return t('in den Ordner „{folder}“ verschieben', { folder: a.folder || '?' });
    case 'markRead':
      return t('als gelesen markieren');
    case 'flag':
      return t('mit Stern markieren');
    case 'task': {
      const title = (a.title || '{subject}').replace('{subject}', t('‹Betreff›')).replace('{from}', t('‹Absender›'));
      if (a.dueDays === null || a.dueDays === undefined) return t('Aufgabe „{title}“ anlegen', { title });
      if (a.dueDays === 0) return t('Aufgabe „{title}“ anlegen, fällig am selben Tag', { title });
      return t('Aufgabe „{title}“ anlegen, fällig in {days} Tagen', { title, days: a.dueDays });
    }
  }
}

/** "When the sender ends with … and …: move …, create task …." */
export function describeRule(rule: AutoRule, t: T, accountLabel?: string) {
  const joiner = rule.match === 'any' ? t(' oder ') : t(' und ');
  const when = rule.conditions.map(c => conditionText(c, t)).join(joiner);
  const order = [...rule.actions].sort((a, b) => (a.type === 'move' ? 1 : 0) - (b.type === 'move' ? 1 : 0));
  const then = order.map(a => actionText(a, t)).join(', ');
  const scope = accountLabel
    ? t('Gilt für neue Mails im Posteingang von {account}.', { account: accountLabel })
    : t('Gilt für neue Mails im Posteingang aller Konten.');
  return `${t('Wenn {when}: {then}.', { when, then })} ${scope}${rule.stop ? ` ${t('Danach keine weiteren Regeln.')}` : ''}`;
}
