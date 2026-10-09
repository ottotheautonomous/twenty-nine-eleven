// An open way forward: shelter supports a path toward a rising horizon.
// Design interpretation of the owner's Jeremiah 29:11 / helping-people brief.
// All geometry is authored for viewBox 0 0 320 320. No animation lives here.
// Legacy cipher class names remain as integration hooks, not visual concepts.
const shoulder = 'M 140 62 C 98 69 73 102 65 143 L 62 213 L 84 242 L 110 224 L 94 199 L 99 151 C 102 121 117 100 145 91 Z';
const structure = (side, index) => `
  <g class="shelter-${side}"><g ${side === 'right' ? 'transform="translate(320 0) scale(-1 1)"' : ''}>
    <path class="cipher-trace" data-trace="${index}" d="${shoulder}" fill="url(#way-metal-${side})" stroke="#A5BCB5" stroke-opacity=".34" stroke-width=".65" />
    <path class="shelter-outside" d="M 140 62 C 98 69 73 102 65 143 L 62 213 L 84 242 L 80 211 L 82 145 C 89 106 107 84 142 76 Z" fill="url(#way-side-${side})" />
    <path class="shelter-inside" d="M 145 91 C 117 100 102 121 99 151 L 94 199 L 110 224 L 102 210 L 106 153 C 110 126 123 107 147 99 Z" fill="url(#way-inner)" />
    <path class="shelter-foot" d="M 62 213 L 84 242 L 110 224 L 94 199 L 91 211 L 99 224 L 85 232 L 73 213 Z" fill="url(#way-foot)" />
    <path class="shelter-crown" d="M 140 62 L 145 91 L 147 99 L 142 76 Z" fill="#B8CFC2" opacity=".8" />
    <path class="shelter-edge" d="M 140 62 C 98 69 73 102 65 143 L 62 213 L 84 242 M 145 91 C 117 100 102 121 99 151 L 94 199 L 110 224" fill="none" stroke="url(#way-edge)" stroke-width="1.05" />
    <path d="M 142 76 C 107 84 89 106 82 145 L 80 211 L 84 242" fill="none" stroke="#DCE4D6" stroke-width=".55" opacity=".54" />
    <path class="shelter-brush" d="M 135 81 C 109 90 94 112 88 144 L 85 191 M 136 85 C 111 94 98 114 92 146 L 89 184 M 136 89 C 114 99 102 117 96 147" fill="none" stroke="#DDE9DB" stroke-width=".32" opacity=".13" />
    <path class="shelter-joint" d="M 80 193 L 93 183 M 81 196 L 93 187" fill="none" stroke="#0C2024" stroke-width=".7" opacity=".44" />
  </g></g>`;

export const cipherMarkup = `
  <defs>
    <linearGradient id="way-metal-left" x1="67" y1="93" x2="124" y2="222" gradientUnits="userSpaceOnUse">
      <stop stop-color="#B9C9BF"/><stop offset=".23" stop-color="#6A8986"/><stop offset=".44" stop-color="#BBCFC3"/><stop offset=".64" stop-color="#49666C"/><stop offset="1" stop-color="#263F47"/>
    </linearGradient>
    <linearGradient id="way-metal-right" x1="72" y1="71" x2="112" y2="228" gradientUnits="userSpaceOnUse">
      <stop stop-color="#DFE3CC"/><stop offset=".22" stop-color="#8EA99C"/><stop offset=".49" stop-color="#456870"/><stop offset=".72" stop-color="#A0BAB1"/><stop offset="1" stop-color="#3B555D"/>
    </linearGradient>
    <linearGradient id="way-side-left" x1="62" y1="124" x2="140" y2="124" gradientUnits="userSpaceOnUse">
      <stop stop-color="#142C33"/><stop offset=".45" stop-color="#405C60"/><stop offset=".84" stop-color="#8CAEA5"/><stop offset="1" stop-color="#CBDFCB"/>
    </linearGradient>
    <linearGradient id="way-side-right" x1="62" y1="124" x2="140" y2="124" gradientUnits="userSpaceOnUse">
      <stop stop-color="#21383D"/><stop offset=".46" stop-color="#48616A"/><stop offset=".85" stop-color="#9AAEAE"/><stop offset="1" stop-color="#D5DFCF"/>
    </linearGradient>
    <linearGradient id="way-inner" x1="91" y1="191" x2="138" y2="100" gradientUnits="userSpaceOnUse">
      <stop stop-color="#5D8994"/><stop offset=".44" stop-color="#B6D3C6"/><stop offset="1" stop-color="#E2E7CB"/>
    </linearGradient>
    <linearGradient id="way-foot" x1="67" y1="209" x2="108" y2="243" gradientUnits="userSpaceOnUse">
      <stop stop-color="#AAC6B8"/><stop offset=".35" stop-color="#7D9B96"/><stop offset="1" stop-color="#29434D"/>
    </linearGradient>
    <linearGradient id="way-edge" x1="71" y1="68" x2="110" y2="237" gradientUnits="userSpaceOnUse">
      <stop stop-color="#F1F0D7"/><stop offset=".32" stop-color="#B1D5C5"/><stop offset=".54" stop-color="#87B6CE"/><stop offset=".75" stop-color="#AAACC0"/><stop offset="1" stop-color="#97BCA9"/>
    </linearGradient>
    <radialGradient id="way-dawn" cx="50%" cy="52%" r="50%">
      <stop stop-color="#F3E8B7" stop-opacity=".32"/><stop offset=".3" stop-color="#CEE5BE" stop-opacity=".13"/><stop offset=".66" stop-color="#8CC4B6" stop-opacity=".04"/><stop offset="1" stop-color="#8CC4B6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="way-sun" x1="160" y1="127" x2="160" y2="157" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FBF0D0"/><stop offset=".55" stop-color="#D3DBAE"/><stop offset="1" stop-color="#94B9AB" stop-opacity=".28"/>
    </linearGradient>
    <linearGradient id="way-road" x1="160" y1="158" x2="160" y2="258" gradientUnits="userSpaceOnUse">
      <stop stop-color="#EAF0CC" stop-opacity=".78"/><stop offset=".24" stop-color="#B4D3BB" stop-opacity=".25"/><stop offset=".67" stop-color="#6CA8AC" stop-opacity=".14"/><stop offset="1" stop-color="#77989D" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="way-horizon" x1="106" y1="160" x2="214" y2="160" gradientUnits="userSpaceOnUse">
      <stop stop-color="#C3DAC1" stop-opacity="0"/><stop offset=".3" stop-color="#D4E4C8" stop-opacity=".65"/><stop offset=".5" stop-color="#F9F2CD"/><stop offset=".7" stop-color="#D4E4C8" stop-opacity=".65"/><stop offset="1" stop-color="#C3DAC1" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="way-ground" cx="50%" cy="50%" r="50%">
      <stop stop-color="#729E9B" stop-opacity=".11"/><stop offset="1" stop-color="#729E9B" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g class="cipher-orbits">
    <g class="cipher-orbit-outer way-ground">
      <ellipse cx="160" cy="235" rx="116" ry="23" fill="url(#way-ground)" />
      <path d="M 49 242 Q 160 269 271 242" fill="none" stroke="#B3CCC2" stroke-opacity=".14" stroke-width=".6" />
      <path d="M 73 249 L 109 219 M 247 249 L 211 219" fill="none" stroke="#B3CCC2" stroke-opacity=".11" stroke-width=".55" />
    </g>
    <g class="cipher-orbit-inner way-atmosphere">
      <ellipse cx="160" cy="148" rx="74" ry="71" fill="url(#way-dawn)" />
    </g>
  </g>
  <g class="cipher-core way-forward">
    <path class="way-sun" d="M 137 153 A 23 23 0 0 1 183 153 Z" fill="url(#way-sun)" />
    <path class="way-sun-rim" d="M 139 144 A 23 23 0 0 1 181 144" fill="none" stroke="#F3ECCB" stroke-width=".6" stroke-opacity=".68" />
    <path class="way-path" d="M 156 159 L 164 159 L 223 258 L 97 258 Z" fill="url(#way-road)" />
    <path class="way-path-edge" d="M 156 159 L 97 258 M 164 159 L 223 258" fill="none" stroke="url(#way-road)" stroke-width=".75" />
    <path class="way-horizon" d="M 106 158 L 214 158" fill="none" stroke="url(#way-horizon)" stroke-width="1.5" />
    <path d="M 119 162 L 201 162" fill="none" stroke="url(#way-horizon)" stroke-opacity=".27" stroke-width=".65" />
  </g>
  <g class="cipher-traces way-shelter" stroke-linejoin="round">${structure('left', 0)}${structure('right', 1)}</g>
  <g class="cipher-signal">
    <path class="cipher-scan way-guidance" d="M 160 253 L 160 161" fill="none" stroke="url(#way-road)" stroke-width="1.1" stroke-linecap="round" opacity=".65" />
  </g>`;

// A reduced open shelter and dawn retain the same meaning at favicon size.
export const faviconMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#080C0B"/><path d="M 26 8 C 13 11 7 23 8 43 L 14 51 L 20 47 L 16 40 C 15 27 19 19 28 16 Z M 38 8 C 51 11 57 23 56 43 L 50 51 L 44 47 L 48 40 C 49 27 45 19 36 16 Z" fill="#AFCBC0"/><path d="M 27 31 A 5 5 0 0 1 37 31 Z" fill="#EEE5B9"/><path d="M 31 34 L 33 34 L 43 56 L 21 56 Z" fill="#83ADA2" opacity=".8"/><path d="M 24 33 H 40" stroke="#E3E7C5" stroke-width="1"/></svg>`;
