//! Value noise on integers. Everything is `u32`/`i32`/`i64` arithmetic, so the native and WebAssembly
//! builds give the same numbers. Noise values run from 0 to 65535.

fn mix(mut h: u32) -> u32 {
    h ^= h >> 16;
    h = h.wrapping_mul(0x85EB_CA6B);
    h ^= h >> 13;
    h = h.wrapping_mul(0xC2B2_AE35);
    h ^ (h >> 16)
}

/// A hash of a seed, a salt that tells uses apart, and a position.
pub(super) fn hash(seed: u32, salt: u32, x: i32, y: i32, z: i32) -> u32 {
    let h = mix(seed.wrapping_add(salt.wrapping_mul(0x9E37_79B1)));
    let h = mix(h ^ x as u32);
    let h = mix(h ^ (y as u32).wrapping_mul(0x27D4_EB2F));
    mix(h ^ (z as u32).wrapping_mul(0x1656_67B1))
}

/// Eases 0..=65536 into 0..=65536 with `3t² - 2t³`.
fn smooth(t: i64) -> i64 {
    let t2 = (t * t) >> 16;
    (t2 * ((3 << 16) - 2 * t)) >> 16
}

fn lerp(a: i64, b: i64, t: i64) -> i64 {
    a + (((b - a) * t) >> 16)
}

/// The lattice cell of a coordinate for a cell `1 << shift` wide, and how far into it, as 0..=65535.
fn split(v: i32, shift: u32) -> (i32, i64) {
    let cell = v >> shift;
    let frac = (v & ((1 << shift) - 1)) as i64;
    (cell, smooth((frac << 16) >> shift))
}

fn corner(seed: u32, salt: u32, x: i32, y: i32, z: i32) -> i64 {
    (hash(seed, salt, x, y, z) >> 16) as i64
}

/// Smooth noise over the x/z plane with lattice cells `1 << shift` blocks wide.
pub(super) fn noise2(seed: u32, salt: u32, x: i32, z: i32, shift: u32) -> i32 {
    let (gx, tx) = split(x, shift);
    let (gz, tz) = split(z, shift);
    let at = |dx, dz| corner(seed, salt, gx + dx, 0, gz + dz);
    let near = lerp(at(0, 0), at(1, 0), tx);
    let far = lerp(at(0, 1), at(1, 1), tx);
    lerp(near, far, tz) as i32
}

/// Smooth noise in space with lattice cells `1 << shift` wide in x and z and `1 << shift_y` tall.
pub(super) fn noise3(
    seed: u32,
    salt: u32,
    x: i32,
    y: i32,
    z: i32,
    shift: u32,
    shift_y: u32,
) -> i32 {
    let (gx, tx) = split(x, shift);
    let (gy, ty) = split(y, shift_y);
    let (gz, tz) = split(z, shift);
    let at = |dx, dy, dz| corner(seed, salt, gx + dx, gy + dy, gz + dz);
    let row = |dy, dz| lerp(at(0, dy, dz), at(1, dy, dz), tx);
    let layer = |dy| lerp(row(dy, 0), row(dy, 1), tz);
    lerp(layer(0), layer(1), ty) as i32
}
