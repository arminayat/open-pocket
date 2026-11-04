import assert from 'node:assert/strict';
import test from 'node:test';
import { PocketError, ResponseDecoder, parseRecording, parseResponse, positiveSize, recorderColor, TransferCounter, validateDeviceKey, validateDirectories, validateListing } from '../src/lib/pocket/protocol';

test('recorder color comes from the name finish and falls back to grey', () => {
  assert.equal(recorderColor('PKT01_GREY_DEMO1234'), 'grey');
  assert.equal(recorderColor('PKT01_BLUE_DEMO1234'), 'blue');
  assert.equal(recorderColor('pkt01_pink_demo1234'), 'pink');
  assert.equal(recorderColor('PKT01_SIERRABLUE_DEMO'), 'blue');
  assert.equal(recorderColor('Pocket'), 'grey');
  assert.equal(recorderColor(undefined), 'grey');
});

test('metadata decoder retains fragmented prefixes and fields and splits concatenated replies', () => {
  const decoder = new ResponseDecoder();
  assert.deepEqual(decoder.feed('MC'), []);
  assert.deepEqual(decoder.flush(), []);
  assert.deepEqual(decoder.feed('U&F&2026-10-07&'), []);
  assert.deepEqual(decoder.flush(), []);
  assert.deepEqual(decoder.feed('PH261007112233&25\0MCU&LIST&001'), [{ name: 'F', value: '2026-10-07&PH261007112233&25' }]);
  assert.deepEqual(decoder.flush(), [{ name: 'LIST', value: '001' }]);
  assert.deepEqual(decoder.flush(), []);
});

test('control data cannot grow without limit', () => {
  assert.throws(() => new ResponseDecoder().feed('x'.repeat(8193)), PocketError);
  assert.equal(parseResponse('APP&SK&do-not-log'), null);
  assert.deepEqual(parseResponse('MCU&OFF\0'), { name: 'OFF', value: '' });
});

test('recording listing preserves opaque phone-call IDs and interprets durations as seconds', () => {
  const recording = parseRecording('2026-10-07&PH261007112233&25', '2026-10-07');
  assert.equal(recording.timestamp, 'PH261007112233');
  assert.equal(recording.durationSeconds, 25);
  assert.equal(recording.id, '2026-10-07/PH261007112233');
  assert.deepEqual(validateListing([{ name: 'F', value: '2026-10-07&PH261007112233&25' }], '001', '2026-10-07'), [recording]);
  assert.deepEqual(validateListing([], '0', '2026-10-07'), []);
});

test('short, unsafe, duplicate, wrong-date and malformed listings fail', () => {
  assert.throws(() => validateListing([], '1', '2026-10-07'));
  for (const entry of ['2026-10-07&../secret&2', '2026-10-06&20261006112233&2', '2026-10-07&20261007112233&NaN', '2026-10-07&20261007112233']) {
    assert.throws(() => validateListing([{ name: 'F', value: entry }], '1', '2026-10-07'));
  }
  const file = { name: 'F', value: '2026-10-07&20261007112233&2' };
  assert.throws(() => validateListing([file, file], '2', '2026-10-07'));
  assert.throws(() => validateDirectories([{ name: 'DIRS', value: '2026-10-07' }], '2'));
  assert.throws(() => validateDirectories([{ name: 'DIRS', value: '../' }], '1'));
  assert.deepEqual(validateDirectories([{ name: 'DIRS', value: '2026-10-07' }], '001'), ['2026-10-07']);
});

test('byte accounting accepts fragmented data before size announcement and requires completion', () => {
  const counter = new TransferCounter();
  for (const size of [1, 3, 2, 5]) counter.add(size);
  assert.equal(counter.bytes, 11);
  assert.equal(counter.ended, false);
  counter.expect(11);
  assert.equal(counter.finish(), 11);
  assert.equal(counter.ended, true);
});

test('truncated, excessive, zero and changing-size transfers cannot complete', () => {
  const short = new TransferCounter(); short.expect(10); short.add(9);
  assert.throws(() => short.finish());
  assert.throws(() => short.add(2));
  assert.throws(() => new TransferCounter().expect(0));
  const changing = new TransferCounter(); changing.expect(10);
  assert.throws(() => changing.expect(11));
  assert.throws(() => new TransferCounter().finish());
  assert.equal(positiveSize('00010'), 10);
  for (const value of ['0', '-1', '10&OFF', 'NaN', '999999999999999999999']) assert.equal(positiveSize(value), null);
});

test('device key cannot inject another command', () => {
  validateDeviceKey('0123456789abcdef');
  for (const value of ['short', '0123456789abcde&', '0123456789abcde\n']) assert.throws(() => validateDeviceKey(value));
});
