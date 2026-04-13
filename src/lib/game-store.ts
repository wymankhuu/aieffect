// Game state backed by Upstash Redis — works across serverless functions

import { Redis } from "@upstash/redis";
import scenarios from "@/data/scenarios.json";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const ROOM_TTL = 7200; // 2 hours

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
  votes: Record<string, Vote>;
  reasons: Record<string, { text: string; name: string }>;
  revisedVotes: Record<string, Vote>;
  roundHistory: {
    cardIndex: number;
    votes: Record<string, Vote>;
    reasons: Record<string, { text: string; name: string }>;
    revisedVotes: Record<string, Vote>;
  }[];
};

function key(code: string) {
  return `room:${code}`;
}

export async function getRoom(code: string): Promise<Room | null> {
  return redis.get<Room>(key(code));
}

export async function roomExists(code: string): Promise<boolean> {
  return (await redis.exists(key(code))) === 1;
}

async function saveRoom(room: Room) {
  await redis.set(key(room.code), room, { ex: ROOM_TTL });
}

export async function createRoom(code: string, facilitator: Player, totalRounds: number): Promise<Room> {
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
    votes: {},
    reasons: {},
    revisedVotes: {},
    roundHistory: [],
  };
  await saveRoom(room);
  return room;
}

export async function joinRoom(code: string, player: Player): Promise<boolean> {
  const room = await getRoom(code);
  if (!room) return false;
  room.players[player.id] = player;
  await saveRoom(room);
  return true;
}

export async function removePlayer(code: string, playerId: string) {
  const room = await getRoom(code);
  if (!room) return;
  const wasFacilitator = room.players[playerId]?.isFacilitator;
  delete room.players[playerId];
  const remaining = Object.values(room.players);
  if (remaining.length === 0) {
    await redis.del(key(code));
    return;
  }
  // Auto-promote oldest player if facilitator left
  if (wasFacilitator && !remaining.some((p) => p.isFacilitator)) {
    remaining[0].isFacilitator = true;
  }
  await saveRoom(room);
}

export async function act(code: string, playerId: string, action: { type: string; [k: string]: any }): Promise<string | null> {
  const room = await getRoom(code);
  if (!room) return "Room not found";
  const player = room.players[playerId];
  if (!player) return "Not in room";

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
      room.phase = action.phase;
      room.timerStartedAt = null;
      break;
    }
    case "set-timer": {
      if (!player.isFacilitator) return "Not facilitator";
      room.timerSeconds = action.seconds ?? 0;
      room.timerStartedAt = null;
      break;
    }
    case "start-timer": {
      if (!player.isFacilitator) return "Not facilitator";
      room.timerStartedAt = Date.now();
      break;
    }
    case "vote": {
      room.votes[playerId] = action.vote;
      break;
    }
    case "reason": {
      room.reasons[playerId] = { text: action.text || "", name: action.name || player.name };
      break;
    }
    case "revote": {
      room.revisedVotes[playerId] = action.vote;
      break;
    }
    case "next-round": {
      if (!player.isFacilitator) return "Not facilitator";
      room.roundHistory.push({
        cardIndex: room.currentCardIndex!,
        votes: { ...room.votes },
        reasons: { ...room.reasons },
        revisedVotes: { ...room.revisedVotes },
      });
      room.votes = {};
      room.reasons = {};
      room.revisedVotes = {};
      room.timerStartedAt = null;

      if (room.currentRound >= room.totalRounds) {
        room.phase = "summary";
        break;
      }
      room.currentRound++;
      drawCard(room);
      room.phase = "draw";
      break;
    }
    case "end-game": {
      if (!player.isFacilitator) return "Not facilitator";
      // Save current round if mid-game
      if (room.currentCardIndex !== null && Object.keys(room.votes).length > 0) {
        room.roundHistory.push({
          cardIndex: room.currentCardIndex,
          votes: { ...room.votes },
          reasons: { ...room.reasons },
          revisedVotes: { ...room.revisedVotes },
        });
      }
      room.votes = {};
      room.reasons = {};
      room.revisedVotes = {};
      room.timerStartedAt = null;
      room.phase = "summary";
      break;
    }
    default:
      return "Unknown action";
  }

  await saveRoom(room);
  return null;
}

function drawCard(room: Room) {
  let available = scenarios.map((_, i) => i).filter((i) => !room.cardsPlayed.includes(i));
  // Recycle deck if all cards have been played
  if (available.length === 0) {
    room.cardsPlayed = [];
    available = scenarios.map((_, i) => i);
  }
  const idx = available[Math.floor(Math.random() * available.length)];
  room.currentCardIndex = idx;
  room.cardsPlayed.push(idx);
}
