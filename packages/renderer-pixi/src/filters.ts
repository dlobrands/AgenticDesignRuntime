import { Filter, GlProgram, UniformGroup } from "pixi.js";

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}
void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}`;

const createFilter = (fragment: string, uniforms?: UniformGroup): Filter =>
  new Filter({
    glProgram: GlProgram.from({ vertex, fragment }),
    ...(uniforms ? { resources: { runtimeUniforms: uniforms } } : {}),
  });

export const luminanceToAlphaFilter = (): Filter =>
  createFilter(`
in vec2 vTextureCoord;
uniform sampler2D uTexture;
void main(void) {
  vec4 color = texture(uTexture, vTextureCoord);
  float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(1.0, 1.0, 1.0, luminance * color.a);
}`);

export const dissolveFilter = (threshold: number, seed: number): Filter => {
  const uniforms = new UniformGroup({
    uThreshold: { value: threshold, type: "f32" },
    uSeed: { value: seed, type: "f32" },
  });
  return createFilter(
    `
in vec2 vTextureCoord;
uniform sampler2D uTexture;
uniform float uThreshold;
uniform float uSeed;
float random(vec2 point) {
  return fract(sin(dot(point + uSeed, vec2(12.9898, 78.233))) * 43758.5453);
}
void main(void) {
  vec4 color = texture(uTexture, vTextureCoord);
  float visible = step(random(gl_FragCoord.xy), color.a * uThreshold);
  gl_FragColor = vec4(color.rgb, visible);
}`,
    uniforms,
  );
};
