"use client";

import { use, useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import scenarios from "@/data/scenarios.json";
import {
  Copy, Crown, User, Play, Share2, Check, Layers,
  HeartOff, Scale, HeartHandshake, ChevronRight,
  RefreshCw, RotateCcw, Monitor, Users, ExternalLink,
  MessageSquareWarning, Send, Timer, PlayCircle, Pause, LogIn,
  Square, DoorOpen, QrCode, X, Zap, Download,
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
        <span className="mb-2 text-xs font-bold tracking-widest text-[#FF6699]">{code}</span>
        <h2 className="text-lg font-bold">Join Game</h2>
        <p className="mt-1 text-sm text-[#8B7FA8]">This game is in progress — jump in!</p>
        <div className="mt-4 w-full max-w-xs space-y-3">
          <input type="text" placeholder="Your name" value={joinName}
            onChange={(e) => { setJoinName(e.target.value); setJoinError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleQuickJoin()}
            className="w-full rounded-xl border border-[#E8DCC0] bg-[#F5EAD4] px-4 py-3 text-sm text-[#1A1033] placeholder:text-[#A89CC0] focus:border-[#1A1033] focus:outline-none" autoFocus />
          {joinError && <p className="text-xs text-red-400 text-center">{joinError}</p>}
          <button onClick={handleQuickJoin} disabled={joinLoading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1A1033] px-4 py-3 text-sm font-bold text-white hover:bg-[#FF3366] disabled:opacity-50">
            <LogIn className="h-4 w-4" /> {joinLoading ? "Joining..." : "Join"}
          </button>
        </div>
      </div>
    );
  }

  if (!room || !playerId) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-[#8B7FA8]">Connecting...</div>;
  }

  const me = room.players[playerId];
  const isFacilitator = me?.isFacilitator ?? false;
  const players = Object.values(room.players);
  const scenario = room.currentCardIndex !== null ? scenarios[room.currentCardIndex] : null;

  if (room.phase === "lobby") return <LobbyView room={room} isFacilitator={isFacilitator} players={players} onStart={() => act({ type: "start" })} onKick={(id) => act({ type: "kick", targetId: id })} />;
  if (room.phase === "summary") return <SummaryView room={room} onReset={() => router.push("/")} />;

  return (
    <div className="relative flex min-h-dvh flex-col">
      {room.isPaused && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Pause className="h-10 w-10 text-[#FF6699]" />
            <p className="text-xl font-bold text-[#2D1F4F]">Game Paused</p>
            {isFacilitator && (
              <button onClick={() => act({ type: "resume" })}
                className="mt-2 rounded-full bg-[#1A1033] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#FF3366]">
                Resume Game
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between py-2 pl-40 pr-3 sm:py-3 sm:pl-52 sm:pr-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={() => { sessionStorage.removeItem(`player-${code}`); router.push("/"); }}
            className="text-[#A89CC0] hover:text-[#6B5F87]" title="Leave game">
            <DoorOpen className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-bold tracking-widest text-[#FF6699]">{room.code}</span>
          <PlayerCount players={players} isFacilitator={isFacilitator} onKick={(id) => act({ type: "kick", targetId: id })} />
          <div className="flex items-center gap-1.5 rounded-full border border-[#E8DCC0] px-2 py-0.5 text-[10px] text-[#8B7FA8] sm:gap-2 sm:px-3 sm:py-1 sm:text-xs">
            <Layers className="h-3 w-3" /> {room.currentRound}/{room.totalRounds}
          </div>
        </div>
        <GameTimer room={room} isFacilitator={isFacilitator} act={act} />
        <div className="flex items-center gap-2">
          {isFacilitator && (
            <>
              <button onClick={() => act({ type: room.isPaused ? "resume" : "pause" })}
                className="flex items-center gap-1 rounded-full border border-[#C9BDD8] px-2.5 py-1.5 text-[10px] font-semibold text-[#3F2F6A] hover:bg-[#E8DCC0] sm:text-xs">
                {room.isPaused ? <Play className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}
                {room.isPaused ? "Resume" : "Pause"}
              </button>
              <button onClick={() => { if (confirm("End game early and show summary?")) act({ type: "end-game" }); }}
                className="flex items-center gap-1 rounded-full border border-red-900/50 px-2.5 py-1.5 text-[10px] font-semibold text-red-400 hover:bg-red-950/30 sm:text-xs">
                <Square className="h-2.5 w-2.5" /> End
              </button>
              <button onClick={() => window.open(`/room/${code}/board`, "_blank")}
                className="hidden items-center gap-1.5 rounded-full bg-[#1A1033] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#FF3366] sm:flex">
                <Monitor className="h-3 w-3" /> Projector <ExternalLink className="h-2.5 w-2.5 opacity-60" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        {room.phase === "draw" && scenario && <DrawView scenario={scenario.text} isFacilitator={isFacilitator} onAdvance={() => act({ type: "advance", phase: "vote" })} onSkip={() => act({ type: "skip-scenario" })} />}
        {room.phase === "vote" && scenario && <VoteView scenario={scenario.text} room={room} playerId={playerId} isFacilitator={isFacilitator} onVote={(v) => act({ type: "vote", vote: v })} onAdvance={() => act({ type: "advance", phase: "reason" })} />}
        {room.phase === "reason" && scenario && <ReasonView scenario={scenario.text} room={room} playerId={playerId} playerName={me?.name || "Player"} isFacilitator={isFacilitator} onSubmit={(text, name) => act({ type: "reason", text, name })} onAdvance={() => act({ type: "advance", phase: "reveal" })} />}
        {(room.phase === "reveal" || room.phase === "reflect") && <RevealView room={room} playerId={playerId} isFacilitator={isFacilitator} scenario={scenario} onReflect={() => act({ type: "advance", phase: "reflect" })} onRevote={(v) => act({ type: "revote", vote: v })} onNext={() => act({ type: "next-round" })} />}
      </div>
    </div>
  );
}

// --- PLAYER COUNT (with kick) ---
function PlayerCount({ players, isFacilitator, onKick }: { players: Room["players"][string][]; isFacilitator: boolean; onKick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!isFacilitator) {
    return <div className="hidden items-center gap-2 text-xs text-[#8B7FA8] sm:flex"><Users className="h-3 w-3" /> {players.length}</div>;
  }
  return (
    <div className="relative hidden sm:block">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-xs text-[#8B7FA8] hover:text-[#3F2F6A]">
        <Users className="h-3 w-3" /> {players.length}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-2 w-48 rounded-xl border border-[#E8DCC0] bg-[#F5EAD4] p-2 shadow-xl">
          {players.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs text-[#3F2F6A]">
              <span className="flex items-center gap-2">
                {p.isFacilitator ? <Crown className="h-3 w-3 text-yellow-500" /> : <User className="h-3 w-3 text-[#A89CC0]" />}
                {p.name}
              </span>
              {!p.isFacilitator && (
                <button onClick={() => { onKick(p.id); }} className="text-[#A89CC0] hover:text-red-400" title="Remove">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
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

  // Timer paused — show frozen time
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

  // Timer is running or expired — show countdown for everyone
  if (room.timerStartedAt) {
    return (
      <div className={`flex items-center gap-2 rounded-full border px-4 py-2 text-lg font-black tabular-nums ${
        isExpired ? "border-red-500/50 bg-red-500/10 text-red-400 animate-pulse" : "border-[#FF3366]/30 bg-[#FF3366]/10 text-[#1A1033]"
      }`}>
        <Timer className="h-4 w-4" />
        {isExpired ? "Time's up!" : `${mins}:${secs.toString().padStart(2, "0")}`}
      </div>
    );
  }

  // Timer set but not started — show for everyone
  if (room.timerSeconds > 0 && !isFacilitator) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-[#E8DCC0] px-3 py-1.5 text-sm font-semibold text-[#6B5F87]">
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
            className="flex items-center gap-1.5 rounded-full border border-[#E8DCC0] px-3 py-1.5 text-xs text-[#6B5F87] hover:border-[#A89CC0] hover:text-[#3F2F6A]">
            <Timer className="h-3 w-3" /> {room.timerSeconds}s
          </button>
          <button onClick={() => act({ type: "start-timer" })}
            className="flex items-center gap-1 rounded-full bg-[#1A1033] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#FF3366]">
            <PlayCircle className="h-3 w-3" /> Start
          </button>
        </>
      ) : (
        <button onClick={() => setShowPicker(!showPicker)}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-[#C9BDD8] px-3 py-1.5 text-xs text-[#8B7FA8] hover:border-[#8B7FA8] hover:text-[#6B5F87]">
          <Timer className="h-3 w-3" /> Set Timer
        </button>
      )}
      {showPicker && (
        <div className="absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 rounded-xl border border-[#E8DCC0] bg-[#F5EAD4] p-3 shadow-xl">
          <div className="flex gap-1.5">
            {[30, 60, 90, 120, 180].map((s) => (
              <button key={s} onClick={() => { act({ type: "set-timer", seconds: s }); setShowPicker(false); }}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  room.timerSeconds === s ? "border-[#1A1033] bg-[#1A1033]/10 text-[#FF6699]" : "border-[#C9BDD8] text-[#6B5F87] hover:border-[#A89CC0]"
                }`}>
                {s >= 60 ? `${s / 60}m` : `${s}s`}
              </button>
            ))}
            <button onClick={() => { act({ type: "set-timer", seconds: 0 }); setShowPicker(false); }}
              className="rounded-lg border border-[#C9BDD8] px-2.5 py-1.5 text-xs text-[#8B7FA8] hover:border-[#A89CC0]">
              Off
            </button>
          </div>
          <button onClick={() => act({ type: "toggle-auto-advance" })}
            className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              room.autoAdvance ? "border-[#1A1033] bg-[#1A1033]/10 text-[#FF6699]" : "border-[#C9BDD8] text-[#8B7FA8] hover:border-[#A89CC0]"
            }`}>
            <Zap className="h-3 w-3" /> Auto-advance {room.autoAdvance ? "ON" : "OFF"}
          </button>
        </div>
      )}
    </div>
  );
}

// --- LOBBY ---
function LobbyView({ room, isFacilitator, players, onStart, onKick }: { room: Room; isFacilitator: boolean; players: Room["players"][string][]; onStart: () => void; onKick: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/room/${room.code}` : "";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="mb-4 flex items-center gap-1.5 text-xs text-[#8B7FA8]"><Share2 className="h-3 w-3" /> Share this code or scan QR to join</div>

      {/* Room code + QR toggle */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center gap-3 rounded-2xl bg-[#F5EAD4] px-6 py-4 sm:px-8">
          <ShineBorder shineColor={["#1A1033", "#06b6d4", "#22c55e", "#eab308", "#ef4444"]} borderWidth={2} />
          <span className="text-3xl font-black tracking-[0.4em] text-[#1A1033] sm:text-4xl">{room.code}</span>
          <div className="flex gap-1.5">
            <button onClick={() => { navigator.clipboard.writeText(joinUrl || room.code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="text-[#8B7FA8] hover:text-[#3F2F6A]" title="Copy link">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </button>
            <button onClick={() => setShowQr(!showQr)} className="text-[#8B7FA8] hover:text-[#3F2F6A]" title="Show QR code">
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
          <div key={p.id} className="flex items-center gap-2 rounded-full border border-[#E8DCC0] bg-[#F5EAD4] px-3 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
            {p.isFacilitator ? <Crown className="h-3.5 w-3.5 text-yellow-500" /> : <User className="h-3.5 w-3.5 text-[#A89CC0]" />}
            <span className="text-[#3F2F6A]">{p.name}</span>
            {isFacilitator && !p.isFacilitator && (
              <button onClick={() => onKick(p.id)} className="text-[#A89CC0] hover:text-red-400" title="Remove player">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {isFacilitator ? (
        <div className="mt-6 sm:mt-8">
          <PulsatingButton className="bg-[#1A1033] text-sm font-bold text-white" pulseColor="#1A1033" onClick={onStart}>
            <Play className="mr-2 h-4 w-4" /> Start Game — {players.length} player{players.length !== 1 ? "s" : ""}
          </PulsatingButton>
        </div>
      ) : <p className="mt-6 animate-pulse text-sm text-[#8B7FA8] sm:mt-8">Waiting for facilitator to start...</p>}
    </div>
  );
}

// --- DRAW ---
function DrawView({ scenario, isFacilitator, onAdvance, onSkip }: { scenario: string; isFacilitator: boolean; onAdvance: () => void; onSkip: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center">
      <div className="relative w-full max-w-md">
        <MagicCard className="relative overflow-hidden rounded-2xl border-2 border-[#1A1033]/30 bg-gradient-to-br from-[#FFFBF2] to-[#F5EAD4] p-10 sm:p-14" gradientColor="rgba(255,51,102,0.06)">
          <div className="flex items-start gap-3">
            <MessageSquareWarning className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#FF3366]" />
            <TypingAnimation className="text-lg leading-relaxed text-[#1A1033] font-medium" duration={30} showCursor={false}>{scenario}</TypingAnimation>
          </div>
          <BorderBeam size={120} duration={4} colorFrom="#FF3366" colorTo="#1A1033" />
        </MagicCard>
      </div>
      {isFacilitator ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-8 flex items-center gap-3">
          <button onClick={onSkip}
            className="flex items-center gap-2 rounded-full border border-[#C9BDD8] px-5 py-3 text-sm font-semibold text-[#6B5F87] hover:border-[#8B7FA8]">
            <RefreshCw className="h-4 w-4" /> Skip Card
          </button>
          <button onClick={onAdvance}
            className="flex items-center gap-2 rounded-full bg-[#1A1033] px-6 py-3 text-sm font-bold text-white hover:bg-[#FF3366]">
            Open Voting <ChevronRight className="h-4 w-4" />
          </button>
        </motion.div>
      ) : <p className="mt-8 text-sm text-[#8B7FA8]">Read the scenario... voting opens soon.</p>}
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
    ["erode", "Erode", HeartOff, "border-[#B91C1C]", "bg-[#DC2626]", "text-white"],
    ["depends", "Depends", Scale, "border-[#B45309]", "bg-[#F59E0B]", "text-[#1A1033]"],
    ["support", "Support", HeartHandshake, "border-[#047857]", "bg-[#10B981]", "text-white"],
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center">
      <div className="relative w-full max-w-md">
        <MagicCard className="relative overflow-hidden rounded-2xl border-2 border-[#1A1033]/30 bg-gradient-to-br from-[#FFFBF2] to-[#F5EAD4] p-10 sm:p-14" gradientColor="rgba(255,51,102,0.06)">
          <p className="text-lg leading-relaxed text-[#1A1033] font-medium">{scenario}</p>
          <BorderBeam size={120} duration={4} colorFrom="#22c55e" colorTo="#16a34a" />
        </MagicCard>
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {buttons.map(([v, label, Icon, border, bg, text]) => (
          <motion.button key={v} whileTap={{ scale: 0.95 }} disabled={!!myVote} onClick={() => onVote(v)}
            className={`flex items-center gap-2 rounded-xl border-2 px-6 py-3.5 text-base font-bold shadow-sm transition-all ${
              myVote === v ? `${border} ${bg} ${text} scale-105 ring-2 ring-offset-2 ring-offset-[#FAF4E8] ring-current`
              : myVote ? `${border} ${bg} ${text} opacity-40`
              : `${border} ${bg} ${text} hover:brightness-110`
            }`}>
            <Icon className="h-5 w-5" /> {label}
          </motion.button>
        ))}
      </div>
      <p className="mt-4 text-xs text-[#8B7FA8]">{voteCount} of {total} voted</p>
      {isFacilitator && (
        <button onClick={onAdvance} className={`mt-3 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold ${
          voteCount > 0 ? "bg-[#1A1033] text-white hover:bg-[#FF3366]" : "border border-[#C9BDD8] text-[#6B5F87] hover:border-[#8B7FA8]"
        }`}>
          {voteCount === 0 ? "Force Skip" : "Share Reasons"} <ChevronRight className="h-4 w-4" />
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex w-full max-w-2xl flex-col items-center px-2">
      <div className="mb-6 w-full rounded-xl border-2 border-[#1A1033]/20 bg-[#FFFBF2] px-6 py-5 text-center text-lg leading-relaxed font-medium text-[#1A1033] sm:mb-8 sm:text-xl">{scenario}</div>
      {!submitted ? (
        <>
          <h3 className="font-serif text-3xl font-bold text-[#1A1033] sm:text-4xl">Why did you choose that?</h3>
          <p className="mt-2 text-lg text-[#6B5F87] sm:text-xl">Share your reasoning (or skip).</p>
          <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 280))} placeholder="I think this would..."
            rows={4} className="mt-6 w-full resize-none rounded-xl border-2 border-[#1A1033]/30 bg-[#FFFBF2] px-5 py-4 text-lg text-[#1A1033] placeholder:text-[#A89CC0] focus:border-[#1A1033] focus:outline-none" />
          <div className="mt-2 w-full text-right text-sm text-[#8B7FA8]">{text.length}/280</div>
          <button onClick={() => onSubmit(text.trim(), playerName)}
            className="mt-5 flex items-center gap-2 rounded-full bg-[#1A1033] px-8 py-4 text-base font-bold text-white hover:bg-[#FF3366]">
            <Send className="h-5 w-5" /> {text.trim() ? "Submit" : "Skip"}
          </button>
        </>
      ) : (
        <div className="flex flex-col items-center">
          <div className="rounded-full bg-[#1A1033]/20 p-3"><Send className="h-5 w-5 text-[#FF6699]" /></div>
          <p className="mt-3 text-sm text-[#6B5F87]">Submitted! Waiting for others...</p>
        </div>
      )}
      <p className="mt-4 text-xs text-[#8B7FA8]">{reasonCount} of {total} submitted</p>
      {isFacilitator && (
        <button onClick={onAdvance} className={`mt-3 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold ${
          reasonCount > 0 ? "bg-[#1A1033] text-white hover:bg-[#FF3366]" : "border border-[#C9BDD8] text-[#6B5F87] hover:border-[#8B7FA8]"
        }`}>
          {reasonCount === 0 ? "Force Skip" : "Reveal Board"} <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </motion.div>
  );
}

// --- REVEAL / REFLECT ---
function RevealView({ room, playerId, isFacilitator, scenario, onReflect, onRevote, onNext }: {
  room: Room; playerId: string; isFacilitator: boolean;
  scenario: { text: string; prompts?: string[] } | null;
  onReflect: () => void; onRevote: (v: Vote) => void; onNext: () => void;
}) {
  const isReflect = room.phase === "reflect";
  const activeVotes = { ...room.votes, ...(isReflect ? room.revisedVotes : {}) };
  const cols: { vote: Vote; label: string; icon: typeof HeartOff; hc: string; bg: string; bl: string; cb: string; btnBg: string; btnBorder: string; btnText: string }[] = [
    { vote: "erode", label: "Erode", icon: HeartOff, hc: "text-[#DC2626]", bg: "bg-[#FEE2E2]", bl: "border-l-[#DC2626]", cb: "bg-[#FEE2E2] text-[#B91C1C]", btnBg: "bg-[#DC2626]", btnBorder: "border-[#B91C1C]", btnText: "text-white" },
    { vote: "depends", label: "Depends", icon: Scale, hc: "text-[#B45309]", bg: "bg-[#FEF3C7]", bl: "border-l-[#F59E0B]", cb: "bg-[#FEF3C7] text-[#92400E]", btnBg: "bg-[#F59E0B]", btnBorder: "border-[#B45309]", btnText: "text-[#1A1033]" },
    { vote: "support", label: "Support", icon: HeartHandshake, hc: "text-[#047857]", bg: "bg-[#D1FAE5]", bl: "border-l-[#10B981]", cb: "bg-[#D1FAE5] text-[#065F46]", btnBg: "bg-[#10B981]", btnBorder: "border-[#047857]", btnText: "text-white" },
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
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-[#8B7FA8]"><User className="h-2.5 w-2.5" /> {card.name}</div>
                      {card.text && <p className="text-xs leading-relaxed text-[#3F2F6A]">{card.text}</p>}
                    </div>
                  </BlurFade>
                ))}
                {isLargeGroup && cards.length > 5 && (
                  <p className="text-center text-xs text-[#A89CC0]">+{cards.length - 5} more</p>
                )}
                {cards.length === 0 && <div className="rounded-lg border border-dashed border-[#E8DCC0] p-4 text-center text-xs text-[#A89CC0]">No votes</div>}
              </div>
            </div>
          );
        })}
      </div>
      {isReflect && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <p className="flex animate-pulse items-center gap-2 text-sm font-semibold text-[#FF6699]"><RefreshCw className="h-4 w-4" /> Changed your mind? Tap to revote</p>
          <div className="flex flex-wrap justify-center gap-3">
            {cols.map((col) => (
              <button key={col.vote} onClick={() => onRevote(col.vote)}
                className={`flex items-center gap-2 rounded-xl border-2 px-6 py-3.5 text-base font-bold shadow-sm transition-all ${col.btnBorder} ${col.btnBg} ${col.btnText} ${
                  myVote === col.vote ? "scale-105 ring-2 ring-offset-2 ring-offset-[#FAF4E8] ring-current" : "hover:brightness-110"
                }`}><col.icon className="h-5 w-5" /> {col.label}</button>
            ))}
          </div>
        </div>
      )}
      {isFacilitator && scenario?.prompts && scenario.prompts.length > 0 && (
        <DiscussionPrompts prompts={scenario.prompts} />
      )}
      {isFacilitator && (
        <div className="mt-8 flex gap-3">
          {!isReflect && <button onClick={onReflect} className="flex items-center gap-2 rounded-full border border-[#C9BDD8] px-5 py-2.5 text-sm font-bold text-[#3F2F6A] hover:border-[#8B7FA8]"><RefreshCw className="h-4 w-4" /> Open Revoting</button>}
          <button onClick={onNext} className="flex items-center gap-2 rounded-full bg-[#1A1033] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#FF3366]">Next Round <ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
    </motion.div>
  );
}

// --- DISCUSSION PROMPTS ---
function DiscussionPrompts({ prompts }: { prompts: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 w-full max-w-md">
      <button onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-xl border-2 border-[#1A1033] bg-[#1A1033] px-4 py-2.5 text-sm font-bold text-[#FAF4E8] shadow-sm transition-colors hover:bg-[#FF3366] hover:border-[#FF3366]">
        <span className="flex items-center gap-2">
          <MessageSquareWarning className="h-4 w-4" />
          Discussion Prompts ({prompts.length})
        </span>
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {prompts.map((p, i) => (
            <div key={i} className="rounded-lg border-2 border-[#1A1033]/30 bg-[#FFFBF2] px-5 py-4 text-base leading-relaxed text-[#1A1033]">
              {p}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- SUMMARY ---
function SummaryView({ room, onReset }: { room: Room; onReset: () => void }) {
  const allRounds = [...room.roundHistory];
  const totals = { erode: 0, depends: 0, support: 0 };
  allRounds.forEach((r) => Object.values(r.votes).forEach((v) => totals[v]++));
  const total = totals.erode + totals.depends + totals.support;
  const confettiFired = useRef(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    confettiFired.current = true;
  }, []);

  function buildResultsText() {
    const lines: string[] = ["The AI Effect — Game Results", `${allRounds.length} rounds played`, ""];
    lines.push(`Erode: ${totals.erode}  |  Depends: ${totals.depends}  |  Support: ${totals.support}`, "");
    allRounds.forEach((r, i) => {
      const card = scenarios[r.cardIndex];
      const rv = Object.values(r.votes);
      const e = rv.filter((v) => v === "erode").length;
      const d = rv.filter((v) => v === "depends").length;
      const s = rv.filter((v) => v === "support").length;
      lines.push(`Round ${i + 1}: ${card?.text || "Unknown scenario"}`);
      lines.push(`  Erode ${e} | Depends ${d} | Support ${s}`);
    });
    return lines.join("\n");
  }

  async function handleExport() {
    const text = buildResultsText();
    if (navigator.share) {
      try {
        await navigator.share({ title: "The AI Effect — Results", text });
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      {!confettiFired.current && <Confetti />}
      <BlurFade delay={0}><h2 className="text-3xl font-black">Game Complete!</h2></BlurFade>
      <BlurFade delay={0.2}><p className="mt-2 text-[#8B7FA8]">{allRounds.length} rounds played</p></BlurFade>
      <BlurFade delay={0.4}>
        <div className="mt-8 flex gap-6">
          {([["erode", HeartOff, "text-red-400"], ["depends", Scale, "text-yellow-400"], ["support", HeartHandshake, "text-green-400"]] as const).map(([k, Icon, color]) => (
            <div key={k} className="flex flex-col items-center gap-1">
              <Icon className={`h-5 w-5 ${color}`} />
              <span className={`text-2xl font-black ${color}`}><NumberTicker value={totals[k]} /></span>
              <span className="text-xs text-[#8B7FA8]">{k}</span>
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
      <div className="mt-8 flex gap-3">
        <button onClick={handleExport} className="flex items-center gap-2 rounded-full border border-[#C9BDD8] px-5 py-3 text-sm font-semibold text-[#3F2F6A] hover:border-[#8B7FA8]">
          {copied ? <Check className="h-4 w-4 text-green-400" /> : <Download className="h-4 w-4" />}
          {copied ? "Copied!" : "Export Results"}
        </button>
        <button onClick={onReset} className="flex items-center gap-2 rounded-full bg-[#1A1033] px-6 py-3 text-sm font-bold text-white hover:bg-[#FF3366]">
          <RotateCcw className="h-4 w-4" /> Play Again
        </button>
      </div>
    </div>
  );
}
