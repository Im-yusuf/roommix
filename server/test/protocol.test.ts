import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../src/protocol.js';

describe('protocol', () => {
  it('accepts well-formed messages and trims the name', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'join', room: 'r1', name: '  Ann ' })),
    ).toEqual({
      type: 'join',
      room: 'r1',
      name: 'Ann',
      clientId: undefined,
    });
    expect(parseClientMessage('{"type":"start","sampleRate":48000}')).toEqual({
      type: 'start',
      sampleRate: 48000,
      channels: undefined,
    });
    expect(parseClientMessage('{"type":"subscribe","enabled":true}')).toEqual({
      type: 'subscribe',
      enabled: true,
    });
    expect(parseClientMessage('{"type":"leave"}')).toEqual({ type: 'leave' });
  });

  it('describes what is wrong with malformed messages', () => {
    expect(parseClientMessage('nope')).toMatch(/JSON/);
    expect(parseClientMessage('{"type":"join","room":"bad room","name":"x"}')).toMatch(/room/);
    expect(parseClientMessage('{"type":"join","room":"r1","name":"   "}')).toMatch(/name/);
    expect(parseClientMessage('{"type":"start","sampleRate":"48000"}')).toMatch(/sampleRate/);
    expect(parseClientMessage('{"type":"start","sampleRate":48000,"channels":3}')).toMatch(
      /channels/,
    );
    expect(parseClientMessage('{"type":"strategy","name":"loudest"}')).toMatch(/strategy/);
    expect(parseClientMessage('{"type":"dance"}')).toMatch(/unknown message type/);
    expect(parseClientMessage(`{"type":"join","room":"r1","name":"${'x'.repeat(5000)}"}`)).toMatch(
      /too long/,
    );
  });
});
