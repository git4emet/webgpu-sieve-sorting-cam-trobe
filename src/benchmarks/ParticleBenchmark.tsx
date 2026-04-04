import { useEffect, useMemo, useRef, useState } from "react";
import { GpuParticles } from "./particles/GpuParticles";
import { JsParticles } from "./particles/JsParticles";

function setupCanvasDpr(canvas: HTMLCanvasElement, cssW: number, cssH: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  return dpr;
}

export default function ParticleBenchmark() {
  const cpuCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gpuCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const cpuEngineRef = useRef<JsParticles | null>(null);
  const gpuEngineRef = useRef<GpuParticles | null>(null);

  const [count, setCount] = useState(50_000);
  const [running, setRunning] = useState(false);

  const [cpuFps, setCpuFps] = useState<number | null>(null);
  const [gpuFps, setGpuFps] = useState<number | null>(null);
  const [gpuErr, setGpuErr] = useState<string>("");

  const canUseWebGPU = useMemo(() => !!navigator.gpu, []);

  useEffect(() => {
    const cpuCanvas = cpuCanvasRef.current;
    const gpuCanvas = gpuCanvasRef.current;
    if (cpuCanvas) setupCanvasDpr(cpuCanvas, 520, 320);
    if (gpuCanvas) setupCanvasDpr(gpuCanvas, 520, 320);

    return () => {
      cpuEngineRef.current?.destroy();
      gpuEngineRef.current?.destroy();
      cpuEngineRef.current = null;
      gpuEngineRef.current = null;
    };
  }, []);

  async function startBoth() {
    if (running) return;
    setRunning(true);
    setGpuErr("");

    const cpuCanvas = cpuCanvasRef.current;
    const gpuCanvas = gpuCanvasRef.current;
    if (!cpuCanvas || !gpuCanvas) return;

    cpuEngineRef.current?.destroy();
    gpuEngineRef.current?.destroy();

    cpuEngineRef.current = new JsParticles(cpuCanvas, setCpuFps);

    if (!canUseWebGPU) {
      setGpuErr("WebGPU not available in this browser.");
      cpuEngineRef.current.start(count);
      return;
    }

    gpuEngineRef.current = new GpuParticles(gpuCanvas, setGpuFps, (msg) =>
      setGpuErr(msg || ""),
    );

    cpuEngineRef.current.start(count);
    await gpuEngineRef.current.start(count);
  }

  function stopBoth() {
    cpuEngineRef.current?.stop();
    gpuEngineRef.current?.stop();
    setRunning(false);
  }

  const winnerBanner = (() => {
    if (cpuFps === null || gpuFps === null) return null;
    const faster = gpuFps > cpuFps ? "GPU" : "CPU";
    const ratio = faster === "GPU" ? gpuFps / cpuFps : cpuFps / gpuFps;
    const isGpu = faster === "GPU";
    const winnerFps = isGpu ? gpuFps : cpuFps;
    const loserFps = isGpu ? cpuFps : gpuFps;
    const cls = isGpu
      ? "border-emerald-500 bg-emerald-950/50 text-emerald-100"
      : "border-amber-500 bg-amber-950/50 text-amber-100";
    return (
      <div
        className={`shrink-0 border-2 rounded-xl px-8 py-4 flex items-center gap-8 ${cls}`}
      >
        <div>
          <div className="text-xs uppercase tracking-widest opacity-50 font-semibold">
            Winner
          </div>
          <div className="text-5xl font-black tracking-tight mt-1">{faster}</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-7xl font-black tabular-nums leading-none">
            {ratio.toFixed(1)}
            <span className="text-4xl">×</span>
          </div>
          <div className="text-sm opacity-60 font-semibold uppercase tracking-widest mt-2">
            faster
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest opacity-50 font-semibold mb-1">
            FPS
          </div>
          <div className="text-3xl font-bold tabular-nums">{winnerFps}</div>
          <div className="text-base opacity-60 mt-1">vs {loserFps}</div>
        </div>
      </div>
    );
  })();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden flex flex-col px-6 py-4 gap-4">
        <div className="flex flex-wrap items-end gap-3 shrink-0">
          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">Particles</label>
            <select
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value, 10))}
              className="bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200"
              disabled={running}
            >
              {[
                1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 200_000, 500_000,
              ].map((v) => (
                <option key={v} value={v}>
                  {v.toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={startBoth}
              disabled={running}
              className="px-5 py-2.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold"
            >
              Run both
            </button>
            <button
              onClick={stopBoth}
              disabled={!running}
              className="px-5 py-2.5 rounded border border-gray-700 hover:border-gray-600 disabled:opacity-50 text-sm font-semibold"
            >
              Stop
            </button>
          </div>

          {!canUseWebGPU && (
            <div className="text-xs text-yellow-400 border border-yellow-900/40 bg-yellow-950/30 rounded px-3 py-2">
              WebGPU not available
            </div>
          )}
        </div>

        {gpuErr && (
          <div className="shrink-0 text-sm text-red-400 border border-red-900/40 bg-red-950/30 rounded-lg p-3">
            {gpuErr}
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4 flex flex-col min-h-0">
            <div className="flex items-start justify-between shrink-0 mb-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
                  CPU · Canvas 2D
                </div>
                <div className="text-sm text-gray-500 mt-0.5">
                  JS typed arrays
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`text-4xl font-black tabular-nums leading-none ${cpuFps !== null ? "text-gray-100" : "text-gray-700"}`}
                >
                  {cpuFps ?? "—"}
                </div>
                <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide mt-0.5">
                  FPS
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 rounded-lg border border-gray-800 overflow-hidden">
              <canvas ref={cpuCanvasRef} />
            </div>
          </div>

          <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4 flex flex-col min-h-0">
            <div className="flex items-start justify-between shrink-0 mb-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
                  GPU · WebGPU
                </div>
                <div className="text-sm text-gray-500 mt-0.5">
                  compute + instanced render
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`text-4xl font-black tabular-nums leading-none ${gpuFps !== null ? "text-gray-100" : "text-gray-700"}`}
                >
                  {gpuFps ?? "—"}
                </div>
                <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide mt-0.5">
                  FPS
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 rounded-lg border border-gray-800 overflow-hidden">
              <canvas ref={gpuCanvasRef} />
            </div>
          </div>
        </div>

        {winnerBanner}
      </div>
    </div>
  );
}
