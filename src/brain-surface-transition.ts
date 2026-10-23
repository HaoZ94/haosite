import * as THREE from 'three';

/** Finish the surface change before the regions settle into their rest position. */
export function corticalSurfaceBlend(expansion: number): number {
  return THREE.MathUtils.smoothstep(expansion, 0.02, 0.75);
}

/**
 * Blend complete rendered appearances, preserving each surface's own depth,
 * shadows, transparency, and antialiasing. Overlapping transparent meshes would
 * let an almost invisible surface block the other surface's depth pass.
 */
export class BrainSurfaceTransition {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly material = new THREE.ShaderMaterial({
    uniforms: {
      assembledFrame: { value: null },
      expandedFrame: { value: null },
      blend: { value: 0 },
    },
    vertexShader: `
      varying vec2 frameUv;
      void main() {
        frameUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D assembledFrame;
      uniform sampler2D expandedFrame;
      uniform float blend;
      varying vec2 frameUv;
      void main() {
        gl_FragColor = mix(texture2D(assembledFrame, frameUv), texture2D(expandedFrame, frameUv), blend);
      }
    `,
    // Framebuffer copies already contain the final premultiplied display colors.
    // Write them directly, without a second color conversion or alpha blend.
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly size = new THREE.Vector2();
  private assembledFrame?: THREE.FramebufferTexture;
  private expandedFrame?: THREE.FramebufferTexture;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const quad = new THREE.Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  render(blend: number, draw: (solid: boolean) => void): void {
    if (blend <= 0 || blend >= 1) {
      draw(blend >= 1);
      return;
    }
    this.renderer.getDrawingBufferSize(this.size);
    if (this.assembledFrame?.image.width !== this.size.x || this.assembledFrame.image.height !== this.size.y) {
      this.assembledFrame?.dispose();
      this.expandedFrame?.dispose();
      this.assembledFrame = new THREE.FramebufferTexture(this.size.x, this.size.y);
      this.expandedFrame = new THREE.FramebufferTexture(this.size.x, this.size.y);
      this.material.uniforms.assembledFrame.value = this.assembledFrame;
      this.material.uniforms.expandedFrame.value = this.expandedFrame;
    }
    draw(false);
    this.renderer.copyFramebufferToTexture(this.assembledFrame!);
    draw(true);
    this.renderer.copyFramebufferToTexture(this.expandedFrame!);
    this.material.uniforms.blend.value = blend;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.assembledFrame?.dispose();
    this.expandedFrame?.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
