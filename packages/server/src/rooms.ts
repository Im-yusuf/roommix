import { randomUUID } from 'node:crypto';
import { createRoom, type Room } from './room.js';
import type { Connection } from './transport.js';

export interface RoomsOptions {
  maxRoomSize?: number;
  now?: () => number;
}

/** Registry of rooms, created on first join and torn down when the last participant leaves. */
export function createRooms(options: RoomsOptions = {}) {
  const rooms = new Map<string, Room>();

  function dispose(room: Room): void {
    room.dispose();
    rooms.delete(room.name);
  }

  return {
    join(
      connection: Connection,
      roomName: string,
      displayName: string,
      requestedId?: string,
    ): { ok: true; room: Room; clientId: string } | { ok: false; reason: 'room_full' } {
      let room = rooms.get(roomName);
      if (!room) {
        const created = createRoom(roomName, {
          maxParticipants: options.maxRoomSize,
          now: options.now,
          onEmpty: () => dispose(created),
        });
        room = created;
        rooms.set(roomName, room);
      }
      const clientId = requestedId ?? randomUUID();
      const result = room.add(connection, displayName, clientId);
      if (!result.ok) {
        if (room.size === 0) dispose(room);
        return result;
      }
      return { ok: true, room, clientId };
    },

    get(name: string): Room | undefined {
      return rooms.get(name);
    },

    get size(): number {
      return rooms.size;
    },

    disposeAll(): void {
      for (const room of rooms.values()) room.dispose();
      rooms.clear();
    },
  };
}

export type Rooms = ReturnType<typeof createRooms>;
