import { BlendModeFilter, ExtensionType, extensions } from "pixi.js";

const glHsl = `
float adrLuminosity(vec3 c) { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }
float adrSaturation(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
vec3 adrSetLuminosity(vec3 c, float lum) {
  float delta = lum - adrLuminosity(c);
  vec3 color = c + vec3(delta);
  float adjustedLuminosity = adrLuminosity(color);
  vec3 luminosityVector = vec3(adjustedLuminosity);
  float minimum = min(color.r, min(color.g, color.b));
  float maximum = max(color.r, max(color.g, color.b));
  if (minimum < 0.0) color = mix(luminosityVector, color, adjustedLuminosity / (adjustedLuminosity - minimum));
  if (maximum > 1.0) color = mix(luminosityVector, color, (1.0 - adjustedLuminosity) / (maximum - adjustedLuminosity));
  return color;
}
vec3 adrSetSaturationSorted(vec3 sorted, float saturation) {
  if (sorted.z > sorted.x) {
    sorted.y = ((sorted.y - sorted.x) * saturation) / (sorted.z - sorted.x);
    sorted.z = saturation;
  } else {
    sorted.y = 0.0;
    sorted.z = 0.0;
  }
  sorted.x = 0.0;
  return sorted;
}
vec3 adrSetSaturation(vec3 color, float saturation) {
  if (color.r <= color.g && color.r <= color.b) {
    return color.g <= color.b
      ? adrSetSaturationSorted(color.rgb, saturation).rgb
      : adrSetSaturationSorted(color.rbg, saturation).rbg;
  }
  if (color.g <= color.r && color.g <= color.b) {
    return color.r <= color.b
      ? adrSetSaturationSorted(color.grb, saturation).grb
      : adrSetSaturationSorted(color.gbr, saturation).gbr;
  }
  return color.r <= color.g
    ? adrSetSaturationSorted(color.brg, saturation).brg
    : adrSetSaturationSorted(color.bgr, saturation).bgr;
}
`;

const gpuHsl = `
fn adrLuminosity(c: vec3<f32>) -> f32 { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }
fn adrSaturation(c: vec3<f32>) -> f32 { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
fn adrSetLuminosity(c: vec3<f32>, lum: f32) -> vec3<f32> {
  let delta = lum - adrLuminosity(c);
  var color = c + vec3<f32>(delta);
  let adjustedLuminosity = adrLuminosity(color);
  let luminosityVector = vec3<f32>(adjustedLuminosity);
  let minimum = min(color.r, min(color.g, color.b));
  let maximum = max(color.r, max(color.g, color.b));
  if (minimum < 0.0) { color = mix(luminosityVector, color, adjustedLuminosity / (adjustedLuminosity - minimum)); }
  if (maximum > 1.0) { color = mix(luminosityVector, color, (1.0 - adjustedLuminosity) / (maximum - adjustedLuminosity)); }
  return color;
}
fn adrSetSaturationSorted(input: vec3<f32>, saturation: f32) -> vec3<f32> {
  var sorted = input;
  if (sorted.z > sorted.x) {
    sorted.y = ((sorted.y - sorted.x) * saturation) / (sorted.z - sorted.x);
    sorted.z = saturation;
  } else {
    sorted.y = 0.0;
    sorted.z = 0.0;
  }
  sorted.x = 0.0;
  return sorted;
}
fn adrSetSaturation(color: vec3<f32>, saturation: f32) -> vec3<f32> {
  if (color.r <= color.g && color.r <= color.b) {
    if (color.g <= color.b) { return adrSetSaturationSorted(color.rgb, saturation).rgb; }
    return adrSetSaturationSorted(color.rbg, saturation).rbg;
  }
  if (color.g <= color.r && color.g <= color.b) {
    if (color.r <= color.b) { return adrSetSaturationSorted(color.grb, saturation).grb; }
    return adrSetSaturationSorted(color.gbr, saturation).gbr;
  }
  if (color.r <= color.g) { return adrSetSaturationSorted(color.brg, saturation).brg; }
  return adrSetSaturationSorted(color.bgr, saturation).bgr;
}
`;

abstract class RegisteredBlendMode extends BlendModeFilter {
  static extension: { name: string; type: ExtensionType.BlendMode };
}

class DarkerColorBlend extends RegisteredBlendMode {
  static override extension = {
    name: "darker-color",
    type: ExtensionType.BlendMode,
  } as const;
  constructor() {
    super({
      gl: {
        functions: `${glHsl}\nvec3 adrDarkerColor(vec3 base, vec3 blend, float opacity) { vec3 selected = adrLuminosity(blend) < adrLuminosity(base) ? blend : base; return mix(base, selected, opacity); }`,
        main: "finalColor = vec4(adrDarkerColor(back.rgb, front.rgb, front.a), blendedAlpha) * uBlend;",
      },
      gpu: {
        functions: `${gpuHsl}\nfn adrDarkerColor(base: vec3<f32>, blend: vec3<f32>, opacity: f32) -> vec3<f32> { let selected = select(base, blend, adrLuminosity(blend) < adrLuminosity(base)); return mix(base, selected, opacity); }`,
        main: "out = vec4<f32>(adrDarkerColor(back.rgb, front.rgb, front.a), blendedAlpha) * blendUniforms.uBlend;",
      },
    });
  }
}

class LighterColorBlend extends RegisteredBlendMode {
  static override extension = {
    name: "lighter-color",
    type: ExtensionType.BlendMode,
  } as const;
  constructor() {
    super({
      gl: {
        functions: `${glHsl}\nvec3 adrLighterColor(vec3 base, vec3 blend, float opacity) { vec3 selected = adrLuminosity(blend) > adrLuminosity(base) ? blend : base; return mix(base, selected, opacity); }`,
        main: "finalColor = vec4(adrLighterColor(back.rgb, front.rgb, front.a), blendedAlpha) * uBlend;",
      },
      gpu: {
        functions: `${gpuHsl}\nfn adrLighterColor(base: vec3<f32>, blend: vec3<f32>, opacity: f32) -> vec3<f32> { let selected = select(base, blend, adrLuminosity(blend) > adrLuminosity(base)); return mix(base, selected, opacity); }`,
        main: "out = vec4<f32>(adrLighterColor(back.rgb, front.rgb, front.a), blendedAlpha) * blendUniforms.uBlend;",
      },
    });
  }
}

class HueBlend extends RegisteredBlendMode {
  static override extension = {
    name: "hue",
    type: ExtensionType.BlendMode,
  } as const;
  constructor() {
    super({
      gl: {
        functions: `${glHsl}\nvec3 adrHue(vec3 base, vec3 blend, float opacity) { vec3 hue = adrSetLuminosity(adrSetSaturation(blend, adrSaturation(base)), adrLuminosity(base)); return mix(base, hue, opacity); }`,
        main: "finalColor = vec4(adrHue(back.rgb, front.rgb, front.a), blendedAlpha) * uBlend;",
      },
      gpu: {
        functions: `${gpuHsl}\nfn adrHue(base: vec3<f32>, blend: vec3<f32>, opacity: f32) -> vec3<f32> { let hue = adrSetLuminosity(adrSetSaturation(blend, adrSaturation(base)), adrLuminosity(base)); return mix(base, hue, opacity); }`,
        main: "out = vec4<f32>(adrHue(back.rgb, front.rgb, front.a), blendedAlpha) * blendUniforms.uBlend;",
      },
    });
  }
}

let registered = false;

export const registerAgenticBlendModes = (): void => {
  if (registered) return;
  extensions.add(DarkerColorBlend, LighterColorBlend, HueBlend);
  registered = true;
};
