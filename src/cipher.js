// Authored geometry for a 320 × 320 viewBox. All motion belongs to the caller.
// Eleven folds advance by 29 degrees, leaving an intentional lower aperture.
const folds = Array.from({ length: 11 }, (_, index) => {
  const angle = -145 + index * 29;
  return `
    <g transform="rotate(${angle} 160 160)">
      <path class="cipher-trace" data-trace="${index}" d="M 148 43 L 174 51 L 184 78 L 176 103 L 160 119 L 165 90 L 157 67 L 148 63" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" />
      <path class="cipher-fold" d="M 157 67 L 174 51 M 165 90 L 184 78 M 160 119 L 176 103" fill="none" stroke="currentColor" stroke-width="0.55" opacity="0.32" />
      <path class="cipher-engraving" d="M 151 48 L 160 51 M 151 52 L 157 54" fill="none" stroke="currentColor" stroke-width="0.7" opacity="0.42" />
    </g>`;
}).join('');

const indexMarks = Array.from({ length: 29 }, (_, index) => {
  const angle = -143 + index * (286 / 28);
  const major = index % 7 === 0;
  return `<path d="M 160 34 L 160 ${major ? 40 : 37}" transform="rotate(${angle} 160 160)" />`;
}).join('');

export const cipherMarkup = `
  <g class="cipher-orbits" fill="none" stroke="currentColor">
    <g class="cipher-orbit cipher-orbit-outer" stroke-width="0.65" opacity="0.33">
      <path d="M 54.9 93 A 124.6 124.6 0 0 1 125 40.4 M 195 40.4 A 124.6 124.6 0 0 1 265.1 93 M 280.5 128.3 A 124.6 124.6 0 0 1 259.5 235 M 60.5 235 A 124.6 124.6 0 0 1 39.5 128.3" />
      <g class="cipher-index" stroke-width="0.75">${indexMarks}</g>
    </g>
    <g class="cipher-orbit cipher-orbit-inner" stroke-width="0.6" opacity="0.3">
      <path d="M 108.1 142.2 A 54.9 54.9 0 0 1 157.1 105.2 M 181.2 109.4 A 54.9 54.9 0 0 1 214.4 167.5 M 207.4 187.7 A 54.9 54.9 0 0 1 141.2 211.6 M 121.2 198.8 A 54.9 54.9 0 0 1 105.2 162.9" />
      <path d="M 157.1 105.2 L 157.4 111 M 214.4 167.5 L 208.7 166.7 M 141.2 211.6 L 143.2 206.2 M 105.2 162.9 L 111 162.6" />
    </g>
  </g>
  <g class="cipher-traces">${folds}</g>
  <g class="cipher-signal" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path class="cipher-scan" d="M 83 249 L 49 207 L 41 151 L 58 103 L 99 64 L 151 45 L 205 55 L 248 87 L 276 135 L 276 184 L 253 231 L 228 253" stroke-width="1.7" opacity="0.86" />
    <path class="cipher-return" d="M 89 247 L 101 260 L 126 272 M 231 247 L 219 260 L 194 272" stroke-width="0.75" opacity="0.45" />
    <path d="M 133 275 L 143 279 M 187 275 L 177 279" stroke-width="1.2" opacity="0.7" />
  </g>
  <g class="cipher-core" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path class="cipher-core-frame" d="M 145 126 L 128 143 L 128 175 L 143 190 M 175 126 L 192 143 L 192 175 L 177 190" stroke-width="0.85" opacity="0.58" />
    <path class="cipher-core-mark" d="M 151 139 L 160 130 L 169 139 L 160 160 L 151 181 L 160 190 L 169 181 L 160 160 Z" stroke-width="1.25" />
    <path d="M 151 139 L 160 148 L 169 139 M 151 181 L 160 172 L 169 181" stroke-width="0.65" opacity="0.42" />
    <path class="cipher-core-axis" d="M 160 117 L 160 122 M 160 198 L 160 203 M 117 160 L 122 160 M 198 160 L 203 160" stroke-width="0.85" opacity="0.55" />
    <path d="M 124 142 L 128 142 M 192 176 L 196 176" stroke-width="1.25" />
  </g>
  <g class="cipher-nodes" fill="currentColor">
    <circle cx="151" cy="45" r="1.65" />
    <circle cx="248" cy="87" r="1.35" />
    <circle cx="41" cy="151" r="1.35" />
    <circle cx="228" cy="253" r="1.65" />
    <circle cx="126" cy="272" r="1.1" opacity="0.65" />
    <circle cx="194" cy="272" r="1.1" opacity="0.65" />
  </g>`;

// Complete standalone SVG for use as a favicon asset or encoded data URL.
export const faviconMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#080C0B"/><g fill="none" stroke="#B7F4C4" stroke-linecap="round" stroke-linejoin="round"><path d="M 23 10 L 11 22 L 11 42 L 22 53 M 41 10 L 53 22 L 53 42 L 42 53" stroke-width="2"/><path d="M 24 17 L 32 9 L 40 17 L 32 32 L 24 47 L 32 55 L 40 47 L 32 32 Z" stroke-width="2.6"/><path d="M 24 17 L 32 24 L 40 17 M 24 47 L 32 40 L 40 47" stroke-width="1" opacity=".5"/></g></svg>`;
