import React, { useState, useEffect, useRef, useCallback } from "react";
import { Send, Mic, Calendar, Clock, AlertTriangle, CheckCircle2, Trash2, Radio, Cpu } from "lucide-react";

// ---------------------------------------------------------------------------
// J.A.R.V.I.S. — Calendar Command Interface
// Point API_BASE at your local FastAPI backend (see api.py) to go live.
// Until then, it runs in DEMO MODE with a small simulated agent.
// ---------------------------------------------------------------------------

const API_BASE = "http://localhost:8000";

const FONT_LINK_ID = "jarvis-fonts";

function useFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
  }, []);
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Arc reactor avatar — idles with a slow rotation, spins up fast while "thinking"
function ArcReactor({ active = false, size = 56 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        flexShrink: 0,
      }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#EAFCFF" />
            <stop offset="35%" stopColor="#4CE6FF" />
            <stop offset="100%" stopColor="#0B121C" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill="none" stroke="#123244" strokeWidth="2" />
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          stroke="#4CE6FF"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          opacity="0.7"
          style={{
            transformOrigin: "50px 50px",
            animation: `spin ${active ? 2.2 : 9}s linear infinite`,
          }}
        />
        <circle
          cx="50"
          cy="50"
          r="27"
          fill="none"
          stroke="#FFB020"
          strokeWidth="1"
          strokeDasharray="2 5"
          style={{
            transformOrigin: "50px 50px",
            animation: `spin-reverse ${active ? 1.6 : 14}s linear infinite`,
          }}
        />
        <circle cx="50" cy="50" r="16" fill="url(#core-glow)">
          <animate
            attributeName="opacity"
            values={active ? "0.6;1;0.6" : "0.85;1;0.85"}
            dur={active ? "0.6s" : "3s"}
            repeatCount="indefinite"
          />
        </circle>
        <circle cx="50" cy="50" r="7" fill="#EAFCFF" />
      </svg>
    </div>
  );
}

function StatusPill({ ok = true, children }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 3,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        letterSpacing: "0.08em",
        color: ok ? "#4CE6FF" : "#FF4655",
        border: `1px solid ${ok ? "rgba(76,230,255,0.35)" : "rgba(255,70,85,0.4)"}`,
        background: ok ? "rgba(76,230,255,0.06)" : "rgba(255,70,85,0.08)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: ok ? "#4CE6FF" : "#FF4655",
          boxShadow: `0 0 6px ${ok ? "#4CE6FF" : "#FF4655"}`,
        }}
      />
      {children}
    </span>
  );
}

// --- Demo-mode "agent" so the interface is fully interactive without a backend ---
function demoRespond(text) {
  const t = text.toLowerCase();
  if (t.includes("cancel") || t.includes("delete")) {
    return {
      reply:
        "I can cancel that, sir — but I'll need explicit confirmation on which entry. Say the word and it's gone.",
    };
  }
  if (t.includes("schedule") || t.includes("book") || t.includes("meeting") || t.includes("create")) {
    return {
      reply:
        "Checking your matrix for conflicts... clear. Shall I lock it in?",
      event: {
        id: `demo-${Date.now()}`,
        title: text.replace(/^(schedule|book|create)\s*/i, "") || "New Engagement",
        time: "Fri · 5:00 PM",
        status: "pending",
      },
    };
  }
  if (t.includes("list") || t.includes("what") || t.includes("agenda") || t.includes("today")) {
    return {
      reply: "Pulling up your schedule matrix now, sir. Displayed on the right.",
    };
  }
  return {
    reply:
      "Understood. Running that through the calendar systems now — connect me to your live backend for real results.",
  };
}

async function callBackend(message, history) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) throw new Error(`Backend responded ${res.status}`);
  return res.json();
}

const SEED_EVENTS = [
  { id: "e1", title: "Standup — Ops Wing", time: "Today · 10:00 AM", status: "confirmed" },
  { id: "e2", title: "Design Review", time: "Today · 3:30 PM", status: "confirmed" },
  { id: "e3", title: "Vendor Call — Hammer Tech", time: "Tomorrow · 11:00 AM", status: "confirmed" },
];

export default function JarvisInterface() {
  useFonts();
  const now = useClock();
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Good day. Systems online, calendar synced. How can I assist?",
    },
  ]);
  const [apiHistory, setApiHistory] = useState(null); // raw Groq-format history round-tripped with the backend
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [events, setEvents] = useState(SEED_EVENTS);
  const [liveBackend, setLiveBackend] = useState(null); // null = unknown, true/false once probed
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/health`).then(
      () => !cancelled && setLiveBackend(true),
      () => !cancelled && setLiveBackend(false)
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setThinking(true);

    try {
      let data;
      if (liveBackend) {
        data = await callBackend(text, apiHistory);
      } else {
        await new Promise((r) => setTimeout(r, 650 + Math.random() * 500));
        data = demoRespond(text);
      }
      setMessages((m) => [...m, { role: "assistant", text: data.reply }]);
      if (data.history) setApiHistory(data.history);
      if (data.event) setEvents((e) => [data.event, ...e]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Connection interrupted: ${err.message}` },
      ]);
    } finally {
      setThinking(false);
    }
  }, [input, thinking, liveBackend, apiHistory]);

  const removeEvent = (id) => setEvents((e) => e.filter((ev) => ev.id !== id));

  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString(undefined, { hour12: false });

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        background:
          "radial-gradient(ellipse at 20% -10%, rgba(76,230,255,0.10), transparent 45%), radial-gradient(ellipse at 100% 10%, rgba(255,176,32,0.06), transparent 40%), #05070C",
        color: "#E8F6FF",
        fontFamily: "'Rajdhani', sans-serif",
        position: "relative",
        overflow: "hidden",
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        @keyframes spin-reverse { from { transform: rotate(360deg);} to { transform: rotate(0deg);} }
        @keyframes scanline { 0% { transform: translateY(-100%);} 100% { transform: translateY(100vh);} }
        @keyframes fadeIn { from { opacity:0; transform: translateY(6px);} to { opacity:1; transform: translateY(0);} }
        .jv-scrollbar::-webkit-scrollbar { width: 6px; }
        .jv-scrollbar::-webkit-scrollbar-thumb { background: rgba(76,230,255,0.25); border-radius: 4px; }
        .jv-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .jv-msg { animation: fadeIn 0.25s ease-out; }
        .jv-input:focus { outline: none; border-color: #4CE6FF !important; box-shadow: 0 0 0 1px rgba(76,230,255,0.3); }
        .jv-send:hover, .jv-mic:hover { background: rgba(76,230,255,0.15) !important; }
        .jv-card:hover { border-color: rgba(76,230,255,0.55) !important; transform: translateX(2px); }
        .jv-del:hover { opacity: 1 !important; color: #FF4655 !important; }
      `}</style>

      {/* ambient scanline */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: 2,
          background:
            "linear-gradient(90deg, transparent, rgba(76,230,255,0.35), transparent)",
          animation: "scanline 7s linear infinite",
          pointerEvents: "none",
        }}
      />
      {/* faint grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(76,230,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(76,230,255,0.035) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", maxWidth: 1180, margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: 16,
            marginBottom: 20,
            borderBottom: "1px solid rgba(76,230,255,0.18)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <ArcReactor active={thinking} size={44} />
            <div>
              <div
                style={{
                  fontFamily: "'Orbitron', sans-serif",
                  fontWeight: 700,
                  fontSize: 22,
                  letterSpacing: "0.12em",
                  background: "linear-gradient(90deg, #EAFCFF, #4CE6FF)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                J.A.R.V.I.S.
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: "0.15em",
                  color: "#6B93A8",
                  marginTop: 2,
                }}
              >
                CALENDAR COMMAND INTERFACE
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                textAlign: "right",
                fontSize: 12,
                color: "#6B93A8",
                lineHeight: 1.5,
              }}
            >
              <div style={{ color: "#4CE6FF", fontSize: 15 }}>{timeStr}</div>
              <div>{dateStr}</div>
            </div>
            <StatusPill ok={liveBackend !== false}>
              {liveBackend ? "LIVE BACKEND" : liveBackend === false ? "DEMO MODE" : "PROBING..."}
            </StatusPill>
          </div>
        </div>

        {/* Body grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20 }}>
          {/* Chat panel */}
          <div
            style={{
              background: "rgba(11,18,28,0.75)",
              border: "1px solid rgba(76,230,255,0.16)",
              borderRadius: 6,
              display: "flex",
              flexDirection: "column",
              height: 560,
              position: "relative",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderBottom: "1px solid rgba(76,230,255,0.12)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: "#6B93A8",
                letterSpacing: "0.08em",
              }}
            >
              <Radio size={13} color="#4CE6FF" />
              COMMS CHANNEL
            </div>

            <div
              ref={scrollRef}
              className="jv-scrollbar"
              style={{ flex: 1, overflowY: "auto", padding: "18px 18px 8px" }}
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className="jv-msg"
                  style={{
                    display: "flex",
                    justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                    marginBottom: 14,
                  }}
                >
                  {m.role === "assistant" && (
                    <div style={{ marginRight: 10, marginTop: 2 }}>
                      <ArcReactor size={26} />
                    </div>
                  )}
                  <div
                    style={{
                      maxWidth: "78%",
                      padding: "10px 14px",
                      borderRadius: 4,
                      fontSize: 15,
                      lineHeight: 1.45,
                      background:
                        m.role === "user" ? "rgba(255,176,32,0.10)" : "rgba(76,230,255,0.07)",
                      border:
                        m.role === "user"
                          ? "1px solid rgba(255,176,32,0.30)"
                          : "1px solid rgba(76,230,255,0.22)",
                      color: m.role === "user" ? "#FFD592" : "#E8F6FF",
                    }}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {thinking && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <ArcReactor active size={26} />
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 12,
                      color: "#4CE6FF",
                      letterSpacing: "0.06em",
                    }}
                  >
                    PROCESSING...
                  </span>
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                padding: 14,
                borderTop: "1px solid rgba(76,230,255,0.14)",
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid rgba(76,230,255,0.25)",
                  borderRadius: 4,
                  padding: "0 12px",
                  background: "rgba(5,7,12,0.6)",
                }}
              >
                <span style={{ color: "#4CE6FF", fontFamily: "'JetBrains Mono', monospace" }}>
                  &gt;
                </span>
                <input
                  className="jv-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Schedule a meeting, check my agenda, cancel an event..."
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    color: "#E8F6FF",
                    fontFamily: "'Rajdhani', sans-serif",
                    fontSize: 15,
                    padding: "10px 0",
                  }}
                />
              </div>
              <button
                className="jv-mic"
                title="Voice input (visual only)"
                style={{
                  width: 42,
                  border: "1px solid rgba(76,230,255,0.25)",
                  borderRadius: 4,
                  background: "transparent",
                  color: "#4CE6FF",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Mic size={16} />
              </button>
              <button
                className="jv-send"
                onClick={send}
                disabled={thinking}
                style={{
                  width: 42,
                  border: "1px solid rgba(76,230,255,0.4)",
                  borderRadius: 4,
                  background: "rgba(76,230,255,0.08)",
                  color: "#4CE6FF",
                  cursor: thinking ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Send size={16} />
              </button>
            </div>
          </div>

          {/* Schedule matrix panel */}
          <div
            style={{
              background: "rgba(11,18,28,0.75)",
              border: "1px solid rgba(76,230,255,0.16)",
              borderRadius: 6,
              height: 560,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderBottom: "1px solid rgba(76,230,255,0.12)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: "#6B93A8",
                letterSpacing: "0.08em",
              }}
            >
              <Calendar size={13} color="#FFB020" />
              SCHEDULE MATRIX
              <span style={{ marginLeft: "auto", color: "#4CE6FF" }}>{events.length} ENTRIES</span>
            </div>

            <div className="jv-scrollbar" style={{ flex: 1, overflowY: "auto", padding: 14 }}>
              {events.length === 0 && (
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                    color: "#6B93A8",
                    textAlign: "center",
                    marginTop: 40,
                  }}
                >
                  NO ENTRIES ON RECORD
                </div>
              )}
              {events.map((ev) => (
                <div
                  key={ev.id}
                  className="jv-card"
                  style={{
                    border: "1px solid rgba(76,230,255,0.18)",
                    borderLeft: `3px solid ${ev.status === "pending" ? "#FFB020" : "#4CE6FF"}`,
                    borderRadius: 3,
                    padding: "10px 12px",
                    marginBottom: 10,
                    background: "rgba(76,230,255,0.03)",
                    transition: "all 0.15s ease",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{ev.title}</div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        marginTop: 4,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        color: "#6B93A8",
                      }}
                    >
                      <Clock size={11} />
                      {ev.time}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        marginTop: 5,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 10,
                        letterSpacing: "0.06em",
                        color: ev.status === "pending" ? "#FFB020" : "#4CE6FF",
                      }}
                    >
                      {ev.status === "pending" ? (
                        <>
                          <AlertTriangle size={11} /> PENDING CONFIRMATION
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={11} /> CONFIRMED
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    className="jv-del"
                    onClick={() => removeEvent(ev.id)}
                    title="Remove"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#6B93A8",
                      opacity: 0.5,
                      cursor: "pointer",
                      padding: 4,
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div
              style={{
                padding: "10px 16px",
                borderTop: "1px solid rgba(76,230,255,0.12)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: "#3E5A6B",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Cpu size={11} />
              {liveBackend ? `SYNCED · ${API_BASE}` : "AWAITING BACKEND CONNECTION"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}