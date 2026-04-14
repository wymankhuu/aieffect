"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, LogIn, Play, Copy, Check, ArrowRight,
  MessageCircle, Cake, HeartCrack, Gift, Users,
  BookOpen, Brain, Eye, Sparkles,
} from "lucide-react";
import { Particles } from "@/components/ui/particles";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Marquee } from "@/components/ui/marquee";

const marqueeScenarios = [
  { icon: MessageCircle, text: "AI writes your apology text" },
  { icon: Cake, text: "AI remembers your best friend's birthday" },
  { icon: HeartCrack, text: "AI coaches you through a breakup" },
  { icon: Gift, text: "AI suggests gifts for your partner" },
  { icon: Users, text: "AI mediates a family group chat" },
  { icon: BookOpen, text: "AI grades your child's homework" },
  { icon: Brain, text: "AI predicts your mood from texts" },
  { icon: Eye, text: "AI monitors your teen's social media" },
  { icon: Sparkles, text: "AI writes your wedding vows" },
];

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "create" | "join">("none");
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [rounds, setRounds] = useState(10);
  const [customRounds, setCustomRounds] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [createdCode, setCreatedCode] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    if (!name.trim()) { setError("Enter your name"); return; }
    setLoading(true);
    const res = await fetch("/api/room/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), rounds }),
    });
    const data = await res.json();
    sessionStorage.setItem(`player-${data.code}`, data.playerId);
    setCreatedCode(data.code);
    setLoading(false);
  }

  async function handleJoin() {
    if (!name.trim()) { setError("Enter your name"); return; }
    if (joinCode.length !== 4) { setError("Enter a 4-letter code"); return; }
    setLoading(true);
    const res = await fetch("/api/room/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: joinCode.toUpperCase(), name: name.trim() }),
    });
    const data = await res.json();
    if (data.error) { setError(data.error); setLoading(false); return; }
    sessionStorage.setItem(`player-${joinCode.toUpperCase()}`, data.playerId);
    router.push(`/room/${joinCode.toUpperCase()}`);
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#FAF4E8] via-[#F5EAD4] to-[#F1E0B8] px-6">
      <Particles className="absolute inset-0" quantity={60} color="#1A1033" ease={80} refresh />

      <div className="relative z-10 flex flex-col items-center text-center">
        <h1 className="font-serif text-6xl font-bold tracking-tight text-[#1A1033] sm:text-8xl">
          The AI Effect
        </h1>
        <p className="mt-6 max-w-xl text-xl text-[#4A3E66] sm:text-2xl">
          Uncover how AI can strengthen human connection — or pull us apart.
        </p>

        {/* Room Created - show code */}
        {createdCode && (
          <div className="mt-8 flex flex-col items-center gap-4">
            <p className="text-sm text-[#6B5F87]">Your room is ready! Share this code:</p>
            <div className="flex items-center gap-3 rounded-2xl border border-[#E8DCC0] bg-[#FFFBF2] px-8 py-4 shadow-sm">
              <span className="font-serif text-4xl font-bold tracking-[0.4em] text-[#1A1033]">{createdCode}</span>
              <button onClick={() => { navigator.clipboard.writeText(createdCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="text-[#6B5F87] hover:text-[#1A1033]">
                {copied ? <Check className="h-5 w-5 text-[#FF3366]" /> : <Copy className="h-5 w-5" />}
              </button>
            </div>
            <button onClick={() => router.push(`/room/${createdCode}`)}
              className="flex items-center gap-2 rounded-full bg-[#1A1033] px-6 py-3 text-sm font-bold text-[#FAF4E8] transition-colors hover:bg-[#FF3366]">
              Enter Room <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {mode === "none" && !createdCode && (
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <ShimmerButton className="h-14 px-8 text-base font-bold" shimmerColor="#FF3366" background="rgba(26,16,51,1)" onClick={() => setMode("create")}>
              <Plus className="mr-2 h-5 w-5" /> Create Room
            </ShimmerButton>
            <button onClick={() => setMode("join")}
              className="flex h-14 items-center gap-2 rounded-full border-2 border-[#1A1033] px-8 text-base font-bold text-[#1A1033] transition-colors hover:border-[#FF3366] hover:text-[#FF3366]">
              <LogIn className="h-5 w-5" /> Join Room
            </button>
          </div>
        )}

        {/* Create Room Form */}
        {mode === "create" && !createdCode && (
          <div className="mt-8 w-full max-w-xs space-y-3">
            <input type="text" placeholder="Your name" value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              className="w-full rounded-xl border border-[#E8DCC0] bg-[#FFFBF2] px-4 py-3 text-sm text-[#1A1033] placeholder:text-[#A89CC0] focus:border-[#FF3366] focus:outline-none" autoFocus />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#1A1033]">Rounds</label>
              <div className="flex gap-2">
                {[1, 5, 10, 15, 20].map((n) => (
                  <button key={n} onClick={() => { setRounds(n); setIsCustom(false); setCustomRounds(""); }}
                    className={`flex-1 rounded-lg border-2 px-2 py-2 text-sm font-bold transition-colors ${
                      rounds === n && !isCustom ? "border-[#FF3366] bg-[#FF3366]/10 text-[#FF3366]" : "border-[#1A1033]/40 text-[#1A1033] hover:border-[#1A1033]"
                    }`}>{n}</button>
                ))}
              </div>
              <input type="number" min={1} max={50} placeholder="custom" value={customRounds}
                onChange={(e) => { setCustomRounds(e.target.value); setIsCustom(true); const n = parseInt(e.target.value); if (n >= 1 && n <= 50) setRounds(n); }}
                onFocus={() => setIsCustom(true)}
                className={`mt-2 w-full rounded-lg border-2 px-4 py-3 text-center text-base font-semibold focus:outline-none ${
                  isCustom && customRounds ? "border-[#FF3366] bg-[#FF3366]/10 text-[#FF3366]" : "border-[#1A1033]/40 bg-transparent text-[#1A1033] placeholder:text-[#A89CC0] placeholder:font-normal focus:border-[#1A1033]"
                }`} />
            </div>
            {error && <p className="text-xs text-[#C2185B] text-center">{error}</p>}
            <button onClick={handleCreate} disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1A1033] px-4 py-3 text-sm font-bold text-[#FAF4E8] transition-colors hover:bg-[#FF3366] disabled:opacity-50">
              <Play className="h-4 w-4" /> {loading ? "Creating..." : "Create Room"}
            </button>
            <button onClick={() => setMode("none")} className="w-full text-xs text-[#6B5F87] hover:text-[#1A1033]">Back</button>
          </div>
        )}

        {/* Join Room Form */}
        {mode === "join" && !createdCode && (
          <div className="mt-8 w-full max-w-xs space-y-3">
            <input type="text" placeholder="Your name" value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              className="w-full rounded-xl border border-[#E8DCC0] bg-[#FFFBF2] px-4 py-3 text-sm text-[#1A1033] placeholder:text-[#A89CC0] focus:border-[#FF3366] focus:outline-none" autoFocus />
            <input type="text" placeholder="Room code (e.g. SPARK)" maxLength={4} value={joinCode}
              onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setError(""); }}
              className="w-full rounded-xl border border-[#E8DCC0] bg-[#FFFBF2] px-4 py-3 text-center font-serif text-lg font-bold uppercase tracking-[0.3em] text-[#1A1033] placeholder:text-[#A89CC0] placeholder:tracking-normal placeholder:text-sm placeholder:font-normal focus:border-[#FF3366] focus:outline-none" />
            {error && <p className="text-xs text-[#C2185B] text-center">{error}</p>}
            <button onClick={handleJoin} disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1A1033] px-4 py-3 text-sm font-bold text-[#FAF4E8] transition-colors hover:bg-[#FF3366] disabled:opacity-50">
              <LogIn className="h-4 w-4" /> {loading ? "Joining..." : "Join Game"}
            </button>
            <button onClick={() => setMode("none")} className="w-full text-xs text-[#6B5F87] hover:text-[#1A1033]">Back</button>
          </div>
        )}
      </div>

      {/* Marquee */}
      <div className="relative z-10 mt-16 w-full max-w-3xl">
        <Marquee pauseOnHover className="[--duration:30s]">
          {marqueeScenarios.map((s) => (
            <div key={s.text} className="flex items-center gap-2 rounded-full border border-[#E8DCC0] bg-[#FFFBF2]/80 px-4 py-2 text-xs text-[#1A1033]">
              <s.icon className="h-3.5 w-3.5 text-[#FF3366]" />
              {s.text}
            </div>
          ))}
        </Marquee>
      </div>
    </div>
  );
}
