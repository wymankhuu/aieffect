"use client";

import { use, useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import scenarios from "@/data/scenarios.json";
import {
  Copy, Crown, User, Play, Share2, Check, Layers,
  HeartOff, Scale, HeartHandshake, ChevronRight,
  RefreshCw, RotateCcw, Monitor, Users, ExternalLink,
  MessageSquareWarning, Send, Timer, PlayCircle, Pause, LogIn,
  Square, DoorOpen, QrCode,
} from "lucide-react";
import { ShineBorder } from "@/components/ui/shine-border";
import { PulsatingButton } from "@/components/ui/pulsating-button";
import { MagicCard } from "@/components/ui/magic-card";
import { BorderBeam } from "@/components/ui/border-beam";
import { TypingAnimation } from "@/components/ui/typing-animation";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Confetti } from "@/components/ui/confetti";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";

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

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [needsJoin, setNeedsJoin] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const pid = sessionStorage.getItem(`player-${code}`);
    if (!pid) { setNeedsJoin(true); return; }
    setPlayerId(pid);
  }, [code]);

  async function handleQuickJoin() {
    if (!joinName.trim()) { setJoinError("Enter your name"); return; }
    setJoinLoading(true);
    const res = await fetch("/api/room/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: joinName.trim() }),
    });
    const data = await res.json();
    if (data.error) { setJoinError(data.error); setJoinLoading(false); return; }
    sessionStorage.setItem(`player-${code}`, data.playerId);
    setPlayerId(data.playerId);
    setNeedsJoin(false);
  }

  useEffect(() => {
    if (!playerId) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/room/poll?code=${code}`);
        if (res.ok && active) setRoom(await res.json());
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 1500);
    return () => { active = false; clearInterval(interval); };
  }, [code, playerId]);

  const act = useCallback(async (action: Record<string, unknown>) => {
    await fetch("/api/room/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, playerId, action }),
    });
  }, [code, playerId]);

  if (needsJoin) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6">
        <span className="mb-2 text-xs font-bold tracking-widest text-violet-400">{code}</span>
        <h2 className="text-lg font-bold">Join Game</h2>
        <p className="mt-1 text-sm text-zinc-500">This game is in progress — jump in!</p>
        <div className="mt-4 w-full max-w-xs space-y-3">
          <input type="text" placeholder="Your name" value={joinName}
            onChange={(e) => { setJoinName(e.target.value); setJoinError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleQuickJoin()}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-violet-600 focus:outline-none" autoFocus />
          {joinError && <p className="text-xs text-red-400 text-center">{joinError}</p>}
          <button onClick={handleQuickJoin} disabled={joinLoading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50">
            <LogIn className="h-4 w-4" /> {joinLoading ? "Joining..." : "Join"}
          </button>
        </div>
      </div>
    );
  }

  if (!room || !playerId) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-zinc-500">Connecting...</div>;
  }

  const me = room.players[playerId];
  const isFacilitator = me?.isFacilitator ?? false;
  const players = Object.values(room.players);
  const scenario = room.currentCardIndex !== null ? scenarios[room.currentCardIndex] : null;

  if (room.phase === "lobby") return <LobbyView room={room} isFacilitator={isFacilitator} players={players} onStart={() => act({ type: "start" })} />;
  if (room.phase === "summary") return <SummaryView room={room} onReset={() => router.push("/")} />;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800/50 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={() => { sessionStorage.removeItem(`player-${code}`); router.push("/"); }}
            className="text-zinc-600 hover:text-zinc-400" title="Leave game">
            <DoorOpen className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-bold tracking-widest text-violet-400">{room.code}</span>
          <div className="hidden items-center gap-2 text-xs text-zinc-500 sm:flex"><Users className="h-3 w-3" /> {players.length}</div>
          <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 sm:gap-2 sm:px-3 sm:py-1 sm:text-xs">
            <Layers className="h-3 w-3" /> {room.currentRound}/{room.totalRounds}
          </div>
        </div>
        <GameTimer room={room} isFacilitator={isFacilitator} act={act} />
        <div className="flex items-center gap-2">
          {isFacilitator && (
            <>
              <button onClick={() => { if (confirm("End game early and show summary?")) act({ type: "end-game" }); }}
                className="flex items-center gap-1 rounded-full border border-red-900/50 px-2.5 py-1.5 text-[10px] font-semibold text-red-400 hover:bg-red-950/30 sm:text-xs">
                <Square className="h-2.5 w-2.5" /> End
              </button>
              <button onClick={() => window.open(`/room/${code}/board`, "_blank")}
                className="hidden items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 sm:flex">
                <Monitor className="h-3 w-3" /> Projector <ExternalLink className="h-2.5 w-2.5 opacity-60" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        {room.phase === "draw" && scenario && <DrawView scenario={scenario.text} isFacilitator={isFacilitator} onAdvance={() => act({ type: "advance", phase: "vote" })} />}
        {room.phase === "vote" && scenario && <VoteView scenario={scenario.text} room={room} playerId={playerId} isFacilitator={isFacilitator} onVote={(v) => act({ type: "vote", vote: v })} onAdvance={() => act({ type: "advance", phase: "reason" })} />}
        {room.phase === "reason" && scenario && <ReasonView scenario={scenario.text} room={room} playerId={playerId} playerName={me?.name || "Player"} isFacilitator={isFacilitator} onSubmit={(text, name) => act({ type: "reason", text, name })} onAdvance={() => act({ type: "advance", phase: "reveal" })} />}
        {(room.phase === "reveal" || room.phase === "reflect") && <RevealView room={room} playerId={playerId} isFacilitator={isFacilitator} onReflect={() => act({ type: "advance", phase: "reflect" })} onRevote={(v) => act({ type: "revote", vote: v })} onNext={() => act({ type: "next-round" })} />}
      </div>
    </div>
  );
}

// --- TIMER ---
function GameTimer({ room, isFacilitator, act }: { room: Room; isFacilitator: boolean; act: (a: Record<string, unknown>) => Promise<void> }) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!room.timerStartedAt || !room.timerSeconds) {
      setTimeLeft(null);
      return;
    }
    const update = () => {
      const elapsed = Math.floor((Date.now() - room.timerStartedAt!) / 1000);
      const remaining = Math.max(0, room.timerSeconds - elapsed);
      setTimeLeft(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [room.timerStartedAt, room.timerSeconds]);

  const mins = timeLeft !== null ? Math.floor(timeLeft / 60) : 0;
  const secs = timeLeft !== null ? timeLeft % 60 : 0;
  const isRunning = room.timerStartedAt !== null && timeLeft !== null && timeLeft > 0;
  const isExpired = timeLeft === 0 && room.timerStartedAt !== null;

  // Timer is running or expired — show countdown for everyone
  if (room.timerStartedAt) {
    return (
      <div className={`flex items-center gap-2 rounded-full border px-4 py-2 text-lg font-black tabular-nums ${
        isExpired ? "border-red-500/50 bg-red-500/10 text-red-400 animate-pulse" : "border-violet-500/30 bg-violet-500/10 text-zinc-50"
      }`}>
        <Timer className="h-4 w-4" />
        {isExpired ? "Time's up!" : `${mins}:${secs.toString().padStart(2, "0")}`}
      </div>
    );
  }

  // Timer set but not started — show for everyone
  if (room.timerSeconds > 0 && !isFacilitator) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-zinc-800 px-3 py-1.5 text-sm font-semibold text-zinc-400">
        <Timer className="h-3.5 w-3.5" /> {room.timerSeconds >= 60 ? `${room.timerSeconds / 60}m` : `${room.timerSeconds}s`}
      </div>
    );
  }

  // No timer and not facilitator
  if (!room.timerSeconds && !isFacilitator) return null;

  // Facilitator controls below

  return (
    <div className="relative flex items-center gap-1.5">
      {room.timerSeconds > 0 ? (
        <>
          <button onClick={() => setShowPicker(!showPicker)}
            className="flex items-center gap-1.5 rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-300">
            <Timer className="h-3 w-3" /> {room.timerSeconds}s
          </button>
          <button onClick={() => act({ type: "start-timer" })}
            className="flex items-center gap-1 rounded-full bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-500">
            <PlayCircle className="h-3 w-3" /> Start
          </button>
        </>
      ) : (
        <button onClick={() => setShowPicker(!showPicker)}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-400">
          <Timer className="h-3 w-3" /> Set Timer
        </button>
      )}
      {showPicker && (
        <div className="absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 shadow-xl">
          <div className="flex gap-1.5">
            {[30, 60, 90, 120, 180].map((s) => (
              <button key={s} onClick={() => { act({ type: "set-timer", seconds: s }); setShowPicker(false); }}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  room.timerSeconds === s ? "border-violet-600 bg-violet-600/10 text-violet-400" : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                }`}>
                {s >= 60 ? `${s / 60}m` : `${s}s`}
              </button>
            ))}
            <button onClick={() => { act({ type: "set-timer", seconds: 0 }); setShowPicker(false); }}
              className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-500 hover:border-zinc-600">
              Off
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- LOBBY ---
function LobbyView({ room, isFacilitator, players, onStart }: { room: Room; isFacilitator: boolean; players: Room["players"][string][]; onStart: () => void }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/room/${room.code}` : "";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="mb-4 flex items-center gap-1.5 text-xs text-zinc-500"><Share2 className="h-3 w-3" /> Share this code or scan QR to join</div>

      {/* Room code + QR toggle */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center gap-3 rounded-2xl bg-zinc-900 px-6 py-4 sm:px-8">
          <ShineBorder shineColor={["#7c3aed", "#06b6d4", "#22c55e", "#eab308", "#ef4444"]} borderWidth={2} />
          <span className="text-3xl font-black tracking-[0.4em] text-zinc-50 sm:text-4xl">{room.code}</span>
          <div className="flex gap-1.5">
            <button onClick={() => { navigator.clipboard.writeText(joinUrl || room.code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="text-zinc-500 hover:text-zinc-300" title="Copy link">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </button>
            <button onClick={() => setShowQr(!showQr)} className="text-zinc-500 hover:text-zinc-300" title="Show QR code">
              <QrCode className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* QR Code */}
        {showQr && joinUrl && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl bg-white p-4">
            <QRCodeSVG value={joinUrl} size={180} level="M" />
          </motion.div>
        )}
      </div>

      {/* Player list */}
      <div className="mt-6 flex flex-wrap justify-center gap-2 sm:mt-8">
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
            {p.isFacilitator ? <Crown className="h-3.5 w-3.5 text-yellow-500" /> : <User className="h-3.5 w-3.5 text-zinc-600" />}
            <span className="text-zinc-300">{p.name}</span>
          </div>
        ))}
      </div>

      {isFacilitator ? (
        <div className="mt-6 sm:mt-8">
          <PulsatingButton className="bg-violet-600 text-sm font-bold text-white" pulseColor="#7c3aed" onClick={onStart}>
            <Play className="mr-2 h-4 w-4" /> Start Game — {players.length} player{players.length !== 1 ? "s" : ""}
          </PulsatingButton>
        </div>
      ) : <p className="mt-6 animate-pulse text-sm text-zinc-500 sm:mt-8">Waiting for facilitator to start...</p>}
    </div>
  );
}

// --- DRAW ---
function DrawView({ scenario, isFacilitator, onAdvance }: { scenario: string; isFacilitator: boolean; onAdvance: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center">
      <div className="relative w-full max-w-md">
        <MagicCard className="relative overflow-hidden rounded-2xl border-green-900/30 bg-gradient-to-br from-[#1a3a2e] to-[#0f2920] p-8" gradientColor="rgba(34,197,94,0.08)">
          <div className="flex items-start gap-3">
            <MessageSquareWarning className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-400" />
            <TypingAnimation className="text-base leading-relaxed text-green-100" duration={30} showCursor={false}>{scenario}</TypingAnimation>
          </div>
          <BorderBeam size={120} duration={4} colorFrom="#22c55e" colorTo="#16a34a" />
        </MagicCard>
      </div>
      {isFacilitator ? (
        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} onClick={onAdvance}
          className="mt-8 flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500">
          Open Voting <ChevronRight className="h-4 w-4" />
        </motion.button>
      ) : <p className="mt-8 text-sm text-zinc-500">Read the scenario... voting opens soon.</p>}
    </motion.div>
  );
}

// --- VOTE ---
function VoteView({ scenario, room, playerId, isFacilitator, onVote, onAdvance }: {
  scenario: string; room: Room; playerId: string; isFacilitator: boolean; onVote: (v: Vote) => void; onAdvance: () => void;
}) {
  const myVote = room.votes[playerId] ?? null;
  const voteCount = Object.keys(room.votes).length;
  const total = Object.keys(room.players).length;
  const buttons: [Vote, string, typeof HeartOff, string, string, string][] = [
    ["erode", "Erode", HeartOff, "border-red-900/50", "bg-red-950/30", "text-red-300"],
    ["depends", "Depends", Scale, "border-yellow-900/50", "bg-yellow-950/30", "text-yellow-300"],
    ["support", "Support", HeartHandshake, "border-green-900/50", "bg-green-950/30", "text-green-300"],
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center">
      <div className="relative w-full max-w-md">
        <MagicCard className="relative overflow-hidden rounded-2xl border-green-900/30 bg-gradient-to-br from-[#1a3a2e] to-[#0f2920] p-8" gradientColor="rgba(34,197,94,0.08)">
          <p className="text-base leading-relaxed text-green-100">{scenario}</p>
          <BorderBeam size={120} duration={4} colorFrom="#22c55e" colorTo="#16a34a" />
        </MagicCard>
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {buttons.map(([v, label, Icon, border, bg, text]) => (
          <motion.button key={v} whileTap={{ scale: 0.95 }} disabled={!!myVote} onClick={() => onVote(v)}
            className={`flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-semibold transition-all ${
              myVote === v ? `${border} ${bg} ${text} scale-105 ring-1 ring-current`
              : myVote ? `${border} ${bg} ${text} opacity-40`
              : `${border} ${bg} ${text} hover:brightness-125`
            }`}>
            <Icon className="h-4 w-4" /> {label}
          </motion.button>
        ))}
      </div>
      <p className="mt-4 text-xs text-zinc-500">{voteCount} of {total} voted</p>
      {isFacilitator && voteCount > 0 && (
        <button onClick={onAdvance} className="mt-3 flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500">
          Share Reasons <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </motion.div>
  );
}

// --- REASON ---
function ReasonView({ scenario, room, playerId, playerName, isFacilitator, onSubmit, onAdvance }: {
  scenario: string; room: Room; playerId: string; playerName: string; isFacilitator: boolean;
  onSubmit: (text: string, name: string) => void; onAdvance: () => void;
}) {
  const [text, setText] = useState("");
  const submitted = !!room.reasons[playerId];
  const reasonCount = Object.keys(room.reasons).length;
  const total = Object.keys(room.players).length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex w-full max-w-md flex-col items-center px-2">
      <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-center text-xs text-zinc-400 sm:mb-6">{scenario}</div>
      {!submitted ? (
        <>
          <h3 className="text-lg font-bold">Why did you choose that?</h3>
          <p className="mt-1 text-sm text-zinc-500">Share your reasoning (or skip).</p>
          <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 280))} placeholder="I think this would..."
            rows={3} className="mt-4 w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-violet-600 focus:outline-none" />
          <div className="mt-1 text-right text-xs text-zinc-600">{text.length}/280</div>
          <button onClick={() => onSubmit(text.trim(), playerName)}
            className="mt-4 flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500">
            <Send className="h-4 w-4" /> {text.trim() ? "Submit" : "Skip"}
          </button>
        </>
      ) : (
        <div className="flex flex-col items-center">
          <div className="rounded-full bg-violet-600/20 p-3"><Send className="h-5 w-5 text-violet-400" /></div>
          <p className="mt-3 text-sm text-zinc-400">Submitted! Waiting for others...</p>
        </div>
      )}
      <p className="mt-4 text-xs text-zinc-500">{reasonCount} of {total} submitted</p>
      {isFacilitator && reasonCount > 0 && (
        <button onClick={onAdvance} className="mt-3 flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500">
          Reveal Board <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </motion.div>
  );
}

// --- REVEAL / REFLECT ---
function RevealView({ room, playerId, isFacilitator, onReflect, onRevote, onNext }: {
  room: Room; playerId: string; isFacilitator: boolean;
  onReflect: () => void; onRevote: (v: Vote) => void; onNext: () => void;
}) {
  const isReflect = room.phase === "reflect";
  const activeVotes = { ...room.votes, ...(isReflect ? room.revisedVotes : {}) };
  const cols: { vote: Vote; label: string; icon: typeof HeartOff; hc: string; bg: string; bl: string; cb: string }[] = [
    { vote: "erode", label: "Erode", icon: HeartOff, hc: "text-red-400", bg: "bg-red-950/20", bl: "border-l-red-400", cb: "bg-red-400/10" },
    { vote: "depends", label: "Depends", icon: Scale, hc: "text-yellow-400", bg: "bg-yellow-950/20", bl: "border-l-yellow-400", cb: "bg-yellow-400/10" },
    { vote: "support", label: "Support", icon: HeartHandshake, hc: "text-green-400", bg: "bg-green-950/20", bl: "border-l-green-400", cb: "bg-green-400/10" },
  ];
  const grouped: Record<Vote, { id: string; text: string; name: string }[]> = { erode: [], depends: [], support: [] };
  Object.entries(activeVotes).forEach(([id, vote]) => {
    const r = room.reasons[id];
    grouped[vote].push({ id, text: r?.text || "", name: r?.name || "Player" });
  });
  const myVote = activeVotes[playerId];
  const totalVotes = Object.keys(activeVotes).length;
  const isLargeGroup = Object.keys(room.players).length >= 30;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex w-full max-w-4xl flex-col items-center">
      {/* Vote distribution bar */}
      {totalVotes > 0 && (
        <div className="mb-4 flex h-3 w-full overflow-hidden rounded-full">
          {cols.map((col) => {
            const pct = (grouped[col.vote].length / totalVotes) * 100;
            return <motion.div key={col.vote} className={col.hc.replace("text-", "bg-")} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />;
          })}
        </div>
      )}

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
        {cols.map((col) => {
          const cards = grouped[col.vote];
          const showCards = isLargeGroup ? cards.slice(0, 5) : cards;
          return (
            <div key={col.vote}>
              <div className={`mb-3 flex items-center justify-center gap-2 text-sm font-bold ${col.hc}`}>
                <col.icon className="h-4 w-4" /> {col.label}
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${col.cb}`}>
                  <NumberTicker value={cards.length} />
                </span>
              </div>
              <div className="space-y-2">
                {showCards.map((card, i) => (
                  <BlurFade key={card.id} delay={i * 0.1} inView>
                    <div className={`rounded-lg border-l-[3px] ${col.bl} ${col.bg} p-3`}>
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-zinc-500"><User className="h-2.5 w-2.5" /> {card.name}</div>
                      {card.text && <p className="text-xs leading-relaxed text-zinc-300">{card.text}</p>}
                    </div>
                  </BlurFade>
                ))}
                {isLargeGroup && cards.length > 5 && (
                  <p className="text-center text-xs text-zinc-600">+{cards.length - 5} more</p>
                )}
                {cards.length === 0 && <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-600">No votes</div>}
              </div>
            </div>
          );
        })}
      </div>
      {isReflect && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <p className="flex animate-pulse items-center gap-2 text-sm font-semibold text-violet-400"><RefreshCw className="h-4 w-4" /> Changed your mind? Tap to revote</p>
          <div className="flex gap-2">
            {cols.map((col) => (
              <button key={col.vote} onClick={() => onRevote(col.vote)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
                  myVote === col.vote ? `border-current ${col.hc} ring-1 ring-current` : "border-zinc-800 text-zinc-500 hover:border-zinc-600"
                }`}><col.icon className="h-3 w-3" /> {col.label}</button>
            ))}
          </div>
        </div>
      )}
      {isFacilitator && (
        <div className="mt-8 flex gap-3">
          {!isReflect && <button onClick={onReflect} className="flex items-center gap-2 rounded-full border border-zinc-700 px-5 py-2.5 text-sm font-bold text-zinc-300 hover:border-zinc-500"><RefreshCw className="h-4 w-4" /> Open Revoting</button>}
          <button onClick={onNext} className="flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500">Next Round <ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
    </motion.div>
  );
}

// --- SUMMARY ---
function SummaryView({ room, onReset }: { room: Room; onReset: () => void }) {
  const allRounds = [...room.roundHistory];
  const totals = { erode: 0, depends: 0, support: 0 };
  allRounds.forEach((r) => Object.values(r.votes).forEach((v) => totals[v]++));
  const total = totals.erode + totals.depends + totals.support;
  const confettiFired = useRef(false);

  useEffect(() => {
    confettiFired.current = true;
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      {!confettiFired.current && <Confetti />}
      <BlurFade delay={0}><h2 className="text-3xl font-black">Game Complete!</h2></BlurFade>
      <BlurFade delay={0.2}><p className="mt-2 text-zinc-500">{allRounds.length} rounds played</p></BlurFade>
      <BlurFade delay={0.4}>
        <div className="mt-8 flex gap-6">
          {([["erode", HeartOff, "text-red-400"], ["depends", Scale, "text-yellow-400"], ["support", HeartHandshake, "text-green-400"]] as const).map(([k, Icon, color]) => (
            <div key={k} className="flex flex-col items-center gap-1">
              <Icon className={`h-5 w-5 ${color}`} />
              <span className={`text-2xl font-black ${color}`}><NumberTicker value={totals[k]} /></span>
              <span className="text-xs text-zinc-500">{k}</span>
            </div>
          ))}
        </div>
      </BlurFade>
      {total > 0 && (
        <BlurFade delay={0.6}>
          <div className="mt-6 flex h-3 w-72 overflow-hidden rounded-full">
            <div className="bg-red-500" style={{ width: `${(totals.erode / total) * 100}%` }} />
            <div className="bg-yellow-500" style={{ width: `${(totals.depends / total) * 100}%` }} />
            <div className="bg-green-500" style={{ width: `${(totals.support / total) * 100}%` }} />
          </div>
        </BlurFade>
      )}
      <button onClick={onReset} className="mt-8 flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500">
        <RotateCcw className="h-4 w-4" /> Play Again
      </button>
    </div>
  );
}
