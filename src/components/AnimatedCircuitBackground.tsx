import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useScanSim } from "@/lib/scan-simulator";
import { useAmbientCalm } from "@/lib/ambient-store";

/**
 * Pauses SMIL animations on the SVG while the tab is hidden or the window
 * loses focus. Resumes when the user returns. Keeps CPU near-zero when the
 * user isn't looking at the app.
 */
function useAnimationsWhileVisible(ref: React.RefObject<SVGSVGElement | null>) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const getSvg = () => ref.current as (SVGSVGElement & {
      pauseAnimations?: () => void;
      unpauseAnimations?: () => void;
    }) | null;

    const apply = () => {
      const svg = getSvg();
      if (!svg) return;
      const hidden = document.visibilityState === "hidden";
      if (hidden) svg.pauseAnimations?.();
      else svg.unpauseAnimations?.();
    };

    const onBlur = () => getSvg()?.pauseAnimations?.();
    const onFocus = () => {
      if (document.visibilityState === "visible") getSvg()?.unpauseAnimations?.();
    };

    apply();
    document.addEventListener("visibilitychange", apply);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", apply);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [ref]);
}


/**
 * Performance tier detection.
 * SSR renders the full version; downgrades after mount on constrained devices.
 */
function usePerfTier(): "high" | "low" {
  const [tier, setTier] = useState<"high" | "low">("high");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const compute = () => {
      const nav = navigator as Navigator & {
        deviceMemory?: number;
        connection?: { saveData?: boolean; effectiveType?: string };
      };
      const lowMem = (nav.deviceMemory ?? 8) <= 4;
      const lowCpu = (nav.hardwareConcurrency ?? 8) <= 4;
      const saveData = nav.connection?.saveData === true;
      const slowNet = /2g/.test(nav.connection?.effectiveType ?? "");
      const smallVp = window.innerWidth < 768;
      const isLow =
        mql.matches ||
        saveData ||
        slowNet ||
        smallVp ||
        coarse.matches ||
        lowMem ||
        lowCpu;
      setTier(isLow ? "low" : "high");
    };
    compute();
    mql.addEventListener?.("change", compute);
    coarse.addEventListener?.("change", compute);
    window.addEventListener("resize", compute, { passive: true });
    return () => {
      mql.removeEventListener?.("change", compute);
      coarse.removeEventListener?.("change", compute);
      window.removeEventListener("resize", compute);
    };
  }, []);
  return tier;
}

/**
 * Autonomous surveillance network background.
 *
 * Six visual layers stacked behind the app:
 *   1. deep navy/black base (via app bg + our darkening overlay)
 *   2. faint circuit grid
 *   3. dim circuit traces
 *   4. small glowing network nodes
 *   5. slow-moving light particles (data flowing through the fabric)
 *   6. atmospheric haze / vignette
 *
 * When the scanner is running, more particles activate and a subset of traces
 * dim up slightly. Everything else stays calm. No pulsing, no flashing.
 */
export function AnimatedCircuitBackground() {
  const tier = usePerfTier();
  const uid = useId().replace(/:/g, "");
  const gridId = `net-grid-${uid}`;
  const glowId = `net-glow-${uid}`;
  const hazeId = `net-haze-${uid}`;

  const sim = useScanSim();
  const isScanning = sim.isScanning;
  const isCalm = useAmbientCalm();
  const isLow = tier === "low";

  // Trace network. Organic-but-orthogonal routes across a huge board.
  const allPaths = useMemo(
    () => [
      "M -20 120 L 260 120 L 260 260 L 520 260 L 520 180 L 900 180 L 900 340 L 1220 340 L 1260 340",
      "M 1260 60 L 980 60 L 980 220 L 720 220 L 720 380 L 420 380 L 420 520 L 120 520 L -20 520",
      "M -20 720 L 200 720 L 200 620 L 460 620 L 460 780 L 780 780 L 780 660 L 1080 660 L 1260 660",
      "M 80 -20 L 80 200 L 340 200 L 340 440 L 600 440 L 600 640 L 860 640 L 860 820 L 860 900",
      "M 1180 900 L 1180 700 L 940 700 L 940 500 L 700 500 L 700 300 L 460 300 L 460 80 L 460 -20",
      "M -20 340 L 160 340 L 160 460 L 380 460 L 380 340 L 620 340 L 620 460 L 820 460",
      "M 1260 460 L 1060 460 L 1060 560 L 820 560 L 820 720 L 560 720 L 560 860 L 320 860 L 320 900",
      "M -20 60 L 60 60 L 60 300 L 240 300 L 240 560 L 40 560 L 40 780 L -20 780",
      "M 1260 800 L 1140 800 L 1140 580 L 1000 580 L 1000 420 L 1200 420 L 1200 200 L 1260 200",
    ],
    [],
  );
  const paths = isLow ? allPaths.slice(0, 5) : allPaths;

  const allNodes: Array<[number, number]> = useMemo(
    () => [
      [260, 120], [520, 260], [900, 180], [1220, 340],
      [980, 60], [720, 220], [420, 380], [120, 520],
      [200, 720], [460, 620], [780, 780], [1080, 660],
      [340, 200], [600, 440], [860, 640],
      [1180, 700], [940, 500], [700, 300], [460, 80],
      [160, 340], [380, 460], [620, 340],
      [1060, 460], [820, 560], [560, 720], [320, 860],
      [60, 300], [240, 560], [1140, 580], [1000, 420], [1200, 200],
    ],
    [],
  );
  const nodes = isLow ? allNodes.filter((_, i) => i % 2 === 0) : allNodes;

  const traceFilter = isLow ? undefined : `url(#${glowId})`;

  const svgRef = useRef<SVGSVGElement | null>(null);
  useAnimationsWhileVisible(svgRef);



  // Real-time reactions to scanner state. Everything stays subtle.
  //   - scanningExtras: ~30% more travelling lights while running
  //   - particleSpeedMul: particles flow ~15% faster during a scan
  //   - traceBoost: brighter stroke on a wider subset of paths
  //   - nodeBoost: nodes glow a touch stronger
  const scanningExtras = isScanning ? Math.max(2, Math.round(paths.length * 0.3)) : 0;
  const particleSpeedMul = isScanning ? 0.85 : 1;
  const nodeBoost = isScanning ? 0.08 : 0;


  return (
    <div
      className={`net-bg${isLow ? " net-bg--low" : ""}${isScanning ? " net-bg--active" : ""}${isCalm ? " net-bg--calm" : ""}`}
      aria-hidden="true"
    >
      {/* Layer 1: darkening base — sinks the app background toward black */}
      <div className="net-bg__base" />

      <svg
        ref={svgRef}
        className="net-bg__svg"
        viewBox="0 0 1280 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id={gridId} width="48" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke="var(--net-blue)"
              strokeOpacity="0.06"
              strokeWidth="0.5"
            />
          </pattern>
          {!isLow && (
            <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
          <radialGradient id={hazeId} cx="72%" cy="18%" r="95%">
            <stop offset="0%" stopColor="var(--net-blue)" stopOpacity="0.22" />
            <stop offset="45%" stopColor="var(--net-purple)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Layer 2: faint grid */}
        <rect width="1280" height="900" fill={`url(#${gridId})`} />

        {/* Layer 3: dim circuit traces */}
        <g
          fill="none"
          stroke="var(--net-blue)"
          strokeWidth="1"
          filter={traceFilter}
        >
          {paths.map((d, i) => {
            const purple = i % 4 === 0;
            const baseOpacity = purple ? 0.18 : 0.22;
            // While scanning, brighten a wider subset (every other path)
            const activeBoost = isScanning ? (i % 2 === 0 ? 0.1 : 0.05) : 0;
            return (
              <path
                key={i}
                d={d}
                stroke={purple ? "var(--net-purple)" : "var(--net-blue)"}
                strokeOpacity={baseOpacity + activeBoost}
                style={{ transition: "stroke-opacity 1600ms ease-out" }}
              />
            );
          })}
        </g>

        {/* Layer 4: network nodes */}
        <g filter={traceFilter}>
          {nodes.map(([x, y], i) => {
            const amber = i % 13 === 0;
            const purple = !amber && i % 5 === 0;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={amber ? 1.9 : 1.1}
                fill={
                  amber
                    ? "var(--net-amber)"
                    : purple
                      ? "var(--net-purple)"
                      : "var(--net-blue)"
                }
                opacity={(amber ? 0.55 : 0.4) + nodeBoost}
                style={{ transition: "opacity 1600ms ease-out" }}
              />
            );
          })}
        </g>

        {/* Layer 5: slow data particles */}
        <g className="net-bg__particles" filter={traceFilter}>
          {paths.map((d, i) => {
            const amber = i % 7 === 0;
            const purple = !amber && i % 4 === 0;
            const color = amber
              ? "var(--net-amber)"
              : purple
                ? "var(--net-purple)"
                : "var(--net-blue)";
            // Base 32-56s per traversal; ~15% faster while scanning.
            const dur = (32 + (i % 5) * 6) * particleSpeedMul;
            const delay = -(i * 5);
            return (
              <circle
                key={i}
                r={amber ? 1.5 : 1.2}
                fill={color}
                opacity={amber ? 0.85 : 0.7}
              >
                <animateMotion
                  dur={`${dur}s`}
                  begin={`${delay}s`}
                  repeatCount="indefinite"
                  path={d}
                  rotate="auto"
                />
              </circle>
            );
          })}

          {/* Scanner-driven extras: only rendered while running */}
          {!isLow &&
            Array.from({ length: scanningExtras }).map((_, k) => {
              const i = k % paths.length;
              const d = paths[i];
              const dur = 26 + (k % 5) * 4;
              const delay = -(k * 4);
              return (
                <circle key={`x-${k}`} r={1.1} fill="var(--net-blue)" opacity={0.55}>
                  <animateMotion
                    dur={`${dur}s`}
                    begin={`${delay}s`}
                    repeatCount="indefinite"
                    path={d}
                  />
                </circle>
              );
            })}
        </g>

        {/* Layer 6a: atmospheric haze — soft directional glow from upper right */}
        <rect width="1280" height="900" fill={`url(#${hazeId})`} />
      </svg>

      {/* Layer 6b: bottom vignette to keep dashboard the focus */}
      <div className="net-bg__vignette" />
    </div>
  );
}
