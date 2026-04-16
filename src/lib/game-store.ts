// Game state backed by Upstash Redis — works across serverless functions

import { Redis } from "@upstash/redis";
import scenarios from "@/data/scenarios.json";
import { archiveRound, markSessionComplete } from "./archive";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const ROOM_TTL = 7200; // 2 hours
const LOCK_TTL = 5; // seconds — lock auto-expires if a function crashes
const LOCK_MAX_ATTEMPTS = 20;

export type Vote = "erode" | "depends" | "support";
export type Phase = "lobby" | "draw" | "vote" | "reason" | "reveal" | "reflect" | "summary";

export type Player = {
  id: string;
  name: string;
  isFacilitator: boolean;
};

export type Room = {
  code: string;
  phase: Phase;
  totalRounds: number;
  currentRound: number;
  currentCardIndex: number | null;
  cardsPlayed: number[];
  players: Record<string, Player>;
  timerSeconds: number;
  timerStartedAt: number | null;
  isPaused: boolean;
  pausedTimeLeft: number | null;
  autoAdvance: boolean;
  votes: Record<string, Vote>;
  reasons: Record<string, { text: string; name: string }>;
  revisedVotes: Record<string, Vote>;
  roundHistory: {
    cardIndex: number;
    votes: Record<string, Vote>;
    reasons: Record<string, { text: string; name: string }>;
    revisedVotes: Record<string, Vote>;
  }[];
  version: number;
  dbSessionId: string | null;
};

function key(code: string) {
  return `room:${code}`;
}
function lockKey(code: string) {
  return `lock:${code}`;
}

export async function getRoom(code: string): Promise<Room | null> {
  return redis.get<Room>(key(code));
}

export async function roomExists(code: string): Promise<boolean> {
  return (await redis.exists(key(code))) === 1;
}

async function saveRoom(room: Room) {
  room.version = (room.version ?? 0) + 1;
  await redis.set(key(room.code), room, { ex: ROOM_TTL });
}

// Distributed per-room lock via Redis SET NX EX. Serializes read-modify-write
// on the same room so simultaneous votes can't overwrite each other.
async function withRoomLock<T>(code: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(code);
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    const acquired = await redis.set(key, token, { nx: true, ex: LOCK_TTL });
    if (acquired === "OK") {
      try {
        return await fn();
      } finally {
        const current = await redis.get<string>(key);
        if (current === token) await redis.del(key);
      }
    }
    await new Promise((r) => setTimeout(r, 30 + attempt * 20));
  }
  throw new Error(`Could not acquire lock for room ${code}`);
}

// Atomic room creation via SET NX — returns false if code already taken.
export async function createRoomIfAbsent(code: string, facilitator: Player, totalRounds: number): Promise<Room | null> {
  const room: Room = {
    code,
    phase: "lobby",
    totalRounds,
    currentRound: 0,
    currentCardIndex: null,
    cardsPlayed: [],
    players: { [facilitator.id]: facilitator },
    timerSeconds: 0,
    timerStartedAt: null,
    isPaused: false,
    pausedTimeLeft: null,
    autoAdvance: false,
    votes: {},
    reasons: {},
    revisedVotes: {},
    roundHistory: [],
    version: 1,
    dbSessionId: null,
  };
  const result = await redis.set(key(code), room, { nx: true, ex: ROOM_TTL });
  return result === "OK" ? room : null;
}

export async function joinRoom(code: string, player: Player): Promise<boolean> {
  return withRoomLock(code, async () => {
    const room = await getRoom(code);
    if (!room) return false;
    room.players[player.id] = player;
    await saveRoom(room);
    return true;
  });
}

export async function removePlayer(code: string, playerId: string) {
  return withRoomLock(code, async () => {
    const room = await getRoom(code);
    if (!room) return;
    const wasFacilitator = room.players[playerId]?.isFacilitator;
    delete room.players[playerId];
    const remaining = Object.values(room.players);
    if (remaining.length === 0) {
      await redis.del(key(code));
      return;
    }
    if (wasFacilitator && !remaining.some((p) => p.isFacilitator)) {
      remaining[0].isFacilitator = true;
    }
    await saveRoom(room);
  });
}

const NEXT_PHASE: Partial<Record<Phase, Phase>> = {
  draw: "vote",
  vote: "reason",
  reason: "reveal",
};

export async function checkAutoAdvance(code: string): Promise<void> {
  // Cheap pre-check without the lock to avoid hammering it on every poll.
  const room = await getRoom(code);
  if (!room || !room.autoAdvance || room.isPaused) return;
  if (!room.timerStartedAt || !room.timerSeconds) return;
  const elapsed = Math.floor((Date.now() - room.timerStartedAt) / 1000);
  if (elapsed < room.timerSeconds) return;

  // Condition holds — take the lock and re-check to avoid a thundering herd of
  // identical auto-advance writes from every polling client.
  await withRoomLock(code, async () => {
    const fresh = await getRoom(code);
    if (!fresh || !fresh.autoAdvance || fresh.isPaused) return;
    if (!fresh.timerStartedAt || !fresh.timerSeconds) return;
    const freshElapsed = Math.floor((Date.now() - fresh.timerStartedAt) / 1000);
    if (freshElapsed < fresh.timerSeconds) return;
    const nextPhase = NEXT_PHASE[fresh.phase as Phase];
    if (!nextPhase) return;
    fresh.phase = nextPhase;
    fresh.timerStartedAt = null;
    await saveRoom(fresh);
  });
}

export async function act(
  code: string,
  playerId: string,
  action: { type: string } & Record<string, unknown>,
): Promise<string | null> {
  return withRoomLock(code, async () => {
    const room = await getRoom(code);
    if (!room) return "Room not found";
    const player = room.players[playerId];
    if (!player) return "Not in room";

    const pauseExempt = ["pause", "resume", "end-game", "kick"];
    if (room.isPaused && !pauseExempt.includes(action.type)) {
      return "Game is paused";
    }

    switch (action.type) {
      case "start": {
        if (!player.isFacilitator) return "Not facilitator";
        room.currentRound = 1;
        drawCard(room);
        room.phase = "draw";
        break;
      }
      case "advance": {
        if (!player.isFacilitator) return "Not facilitator";
        room.phase = action.phase as Phase;
        room.timerStartedAt = null;
        break;
      }
      case "set-timer": {
        if (!player.isFacilitator) return "Not facilitator";
        room.timerSeconds = (action.seconds as number | undefined) ?? 0;
        room.timerStartedAt = null;
        break;
      }
      case "start-timer": {
        if (!player.isFacilitator) return "Not facilitator";
        room.timerStartedAt = Date.now();
        break;
      }
      case "vote": {
        room.votes[playerId] = action.vote as Vote;
        break;
      }
      case "reason": {
        const text = (action.text as string | undefined) ?? "";
        const name = (action.name as string | undefined) ?? player.name;
        room.reasons[playerId] = { text, name };
        break;
      }
      case "revote": {
        room.revisedVotes[playerId] = action.vote as Vote;
        break;
      }
      case "next-round": {
        if (!player.isFacilitator) return "Not facilitator";
        const snapshot = {
          cardIndex: room.currentCardIndex!,
          votes: { ...room.votes },
          reasons: { ...room.reasons },
          revisedVotes: { ...room.revisedVotes },
        };
        room.roundHistory.push(snapshot);
        // Persist dbSessionId to Redis as soon as it's allocated, to minimise the
        // window where a crash could create an orphan session row on retry.
        const hadDbSessionBefore = room.dbSessionId !== null;
        try {
          await archiveRound(room, snapshot);
          if (!hadDbSessionBefore && room.dbSessionId) {
            await saveRoom(room);
          }
        } catch (err) {
          console.error("archiveRound failed", { code: room.code, round: room.currentRound, err });
        }
        room.votes = {};
        room.reasons = {};
        room.revisedVotes = {};
        room.timerStartedAt = null;

        if (room.currentRound >= room.totalRounds) {
          room.phase = "summary";
          try {
            await markSessionComplete(room);
          } catch (err) {
            console.error("markSessionComplete failed", { code: room.code, err });
          }
          break;
        }
        room.currentRound++;
        drawCard(room);
        room.phase = "draw";
        break;
      }
      case "end-game": {
        if (!player.isFacilitator) return "Not facilitator";
        if (room.currentCardIndex !== null && Object.keys(room.votes).length > 0) {
          const snapshot = {
            cardIndex: room.currentCardIndex,
            votes: { ...room.votes },
            reasons: { ...room.reasons },
            revisedVotes: { ...room.revisedVotes },
          };
          room.roundHistory.push(snapshot);
          const hadDbSessionBefore = room.dbSessionId !== null;
          try {
            await archiveRound(room, snapshot);
            if (!hadDbSessionBefore && room.dbSessionId) {
              await saveRoom(room);
            }
          } catch (err) {
            console.error("archiveRound failed", { code: room.code, round: room.currentRound, err });
          }
        }
        room.votes = {};
        room.reasons = {};
        room.revisedVotes = {};
        room.timerStartedAt = null;
        room.phase = "summary";
        try {
          await markSessionComplete(room);
        } catch (err) {
          console.error("markSessionComplete failed", { code: room.code, err });
        }
        break;
      }
      case "pause": {
        if (!player.isFacilitator) return "Not facilitator";
        if (room.isPaused) return "Already paused";
        room.isPaused = true;
        if (room.timerStartedAt !== null) {
          const elapsed = Math.floor((Date.now() - room.timerStartedAt) / 1000);
          room.pausedTimeLeft = Math.max(0, room.timerSeconds - elapsed);
          room.timerStartedAt = null;
        }
        break;
      }
      case "resume": {
        if (!player.isFacilitator) return "Not facilitator";
        if (!room.isPaused) return "Not paused";
        room.isPaused = false;
        if (room.pausedTimeLeft !== null) {
          room.timerSeconds = room.pausedTimeLeft;
          room.timerStartedAt = Date.now();
          room.pausedTimeLeft = null;
        }
        break;
      }
      case "skip-scenario": {
        if (!player.isFacilitator) return "Not facilitator";
        if (room.phase !== "draw") return "Can only skip during draw phase";
        drawCard(room);
        room.timerStartedAt = null;
        break;
      }
      case "kick": {
        if (!player.isFacilitator) return "Not facilitator";
        const targetId = action.targetId as string | undefined;
        if (!targetId || !room.players[targetId]) return "Player not found";
        if (room.players[targetId].isFacilitator) return "Cannot kick facilitator";
        delete room.players[targetId];
        delete room.votes[targetId];
        delete room.reasons[targetId];
        delete room.revisedVotes[targetId];
        break;
      }
      case "toggle-auto-advance": {
        if (!player.isFacilitator) return "Not facilitator";
        room.autoAdvance = !room.autoAdvance;
        break;
      }
      default:
        return "Unknown action";
    }

    await saveRoom(room);
    return null;
  });
}

function drawCard(room: Room) {
  let available = scenarios.map((_, i) => i).filter((i) => !room.cardsPlayed.includes(i));
  if (available.length === 0) {
    room.cardsPlayed = [];
    available = scenarios.map((_, i) => i);
  }
  const idx = available[Math.floor(Math.random() * available.length)];
  room.currentCardIndex = idx;
  room.cardsPlayed.push(idx);
}
