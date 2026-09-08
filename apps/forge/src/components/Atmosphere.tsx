// Renders the ambient background (a theme-tinted photo, animated
// glow/motes/grain, all driven by the --forge-atmo-* tokens in forge.css)
// and the shared liquid-glass refraction filter every glass surface
// references. One component for every glass theme — only the tokens change.
export function Atmosphere() {
  return (
    <>
      <svg className="forge-filter-defs" aria-hidden="true" focusable="false">
        <filter id="forge-refract" x="-2%" y="-2%" width="104%" height="104%" colorInterpolationFilters="sRGB">
          {/* fractalNoise (not turbulence) reads as smooth glass thickness
              rather than veins/smoke; the blur removes displacement
              stippling; scale is the "how much like glass" knob — kept
              modest because a rounded corner clips this filter's region
              AFTER displacement runs, so too large a scale drags a sliver
              of the filter's un-clipped rectangular edge across the curve
              and shows up as a bright seam right on the border-radius arc. */}
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.014" numOctaves={2} seed={7} result="noise" />
          <feGaussianBlur in="noise" stdDeviation="1.6" result="soft" />
          <feDisplacementMap in="SourceGraphic" in2="soft" scale={7} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div className="forge-atmosphere" aria-hidden="true">
        <div className="atmo-photo" />
        <div className="atmo-scrim" />
        <div className="atmo-horizon" />
        <div className="atmo-current atmo-current-one" />
        <div className="atmo-current atmo-current-two" />
        <span className="atmo-mote atmo-mote-one" />
        <span className="atmo-mote atmo-mote-two" />
        <span className="atmo-mote atmo-mote-three" />
        <span className="atmo-mote atmo-mote-four" />
        <div className="atmo-grain" />
      </div>
    </>
  );
}
