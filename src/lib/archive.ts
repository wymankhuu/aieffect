import { sql } from "./db";
import scenarios from "@/data/scenarios.json";
import type { Room, Vote } from "./game-store";

export type RoundSnapshot = {
  cardIndex: number;
  votes: Record<string, Vote>;
  reasons: Record<string, { text: string; name: string }>;
  revisedVotes: Record<string, Vote>;
};

/**
 * Writes a completed round to Postgres. On first call for a room, also inserts
 * a `sessions` row and mutates `room.dbSessionId` so the caller must persist
 * the room afterwards.
 *
 * Idempotency: per-session via the unique (session_id, round_number, player_id)
 * constraint — retrying the same snapshot under the same dbSessionId is safe.
 * NOT idempotent across the gap between the session insert and the caller's
 * `saveRoom`: if the process dies after the session row commits but before
 * dbSessionId is persisted to Redis, a retry will create a new (empty) session
 * row. To minimise that window, callers should persist the room as soon as
 * dbSessionId transitions from null to a UUID.
 */
export async function archiveRound(room: Room, snapshot: RoundSnapshot): Promise<void> {
  if (!room.dbSessionId) {
    const facilitator = Object.values(room.players).find((p) => p.isFacilitator);
    const rows = await sql`
      INSERT INTO sessions (room_code, total_rounds, rounds_completed, facilitator_name, player_count)
      VALUES (${room.code}, ${room.totalRounds}, 0, ${facilitator?.name ?? null}, ${Object.keys(room.players).length})
      RETURNING id
    `;
    room.dbSessionId = (rows[0] as { id: string }).id;
  }

  const scenario = scenarios[snapshot.cardIndex];
  const scenarioText = (scenario as { text: string } | undefined)?.text ?? "";

  // Union of player ids that appear in this round's votes/reasons/revisedVotes
  const playerIds = new Set<string>([
    ...Object.keys(snapshot.votes),
    ...Object.keys(snapshot.reasons),
    ...Object.keys(snapshot.revisedVotes),
  ]);

  for (const playerId of playerIds) {
    const playerName =
      room.players[playerId]?.name ?? snapshot.reasons[playerId]?.name ?? "(unknown)";
    const initialVote = snapshot.votes[playerId] ?? null;
    const reasonText = snapshot.reasons[playerId]?.text ?? null;
    const revisedVote = snapshot.revisedVotes[playerId] ?? null;

    await sql`
      INSERT INTO responses (
        session_id, round_number, scenario_index, scenario_text,
        player_id, player_name, initial_vote, reason_text, revised_vote
      )
      VALUES (
        ${room.dbSessionId}, ${room.currentRound}, ${snapshot.cardIndex}, ${scenarioText},
        ${playerId}, ${playerName}, ${initialVote}, ${reasonText}, ${revisedVote}
      )
      ON CONFLICT (session_id, round_number, player_id) DO NOTHING
    `;
  }

  await sql`
    UPDATE sessions SET rounds_completed = ${room.roundHistory.length}
    WHERE id = ${room.dbSessionId}
  `;
}

export async function markSessionComplete(room: Room): Promise<void> {
  if (!room.dbSessionId) return;
  await sql`
    UPDATE sessions SET completed_at = now()
    WHERE id = ${room.dbSessionId} AND completed_at IS NULL
  `;
}
