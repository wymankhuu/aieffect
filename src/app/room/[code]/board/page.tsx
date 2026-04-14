"use client";

import { use, useEffect, useState } from "react";
import scenarios from "@/data/scenarios.json";
import {
  HeartOff, Scale, HeartHandshake, User, Timer,
  Users, Layers, MessageSquareWarning, Pause, X,
} from "lucide-react";
import { BlurFade } from "@/components/ui/blur-fade";
import { MagicCard } from "@/components/ui/magic-card";
import { BorderBeam } from "@/components/ui/border-beam";
import { Confetti } from "@/components/ui/confetti";
import { motion, AnimatePresence } from "framer-motion";

type Vote = "erode" | "depends" | "support";
type Room = {
  code: string;
  phase: string;
  totalRounds: number;
  currentRound: number;
  currentCardIndex: number | null;
  players: Record<string, { id: string; name: string; isFacilitator: boolean }>;
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
};

const cols = [
  { vote: "erode" as Vote, label: "Erode Human Connection", icon: HeartOff, color: "text-[#DC2626]", bg: "bg-[#FEE2E2]", bl: "border-l-[#DC2626]", barBg: "bg-[#DC2626]" },
  { vote: "depends" as Vote, label: "It Depends", icon: Scale, color: "text-[#B45309]", bg: "bg-[#FEF3C7]", bl: "border-l-[#F59E0B]", barBg: "bg-[#F59E0B]" },
  { vote: "support" as Vote, label: "Support Human Connection", icon: HeartHandshake, color: "text-[#047857]", bg: "bg-[#D1FAE5]", bl: "border-l-[#10B981]", barBg: "bg-[#10B981]" },
];

export default function BoardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [room, setRoom] = useState<Room | null>(null);

  useEffect(() => {
    let active = true;
    let etag: string | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/room/poll?code=${code}`, {
          headers: etag ? { "If-None-Match": etag } : undefined,
        });
        if (!active) return;
        if (res.status === 304) return;
        if (res.ok) {
          etag = res.headers.get("ETag");
          setRoom(await res.json());
        }
      } catch {}
    };
    const schedule = () => {
      timer = setTimeout(async () => {
        await poll();
        if (active) schedule();
      }, 1300 + Math.random() * 400);
    };
    poll();
    schedule();
    return () => { active = false; clearTimeout(timer); };
  }, [code]);

  if (!room) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#FAF4E8]">
        <p className="text-[#8B7FA8]">Connecting to room {code}...</p>
      </div>
    );
  }

  const scenario = room.currentCardIndex !== null ? scenarios[room.currentCardIndex] : null;
  const playerCount = Object.keys(room.players).length;
  const isLargeGroup = playerCount >= 30;

  // Merge votes
  const activeVotes = { ...room.votes, ...(room.phase === "reflect" ? room.revisedVotes : {}) };
  const grouped: Record<Vote, { id: string; text: string; name: string }[]> = { erode: [], depends: [], support: [] };
  Object.entries(activeVotes).forEach(([id, vote]) => {
    const r = room.reasons[id];
    grouped[vote].push({ id, text: r?.text || "", name: r?.name || "Player" });
  });
  const totalVotes = Object.keys(activeVotes).length;

  const showBoard = room.phase === "reveal" || room.phase === "reflect";

  return (
    <div className="relative flex min-h-dvh flex-col bg-[#FAF4E8] text-[#1A1033]">
      {room.isPaused && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <Pause className="h-16 w-16 text-[#FF6699]" />
            <p className="text-4xl font-black text-[#2D1F4F]">Game Paused</p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between py-4 pl-52 pr-8">
        <div className="flex items-center gap-4">
          <span className="text-sm font-bold tracking-widest text-[#FF6699]">{room.code}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-[#8B7FA8]"><Users className="h-4 w-4" /> {playerCount} players</div>
          <div className="flex items-center gap-2 text-sm text-[#8B7FA8]"><Layers className="h-4 w-4" /> Round {room.currentRound} of {room.totalRounds}</div>
          <BoardTimer room={room} />
          <button
            onClick={() => { if (window.opener) window.close(); else window.history.back(); }}
            className="flex items-center gap-1.5 rounded-full border-2 border-[#1A1033] px-4 py-1.5 text-xs font-bold text-[#1A1033] transition-colors hover:bg-[#1A1033] hover:text-[#FAF4E8]"
            title="Exit projector mode"
          >
            <X className="h-3.5 w-3.5" /> Exit Projector
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-8 py-6">
        {/* Scenario card — always visible during game */}
        {scenario && room.phase !== "lobby" && room.phase !== "summary" && (
          <div className="mx-auto mb-6 w-full max-w-3xl">
            <MagicCard className="relative overflow-hidden rounded-2xl border-2 border-[#1A1033]/30 bg-gradient-to-br from-[#FFFBF2] to-[#F5EAD4] p-10 sm:p-14" gradientColor="rgba(255,51,102,0.06)">
              <div className="flex items-start gap-4">
                <MessageSquareWarning className="mt-1 h-6 w-6 flex-shrink-0 text-[#FF3366]" />
                <p className="text-2xl leading-relaxed text-[#1A1033] font-medium">{scenario.text}</p>
              </div>
              <BorderBeam size={150} duration={4} colorFrom="#FF3366" colorTo="#1A1033" />
            </MagicCard>
          </div>
        )}

        {/* LOBBY */}
        {room.phase === "lobby" && (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <p className="text-2xl font-bold text-[#6B5F87]">Waiting for players to join...</p>
              <p className="mt-2 text-6xl font-black tracking-widest text-[#FF6699]">{room.code}</p>
              <p className="mt-4 text-lg text-[#8B7FA8]">{playerCount} player{playerCount !== 1 ? "s" : ""} connected</p>
            </div>
          </div>
        )}

        {/* DRAW */}
        {room.phase === "draw" && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-lg text-[#8B7FA8]">Read the scenario above...</p>
          </div>
        )}

        {/* VOTE */}
        {room.phase === "vote" && (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <p className="text-2xl font-bold text-[#3F2F6A]">Voting in progress...</p>
              <div className="mt-4 flex justify-center gap-8">
                {cols.map((c) => (
                  <div key={c.vote} className={`flex items-center gap-2 text-lg ${c.color}`}>
                    <c.icon className="h-6 w-6" /> {c.label}
                  </div>
                ))}
              </div>
              <p className="mt-6 text-4xl font-black text-[#1A1033]">{Object.keys(room.votes).length} <span className="text-lg font-normal text-[#8B7FA8]">of {playerCount} voted</span></p>
            </div>
          </div>
        )}

        {/* REASON */}
        {room.phase === "reason" && (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <p className="text-2xl font-bold text-[#3F2F6A]">Sharing reasons...</p>
              <p className="mt-4 text-4xl font-black text-[#1A1033]">{Object.keys(room.reasons).length} <span className="text-lg font-normal text-[#8B7FA8]">of {playerCount} submitted</span></p>
            </div>
          </div>
        )}

        {/* REVEAL / REFLECT — Card Wall */}
        {showBoard && (
          <AnimatePresence>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-1 flex-col">
              {/* Vote distribution bar */}
              <div className="mb-6 flex items-center gap-3">
                {totalVotes > 0 && (
                  <div className="flex h-4 flex-1 overflow-hidden rounded-full">
                    {cols.map((c) => {
                      const count = grouped[c.vote].length;
                      const pct = (count / totalVotes) * 100;
                      return <motion.div key={c.vote} className={c.barBg} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />;
                    })}
                  </div>
                )}
              </div>

              {/* Column headers with counts */}
              <div className="mb-4 grid grid-cols-3 gap-6">
                {cols.map((c) => (
                  <div key={c.vote} className={`flex items-center justify-center gap-2 text-lg font-bold ${c.color}`}>
                    <c.icon className="h-5 w-5" /> {c.label}
                    <span className="ml-1 rounded-full bg-[#E8DCC0] px-2.5 py-0.5 text-sm">{grouped[c.vote].length}</span>
                  </div>
                ))}
              </div>

              {/* Cards */}
              <div className="grid flex-1 grid-cols-3 gap-6 overflow-y-auto">
                {cols.map((c) => (
                  <div key={c.vote} className="space-y-3">
                    {isLargeGroup ? (
                      // Large group: show top words + sample cards
                      <>
                        <WordCloud reasons={grouped[c.vote].map((r) => r.text).filter(Boolean)} color={c.color} />
                        {grouped[c.vote].slice(0, 5).map((card, i) => (
                          <BlurFade key={card.id} delay={i * 0.08} inView>
                            <ReasonCard card={card} col={c} />
                          </BlurFade>
                        ))}
                        {grouped[c.vote].length > 5 && (
                          <p className="text-center text-xs text-[#A89CC0]">+{grouped[c.vote].length - 5} more</p>
                        )}
                      </>
                    ) : (
                      // Small group: show all cards
                      grouped[c.vote].map((card, i) => (
                        <BlurFade key={card.id} delay={i * 0.08} inView>
                          <ReasonCard card={card} col={c} />
                        </BlurFade>
                      ))
                    )}
                    {grouped[c.vote].length === 0 && (
                      <div className="rounded-2xl border-2 border-dashed border-[#1A1033]/20 p-10 text-center text-base font-medium text-[#A89CC0]">No votes</div>
                    )}
                  </div>
                ))}
              </div>

              {room.phase === "reflect" && (
                <div className="mt-4 text-center">
                  <p className="animate-pulse text-sm font-semibold text-[#FF6699]">Players can change their vote now...</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {/* SUMMARY */}
        {room.phase === "summary" && (
          <div className="flex flex-1 flex-col items-center justify-center">
            <Confetti />
            <h2 className="text-4xl font-black">Game Complete!</h2>
            <p className="mt-2 text-[#8B7FA8]">{room.roundHistory.length} rounds played</p>
            <SummaryStats rounds={room.roundHistory} />
          </div>
        )}
      </div>
    </div>
  );
}

function ReasonCard({ card, col }: { card: { id: string; text: string; name: string }; col: typeof cols[number] }) {
  return (
    <div className={`rounded-2xl border-2 border-[#1A1033]/15 border-l-[10px] ${col.bl} ${col.bg} p-6 shadow-sm`}>
      <div className={`mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide ${col.color}`}>
        <User className="h-4 w-4" /> {card.name}
      </div>
      {card.text && <p className="text-lg leading-relaxed text-[#1A1033] font-medium">{card.text}</p>}
    </div>
  );
}

function WordCloud({ reasons, color }: { reasons: string[]; color: string }) {
  // Extract top words (simple frequency analysis)
  const stopWords = new Set(["the", "a", "an", "is", "it", "to", "of", "and", "in", "for", "on", "that", "this", "with", "but", "or", "be", "are", "was", "i", "you", "they", "we", "would", "could", "should", "not", "no", "yes", "its", "if", "so", "do", "can"]);
  const wordCount: Record<string, number> = {};
  reasons.forEach((text) => {
    text.toLowerCase().split(/\s+/).forEach((w) => {
      const clean = w.replace(/[^a-z]/g, "");
      if (clean.length > 2 && !stopWords.has(clean)) {
        wordCount[clean] = (wordCount[clean] || 0) + 1;
      }
    });
  });
  const topWords = Object.entries(wordCount).sort((a, b) => b[1] - a[1]).slice(0, 12);

  if (topWords.length === 0) return null;

  const maxCount = topWords[0][1];
  return (
    <div className="flex flex-wrap justify-center gap-2 rounded-xl border border-[#E8DCC0]/50 bg-[#F5EAD4]/50 p-4">
      {topWords.map(([word, count]) => {
        const scale = 0.7 + (count / maxCount) * 0.6;
        return (
          <span key={word} className={`${color} font-semibold`} style={{ fontSize: `${scale}rem`, opacity: 0.5 + (count / maxCount) * 0.5 }}>
            {word}
          </span>
        );
      })}
    </div>
  );
}

function BoardTimer({ room }: { room: Room }) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!room.timerStartedAt || !room.timerSeconds) { setTimeLeft(null); return; }
    const update = () => {
      const elapsed = Math.floor((Date.now() - room.timerStartedAt!) / 1000);
      setTimeLeft(Math.max(0, room.timerSeconds - elapsed));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [room.timerStartedAt, room.timerSeconds]);

  // Show frozen time when paused
  if (room.isPaused && room.pausedTimeLeft !== null) {
    const pMins = Math.floor(room.pausedTimeLeft / 60);
    const pSecs = room.pausedTimeLeft % 60;
    return (
      <div className="flex items-center gap-2 rounded-full border border-[#C9BDD8] px-4 py-2 text-lg font-black tabular-nums text-[#8B7FA8]">
        <Pause className="h-4 w-4" />
        {pMins}:{pSecs.toString().padStart(2, "0")}
      </div>
    );
  }

  if (timeLeft === null) return null;
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const isExpired = timeLeft === 0;

  return (
    <div className={`flex items-center gap-2 rounded-full border px-4 py-2 text-lg font-black tabular-nums ${
      isExpired ? "border-red-500/50 bg-red-500/10 text-red-400 animate-pulse" : "border-[#FF3366]/30 bg-[#FF3366]/10 text-[#1A1033]"
    }`}>
      <Timer className="h-4 w-4" />
      {isExpired ? "Time's up!" : `${mins}:${secs.toString().padStart(2, "0")}`}
    </div>
  );
}

function SummaryStats({ rounds }: { rounds: Room["roundHistory"] }) {
  const totals = { erode: 0, depends: 0, support: 0 };
  rounds.forEach((r) => Object.values(r.votes).forEach((v) => totals[v]++));
  const total = totals.erode + totals.depends + totals.support;

  return (
    <div className="mt-8 flex flex-col items-center gap-6">
      <div className="flex gap-8">
        {cols.map((c) => (
          <div key={c.vote} className="flex flex-col items-center gap-1">
            <c.icon className={`h-6 w-6 ${c.color}`} />
            <span className={`text-3xl font-black ${c.color}`}>{totals[c.vote]}</span>
            <span className="text-xs text-[#8B7FA8]">{c.label}</span>
          </div>
        ))}
      </div>
      {total > 0 && (
        <div className="flex h-4 w-96 overflow-hidden rounded-full">
          {cols.map((c) => (
            <div key={c.vote} className={c.barBg} style={{ width: `${(totals[c.vote] / total) * 100}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}
