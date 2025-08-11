import React, { useEffect, useMemo, useRef, useState } from "react";

// =====================
// FocusBlocks – lightweight Pomodoro/timeblock app
// - Custom focus & break lengths
// - Configurable alert sound & volume
// - Timeblock task per focus window
// - Session log with localStorage persistence
// =====================

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (sec) => `${pad(Math.floor(sec / 60))}:${pad(Math.floor(sec % 60))}`;

// ===== Spark Trail Config & Helper Functions =====
const toRad = (deg) => (deg * Math.PI) / 180; // Convert degrees → radians

const SPARK = {
  r: 52,            // same radius as your SVG progress circle
  cx: 60,           // SVG center X
  cy: 60,           // SVG center Y
  lifetime: 1200,   // ms: how long each spark stays visible
  cap: 10           // max sparks in the trail at a time
};

// Color of the spark based on phase
const sparkColor = (phase) => (
  phase === "focus" ? "#f59e0b" /* warm amber */ : "#10b981" /* cool emerald */
);

const useLocalStorage = (key, initial) => {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
  }, [key, value]);
  return [value, setValue];
};

function useAudio() {
  const ctxRef = useRef(null);
  const ensureCtx = () => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    return ctxRef.current;
  };
  const playBeep = async ({ type = "beep", volume = 0.5 } = {}) => {
    const ctx = ensureCtx();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(volume, 1));
    gain.connect(ctx.destination);

    const makeTone = (freq, dur, delay = 0) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now + delay);
      osc.stop(now + delay + dur);
    };

    if (type === "beep") {
      makeTone(880, 0.25, 0);
    } else if (type === "chime") {
      makeTone(660, 0.18, 0);
      makeTone(990, 0.22, 0.18);
    } else if (type === "tick") {
      makeTone(440, 0.08, 0);
    }
  };
  return { playBeep };
}

export default function App() {
  // Settings
  const [focusMin, setFocusMin] = useLocalStorage("fb_focusMin", 25);
  const [breakMin, setBreakMin] = useLocalStorage("fb_breakMin", 5);
  const [volume, setVolume] = useLocalStorage("fb_volume", 0.6);
  const [sound, setSound] = useLocalStorage("fb_sound", "chime");

  // Keeps the page’s original title so we can restore it on unmount
  const originalTitleRef = useRef(document.title);

  // Timeblock Task (per current focus window)
  const [currentTask, setCurrentTask] = useLocalStorage("fb_currentTask", "");

  // ===== Todo list (for current focus window) =====
  const [todos, setTodos] = useLocalStorage("fb_todos_current", []); 
  // each todo: { id: string, text: string, done: boolean }

  // ===== Log details modal =====
  const [openDetails, setOpenDetails] = useState(null); 
  // null | {id, phase, task, start, end, duration, reason, todos: []}

  // Live clock & date
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Timer State
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useLocalStorage("fb_phase", "focus"); // "focus" | "break"
  const [remaining, setRemaining] = useLocalStorage("fb_remaining", focusMin * 60);

  // Logs
  const [log, setLog] = useLocalStorage("fb_log", []); // {id, phase, task, start, end, duration}

  // ===== Spark Trail State =====
  // Stores positions of recent spark dots [{x, y, t}]
  const [trail, setTrail] = useState([]);

  const { playBeep } = useAudio();
  const intervalRef = useRef(null);
  const sessionStartRef = useRef(null);

  // 🔽 ADD THIS BLOCK
  const getTotalSec = () => (phase === "focus" ? focusMin : breakMin) * 60;
  const completingRef = useRef(false);

  const addTodo = (text) => {
  const t = text.trim();
  if (!t) return;
  setTodos((prev) => [{ id: String(Date.now()), text: t, done: false }, ...prev]);
  };

  const toggleTodo = (id) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const removeTodo = (id) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const clearCompleted = () => {
    setTodos((prev) => prev.filter((t) => !t.done));
  };


  const finalizePhase = (reason = "completed", { autoSwitch = true } = {}) => {
    if (completingRef.current) return;
    completingRef.current = true;

    const total = getTotalSec();
    const end = Date.now();

    // how much time actually elapsed
    const elapsedSec = Math.max(0, Math.min(total, total - remaining));
    const duration = reason === "completed" ? total : elapsedSec;

    // derive start if missing
    const start = sessionStartRef.current ?? end - duration * 1000;

    const entry = {
      id: `${end}`,
      phase,
      task: phase === "focus" ? (currentTask || "(No task)") : "—",
      start,
      end,
      duration,  // seconds
      reason,    // "completed" | "reset" | "skipped"
      todos: [...todos], // 👈 snapshot of current todo list
    };
    setLog((l) => [entry, ...l].slice(0, 200));

    // 🔽 clear the current checklist whenever a FOCUS phase ends
    if (phase === "focus") {
      setTodos([]);
    }

    sessionStartRef.current = null;

    if (reason === "completed" && autoSwitch) {
      playBeep({ type: sound, volume });
      const nextPhase = phase === "focus" ? "break" : "focus";
      setPhase(nextPhase);
      setRemaining((nextPhase === "focus" ? focusMin : breakMin) * 60);
      setIsRunning(true);
    }

    completingRef.current = false;
  };
  // 🔼 END ADD

  // Keep remaining synced to setting changes when stopped or when phase changes
  useEffect(() => {
    if (!isRunning) {
      setRemaining((phase === "focus" ? focusMin : breakMin) * 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMin, breakMin, phase]);

  // Core timer loop
  useEffect(() => {
    if (!isRunning) return;
    if (!sessionStartRef.current) sessionStartRef.current = Date.now();

    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          finalizePhase("completed");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // const handlePhaseComplete = () => {
  //   // finalize log for this phase
  //   const start = sessionStartRef.current || Date.now();
  //   const end = Date.now();
  //   const duration = (phase === "focus" ? focusMin : breakMin) * 60;
  //   const entry = {
  //     id: `${end}`,
  //     phase,
  //     task: phase === "focus" ? currentTask || "(No task)" : "—",
  //     start,
  //     end,
  //     duration,
  //   };
  //   setLog((l) => [entry, ...l].slice(0, 200));
  //   sessionStartRef.current = null;

  //   // alert & switch phase
  //   playBeep({ type: sound, volume });
  //   const nextPhase = phase === "focus" ? "break" : "focus";
  //   setPhase(nextPhase);
  //   setRemaining((nextPhase === "focus" ? focusMin : breakMin) * 60);
  //   // If auto-continue, start next phase automatically
  //   setIsRunning(true);
  // };

  const start = () => {
    if (remaining <= 0) setRemaining((phase === "focus" ? focusMin : breakMin) * 60);
    sessionStartRef.current = Date.now();
    setIsRunning(true);
  };
  const pause = () => {
    setIsRunning(false);
    sessionStartRef.current = null;
  };
  const reset = () => {
    const total = getTotalSec();
    const shouldLog = remaining < total; // only if user actually spent time
    setIsRunning(false);
    if (shouldLog) finalizePhase("reset", { autoSwitch: false });
    sessionStartRef.current = null;
    setRemaining(total); // restart same phase fresh
  };

  const skip = () => {
    setIsRunning(false);
    sessionStartRef.current = null;
    finalizePhase("skipped", { autoSwitch: true }); // will switch & beep
  };

  const pct = useMemo(() => {
    const total = (phase === "focus" ? focusMin : breakMin) * 60;
    if (!total) return 0;
    return Math.round(((total - remaining) / total) * 100);
  }, [remaining, phase, focusMin, breakMin]);

  const clearLog = () => setLog([]);

  // ===== Spark Trail Update Effect =====
  // ⬇️  ADD THIS **RIGHT HERE** (after the above useEffect, before `return`)
  useEffect(() => {
    if (!isRunning) return; // Only update trail when timer is running

    // Calculate head position based on pct
    const angle = -90 + (pct / 100) * 360; // -90deg so it starts at top
    const x = SPARK.cx + SPARK.r * Math.cos(toRad(angle));
    const y = SPARK.cy + SPARK.r * Math.sin(toRad(angle));
    const now = Date.now();

    setTrail((prev) => {
      // Keep only fresh sparks within lifetime
      const fresh = [...prev, { x, y, t: now }]
        .filter((p) => now - p.t < SPARK.lifetime)
        .slice(-SPARK.cap);
      return fresh;
    });
  }, [pct, isRunning]);

  // ===== Browser tab live title =====
  useEffect(() => {
    const label = phase === "focus" ? "🔥" : "Break";

    if (isRunning) {
      // e.g. "24:59 • Focus — FocusBlocks"
      document.title = `${fmtTime(remaining)} • ${label} Focus 🔥`;
    } else {
      // e.g. "Paused • Focus — FocusBlocks"
      document.title = `Paused • ${label} Focus 🔥`;
    }

    // Restore original title when component unmounts
    return () => { document.title = originalTitleRef.current; };
  }, [remaining, isRunning, phase]);


  return (
    <div className="min-h-screen w-full bg-white text-gray-900 py-8 px-4 md:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">FocusBlocks</h1>
          <div className="flex-row justify-end">
          <div className="text-2xl font-semibold text-gray-600">
            {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="text-m font-semibold text-gray-500">
            {now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" })}{" "}
          </div>
          </div>
        </header>

        <main className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Timer Card */}
          <section className="lg:col-span-2 rounded-2xl border border-gray-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm uppercase tracking-wide text-gray-500">Current</span>

              {!isRunning ? (
                <div className="inline-flex rounded-full border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => { setPhase("focus"); setRemaining(focusMin * 60); }}
                    className={`px-3 py-1 text-sm ${phase === "focus" ? "bg-gray-900 text-white" : "bg-white"}`}
                  >
                    Focus
                  </button>
                  <button
                    onClick={() => { setPhase("break"); setRemaining(breakMin * 60); }}
                    className={`px-3 py-1 text-sm ${phase === "break" ? "bg-gray-900 text-white" : "bg-white"}`}
                  >
                    Break
                  </button>
                </div>
              ) : (
                <span className="text-sm font-medium px-2 py-1 rounded-full bg-gray-100">
                  {phase === "focus" ? "Focus" : "Break"}
                </span>
              )}
            </div>


            <div className="flex items-center gap-6">
              <div className="relative w-40 h-40 shrink-0">
                <svg viewBox="0 0 120 120" className="w-full h-full">
                  {/* ===== Soft glow for the spark dots ===== */}
                  <defs>
                    <filter id="spark-glow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  {/* Base ring */}
                  <circle cx="60" cy="60" r="52" className="fill-none stroke-gray-200" strokeWidth="8" />

                  {/* Progress arc */}
                  <circle
                    cx="60" cy="60" r="52"
                    className="fill-none stroke-gray-900"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${Math.max(0.01, (pct / 100) * 2 * Math.PI * 52)} ${2 * Math.PI * 52}`}
                    transform="rotate(-90 60 60)"
                  />

                  {/* ===== Comet spark trail ===== */}
                  <g filter="url(#spark-glow)">
                    {/* Trail dots (fade & shrink with age) */}
                    {trail.map((p, i) => {
                      const age = Date.now() - p.t;                      // ms since dot was created
                      const k = Math.max(0, 1 - age / SPARK.lifetime);   // 1 → 0 as it ages
                      const opacity = 0.55 * k;                          // fade out
                      const radius = 2.8 * (0.65 + 0.35 * k);            // slight shrink
                      return (
                        <circle
                          key={i}
                          cx={p.x}
                          cy={p.y}
                          r={radius}
                          fill={sparkColor(phase)}
                          style={{ opacity }}
                        />
                      );
                    })}

                    {/* Current head spark (bright core + faint ring) */}
                    {(() => {
                      const angle = -90 + (pct / 100) * 360;
                      const x = SPARK.cx + SPARK.r * Math.cos(toRad(angle));
                      const y = SPARK.cy + SPARK.r * Math.sin(toRad(angle));
                      const color = sparkColor(phase);
                      return (
                        <>
                          <circle cx={x} cy={y} r={3} fill={color} style={{ opacity: 0.9 }} />
                          <circle cx={x} cy={y} r={4.6} fill="none" stroke={color} strokeWidth="1.2" style={{ opacity: 0.35 }} />
                        </>
                      );
                    })()}
                  </g>
                </svg>

                <div className="absolute inset-0 grid place-items-center">
                  <div className="text-3xl font-semibold tabular-nums">{fmtTime(remaining)}</div>
                </div>
              </div>

              <div className="flex-1 space-y-4">
                {phase === "focus" && (
                  <div>
                    <label className="text-sm text-gray-600">Task for this focus window</label>
                    <input
                      type="text"
                      value={currentTask}
                      onChange={(e) => setCurrentTask(e.target.value)}
                      placeholder="e.g. Build React component for navbar"
                      className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {!isRunning ? (
                    <button onClick={start} className="rounded-xl px-4 py-2 bg-gray-900 text-white font-medium shadow">Start</button>
                  ) : (
                    <button onClick={pause} className="rounded-xl px-4 py-2 bg-gray-900 text-white font-medium shadow">Pause</button>
                  )}
                  <button onClick={reset} className="rounded-xl px-4 py-2 border border-gray-300 font-medium">Reset</button>
                  <button onClick={skip} className="rounded-xl px-4 py-2 border border-gray-300 font-medium">Skip</button>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                  <span>Progress: <b>{pct}%</b></span>
                  <span>Window: <b>{phase === "focus" ? focusMin : breakMin} min</b></span>
                  {phase === "focus" && currentTask && (<span className="truncate max-w-[60%]">Task: <b className="text-gray-900">{currentTask}</b></span>)}
                </div>
              </div>
            </div>
            {/* ===== Todo list (per current focus window) ===== */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <label className="text-sm text-gray-600">Checklist for this window</label>

              {/* Input + Add */}
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  placeholder="Add a todo and press Enter"
                  className="flex-1 rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTodo(e.currentTarget.value);
                  }}
                />
                <button
                  onClick={(e) => {
                    const input = e.currentTarget.previousSibling;
                    addTodo(input.value);
                    if (input && input.value) input.value = "";
                  }}
                  className="rounded-xl px-3 py-2 bg-gray-900 text-white text-sm"
                >
                  Add
                </button>
              </div>

              {/* List */}
              <ul className="mt-3 space-y-2">
                {todos.length === 0 && (
                  <li className="text-xs text-gray-500">No todos yet. Add a few small steps.</li>
                )}
                {todos.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-3 flex-1">
                      <input
                        type="checkbox"
                        checked={t.done}
                        onChange={() => toggleTodo(t.id)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span className={`text-sm ${t.done ? "line-through text-gray-400" : "text-gray-800"}`}>
                        {t.text}
                      </span>
                    </label>
                    <button
                      onClick={() => removeTodo(t.id)}
                      className="text-xs text-gray-500 hover:text-gray-800"
                      aria-label="Remove todo"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>

              {/* Footer actions */}
              {todos.some((t) => t.done) && (
                <div className="mt-2">
                  <button
                    onClick={clearCompleted}
                    className="text-xs text-gray-600 underline underline-offset-4"
                  >
                    Clear completed
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Settings */}
          <aside className="rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-600">Focus length (minutes)</label>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={focusMin}
                  onChange={(e) => setFocusMin(Math.max(1, Number(e.target.value || 0)))}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              <div>
                <label className="text-sm text-gray-600">Break length (minutes)</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={breakMin}
                  onChange={(e) => setBreakMin(Math.max(1, Number(e.target.value || 0)))}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              <div>
                <label className="text-sm text-gray-600">Alert sound</label>
                <select
                  value={sound}
                  onChange={(e) => setSound(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                >
                  <option value="chime">Chime</option>
                  <option value="beep">Beep</option>
                  <option value="tick">Tick</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-600">Volume: {Math.round(volume * 100)}%</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="mt-1 w-full"
                />
              </div>

              <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600">
                Tip: When the timer switches phase, your current focus task is saved with timestamps so you can review later.
              </div>
            </div>
          </aside>

          {/* Log */}
          <section className="lg:col-span-3 rounded-2xl border border-gray-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Session Log</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => playBeep({ type: sound, volume })} className="rounded-xl px-3 py-1.5 border border-gray-300 text-sm">Test sound</button>
                <button onClick={clearLog} className="rounded-xl px-3 py-1.5 border border-gray-300 text-sm">Clear</button>
              </div>
            </div>

            {log.length === 0 ? (
              <div className="text-sm text-gray-500">No sessions yet. Start a focus window to see entries here.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-4">Phase</th>
                      <th className="py-2 pr-4">Task</th>
                      <th className="py-2 pr-4">Start</th>
                      <th className="py-2 pr-4">End</th>
                      <th className="py-2 pr-4">Duration</th>
                      <th className="py-2 pr-4">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((e) => (
                      <tr key={e.id} className="border-t border-gray-100">
                        <td className="py-2 pr-4 font-medium">{e.phase === "focus" ? "Focus" : "Break"}</td>
                        <td className="py-2 pr-4 max-w-[28ch] truncate">{e.task}</td>
                        <td className="py-2 pr-4 text-gray-600">{new Date(e.start).toLocaleString()}</td>
                        <td className="py-2 pr-4 text-gray-600">{new Date(e.end).toLocaleString()}</td>
                        <td className="py-2 pr-4 text-gray-600">{fmtTime(e.duration)}</td>
                        <td className="py-2 pr-4">
                          <button onClick={() => setOpenDetails(e)}
                            className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                            title="View session todos" aria-label="View session todos"> 🗒️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {/* ===== Details Modal ===== */}
          {openDetails && (
              <div
                className="fixed inset-0 z-50 grid place-items-center bg-black/30"
                onClick={() => setOpenDetails(null)}
              >
                <div
                  className="w-[min(92vw,560px)] max-h-[80vh] overflow-auto rounded-2xl bg-white p-5 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                >
                  <div className="flex items-start justify-between">
                    <h3 className="text-lg font-semibold">Session details</h3>
                    <button
                      onClick={() => setOpenDetails(null)}
                      className="text-gray-500 hover:text-gray-800"
                      aria-label="Close"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="mt-2 text-sm text-gray-600 space-y-1">
                    <div><b>Phase:</b> {openDetails.phase === "focus" ? "Focus" : "Break"}</div>
                    <div><b>Task:</b> {openDetails.task}</div>
                    <div><b>Start:</b> {new Date(openDetails.start).toLocaleString()}</div>
                    <div><b>End:</b> {new Date(openDetails.end).toLocaleString()}</div>
                    <div><b>Duration:</b> {fmtTime(openDetails.duration)}</div>
                  </div>

                  <div className="mt-4">
                    <div className="text-sm font-medium mb-2">Todos snapshot</div>
                    {(!openDetails.todos || openDetails.todos.length === 0) ? (
                      <div className="text-sm text-gray-500">No todos were attached to this session.</div>
                    ) : (
                      <ul className="space-y-2">
                        {openDetails.todos.map((t) => (
                          <li key={t.id} className="flex items-center gap-3">
                            <input type="checkbox" checked={!!t.done} readOnly className="h-4 w-4 rounded" />
                            <span className={`text-sm ${t.done ? "line-through text-gray-400" : "text-gray-800"}`}>
                              {t.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="mt-5 text-right">
                    <button
                      onClick={() => setOpenDetails(null)}
                      className="rounded-xl px-4 py-2 border border-gray-300 text-sm"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

        </main>

        <footer className="mt-8 text-xs text-gray-500">
          Your settings & logs are stored locally in your browser.
        </footer>
      </div>
    </div>
  );
}


