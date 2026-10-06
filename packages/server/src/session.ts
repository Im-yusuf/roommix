import { MixerError } from '@roommix/core';
import { type ErrorCode, parseClientMessage, type ServerMessage } from './protocol.js';
import type { Room } from './room.js';
import type { Rooms } from './rooms.js';
import type { Connection } from './transport.js';

/**
 * Per-connection protocol handler: parses messages, routes them to the room
 * the connection joined, and turns every failure into an error message the
 * client can show. Fatal errors close the connection.
 */
export function attachSession(connection: Connection, rooms: Rooms): void {
  let room: Room | undefined;
  let clientId: string | undefined;

  const reply = (message: ServerMessage) => connection.send(JSON.stringify(message));
  const fail = (code: ErrorCode, message: string, fatal = false) => {
    reply({ type: 'error', code, message, fatal });
    if (fatal) connection.close(message);
  };

  connection.onMessage((data) => {
    if (typeof data !== 'string') {
      if (!room || !clientId) return fail('not_joined', 'Join a room before sending audio');
      try {
        room.pushAudio(clientId, data);
      } catch (error) {
        if (!(error instanceof MixerError)) throw error;
        if (error.code === 'unknown_source') return fail('no_source', 'Send "start" before audio');
        fail('invalid_audio', error.message);
      }
      return;
    }

    const message = parseClientMessage(data);
    if (typeof message === 'string') return fail('bad_message', message);

    if (message.type === 'join') {
      if (room) return fail('bad_message', 'Already joined a room');
      const result = rooms.join(connection, message.room, message.name, message.clientId);
      if (!result.ok) return fail('room_full', `Room "${message.room}" is full`, true);
      room = result.room;
      clientId = result.clientId;
      reply({ type: 'joined', clientId, room: room.name, strategy: room.strategy });
      return;
    }
    if (!room || !clientId) return fail('not_joined', 'Join a room first');

    switch (message.type) {
      case 'start':
        try {
          room.startSource(clientId, message.sampleRate, message.channels);
        } catch (error) {
          if (!(error instanceof MixerError)) throw error;
          fail('invalid_audio', error.message);
        }
        return;
      case 'stop':
        room.stopSource(clientId);
        return;
      case 'subscribe':
        room.subscribe(clientId, message.enabled);
        return;
      case 'strategy':
        room.setStrategy(message.name);
        return;
      case 'leave':
        room.remove(clientId, connection);
        room = undefined;
        clientId = undefined;
        connection.close('left');
        return;
    }
  });

  connection.onClose(() => {
    if (room && clientId) room.remove(clientId, connection);
  });
}
