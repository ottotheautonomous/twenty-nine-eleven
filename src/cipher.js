// Eleven equal sectors: the metal aperture is balanced around (160, 160).
// The leading bevel is exactly 29 degrees; rotation is 360 / 11 degrees.
const bevelY = 36 + 26 * Math.tan(29 * Math.PI / 180);
const blade = `M 149 36 L 175 ${bevelY} L 188 80 L 177 108 L 163 121 L 149 113 L 160 88 L 151 66 L 143 53 Z`;
const folds = Array.from({ length: 11 }, (_, index) => `
  <g transform="rotate(${index * 360 / 11} 160 160)">
    <path class="cipher-trace" data-trace="${index}" d="${blade}" fill="url(#cipher-metal)" stroke="url(#cipher-edge)" stroke-width="0.65" stroke-linejoin="round" />
    <path class="cipher-fold" d="M 149 36 L 175 ${bevelY} L 166 55 L 151 47 L 149 58 L 143 53 Z" fill="url(#cipher-crown)" />
    <path d="M 175 ${bevelY} L 188 80 L 177 108 L 163 121 L 167 108 L 179 79 L 166 55 Z" fill="url(#cipher-bevel)" />
    <path d="M 151 66 L 160 88 L 149 113 L 163 121 L 157 108 L 168 87 L 158 62 Z" fill="#10191B" opacity="0.84" />
    <path class="cipher-engraving" d="M 153 53 L 163 58 L 175 80 L 163 107 M 155 55 L 162 59 L 173 80 L 162 103 M 157 58 L 161 60 L 171 80 L 160 101" fill="none" stroke="#D1E4DB" stroke-width="0.28" opacity="0.18" />
    <path d="M 149 36 L 175 ${bevelY} L 187 80 M 177 108 L 163 121" fill="none" stroke="url(#cipher-edge)" stroke-width="1.05" />
    <path d="M 166 55 L 179 79 L 167 108" fill="none" stroke="#D8E8DF" stroke-width="0.48" opacity="0.61" />
  </g>`).join('');

export const cipherMarkup = `
  <defs>
    <linearGradient id="cipher-metal" x1="143" y1="44" x2="185" y2="112" gradientUnits="userSpaceOnUse">
      <stop stop-color="#627774"/><stop offset=".23" stop-color="#C4D4C9"/><stop offset=".38" stop-color="#718986"/><stop offset=".61" stop-color="#344C4E"/><stop offset=".84" stop-color="#162B30"/><stop offset="1" stop-color="#8FAAA0"/>
    </linearGradient>
    <linearGradient id="cipher-crown" x1="143" y1="36" x2="171" y2="58" gradientUnits="userSpaceOnUse">
      <stop stop-color="#E3EEE0"/><stop offset=".46" stop-color="#AAC9BB"/><stop offset="1" stop-color="#506E79"/>
    </linearGradient>
    <linearGradient id="cipher-bevel" x1="166" y1="51" x2="179" y2="118" gradientUnits="userSpaceOnUse">
      <stop stop-color="#91BDB3"/><stop offset=".3" stop-color="#2E5360"/><stop offset=".65" stop-color="#78878E"/><stop offset="1" stop-color="#DBE9CF"/>
    </linearGradient>
    <linearGradient id="cipher-edge" x1="148" y1="36" x2="185" y2="121" gradientUnits="userSpaceOnUse">
      <stop stop-color="#E6F4DA"/><stop offset=".24" stop-color="#AACCC0"/><stop offset=".47" stop-color="#78B6CD"/><stop offset=".65" stop-color="#A9A1C0"/><stop offset=".83" stop-color="#567E84"/><stop offset="1" stop-color="#D0E9C8"/>
    </linearGradient>
    <linearGradient id="cipher-rune-metal" x1="138" y1="124" x2="182" y2="196" gradientUnits="userSpaceOnUse">
      <stop stop-color="#F0F5DE"/><stop offset=".26" stop-color="#BCDED0"/><stop offset=".48" stop-color="#6C9FA9"/><stop offset=".52" stop-color="#E6EFDC"/><stop offset=".8" stop-color="#ADC8B7"/><stop offset="1" stop-color="#668F98"/>
    </linearGradient>
  </defs>
  <g class="cipher-orbits" fill="none">
    <g class="cipher-orbit cipher-orbit-outer" stroke="#98BDB5" stroke-width="0.65" opacity="0.52">
      <path d="M 101 49 A 126 126 0 0 1 219 49 M 271 101 A 126 126 0 0 1 271 219 M 219 271 A 126 126 0 0 1 101 271 M 49 219 A 126 126 0 0 1 49 101" />
      <path d="M 148 34 L 172 34 M 286 148 L 286 172 M 172 286 L 148 286 M 34 172 L 34 148" stroke-width="1.25" />
    </g>
    <g class="cipher-orbit cipher-orbit-inner" stroke="#A9CCC0" opacity="0.49">
      <path d="M 128 128 L 139 117 L 181 117 L 192 128 M 192 192 L 181 203 L 139 203 L 128 192 M 117 145 L 117 175 M 203 145 L 203 175" stroke-width="0.65" />
      <path d="M 137 120 L 140 120 M 180 200 L 183 200" stroke-width="1.65" />
    </g>
  </g>
  <g class="cipher-traces">
    <circle class="cipher-bearing" cx="160" cy="160" r="125" fill="none" stroke="#708D83" stroke-width="0.65" opacity="0.48" />
    ${folds}
  </g>
  <g class="cipher-signal" fill="none" stroke="#CEECDC" stroke-linecap="round">
    <path class="cipher-scan" d="M 160 34 A 126 126 0 1 1 160 286 A 126 126 0 1 1 160 34" stroke-width="1.35" opacity="0.8" />
  </g>
  <g class="cipher-core" stroke-linejoin="round">
    <path class="cipher-core-frame" d="M 134 131 L 124 141 L 124 179 L 134 189 M 186 131 L 196 141 L 196 179 L 186 189" fill="none" stroke="#8EAFA6" stroke-width="1" opacity="0.52" />
    <path class="cipher-core-mark" fill="url(#cipher-rune-metal)" fill-rule="evenodd" d="M 160 123 L 181 139 L 166 160 L 181 181 L 160 197 L 139 181 L 154 160 L 139 139 Z M 160 134 L 150 141 L 160 154 L 170 141 Z M 160 166 L 150 179 L 160 186 L 170 179 Z" />
    <path d="M 160 123 L 181 139 L 166 160 L 181 181 L 160 197 M 160 134 L 150 141 L 160 154 M 160 166 L 150 179 L 160 186" fill="none" stroke="#EDFFE1" stroke-width="0.8" opacity="0.85" />
    <path d="M 160 126 L 143 139 L 158 160 L 143 181 L 160 194 L 160 186 L 150 179 L 160 166 L 160 154 L 150 141 L 160 134 Z" fill="#324F58" opacity="0.4" />
    <path class="cipher-core-axis" d="M 108 160 L 113 160 M 207 160 L 212 160" fill="none" stroke="#C2DACE" stroke-width="1.4" />
  </g>`;

export const faviconMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#080C0B"/><path fill="#CEE5D3" fill-rule="evenodd" d="M 32 5 L 48 17 L 37 32 L 48 47 L 32 59 L 16 47 L 27 32 L 16 17 Z M 32 14 L 24 19 L 32 28 L 40 19 Z M 32 36 L 24 45 L 32 50 L 40 45 Z"/><path d="M 11 19 L 7 23 L 7 41 L 11 45 M 53 19 L 57 23 L 57 41 L 53 45" fill="none" stroke="#80A89F" stroke-width="1.5"/></svg>`;
