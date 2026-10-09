import { animate, springValue, followValue } from 'motion';
import { threeEffect } from 'motion/three';

// Motion owns every animated scene input. threeEffect claims this bare
// uniforms object, so animate(uniforms, …) and the springs below write into it
// once per frame in preRender, ahead of the renderer's frame.render pass.
animate.addEffect(threeEffect);

export const uniforms = {
  u_yaw: { value: 0 }, u_pitch: { value: 0 },          // camera orbit, radians
  u_lightX: { value: 0 }, u_lightY: { value: 0.2 },    // visitor light, world xy at z = 1.15
  u_dawn: { value: 0 }, u_engage: { value: 0 },        // lamp level, visitor engagement
  u_reveal: { value: 0 }, u_rise: { value: 0 },        // entrance: drawn edges to glass, rise from the floor
  u_plan: { value: 0 }, u_pulse: { value: 1 },         // grid sweep, press pulse phase (1 = finished)
  u_idle: { value: 0 }, u_dolly: { value: 0 }, u_dim: { value: 0 },
  u_motion: { value: 1 },                              // 0 = composed still (reduced motion or paused)
};

// The door is a heavy object: the camera answers on a slow spring.
export const heavy = { stiffness: 60, damping: 18, mass: 1.2 };
const light = { stiffness: 90, damping: 20 };
export const yaw = springValue(0, heavy);
export const pitch = springValue(0, heavy);
export const lightX = springValue(0, light);
export const lightY = springValue(0.2, light);
export const engage = springValue(0, { stiffness: 75, damping: 21 });
export const idle = followValue(0, { type: 'tween', duration: 2, ease: 'easeInOut' });
threeEffect(uniforms, { u_yaw: yaw, u_pitch: pitch, u_lightX: lightX, u_lightY: lightY, u_engage: engage, u_idle: idle });

// Final entrance values, used for reduced motion and as the still frame.
export const settled = { u_rise: 1, u_reveal: 1, u_plan: 1, u_dawn: 1, u_pulse: 1 };
