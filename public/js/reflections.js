// Glossy floors: one planar reflection of the scene (mirror at y = 0) shared by
// the room floor and the dance floor. Each floor keeps its lit PBR material;
// the reflection is added on top with a Fresnel term and a roughness blur.
import * as THREE from 'three';

const _reflPos = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _target = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const NORMAL = new THREE.Vector3(0, 1, 0);

export class PlanarReflection {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.target.texture.name = 'floorReflection';
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = true;
    this.textureMatrix = new THREE.Matrix4();
    // Shared by every patched floor material.
    this.uniforms = {
      tReflect: { value: this.target.texture },
      uReflectMatrix: { value: this.textureMatrix },
      uReflectOn: { value: 0 },
      uReflectSize: { value: new THREE.Vector2(4, 4) },
    };
    this.surfaces = new Set();
    this.enabled = false;
    this.scale = 0.5;
  }

  setSize(w, h) {
    const rw = Math.max(4, Math.round(w * this.scale));
    const rh = Math.max(4, Math.round(h * this.scale));
    if (this.target.width !== rw || this.target.height !== rh) this.target.setSize(rw, rh);
    this.uniforms.uReflectSize.value.set(rw, rh);
  }

  /**
   * Patch a floor material so it adds the reflection.
   * strength 0..1 (0 = only the env-map look), blur 0..1 (roughness of the finish).
   */
  attach(mesh, { strength, blur }) {
    const mat = mesh.material;
    if (!mat || !mat.isMeshStandardMaterial) return;
    mesh.userData.reflective = true;
    this.surfaces.add(mesh);
    const u = mat.userData.reflect || (mat.userData.reflect = { uStrength: { value: 0 }, uBlur: { value: 0.3 } });
    u.uStrength.value = strength;
    u.uBlur.value = blur;
    if (mat.userData.reflectPatched) return;
    mat.userData.reflectPatched = true;
    const shared = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uReflectMatrix;\nvarying vec4 vReflectCoord;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvReflectCoord = uReflectMatrix * modelMatrix * vec4( transformed, 1.0 );');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tReflect;
uniform float uReflectOn;
uniform float uStrength;
uniform float uBlur;
uniform vec2 uReflectSize;
varying vec4 vReflectCoord;
vec3 floorReflection( vec3 n, vec3 v, vec2 bump ) {
  // Bumps of the finish (normal map) wobble the mirror image a little.
  vec2 uv = vReflectCoord.xy / vReflectCoord.w + bump * 0.035;
  float lod = uBlur * 4.5;
  vec2 px = ( 1.0 + uBlur * 14.0 ) / uReflectSize;
  vec3 c = texture2D( tReflect, uv, lod ).rgb * 0.28;
  c += texture2D( tReflect, uv + vec2( px.x, 0.0 ), lod ).rgb * 0.18;
  c += texture2D( tReflect, uv - vec2( px.x, 0.0 ), lod ).rgb * 0.18;
  c += texture2D( tReflect, uv + vec2( 0.0, px.y * 1.6 ), lod ).rgb * 0.18;
  c += texture2D( tReflect, uv - vec2( 0.0, px.y * 1.6 ), lod ).rgb * 0.18;
  float fres = 0.04 + 0.96 * pow( 1.0 - clamp( dot( n, v ), 0.0, 1.0 ), 5.0 );
  return c * mix( 0.35, 1.0, fres );
}`)
        .replace('#include <opaque_fragment>', `if ( uReflectOn > 0.5 && uStrength > 0.0 ) outgoingLight += floorReflection( normal, normalize( vViewPosition ), ( normal - nonPerturbedNormal ).xy ) * uStrength;
// Soft knee: the mirror-like highlight of a spot on a glossy floor must not become a blinding bloom blob.
float peak = max( outgoingLight.r, max( outgoingLight.g, outgoingLight.b ) );
if ( peak > 2.0 ) outgoingLight *= ( 2.0 + ( peak - 2.0 ) / ( 1.0 + ( peak - 2.0 ) * 0.5 ) ) / peak;
#include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'floor-reflect';
    mat.needsUpdate = true;
  }

  detach(mesh) {
    this.surfaces.delete(mesh);
  }

  /** Render the mirrored scene (call before the main render). `hide` = objects to leave out. */
  render(renderer, scene, camera, hide = []) {
    for (const m of this.surfaces) if (!m.parent) this.surfaces.delete(m);
    const active = [...this.surfaces].some((m) => m.visible && m.material?.userData.reflect?.uStrength.value > 0);
    this.uniforms.uReflectOn.value = this.enabled && active ? 1 : 0;
    if (!this.uniforms.uReflectOn.value) return;
    const vc = this.camera;
    _reflPos.set(0, 0, 0);
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    if (_camPos.y <= 0.01) { this.uniforms.uReflectOn.value = 0; return; }
    _rot.extractRotation(camera.matrixWorld);
    // Mirror the camera position and its look-at point in the floor.
    vc.position.set(_camPos.x, -_camPos.y, _camPos.z);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
    _target.set(_look.x, -_look.y, _look.z);
    vc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(NORMAL);
    vc.lookAt(_target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.layers.mask = camera.layers.mask;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // Oblique near plane = the floor, so nothing below it shows in the mirror.
    _plane.setFromNormalAndCoplanarPoint(NORMAL, _reflPos).applyMatrix4(vc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const p = vc.projectionMatrix.elements;
    _q.set((Math.sign(_clip.x) + p[8]) / p[0], (Math.sign(_clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    _clip.multiplyScalar(2 / _clip.dot(_q));
    p[2] = _clip.x; p[6] = _clip.y; p[10] = _clip.z + 1 - 0.003; p[14] = _clip.w;

    const hidden = [];
    for (const m of this.surfaces) if (m.visible) { m.visible = false; hidden.push(m); }
    for (const o of hide) if (o && o.visible) { o.visible = false; hidden.push(o); }
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(prev);
    for (const o of hidden) o.visible = true;
  }

  dispose() {
    this.target.dispose();
  }
}
