import { useEffect, useMemo, useRef, useState } from "react";
import { GpuMatMul } from "./matmul/GpuMatMul";
import { JsMatMul } from "./matmul/JsMatMul";

function msToPretty(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

type Result = {
  lastMs: number | null;
  avgMs: number | null;
  sample: number[];
};

const emptyResult: Result = { lastMs: null, avgMs: null, sample: [] };

export default function MatMulBenchmark() {
  const [n, setN] = useState(1024);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cpuRes, setCpuRes] = useState<Result>(emptyResult);
  const [gpuRes, setGpuRes] = useState<Result>(emptyResult);

  const gpu = useRef<GpuMatMul | null>(null);
  const cpu = useRef<JsMatMul | null>(null);

  const canUseWebGPU = useMemo(() => !!navigator.gpu, []);

  useEffect(() => {
    return () => {
      gpu.current?.destroy();
      cpu.current?.destroy();
    };
  }, []);

  async function prepareCpu() {
    if (!cpu.current) cpu.current = new JsMatMul();
    cpu.current.init(n);
  }

  async function prepareGpu() {
    if (!canUseWebGPU) throw new Error("WebGPU not available in this browser.");
    if (!gpu.current) gpu.current = new GpuMatMul();
    await gpu.current.init(n);
  }

  async function runBoth(iterations: number) {
    if (running) return;
    setRunning(true);
    setStatus("Initializing...");
    setError(null);
    setCpuRes(emptyResult);
    setGpuRes(emptyResult);

    try {
      await nextFrame();

      setStatus("Preparing GPU...");
      await prepareGpu();
      await nextFrame();

      setStatus("Preparing CPU...");
      await prepareCpu();
      await nextFrame();

      setStatus("Warming up GPU...");
      const gpuWarm = await gpu.current!.runOnce();
      setGpuRes((prev) => ({ ...prev, lastMs: gpuWarm.ms }));
      await nextFrame();

      setStatus("Warming up CPU...");
      const cpuWarm = cpu.current!.runOnce();
      setCpuRes((prev) => ({ ...prev, lastMs: cpuWarm.ms }));
      await nextFrame();

      const cpuTimes: number[] = [];
      const gpuTimes: number[] = [];

      for (let i = 0; i < iterations; i++) {
        setStatus(`Running iteration ${i + 1} / ${iterations}...`);

        const gr = await gpu.current!.runOnce();
        gpuTimes.push(gr.ms);
        setGpuRes((prev) => ({ ...prev, lastMs: gr.ms }));
        await nextFrame();

        const cr = cpu.current!.runOnce();
        cpuTimes.push(cr.ms);
        setCpuRes((prev) => ({ ...prev, lastMs: cr.ms }));
        await nextFrame();
      }

      const cpuAvg = cpuTimes.reduce((a, b) => a + b, 0) / cpuTimes.length;
      const gpuAvg = gpuTimes.reduce((a, b) => a + b, 0) / gpuTimes.length;

      setGpuRes({
        lastMs: gpuTimes.at(-1) ?? null,
        avgMs: gpuAvg,
        sample: await gpu.current!.readBackSample(8),
      });
      await nextFrame();

      setCpuRes({
        lastMs: cpuTimes.at(-1) ?? null,
        avgMs: cpuAvg,
        sample: cpu.current!.sample(8),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Benchmark failed.");
    } finally {
      setStatus(null);
      setRunning(false);
    }
  }

  const winnerBanner = (() => {
    if (cpuRes.avgMs === null || gpuRes.avgMs === null) return null;
    const faster = cpuRes.avgMs < gpuRes.avgMs ? "CPU" : "GPU";
    const ratio =
      faster === "CPU"
        ? gpuRes.avgMs / cpuRes.avgMs
        : cpuRes.avgMs / gpuRes.avgMs;
    const isGpu = faster === "GPU";
    const winnerMs = isGpu ? gpuRes.avgMs : cpuRes.avgMs;
    const loserMs = isGpu ? cpuRes.avgMs : gpuRes.avgMs;
    const cls = isGpu
      ? "border-emerald-500 bg-emerald-950/50 text-emerald-100"
      : "border-amber-500 bg-amber-950/50 text-amber-100";
    return (
      <div
        className={`shrink-0 border-2 rounded-xl px-8 py-5 flex items-center gap-8 ${cls}`}
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
            Avg time
          </div>
          <div className="text-3xl font-bold tabular-nums">
            {msToPretty(winnerMs)}
          </div>
          <div className="text-base opacity-60 mt-1">
            vs {msToPretty(loserMs)}
          </div>
        </div>
      </div>
    );
  })();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden flex flex-col px-6 py-4 gap-4">
        <div className="flex flex-wrap gap-3 items-end shrink-0">
          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">Matrix size (N×N)</label>
            <select
              value={n}
              onChange={(e) => setN(parseInt(e.target.value, 10))}
              className="bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200"
            >
              {[256, 512, 768, 1024, 1536, 2048].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              disabled={running}
              onClick={() => runBoth(3)}
              className="px-5 py-2.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold"
            >
              Run both ×3
            </button>
            <button
              disabled={running}
              onClick={() => runBoth(10)}
              className="px-5 py-2.5 rounded border border-gray-700 hover:border-gray-600 disabled:opacity-50 text-sm font-semibold"
            >
              Run both ×10
            </button>
          </div>

          {!canUseWebGPU && (
            <div className="text-xs text-yellow-400 border border-yellow-900/40 bg-yellow-950/30 rounded px-3 py-2">
              WebGPU not available
            </div>
          )}
        </div>

        {status && (
          <div className="shrink-0 text-sm text-indigo-300 border border-indigo-900/40 bg-indigo-950/20 rounded-lg p-3 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            {status}
          </div>
        )}

        {error && (
          <div className="shrink-0 text-sm text-red-400 border border-red-900/40 bg-red-950/30 rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 shrink-0">
          <div className="rounded-xl border border-gray-700 bg-gray-900/50 px-6 py-5">
            <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
              CPU · JS
            </div>
            <div className="text-sm text-gray-500 mt-0.5">
              typed arrays + tiled
            </div>
            <div className="mt-4">
              <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                Avg
              </div>
              <div className="text-5xl font-black tabular-nums mt-1 text-gray-100">
                {msToPretty(cpuRes.avgMs)}
              </div>
            </div>
            <div className="mt-3 text-sm text-gray-500 tabular-nums">
              Last: {msToPretty(cpuRes.lastMs)}
            </div>
          </div>

          <div className="rounded-xl border border-gray-700 bg-gray-900/50 px-6 py-5">
            <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
              GPU · WebGPU
            </div>
            <div className="text-sm text-gray-500 mt-0.5">
              compute shader + tiled
            </div>
            <div className="mt-4">
              <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                Avg
              </div>
              <div className="text-5xl font-black tabular-nums mt-1 text-gray-100">
                {msToPretty(gpuRes.avgMs)}
              </div>
            </div>
            <div className="mt-3 text-sm text-gray-500 tabular-nums">
              Last: {msToPretty(gpuRes.lastMs)}
            </div>
          </div>
        </div>

        {winnerBanner}
      </div>
    </div>
  );
}
