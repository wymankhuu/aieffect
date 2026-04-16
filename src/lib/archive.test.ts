import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { archiveRound, markSessionComplete, type RoundSnapshot } from "./archive";
import { sql } from "./db";
import scenarios from "@/data/scenarios.json";
import type { Room } from "./game-store";

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    code: "TEST",
    phase: "draw",
    totalRounds: 3,
    currentRound: 1,
    currentCardIndex: 0,
    cardsPlayed: [0],
    players: {
      p1: { id: "p1", name: "Alice", isFacilitator: true },
      p2: { id: "p2", name: "Bob", isFacilitator: false },
    },
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
    ...overrides,
  };
}

const round1: RoundSnapshot = {
  cardIndex: 0,
  votes: { p1: "support", p2: "erode" },
  reasons: { p1: { text: "good", name: "Alice" }, p2: { text: "bad", name: "Bob" } },
  revisedVotes: { p1: "support", p2: "depends" },
};

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set — start docker postgres and source .env.local");
  }
});

beforeEach(async () => {
  await sql.query("TRUNCATE responses, sessions RESTART IDENTITY CASCADE");
});

describe("archiveRound", () => {
  it("inserts a session row on first call and sets room.dbSessionId", async () => {
    const room = makeRoom();
    room.roundHistory.push(round1);
    await archiveRound(room, round1);
    expect(room.dbSessionId).toMatch(/^[0-9a-f-]{36}$/);
    const sessions = await sql.query<{ room_code: string; player_count: number; rounds_completed: number; facilitator_name: string }>(
      "SELECT room_code, player_count, rounds_completed, facilitator_name FROM sessions"
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].room_code).toBe("TEST");
    expect(sessions[0].player_count).toBe(2);
    expect(sessions[0].rounds_completed).toBe(1);
    expect(sessions[0].facilitator_name).toBe("Alice");
  });

  it("reuses the session on second call and increments rounds_completed", async () => {
    const room = makeRoom();
    room.roundHistory.push(round1);
    await archiveRound(room, round1);
    const firstId = room.dbSessionId;

    const round2: RoundSnapshot = {
      cardIndex: 1,
      votes: { p1: "depends" },
      reasons: { p1: { text: "meh", name: "Alice" } },
      revisedVotes: {},
    };
    room.currentRound = 2;
    room.roundHistory.push(round2);
    await archiveRound(room, round2);

    expect(room.dbSessionId).toBe(firstId);
    const sessions = await sql.query<{ rounds_completed: number }>(
      "SELECT rounds_completed FROM sessions"
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].rounds_completed).toBe(2);
    const responses = await sql.query("SELECT round_number FROM responses ORDER BY round_number");
    expect(responses).toHaveLength(3); // 2 from round 1 + 1 from round 2
  });

  it("is idempotent under retry (unique constraint)", async () => {
    const room = makeRoom();
    room.roundHistory.push(round1);
    await archiveRound(room, round1);
    await archiveRound(room, round1); // retry same round
    const responses = await sql.query("SELECT * FROM responses");
    expect(responses).toHaveLength(2); // not 4
  });

  it("falls back to reasons[playerId].name if player has been kicked", async () => {
    const room = makeRoom();
    delete room.players.p2; // p2 was kicked but their reason was captured
    room.roundHistory.push(round1);
    await archiveRound(room, round1);
    const responses = await sql.query<{ player_id: string; player_name: string }>(
      "SELECT player_id, player_name FROM responses ORDER BY player_id"
    );
    expect(responses.find((r) => r.player_id === "p2")?.player_name).toBe("Bob");
  });

  it("denormalizes scenario_text from scenarios.json at archive time", async () => {
    const room = makeRoom();
    room.roundHistory.push(round1);
    await archiveRound(room, round1);
    const responses = await sql.query<{ scenario_text: string }>(
      "SELECT DISTINCT scenario_text FROM responses"
    );
    expect(responses[0].scenario_text).toBe((scenarios[0] as { text: string }).text);
  });
});

describe("markSessionComplete", () => {
  it("sets completed_at the first time and is idempotent thereafter", async () => {
    const room = makeRoom();
    room.roundHistory.push(round1);
    await archiveRound(room, round1);

    await markSessionComplete(room);
    const first = await sql.query<{ completed_at: Date }>("SELECT completed_at FROM sessions");
    expect(first[0].completed_at).not.toBeNull();
    const firstMs = first[0].completed_at.getTime();

    // Second call should NOT change completed_at (idempotent — guarded by IS NULL).
    await new Promise((r) => setTimeout(r, 10));
    await markSessionComplete(room);
    const second = await sql.query<{ completed_at: Date }>("SELECT completed_at FROM sessions");
    expect(second[0].completed_at.getTime()).toBe(firstMs);
  });

  it("is a no-op if room has no dbSessionId", async () => {
    const room = makeRoom();
    expect(room.dbSessionId).toBeNull();
    await expect(markSessionComplete(room)).resolves.toBeUndefined();
  });
});
