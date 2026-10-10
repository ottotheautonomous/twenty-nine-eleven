import { animate, springValue, followValue } from 'motion';
import { threeEffect } from 'motion/three';

// Motion owns every animated scene input. threeEffect claims this bare uniforms object, so animate(uniforms, …)
// and the bound values below write into it in preRender, ahead of the renderer's frame.render pass.
// Every key is u_* and { value } (a single non-{value} key would make threeEffect drop the object).
animate.addEffect(threeEffect);

export const uniforms = {
  // written by model.js each frame (continuous, never animated by Motion)
  u_probeX: { value: 0 }, u_probeY: { value: 0 }, u_probeZ: { value: 0 }, u_vel: { value: 0 },
  u_yaw: { value: 0 }, u_pitch: { value: 0 }, u_tear: { value: 0 }, u_present: { value: 0 },
  u_probeRX: { value: 0 }, u_probeRY: { value: 0 }, u_probeRZ: { value: 0 },   // the hand: raw probe, its world velocity, and a poke
  u_pokeX: { value: 0 }, u_pokeY: { value: 0 }, u_pokeZ: { value: 0 }, u_poke: { value: 0 },
  u_handDX: { value: 0 }, u_handDY: { value: 0 }, u_handDZ: { value: -1 },     // unit view ray through the raw probe (eye -> probe)
  // bound values
  u_engage: { value: 0 }, u_idle: { value: 0 },
  // entrance
  u_ember: { value: 0 }, u_build: { value: 0 }, u_entry: { value: 0.25 }, u_ca: { value: 0 },
  // transient gestures
  u_flinch: { value: 0 }, u_boostPress: { value: 0 }, u_boostGreet: { value: 0 },
  u_ringLon: { value: 0 }, u_ringPhase: { value: 1 }, u_ringAmp: { value: 0 },
  u_classSel: { value: -1 }, u_classAmp: { value: 0 }, u_tight: { value: 0 }, u_warm: { value: 0 },
  u_tier0: { value: 0 }, u_tapX: { value: 0 }, u_tapY: { value: 0 }, u_tapZ: { value: 0 }, u_tapT: { value: 1 },
  u_sentry: { value: 0 },
  // modal and policy
  u_open: { value: 0 }, u_dim: { value: 0 }, u_dolly: { value: 0 },
  u_motion: { value: 1 },                              // 0 = composed still (reduced motion or paused)
};

export const engage = springValue(0, { stiffness: 75, damping: 21 });
export const idle = followValue(0, { type: 'tween', duration: 2, ease: 'easeInOut' });
threeEffect(uniforms, { u_engage: engage, u_idle: idle });

// Final entrance values, used for reduced motion and as the still frame.
export const settled = { u_ember: 1, u_build: 1, u_entry: 0, u_ca: 0, u_ringAmp: 0, u_tapT: 1, u_sentry: 0 };
