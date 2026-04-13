// In-memory game state — server only, zero dependencies

import scenarios from "@/data/scenarios.json";

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
  timerSeconds: number; // 0 = no timer
  timerStartedAt: number | null; // epoch ms when timer started
  // Per-round data
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

type Listener = (room: Room) => void;

const rooms = new Map<string, Room>();
const listeners = new Map<string, Set<Listener>>();

function notify(code: string) {
  const room = rooms.get(code);
  const set = listeners.get(code);
  if (!room || !set) return;
  const snap = JSON.parse(JSON.stringify(room));
  set.forEach((fn) => fn(snap));
}

// --- Public API ---

export function createRoom(code: string, facilitator: Player, totalRounds: number): Room {
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
  rooms.set(code, room);
  listeners.set(code, new Set());
  return room;
}

export function roomExists(code: string) {
  return rooms.has(code);
}

export function joinRoom(code: string, player: Player): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  room.players[player.id] = player;
  notify(code);
  return true;
}

export function subscribe(code: string, listener: Listener): () => void {
  let set = listeners.get(code);
  if (!set) { set = new Set(); listeners.set(code, set); }
  set.add(listener);
  const room = rooms.get(code);
  if (room) listener(JSON.parse(JSON.stringify(room)));
  return () => { set!.delete(listener); };
}

export function removePlayer(code: string, playerId: string) {
  const room = rooms.get(code);
  if (!room) return;
  delete room.players[playerId];
  if (Object.keys(room.players).length === 0) {
    rooms.delete(code);
    listeners.delete(code);
  } else {
    notify(code);
  }
}

export function act(code: string, playerId: string, action: { type: string;[k: string]: any }): string | null {
  const room = rooms.get(code);
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
      room.timerStartedAt = null; // clear timer on phase change
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
      // Save current round
      room.roundHistory.push({
        cardIndex: room.currentCardIndex!,
        votes: { ...room.votes },
        reasons: { ...room.reasons },
        revisedVotes: { ...room.revisedVotes },
      });
      // Clear round state
      room.votes = {};
      room.reasons = {};
      room.revisedVotes = {};

      if (room.currentRound >= room.totalRounds) {
        room.phase = "summary";
        break;
      }
      room.currentRound++;
      drawCard(room);
      room.phase = "draw";
      break;
    }
    default:
      return "Unknown action";
  }

  notify(code);
  return null;
}

function drawCard(room: Room) {
  const available = scenarios.map((_, i) => i).filter((i) => !room.cardsPlayed.includes(i));
  if (available.length === 0) return;
  const idx = available[Math.floor(Math.random() * available.length)];
  room.currentCardIndex = idx;
  room.cardsPlayed.push(idx);
}
