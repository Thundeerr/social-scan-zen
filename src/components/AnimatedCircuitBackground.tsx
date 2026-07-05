import { useEffect, useId, useState } from "react";

/**
 * Performance tier detection.
 * - "low" on: prefers-reduced-motion, save-data, small viewport,
 *   low deviceMemory, low hardwareConcurrency, or coarse pointer (mobile).
 * - "high" otherwise.
 * Runs after mount so SSR always renders the full version, then downgrades.
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
 * Subtle animated cyberpunk circuit-board background.
 * - fixed, non-interactive, sits behind all app content
 * - respects prefers-reduced-motion
 * - downshifts particle/node/path counts on low-power devices
 * - tunable via CSS vars: --circuit-opacity, --circuit-speed,
 *   --circuit-blue, --circuit-purple, --circuit-amber
 */
export function AnimatedCircuitBackground() {
  const tier = usePerfTier();
  const uid = useId().replace(/:/g, "");
  const gridId = `circuit-grid-${uid}`;
  const glowId = `circuit-glow-${uid}`;
  const fadeId = `circuit-fade-${uid}`;


  const isLow = tier === "low";

  // Full path set. On low-power devices we render fewer traces and skip the
  // secondary trailing particle per trace — cuts SMIL animateMotion work
  // roughly in half and drops the glow filter (biggest paint cost).
  const allPaths = [
    "M -20 120 L 260 120 L 260 260 L 520 260 L 520 180 L 900 180 L 900 340 L 1220 340 L 1260 340",
    "M 1260 60 L 980 60 L 980 220 L 720 220 L 720 380 L 420 380 L 420 520 L 120 520 L -20 520",
    "M -20 720 L 200 720 L 200 620 L 460 620 L 460 780 L 780 780 L 780 660 L 1080 660 L 1260 660",
    "M 80 -20 L 80 200 L 340 200 L 340 440 L 600 440 L 600 640 L 860 640 L 860 820 L 860 900",
    "M 1180 900 L 1180 700 L 940 700 L 940 500 L 700 500 L 700 300 L 460 300 L 460 80 L 460 -20",
    "M -20 340 L 160 340 L 160 460 L 380 460 L 380 340 L 620 340 L 620 460 L 820 460",
    "M 1260 460 L 1060 460 L 1060 560 L 820 560 L 820 720 L 560 720 L 560 860 L 320 860 L 320 900",
  ];
  const paths = isLow ? allPaths.slice(0, 4) : allPaths;

  const allNodes: Array<[number, number]> = [
    [260, 120], [520, 260], [900, 180], [1220, 340],
    [980, 60], [720, 220], [420, 380], [120, 520],
    [200, 720], [460, 620], [780, 780], [1080, 660],
    [340, 200], [600, 440], [860, 640],
    [1180, 700], [940, 500], [700, 300], [460, 80],
    [160, 340], [380, 460], [620, 340],
    [1060, 460], [820, 560], [560, 720], [320, 860],
  ];
  const nodes = isLow ? allNodes.filter((_, i) => i % 2 === 0) : allNodes;

  // Glow (SVG feGaussianBlur + feMerge) is the most expensive part; skip on low tier.
  const traceFilter = isLow ? undefined : `url(#${glowId})`;

  return (
    <div className={`circuit-bg${isLow ? " circuit-bg--low" : ""}`} aria-hidden="true">
      <svg
        className="circuit-bg__svg"
        viewBox="0 0 1280 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id={gridId} width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="var(--circuit-blue)"
              strokeOpacity="0.08"
              strokeWidth="0.5"
            />
          </pattern>
          {!isLow && (
            <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
          <radialGradient id={fadeId} cx="75%" cy="15%" r="90%">
            <stop offset="0%" stopColor="var(--circuit-blue)" stopOpacity="0.35" />
            <stop offset="55%" stopColor="var(--circuit-purple)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="1280" height="900" fill={`url(#${gridId})`} />
        <rect width="1280" height="900" fill={`url(#${fadeId})`} />

        <g
          fill="none"
          stroke="var(--circuit-blue)"
          strokeOpacity="0.35"
          strokeWidth="1"
          filter={traceFilter}
        >
          {paths.map((d, i) => (
            <path
              key={i}
              d={d}
              stroke={i % 3 === 0 ? "var(--circuit-purple)" : "var(--circuit-blue)"}
              strokeOpacity={i % 3 === 0 ? 0.28 : 0.32}
            />
          ))}
        </g>

        <g filter={traceFilter}>
          {nodes.map(([x, y], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={i % 7 === 0 ? 2.2 : 1.2}
              fill={
                i % 11 === 0
                  ? "var(--circuit-amber)"
                  : i % 3 === 0
                    ? "var(--circuit-purple)"
                    : "var(--circuit-blue)"
              }
              opacity={i % 11 === 0 ? 0.75 : 0.55}
            />
          ))}
        </g>

        <g className="circuit-bg__particles" filter={traceFilter}>
          {paths.map((d, i) => {
            const color =
              i % 5 === 0
                ? "var(--circuit-amber)"
                : i % 3 === 0
                  ? "var(--circuit-purple)"
                  : "var(--circuit-blue)";
            const dur = 18 + (i % 4) * 6;
            const delay = -(i * 3);
            return (
              <g key={i}>
                <circle r={1.6} fill={color} opacity={0.9}>
                  <animateMotion
                    dur={`${dur}s`}
                    begin={`${delay}s`}
                    repeatCount="indefinite"
                    path={d}
                    rotate="auto"
                  />
                </circle>
                {!isLow && i % 2 === 0 && (
                  <circle r={1.1} fill={color} opacity={0.6}>
                    <animateMotion
                      dur={`${dur + 4}s`}
                      begin={`${delay - 8}s`}
                      repeatCount="indefinite"
                      path={d}
                    />
                  </circle>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="circuit-bg__overlay" />
    </div>
  );
}

