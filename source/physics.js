export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
export const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
export const smooth = value => value * value * (3 - 2 * value);

export function physics(car, controls, dt, collide) {
  const { throttle, steering, handbrake } = controls;
  const { spec, root } = car;
  const speed = Math.abs(car.speed);
  const targetSteer = steering * spec.lock / (1 + speed * .055);
  car.steer = damp(car.steer, targetSteer, 8.5, dt);
  let acceleration = -car.speed * (.15 + speed * .007);
  if (handbrake) {
    acceleration -= clamp(car.speed * 9, -17, 17);
  } else if (throttle) {
    const opposing = Math.sign(car.speed) !== throttle && speed > .35;
    const cap = throttle > 0 ? spec.max : spec.bike ? 2.7 : 7;
    acceleration += throttle * (opposing ? spec.brake : spec.power * Math.max(0, 1 - (speed / cap) ** 2));
  } else {
    acceleration -= clamp(car.speed * 3, -.95, .95);
  }
  car.speed += acceleration * dt;
  if (Math.abs(car.speed) < .06 && !throttle) car.speed = 0;
  const yaw = root.rotation.y;
  const turn = car.speed * Math.tan(car.steer) / spec.wheelbase;
  const nextYaw = wrap(yaw + clamp(turn, -2.5, 2.5) * (handbrake ? 1.45 : 1) * dt);
  car.slide = damp(car.slide, -turn * car.speed * (handbrake ? .62 : .07), handbrake ? 3.5 : 7, dt);
  const x = root.position.x + (Math.sin(nextYaw) * car.speed + Math.cos(nextYaw) * car.slide) * dt;
  const z = root.position.z + (Math.cos(nextYaw) * car.speed - Math.sin(nextYaw) * car.slide) * dt;
  if (collide(x, z, nextYaw)) {
    car.speed *= -.15;
    car.slide = 0;
  } else {
    root.position.x = x;
    root.position.z = z;
    root.rotation.y = nextYaw;
  }
  car.spin -= car.speed * dt / spec.radius;
  car.lean = damp(car.lean, clamp(turn * Math.abs(car.speed) * (spec.bike ? -.055 : -.012), -.5, .5), 6, dt);
  car.pitch = damp(car.pitch, clamp(-acceleration * (spec.bike ? .003 : .005), -.07, .07), 7, dt);
}

export function footprint(x, z, yaw, halfWidth, halfLength) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const centerline = halfLength - halfWidth * .45;
  return [-centerline, 0, centerline].map(offset => [x + s * offset, z + c * offset, halfWidth]);
}
