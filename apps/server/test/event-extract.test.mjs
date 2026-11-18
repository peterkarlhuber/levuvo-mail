import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEventSuggestions,
  jsonLdNodes,
  ownText,
  schemaTime,
  suggestionsFromIcs,
  suggestionsFromText
} from '../src/event-extract.mjs';

const ld = obj =>
  `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body>Hi</body></html>`;

test('schemaTime keeps instants, floating times and dates apart', () => {
  assert.deepEqual(schemaTime('2026-12-12T08:15:00+01:00'), {
    allDay: false,
    value: '2026-12-12T07:15:00.000Z',
    floating: false
  });
  assert.deepEqual(schemaTime('2026-12-12T08:15:00Z'), {
    allDay: false,
    value: '2026-12-12T08:15:00.000Z',
    floating: false
  });
  assert.deepEqual(schemaTime('2026-12-12T08:15'), { allDay: false, value: '2026-12-12T08:15', floating: true });
  assert.deepEqual(schemaTime('2026-12-12'), { allDay: true, value: '2026-12-12' });
  assert.equal(schemaTime('2026-02-30'), null);
  assert.equal(schemaTime('tomorrow'), null);
  assert.equal(schemaTime(undefined), null);
});

test('Flight reservation from JSON-LD', () => {
  const html = ld({
    '@context': 'http://schema.org',
    '@type': 'FlightReservation',
    reservationNumber: 'XK4P2Q',
    reservationFor: {
      '@type': 'Flight',
      flightNumber: '1234',
      airline: { '@type': 'Airline', name: 'Lufthansa', iataCode: 'LH' },
      departureAirport: { '@type': 'Airport', name: 'Wien-Schwechat', iataCode: 'VIE' },
      departureTime: '2026-12-12T08:15:00+01:00',
      arrivalAirport: { '@type': 'Airport', name: 'Frankfurt', iataCode: 'FRA' },
      arrivalTime: '2026-12-12T09:50:00+01:00'
    }
  });
  const [s] = extractEventSuggestions({ html, subject: 'Ihre Buchung' });
  assert.equal(s.kind, 'flight');
  assert.equal(s.summary, 'LH 1234 VIE → FRA');
  assert.equal(s.start, '2026-12-12T07:15:00.000Z');
  assert.equal(s.end, '2026-12-12T08:50:00.000Z');
  assert.equal(s.location, 'Wien-Schwechat (VIE)');
  assert.equal(s.reservationNumber, 'XK4P2Q');
  assert.equal(s.allDay, false);
});

test('Hotel stay becomes an all-day span including the check-out day', () => {
  const html = ld({
    '@context': 'https://schema.org',
    '@type': 'LodgingReservation',
    reservationNumber: '998877',
    reservationFor: {
      '@type': 'LodgingBusiness',
      name: 'Hotel Sacher',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Philharmoniker Str. 4',
        postalCode: '1010',
        addressLocality: 'Wien'
      }
    },
    checkinTime: '2026-12-12T15:00:00+01:00',
    checkoutTime: '2026-12-14T11:00:00+01:00'
  });
  const [s] = extractEventSuggestions({ html });
  assert.equal(s.kind, 'hotel');
  assert.equal(s.summary, 'Hotel Sacher');
  assert.deepEqual([s.allDay, s.start, s.end], [true, '2026-12-12', '2026-12-15']);
  assert.equal(s.location, 'Philharmoniker Str. 4, 1010 Wien');
});

test('Events, @graph, arrays and several reservations in one mail', () => {
  const html = ld({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Ticketshop' },
      {
        '@type': 'EventReservation',
        reservationFor: {
          '@type': 'MusicEvent',
          name: 'Neujahrskonzert',
          startDate: '2027-01-01T11:15:00+01:00',
          location: { '@type': 'Place', name: 'Musikverein', address: 'Musikvereinsplatz 1, Wien' }
        }
      },
      [
        {
          '@type': 'TrainReservation',
          reservationFor: {
            '@type': 'TrainTrip',
            trainNumber: 'RJX 162',
            departureStation: { '@type': 'TrainStation', name: 'Wien Hbf' },
            arrivalStation: { '@type': 'TrainStation', name: 'Salzburg Hbf' },
            departureTime: '2026-12-30T07:30:00+01:00',
            arrivalTime: '2026-12-30T09:52:00+01:00'
          }
        }
      ]
    ]
  });
  const list = extractEventSuggestions({ html });
  assert.deepEqual(
    list.map(s => [s.kind, s.summary]),
    [
      ['event', 'Neujahrskonzert'],
      ['train', 'RJX 162 Wien Hbf → Salzburg Hbf']
    ]
  );
  assert.equal(list[0].location, 'Musikverein, Musikvereinsplatz 1, Wien');
  assert.equal(list[0].end, '2027-01-01T12:15:00.000Z');
});

test('Broken or hostile JSON-LD is ignored', () => {
  const html =
    '<script type="application/ld+json">{ not json</script>' +
    '<script type="application/ld+json">{"@type":"Event","name":"x","startDate":"nope"}</script>' +
    '<script type="application/ld+json">{"@type":"Person","name":"y"}</script>';
  assert.equal(jsonLdNodes(html).length, 2);
  assert.deepEqual(extractEventSuggestions({ html }), []);
});

test('Plain .ics attachment (no iTIP method) is suggested, invitations are not', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    'UID:abc@test',
    'DTSTAMP:20261101T100000Z',
    'DTSTART:20261203T130000Z',
    'DTEND:20261203T143000Z',
    'SUMMARY:Webinar Steuern',
    'LOCATION:Online',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const [s] = suggestionsFromIcs(ics);
  assert.deepEqual(
    [s.kind, s.summary, s.start, s.end, s.location],
    ['calendar', 'Webinar Steuern', '2026-12-03T13:00:00.000Z', '2026-12-03T14:30:00.000Z', 'Online']
  );
  assert.deepEqual(suggestionsFromIcs(ics.replace('VERSION:2.0', 'VERSION:2.0\r\nMETHOD:REQUEST')), []);
  assert.deepEqual(suggestionsFromIcs('garbage'), []);
});

test('Dates with times in German and English text', () => {
  const date = '2026-11-18T10:00:00Z';
  const cases = [
    ['Treffen am 12.12.2026 um 14:30 im Büro', '2026-12-12T14:30', '2026-12-12T15:30'],
    ['Termin: Mittwoch, 3. Dezember 2026, 10:00–11:30 Uhr', '2026-12-03T10:00', '2026-12-03T11:30'],
    ['Wir sehen uns am 5.12. um 9 Uhr.', '2026-12-05T09:00', '2026-12-05T10:00'],
    ['Call on December 4, 2026 at 2:30 pm', '2026-12-04T14:30', '2026-12-04T15:30'],
    ['Meeting 2026-12-07 14:00 - 15:00', '2026-12-07T14:00', '2026-12-07T15:00'],
    ['Abholung 8. Jänner von 9 bis 11 Uhr', '2027-01-08T09:00', '2027-01-08T11:00']
  ];
  for (const [text, start, end] of cases) {
    const [s] = suggestionsFromText(text, { subject: 'AW: Besprechung', date });
    assert.ok(s, `nothing found in: ${text}`);
    assert.deepEqual([s.start, s.end, s.floating, s.summary], [start, end, true, 'Besprechung'], text);
  }
});

test('No suggestion for dates without time, past dates, quoted history or numbers', () => {
  const date = '2026-11-18T10:00:00Z';
  for (const text of [
    'Rechnung vom 12.12.2026',
    'Die Lieferung kommt am 3. Dezember.',
    'Am 3.1.2025 um 10:00 war das Meeting.',
    'Version 2.2.2 ist da, 15 neue Funktionen',
    'Danke!\n\nAm 17.11.2026 um 09:12 schrieb Anna:\n> Termin am 12.12.2026 um 14:30?'
  ]) {
    assert.deepEqual(suggestionsFromText(text, { date }), [], text);
  }
});

test('ownText strips quoted replies and forwarded history', () => {
  assert.equal(ownText('Neu\n> alt\nauch neu'), 'Neu\nauch neu');
  assert.equal(ownText('Oben\n-----Original Message-----\nunten'), 'Oben');
  assert.equal(ownText('Hallo\nOn Mon, 3 Nov 2026 at 10:00, Bob <b@x.at> wrote:\nalt'), 'Hallo');
});

test('Structured data wins over the text heuristic and duplicates are removed', () => {
  const event = { '@type': 'Event', name: 'Workshop', startDate: '2026-12-10T09:00:00+01:00' };
  const html = ld([event, event]);
  const list = extractEventSuggestions({ html, text: 'Workshop am 10.12.2026 um 09:00 Uhr', subject: 'Workshop' });
  assert.equal(list.length, 1);
  assert.equal(list[0].source, 'schema');
});

test('At most three suggestions; missing summary falls back to the subject', () => {
  const text = [1, 2, 3, 4, 5].map(d => `Termin am ${d}.12.2026 um 10:00`).join('\n');
  const list = extractEventSuggestions({ text, subject: 'Re: Schulung', date: '2026-11-18' });
  assert.equal(list.length, 3);
  assert.ok(list.every(s => s.summary === 'Schulung'));
  const [ev] = extractEventSuggestions({
    html: ld({ '@type': 'Event', startDate: '2026-12-01' }),
    subject: 'Einladung'
  });
  assert.deepEqual([ev.summary, ev.allDay, ev.start, ev.end], ['Einladung', true, '2026-12-01', '2026-12-02']);
});
