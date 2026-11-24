import { useId } from 'react';

// ─── Sketchy's puppet (ADR-0024) ──────────────────────────────────────────────
// The fox artist from the official character sheet, drawn as one layered SVG
// in a three-quarter view facing right (mirrored to face left). Every part
// that moves is its own group with a pivot (PIVOTS): the pose engine
// (./engine.ts) turns, moves and scales those groups, swaps the face's
// expressions and shows the props. Nothing here holds text: words are always
// HTML beside him (signs, the menu), in the page's language.
//
// Coordinates: a 200 × 260 figure standing on y = 252; the view box leaves
// room above and around for a raised paw, a jump and the effects.

export const VIEWBOX = { x: -24, y: -34, w: 248, h: 292 } as const;
export const GROUND_Y = 252;

/** Where each moving part turns (in the figure's own coordinates, at rest). */
export const PIVOTS = {
  body: [133, 200],
  tail: [97, 186],
  legBack: [116, 190],
  shinBack: [115, 221],
  legFront: [150, 190],
  shinFront: [151, 221],
  armBack: [103, 139],
  forearmBack: [101, 166],
  handBack: [101, 187],
  armFront: [165, 139],
  forearmFront: [166, 166],
  handFront: [167, 187],
  torso: [133, 198],
  scarfEnd: [156, 133],
  head: [131, 118],
  earBack: [86, 50],
  earFront: [151, 40],
  beret: [106, 42],
  face: [132, 78],
  eyeNear: [121, 68],
  eyeFar: [155, 66],
  irisNear: [121, 68],
  irisFar: [155, 66],
  browNear: [120, 48],
  browFar: [155, 46],
} as const;

export type PartId = keyof typeof PIVOTS;
export const PART_IDS = Object.keys(PIVOTS) as PartId[];

export const PALETTE = {
  furLight: '#fca24f',
  fur: '#f07a24',
  furDark: '#cf5612',
  furDeep: '#a8400c',
  cream: '#fbe4c6',
  creamLight: '#fff5e6',
  creamDark: '#e9c497',
  beret: '#6b3020',
  beretDark: '#47190f',
  beretLight: '#8e4a31',
  scarf: '#d1332c',
  scarfDark: '#9c1e1b',
  scarfLight: '#e8564c',
  shirt: '#f4e1c0',
  shirtShade: '#dcbd92',
  vest: '#8d5532',
  vestDark: '#673a1f',
  vestLight: '#a96d43',
  glove: '#6f3b22',
  gloveDark: '#4b2414',
  gloveLight: '#8f5534',
  eyeWhite: '#fffdf8',
  iris: '#a2521a',
  irisDark: '#552309',
  pupil: '#170703',
  line: '#3a1a0c',
  nose: '#3b1f16',
  mouth: '#5a1612',
  tongue: '#ef7f84',
  outline: '#7c300b',
} as const;

const P = PALETTE;

/** Face expressions the engine can show. */
export const EYES = ['open', 'happy', 'closed', 'wide'] as const;
export const MOUTHS = ['smile', 'grin', 'open', 'o', 'flat', 'tongue'] as const;
export type Eyes = (typeof EYES)[number];
export type Mouth = (typeof MOUTHS)[number];

/** Things he can hold or that appear around him. */
export const PROPS = ['pencil', 'pad', 'sign', 'brush', 'finger'] as const;
export type PropId = (typeof PROPS)[number];
export const FX = ['sparkles', 'confetti', 'think', 'question', 'zzz', 'exclaim', 'dust'] as const;
export type FxId = (typeof FX)[number];

/** A short id that is safe inside url(#…) in every browser. */
function useSafeId(): string {
  return `sk${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

/**
 * The puppet itself. `title` names it for assistive technology when it is
 * not inside a labelled control (the studio wraps it in a button, so it is
 * hidden there). Everything that moves carries `data-part`.
 */
export function SketchyRig({ className, style, labelled = false, title }: { className?: string; style?: React.CSSProperties; labelled?: boolean; title?: string }) {
  const id = useSafeId();
  const u = (name: string) => `url(#${id}-${name})`;
  return (
    <svg
      viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}`}
      className={className}
      style={style}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      overflow="visible"
      data-sketchy-rig=""
    >
      <defs>
        <radialGradient id={`${id}-head`} cx="0.62" cy="0.32" r="0.75">
          <stop offset="0" stopColor={P.furLight} />
          <stop offset="0.55" stopColor={P.fur} />
          <stop offset="1" stopColor={P.furDark} />
        </radialGradient>
        <radialGradient id={`${id}-fur`} cx="0.6" cy="0.3" r="0.8">
          <stop offset="0" stopColor={P.furLight} />
          <stop offset="0.6" stopColor={P.fur} />
          <stop offset="1" stopColor={P.furDark} />
        </radialGradient>
        <linearGradient id={`${id}-tail`} x1="0" y1="1" x2="0.7" y2="0">
          <stop offset="0" stopColor={P.furDark} />
          <stop offset="0.45" stopColor={P.fur} />
          <stop offset="1" stopColor={P.furLight} />
        </linearGradient>
        <linearGradient id={`${id}-tip`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={P.creamLight} />
          <stop offset="1" stopColor={P.cream} />
        </linearGradient>
        <radialGradient id={`${id}-cream`} cx="0.55" cy="0.35" r="0.8">
          <stop offset="0" stopColor={P.creamLight} />
          <stop offset="0.7" stopColor={P.cream} />
          <stop offset="1" stopColor={P.creamDark} />
        </radialGradient>
        <linearGradient id={`${id}-ear`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3a98c" />
          <stop offset="1" stopColor={P.cream} />
        </linearGradient>
        <radialGradient id={`${id}-beret`} cx="0.35" cy="0.25" r="0.85">
          <stop offset="0" stopColor={P.beretLight} />
          <stop offset="0.55" stopColor={P.beret} />
          <stop offset="1" stopColor={P.beretDark} />
        </radialGradient>
        <linearGradient id={`${id}-scarf`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.scarfLight} />
          <stop offset="1" stopColor={P.scarfDark} />
        </linearGradient>
        <linearGradient id={`${id}-shirt`} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor={P.shirtShade} />
          <stop offset="0.5" stopColor={P.shirt} />
          <stop offset="1" stopColor="#fbefd9" />
        </linearGradient>
        <linearGradient id={`${id}-vest`} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stopColor="#7d4727" />
          <stop offset="0.6" stopColor={P.vest} />
          <stop offset="1" stopColor={P.vestLight} />
        </linearGradient>
        <radialGradient id={`${id}-glove`} cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stopColor={P.gloveLight} />
          <stop offset="0.6" stopColor={P.glove} />
          <stop offset="1" stopColor={P.gloveDark} />
        </radialGradient>
        <radialGradient id={`${id}-iris`} cx="0.45" cy="0.4" r="0.6">
          <stop offset="0" stopColor="#d27a2c" />
          <stop offset="0.55" stopColor={P.iris} />
          <stop offset="1" stopColor={P.irisDark} />
        </radialGradient>
        <radialGradient id={`${id}-shadow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.38" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-tailclip`}>
          <path d={TAIL} />
        </clipPath>
        <clipPath id={`${id}-eyeNearClip`}>
          <ellipse cx="121" cy="68" rx="14.6" ry="12.6" />
        </clipPath>
        <clipPath id={`${id}-eyeFarClip`}>
          <ellipse cx="155.5" cy="66" rx="8.8" ry="11.6" />
        </clipPath>
      </defs>

      {/* The ground shadow (stretched and faded by the engine during a jump). */}
      <ellipse data-part-shadow="" cx="133" cy={GROUND_Y} rx="54" ry="7" fill={u('shadow')} />

      <g data-part="body">
        {/* ── Tail ── */}
        <g data-part="tail">
          <path d={TAIL} fill={u('tail')} stroke={P.outline} strokeWidth="1" strokeLinejoin="round" />
          <g clipPath={u('tailclip')}>
            <path d={TAIL_TIP} fill={u('tip')} />
            <path d="M60 160 C50 172 46 190 52 206 C58 218 70 224 84 222" fill="none" stroke={P.furDeep} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
            <path d="M30 200 C24 190 20 178 21 166 M42 214 C32 206 26 194 25 182 M60 222 C48 218 40 208 36 196 M84 216 C74 222 62 222 54 216" fill="none" stroke={P.furLight} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
            <path d="M12 150 C16 138 24 128 34 124 M20 156 C24 144 32 136 42 132 M30 160 C34 150 40 144 50 140" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.65" />
          </g>
        </g>

        {/* ── Back leg (his left, further away) ── */}
        <g data-part="legBack">
          <path d="M104 180 C101 194 102 207 106 219 L127 219 C130 207 130 193 128 180 Z" fill={P.furDark} />
          <path d="M122 186 C125 198 125 208 123 216" fill="none" stroke={P.creamDark} strokeWidth="4.5" strokeLinecap="round" opacity="0.7" />
          <g data-part="shinBack">
            <path d="M107 213 C106 225 106 235 108 244 L125 244 C127 235 127 225 126 213 Z" fill={P.furDark} />
            <path d="M100 246 C99 239 106 236 115 236 C124 236 130 239 130 246 C130 251 123 253 115 253 C106 253 100 251 100 246 Z" fill={P.gloveDark} />
            <path d="M108 250 L108 246 M115 251 L115 246 M122 250 L122 246" stroke={P.glove} strokeWidth="1.2" strokeLinecap="round" />
          </g>
        </g>

        {/* ── Back arm ── */}
        <g data-part="armBack">
          <path d="M98 127 C87 136 85 155 91 169 L110 169 C112 156 112 139 108 129 Z" fill={P.shirtShade} />
          <path d="M95 136 C91 146 91 156 93 164" fill="none" stroke="#c9a578" strokeWidth="1.2" strokeLinecap="round" />
          <g data-part="forearmBack">
            <path d="M93 170 L108 170 L107 189 L94 189 Z" fill={P.furDark} />
            <path d="M89 163 C89 158 111 157 112 163 L112 171 C111 175 90 175 89 171 Z" fill={P.shirtShade} stroke="#c9a578" strokeWidth="0.8" />
            <g data-part="handBack">
              <path d="M90 187 C88 196 92 205 101 205 C110 205 113 197 111 187 C107 182 94 182 90 187 Z" fill={u('glove')} />
              <path d="M92 196 C94 199 98 200 101 199" fill="none" stroke={P.gloveDark} strokeWidth="1" strokeLinecap="round" />
            </g>
          </g>
        </g>

        {/* ── Front leg ── */}
        <g data-part="legFront">
          <path d="M137 180 C134 194 135 207 139 219 L161 219 C164 207 165 193 163 180 Z" fill={u('fur')} />
          <path d="M140 188 C138 200 139 209 141 217" fill="none" stroke={P.cream} strokeWidth="5.5" strokeLinecap="round" opacity="0.75" />
          <g data-part="shinFront">
            <path d="M140 213 C139 225 139 235 141 244 L160 244 C162 235 162 225 161 213 Z" fill={u('fur')} />
            <path d="M136 246 C135 238 144 235 153 235 C163 235 170 239 170 246 C170 251 162 254 153 254 C143 254 136 251 136 246 Z" fill={u('glove')} />
            <path d="M146 251 L146 246 M153 252 L153 246 M161 251 L161 246" stroke={P.gloveDark} strokeWidth="1.3" strokeLinecap="round" />
          </g>
        </g>

        {/* ── Torso: shirt, vest, the pocket with his tools ── */}
        <g data-part="torso">
          {/* cream belly fur between the legs */}
          <path d="M118 184 C124 194 142 196 152 184 L152 204 C142 211 126 211 118 204 Z" fill={u('cream')} />
          <path d="M100 127 C96 145 96 171 101 193 C118 200 150 200 167 193 C171 171 172 145 168 127 C150 119 118 119 100 127 Z" fill={u('shirt')} />
          {/* shirt placket and buttons */}
          <path d="M153 134 L154 196" stroke="#e2c79e" strokeWidth="1" />
          <circle cx="157" cy="148" r="1.9" fill="#b98451" />
          <circle cx="157.5" cy="162" r="1.9" fill="#b98451" />
          <circle cx="158" cy="176" r="1.9" fill="#b98451" />
          {/* vest: the big near panel and the narrow far one */}
          <path d="M101 127 C108 123 118 122 127 123 C132 136 140 148 146 160 C149 172 149 186 147 201 L139 197 C125 199 110 197 101 192 C96 172 96 146 101 127 Z" fill={u('vest')} />
          <path d="M127 123 C132 136 140 148 146 160 C149 172 149 186 147 201" fill="none" stroke={P.vestLight} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M163 128 C161 140 160 152 161 162 C163 174 164 186 163 199 L170 193 C172 172 172 148 168 128 Z" fill={u('vest')} />
          <path d="M163 128 C161 140 160 152 161 162 C163 174 164 186 163 199" fill="none" stroke={P.vestDark} strokeWidth="1" />
          {/* side shading */}
          <path d="M100 127 C96 145 96 171 101 191 L107 193 C102 172 101 148 105 128 Z" fill={P.vestDark} opacity="0.6" />
          {/* pencil and brush, in the pocket */}
          <path d="M115.5 141 L119 139.5 L122 162 L118.5 163.5 Z" fill="#f3c13a" stroke="#b78a1d" strokeWidth="0.6" />
          <path d="M115.5 141 L117 134 L119 139.5 Z" fill="#f2d3a0" />
          <path d="M116.4 137 L117 134 L117.7 136.6 Z" fill="#3b3b3b" />
          <path d="M124 146 L127 146 L128 163 L124.5 163 Z" fill="#7ea6c8" />
          <path d="M123.6 142 L127.6 142 L127.4 147 L123.9 147 Z" fill="#c9ced6" />
          <path d="M123.8 142 C122 137 124 131 125.6 129 C127.4 131 129.4 137 127.4 142 Z" fill="#f6e3c0" />
          <path d="M124.7 133 C125.2 131 125.6 130 125.6 129 C126.4 130.3 127.2 132 127.5 134 Z" fill="#e0783a" />
          {/* the pocket */}
          <path d="M107 155 L136 155 L136 175 Q136 182 129 182 L114 182 Q107 182 107 175 Z" fill={P.vestDark} />
          <path d="M109 158 L134 158 M109 158 L109 175 Q109 180 114 180 L129 180 Q134 180 134 175 L134 158" fill="none" stroke={P.vestLight} strokeWidth="0.8" strokeDasharray="1.6 1.4" />
          <circle cx="162.5" cy="160" r="1.5" fill={P.vestDark} />
          <circle cx="163" cy="176" r="1.5" fill={P.vestDark} />
          {/* his sketchpad, held against him while he draws */}
          <g data-prop="pad" style={{ display: 'none' }}>
            <g transform="rotate(-10 140 176)">
              <rect x="114" y="158" width="48" height="36" rx="3" fill="#fbf7ee" stroke="#5b4a3a" strokeWidth="1.1" />
              <path d="M114 161 L162 161" stroke="#b33a2a" strokeWidth="3" />
              <path d="M121 172 C128 166 136 168 140 174 C144 180 152 181 156 175" fill="none" stroke="#6d6258" strokeWidth="1.1" strokeLinecap="round" />
              <path d="M123 184 L150 184 M123 188 L141 188" stroke="#a99d90" strokeWidth="0.9" strokeLinecap="round" />
            </g>
            <path d="M109 178 C106 184 108 192 114 193 C119 193 121 187 120 181 C117 177 112 176 109 178 Z" fill={u('glove')} />
          </g>
        </g>

        {/* ── Scarf ── */}
        <g data-part="scarf">
          <path d="M102 116 C112 126 150 128 170 118 C174 125 172 132 167 136 C150 143 116 143 100 134 C97 128 98 121 102 116 Z" fill={u('scarf')} />
          <path d="M107 125 C120 133 146 134 163 127 M111 133 C126 138 146 138 159 134" fill="none" stroke={P.scarfDark} strokeWidth="1.3" strokeLinecap="round" opacity="0.8" />
          <g data-part="scarfEnd">
            <path d="M151 132 C160 136 165 146 162 159 C158 160 154 157 151 151 C149 145 149 138 151 132 Z" fill={u('scarf')} />
            <path d="M154 140 C157 146 158 151 158 156" fill="none" stroke={P.scarfDark} strokeWidth="1.1" strokeLinecap="round" />
          </g>
        </g>

        {/* ── Head ── */}
        <g data-part="head">
          <g transform="translate(0 4)">
          <g data-part="earBack">
            <path d="M70 66 C61 48 55 28 56 8 C68 15 86 30 98 46 Z" fill={u('fur')} stroke={P.outline} strokeWidth="1" strokeLinejoin="round" />
            <path d="M73 58 C67 45 63 32 62 19 C71 27 82 37 90 47 Z" fill={u('ear')} />
            <path d="M68 40 C70 46 73 52 76 56 M73 36 C76 42 80 47 84 51" fill="none" stroke={P.creamLight} strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
          </g>
          <g data-part="earFront">
            <path d="M136 42 C142 27 150 13 158 3 C165 18 170 36 169 55 Z" fill={u('fur')} stroke={P.outline} strokeWidth="1" strokeLinejoin="round" />
            <path d="M142 42 C147 31 153 20 157 13 C162 25 164 38 163 50 Z" fill={u('ear')} />
          </g>

          {/* skull and cheeks, with fluffy tufts */}
          <path
            d="M71 64 C73 40 96 25 123 25 C151 25 171 39 175 60 C177 68 180 73 184 79 C180 82 182 88 176 93 C178 96 172 99 170 102 C162 110 150 113 136 114 C121 116 106 113 95 107 C88 105 82 101 77 97 L68 99 L72 92 L63 90 L70 84 L62 78 L69 74 C68 70 70 67 71 64 Z"
            fill={u('head')}
            stroke={P.outline}
            strokeWidth="1"
            strokeLinejoin="round"
          />
          {/* the cream of the cheeks and the muzzle */}
          <path
            d="M70 84 C80 79 95 78 107 83 C117 87 125 86 134 81 C143 76 152 73 162 73 C171 73 178 76 183 80 C181 86 180 89 176 93 C178 96 173 99 170 102 C162 110 150 113 136 114 C121 116 106 113 95 107 C88 105 82 101 77 97 L68 99 L72 92 L63 90 Z"
            fill={u('cream')}
          />
          {/* fur on the forehead */}
          <path d="M118 30 C122 34 124 40 124 46 M128 29 C131 34 132 39 132 44 M109 33 C112 37 114 41 114 46" fill="none" stroke={P.furLight} strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />

          <g data-part="face">
            {/* near eye (his right, nearer to us) */}
            <g data-part="eyeNear" data-eyes="open">
              <ellipse cx="121" cy="68" rx="14.6" ry="12.6" fill={P.eyeWhite} />
              <g clipPath={u('eyeNearClip')}>
                <g data-part="irisNear">
                  <circle cx="125" cy="69.5" r="8.8" fill={u('iris')} />
                  <circle cx="125.6" cy="69.8" r="5" fill={P.pupil} />
                  <circle cx="122" cy="65.6" r="2.7" fill="#fff" />
                  <circle cx="128.6" cy="73.4" r="1.2" fill="#fff" opacity="0.9" />
                </g>
                <path d="M106 64 C110 56 124 52 136 62 L136 52 L106 52 Z" fill={P.furDark} opacity="0.18" />
              </g>
              <path d="M105.6 66.5 C107.6 57.6 117 53.6 126.6 55.2 C131 56 134.4 58.8 135.9 63" fill="none" stroke={P.line} strokeWidth="2.4" strokeLinecap="round" />
              <path d="M106.6 61.4 L101.8 58.2" stroke={P.line} strokeWidth="1.8" strokeLinecap="round" />
            </g>
            {/* far eye */}
            <g data-part="eyeFar" data-eyes="open">
              <ellipse cx="155.5" cy="66" rx="8.8" ry="11.6" fill={P.eyeWhite} />
              <g clipPath={u('eyeFarClip')}>
                <g data-part="irisFar">
                  <circle cx="157.6" cy="67.6" r="7" fill={u('iris')} />
                  <circle cx="158" cy="68" r="4" fill={P.pupil} />
                  <circle cx="155.8" cy="64.4" r="2.1" fill="#fff" />
                </g>
              </g>
              <path d="M147.2 62.6 C148.4 56.2 153.6 53.8 158.6 55 C161.6 55.8 163.6 58.4 164.2 61.6" fill="none" stroke={P.line} strokeWidth="2.1" strokeLinecap="round" />
            </g>
            {/* happy eyes (^ ^) and closed eyes */}
            <g data-eyes-alt="happy" style={{ display: 'none' }}>
              <path d="M107 70 C111 60 129 59 134 69" fill="none" stroke={P.line} strokeWidth="3" strokeLinecap="round" />
              <path d="M149 68 C151 61 160 60 163 67" fill="none" stroke={P.line} strokeWidth="2.6" strokeLinecap="round" />
            </g>
            <g data-eyes-alt="closed" style={{ display: 'none' }}>
              <path d="M107 67 C112 73 128 74 134 66" fill="none" stroke={P.line} strokeWidth="2.6" strokeLinecap="round" />
              <path d="M149 65 C152 70 160 70 163 64" fill="none" stroke={P.line} strokeWidth="2.3" strokeLinecap="round" />
            </g>
            {/* brows */}
            <path data-part="browNear" d="M108 50.5 C114 45 124 43.6 132 47" fill="none" stroke="#5a2a12" strokeWidth="2.8" strokeLinecap="round" />
            <path data-part="browFar" d="M148.5 47 C152 44 158 43.6 162.6 46.6" fill="none" stroke="#5a2a12" strokeWidth="2.4" strokeLinecap="round" />

            {/* nose */}
            <path d="M156 76.6 C159.6 73 168.6 73.2 170.6 77.4 C171 81.8 165.8 85 162.4 85 C158.8 85 154.6 80.6 156 76.6 Z" fill={P.nose} />
            <ellipse cx="163.4" cy="76.8" rx="3" ry="1.3" fill="#fff" opacity="0.45" />

            {/* mouths: one shown at a time */}
            <g data-mouth="smile">
              <path d="M133 90 C140 95 151 96 160 90 C160 99 152 105 145 104 C139 103 134 97 133 90 Z" fill={P.mouth} />
              <path d="M138.6 100.4 C141.4 96.6 150 96.4 154.6 99.6 C152.6 104 143 105.4 138.6 100.4 Z" fill={P.tongue} />
              <path d="M136.4 91.4 L138 95 L139.8 92" fill="#fff" />
              <path d="M131 88.6 C133 90 133.5 90.4 134 91" fill="none" stroke={P.line} strokeWidth="1.4" strokeLinecap="round" />
            </g>
            <g data-mouth="grin" style={{ display: 'none' }}>
              <path d="M132 89 C139 96 152 97 161 89" fill="none" stroke={P.line} strokeWidth="2.4" strokeLinecap="round" />
            </g>
            <g data-mouth="open" style={{ display: 'none' }}>
              <path d="M131 88 C140 94 152 95 162 88 C163 102 154 111 146 111 C137 110 131 100 131 88 Z" fill={P.mouth} />
              <path d="M137 104 C141 98 152 98 157 103 C153 109 142 110 137 104 Z" fill={P.tongue} />
              <path d="M134.6 89.6 L136.4 94 L138.4 90.6" fill="#fff" />
            </g>
            <g data-mouth="o" style={{ display: 'none' }}>
              <ellipse cx="146" cy="95" rx="4.6" ry="5.4" fill={P.mouth} />
              <ellipse cx="146" cy="98" rx="3" ry="1.8" fill={P.tongue} />
            </g>
            <g data-mouth="flat" style={{ display: 'none' }}>
              <path d="M136 93 C141 95 150 95 156 92" fill="none" stroke={P.line} strokeWidth="2.2" strokeLinecap="round" />
            </g>
            <g data-mouth="tongue" style={{ display: 'none' }}>
              <path d="M134 91 C141 95 151 95 159 90" fill="none" stroke={P.line} strokeWidth="2.2" strokeLinecap="round" />
              <path d="M150 93 C152 99 158 100 160 95 C159 93 155 92 150 93 Z" fill={P.tongue} />
            </g>
          </g>

          {/* beret, tilted toward his right ear */}
          <g data-part="beret">
            <path d="M62 46 C57 30 78 14 106 12 C134 10 154 21 154 34 C154 43 141 49 120 51 C96 53 68 54 62 46 Z" fill={u('beret')} stroke={P.beretDark} strokeWidth="1" />
            <path d="M65 45 C82 52 121 51 151 39 C152 45 143 51 122 54 C97 57 72 55 65 48 Z" fill={P.beretDark} />
            <path d="M80 22 C90 17 104 15 116 16" fill="none" stroke={P.beretLight} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
            <path d="M99 13 C97 7 99 2.5 104.5 2.6 C106.6 4.4 103.4 6.6 103.6 12 Z" fill={P.beretDark} />
          </g>
          </g>
        </g>

        {/* ── Front arm (drawn last: it can cross the body) ── */}
        <circle data-anchor="shoulder" cx="165" cy="139" r="0.6" fill="none" />
        <g data-part="armFront">
          <path d="M160 128 C154 140 154 156 157 169 L176 169 C179 156 178 139 173 129 Z" fill={u('shirt')} />
          <path d="M173 136 C176 146 176 156 174 164" fill="none" stroke={P.shirtShade} strokeWidth="1.2" strokeLinecap="round" />
          <g data-part="forearmFront">
            <path d="M159 170 L174 170 L173 189 L160 189 Z" fill={u('fur')} />
            <path d="M155 163 C155 158 177 157 178 163 L178 171 C177 175 156 175 155 171 Z" fill={P.shirt} stroke={P.shirtShade} strokeWidth="0.8" />
            <g data-part="handFront">
              {/* the sign's post: the board itself is HTML above it */}
              <g data-prop="sign" style={{ display: 'none' }}>
                <rect x="163.6" y="180" width="6.8" height="96" rx="2.6" fill="#9a6232" stroke="#5d3518" strokeWidth="1" />
                <path d="M166 184 L166 272" stroke="#c48a52" strokeWidth="1.2" opacity="0.7" />
                <circle data-anchor="signTop" cx="167" cy="276" r="0.6" fill="none" />
              </g>
              <g data-prop="pencil" style={{ display: 'none' }}>
                <path d="M171 180 L176 178 L185 205 L180 207 Z" fill="#f3c13a" stroke="#b78a1d" strokeWidth="0.7" />
                <path d="M180 207 L185 205 L184.6 212.4 Z" fill="#f2d3a0" />
                <path d="M183.6 210.2 L184.6 212.4 L183 211.4 Z" fill="#333" />
                <path d="M171 180 L176 178 L175 175 L170 177 Z" fill="#e88b9a" />
              </g>
              <g data-prop="brush" style={{ display: 'none' }}>
                <path d="M170 182 L174 180 L184 204 L180 206 Z" fill="#7ea6c8" />
                <path d="M180 206 L184 204 L186 209 L182 211 Z" fill="#c9ced6" />
                <path d="M182 211 C182 216 185 220 188 221 C188 217 187 212 186 209 Z" fill="#e0783a" />
              </g>
              <path d="M156 187 C154 196 158 205 167 205 C176 205 179 197 177 187 C173 182 160 182 156 187 Z" fill={u('glove')} />
              <path d="M158 196 C160 199 164 200 167 199" fill="none" stroke={P.gloveDark} strokeWidth="1" strokeLinecap="round" />
              <path d="M159 189 C161 187 164 186 167 187" fill="none" stroke={P.gloveLight} strokeWidth="1" strokeLinecap="round" opacity="0.8" />
              <g data-prop="finger" style={{ display: 'none' }}>
                <path d="M162 200 C161 207 162 214 165.5 215 C169 214.6 169.6 207 168.8 200 Z" fill={u('glove')} />
              </g>
            </g>
          </g>
        </g>
      </g>

      {/* ── Effects around him (not part of the body) ── */}
      <g data-fx="sparkles" style={{ display: 'none' }}>
        <path d={star(40, 40, 9)} fill="#ffd34d" />
        <path d={star(214, 70, 7)} fill="#ffd34d" />
        <path d={star(26, 120, 5)} fill="#fff1b8" />
        <path d={star(206, 150, 6)} fill="#fff1b8" />
      </g>
      <g data-fx="confetti" style={{ display: 'none' }}>
        {CONFETTI.map(([x, y, r, c], i) => (
          <rect key={i} x={x} y={y} width="6" height="3.4" rx="1" fill={c} transform={`rotate(${r} ${x + 3} ${y + 1.7})`} />
        ))}
      </g>
      <g data-fx="think" style={{ display: 'none' }}>
        <circle cx="176" cy="20" r="3.4" fill="#f4ead8" />
        <circle cx="190" cy="6" r="5" fill="#f4ead8" />
        <circle cx="206" cy="-12" r="7.4" fill="#f4ead8" />
      </g>
      <g data-fx="question" style={{ display: 'none' }}>
        <path d="M182 4 C182 -6 196 -8 198 1 C199 7 191 9 190 15 L190 18" fill="none" stroke="#ffd34d" strokeWidth="4" strokeLinecap="round" />
        <circle cx="190" cy="25" r="2.6" fill="#ffd34d" />
      </g>
      <g data-fx="zzz" style={{ display: 'none' }}>
        <path d="M174 18 L184 18 L174 28 L184 28" fill="none" stroke="#cfe3ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M188 0 L196 0 L188 8 L196 8" fill="none" stroke="#cfe3ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g data-fx="exclaim" style={{ display: 'none' }}>
        <path d="M186 6 L182 22 M196 10 L188 24 M200 24 L190 30" stroke="#ffd34d" strokeWidth="3.4" strokeLinecap="round" />
      </g>
      <g data-fx="dust" style={{ display: 'none' }}>
        <ellipse cx="96" cy="250" rx="7" ry="3.4" fill="#d9c8b0" opacity="0.7" />
        <ellipse cx="84" cy="246" rx="5" ry="2.6" fill="#d9c8b0" opacity="0.5" />
        <ellipse cx="74" cy="249" rx="3.6" ry="2" fill="#d9c8b0" opacity="0.4" />
      </g>
    </svg>
  );
}

const TAIL =
  'M104 192 C98 209 80 228 54 230 C28 232 8 214 4 188 C0 162 8 136 26 122 C38 112 56 109 70 117 C75 120 79 125 77 131 C71 129 63 130 59 136 C55 144 60 154 72 158 C84 162 96 160 104 156 Z';

/** The cream tip of the tail (clipped to the tail): a fluffy edge across its upper part. */
const TAIL_TIP =
  'M-6 176 C0 174 5 170 8 165 C10 169 14 169 16 165 C17 159 21 156 25 158 C27 161 30 160 31 156 C32 150 36 148 40 150 C42 151 44 149 44 146 C45 141 49 139 53 141 C56 142 58 140 59 137 C61 141 63 146 66 150 L90 150 L90 100 L-6 100 Z';

function star(cx: number, cy: number, r: number): string {
  const s = r * 0.32;
  return `M${cx} ${cy - r} L${cx + s} ${cy - s} L${cx + r} ${cy} L${cx + s} ${cy + s} L${cx} ${cy + r} L${cx - s} ${cy + s} L${cx - r} ${cy} L${cx - s} ${cy - s} Z`;
}

const CONFETTI: [number, number, number, string][] = [
  [30, 20, 20, '#ffd34d'],
  [60, -6, -30, '#5ec2ff'],
  [104, -20, 45, '#ff7a90'],
  [150, -14, -15, '#8be37a'],
  [190, 6, 30, '#ffd34d'],
  [210, 44, -40, '#ff7a90'],
  [14, 70, 60, '#8be37a'],
  [200, 96, 10, '#5ec2ff'],
];
