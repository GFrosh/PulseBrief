import { describe, expect, it } from 'vitest';
import { applyDeterministicRedaction, maskModelFoundItems } from './hybridAI';

const redact = (text: string) => applyDeterministicRedaction(text);

describe('applyDeterministicRedaction: emails', () => {
  it('masks a normal email address', () => {
    const out = redact('You can reach me at sam.okafor@northwind.com after lunch.');
    expect(out.sanitizedTranscript).toBe('You can reach me at [REDACTED_EMAIL] after lunch.');
    expect(out.entities).toEqual(['EMAIL']);
  });

  it('masks plus addresses, sub domains and capital letters', () => {
    const out = redact('Try SAM+news@mail.eu.Northwind.CO.UK or ops_team@acme.io please.');
    expect(out.sanitizedTranscript).toBe('Try [REDACTED_EMAIL] or [REDACTED_EMAIL] please.');
    expect(out.redactionCount).toBe(2);
  });

  it('leaves text without an email alone', () => {
    const text = 'We send about 40 emails a day, mostly to @home customers.';
    expect(redact(text).sanitizedTranscript).toBe(text);
  });
});

describe('applyDeterministicRedaction: IDs', () => {
  it('masks an SSN style number', () => {
    expect(redact('My number is 123-45-6789 okay.').sanitizedTranscript).toBe('My number is [REDACTED_ID] okay.');
  });

  it('masks account, order and customer references', () => {
    const out = redact('Account ACCT-123456, PO 88421, inv_20431 and cust 99887766 are open.');
    expect(out.sanitizedTranscript).toBe('Account [REDACTED_ID], [REDACTED_ID], [REDACTED_ID] and [REDACTED_ID] are open.');
    expect(out.redactionCount).toBe(4);
  });

  it('does not mask a short number after the prefix', () => {
    const text = 'Please see PO 12 for details.';
    expect(redact(text).sanitizedTranscript).toBe(text);
  });
});

describe('applyDeterministicRedaction: addresses', () => {
  it('masks a simple street address', () => {
    expect(redact('We are at 14 Douglas Road in town.').sanitizedTranscript).toBe(
      'We are at [REDACTED_ADDRESS] in town.',
    );
  });

  it('masks longer addresses and keeps the full stop out of the way', () => {
    const out = redact('Ship to 1200 North Main Avenue. Thanks.');
    expect(out.sanitizedTranscript).toBe('Ship to [REDACTED_ADDRESS] Thanks.');
  });

  it('does not touch ordinary sentences that start with a number', () => {
    const text = 'About 20 big wins came from that, and 12 Big Stores joined.';
    expect(redact(text).sanitizedTranscript).toBe(text);
  });

  it('does not cut a word that only starts like a street word', () => {
    const text = 'There are 20 Big Ways to cut cost.';
    expect(redact(text).sanitizedTranscript).toBe(text);
  });
});

describe('applyDeterministicRedaction: phone numbers', () => {
  it.each([
    ['local Nigerian number', 'Call 0803 555 0142 today.'],
    ['international with spaces', 'Call +234 803 555 0142 today.'],
    ['brackets', 'Call (403) 555-0142 today.'],
    ['dashes', 'Call 403-555-0142 today.'],
    ['dots', 'Call 403.555.0142 today.'],
    ['international no spaces', 'Call +2348035550142 today.'],
  ])('masks a %s', (_name, text) => {
    const out = redact(text);
    expect(out.sanitizedTranscript).toBe('Call [REDACTED_PHONE] today.');
    expect(out.entities).toEqual(['PHONE']);
  });

  it('does not mask dates, prices or short numbers', () => {
    const text = 'On 2026-11-25 we paid 1,500,000 naira for 3 to 5 weeks of stock.';
    expect(redact(text).sanitizedTranscript).toBe(text);
  });
});

describe('applyDeterministicRedaction: whole transcripts', () => {
  const call = [
    'Interviewer: What is the best way to reach you?',
    'Guest: Email is sam@northwind.com, phone 0803 555 0142, office at 14 Douglas Road.',
    'Guest: Our account is ACCT-123456 if you need it.',
  ].join('\n');

  it('masks everything and keeps speaker labels and line breaks', () => {
    const out = redact(call);
    expect(out.sanitizedTranscript).toBe(
      [
        'Interviewer: What is the best way to reach you?',
        'Guest: Email is [REDACTED_EMAIL], phone [REDACTED_PHONE], office at [REDACTED_ADDRESS]',
        'Guest: Our account is [REDACTED_ID] if you need it.',
      ].join('\n'),
    );
    expect(out.redactionCount).toBe(4);
    expect(out.entities.sort()).toEqual(['ACCOUNT_ID', 'ADDRESS', 'EMAIL', 'PHONE']);
  });

  it('is safe to run twice: the second pass finds nothing', () => {
    const first = redact(call);
    const second = redact(first.sanitizedTranscript);
    expect(second.sanitizedTranscript).toBe(first.sanitizedTranscript);
    expect(second.redactionCount).toBe(0);
  });

  it('handles an empty transcript', () => {
    expect(redact('')).toEqual({ sanitizedTranscript: '', redactionCount: 0, entities: [] });
  });
});

describe('maskModelFoundItems', () => {
  const base = 'Guest: reach me on oh eight oh three five five five or sam at mail dot com, ref ACME-4412-B.';

  it('masks items the model found, by type', () => {
    const out = maskModelFoundItems(base, [
      { text: 'oh eight oh three five five five', type: 'PHONE' },
      { text: 'sam at mail dot com', type: 'EMAIL' },
      { text: 'ACME-4412-B', type: 'ID' },
    ]);
    expect(out.text).toBe('Guest: reach me on [REDACTED_PHONE] or [REDACTED_EMAIL], ref [REDACTED_ID].');
    expect(out.count).toBe(3);
    expect(out.entities).toEqual(['PHONE', 'EMAIL', 'ID']);
  });

  it('masks every copy of an item', () => {
    const out = maskModelFoundItems('Code ACME-4412-B, again ACME-4412-B.', [{ text: 'ACME-4412-B', type: 'ID' }]);
    expect(out.text).toBe('Code [REDACTED_ID], again [REDACTED_ID].');
  });

  it('ignores items that are not in the transcript', () => {
    const out = maskModelFoundItems(base, [{ text: 'ZZZ-9999', type: 'ID' }]);
    expect(out.text).toBe(base);
    expect(out.count).toBe(0);
  });

  it('ignores plain words, even if the model calls them private', () => {
    const text = 'Guest: the budget is tight this year.';
    const out = maskModelFoundItems(text, [
      { text: 'the budget', type: 'ID' },
      { text: 'tight this year', type: 'ADDRESS' },
    ]);
    expect(out.text).toBe(text);
  });

  it('ignores very short and very long items', () => {
    const text = 'Guest: code 12 and code ' + '9'.repeat(70) + '.';
    const out = maskModelFoundItems(text, [
      { text: '12', type: 'ID' },
      { text: '9'.repeat(70), type: 'ID' },
    ]);
    expect(out.text).toBe(text);
  });

  it('never masks speaker labels or existing placeholders', () => {
    const text = 'Guest: my id is [REDACTED_ID] and Guest: 5 said hi.';
    const out = maskModelFoundItems(text, [
      { text: 'Guest:', type: 'ID' },
      { text: '[REDACTED_ID]', type: 'ID' },
    ]);
    expect(out.text).toBe(text);
  });

  it('uses the ID placeholder for an unknown type', () => {
    const out = maskModelFoundItems('Policy PX-7781 is active.', [{ text: 'PX-7781', type: 'POLICY' }]);
    expect(out.text).toBe('Policy [REDACTED_ID] is active.');
  });

  it('masks the longer item first so nothing is left behind', () => {
    const out = maskModelFoundItems('Ref ACME-4412-B here.', [
      { text: '4412', type: 'ID' },
      { text: 'ACME-4412-B', type: 'ID' },
    ]);
    expect(out.text).toBe('Ref [REDACTED_ID] here.');
  });

  it('keeps the regex result if the model tries to hide most of the transcript', () => {
    const text = 'Guest: 0803 555 0142 0803 555 0142 0803 555 0142';
    const out = maskModelFoundItems(text, [{ text: 'Guest: 0803 555 0142 0803 555 0142 0803 555 0142', type: 'PHONE' }]);
    expect(out.text).toBe(text);
    expect(out.count).toBe(0);
  });

  it('survives bad entries from the model', () => {
    const bad = [null, undefined, { text: 42 }, { type: 'ID' }, { text: 'ACME-4412-B' }] as never;
    const out = maskModelFoundItems(base, bad);
    expect(out.text).toContain('[REDACTED_ID]');
    expect(out.count).toBe(1);
  });

  it('only acts on the first 12 items', () => {
    const items = Array.from({ length: 15 }, (_, i) => `ID-${1000 + i}`);
    const text = items.join(' ');
    const out = maskModelFoundItems(
      text,
      items.map((value) => ({ text: value, type: 'ID' })),
    );
    expect(out.count).toBe(12);
  });
});
