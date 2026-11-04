import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { heightAt, loadTerrain } from '../services/terrain';
import { buildRoadPath, pointAt, roadRibbon, scatterTrees, seededRandom } from '../services/routeScene';

const SKY_COLOR = 0xa9cde8;
const ROAD_HALF_WIDTH_M = 3;
const EYE_HEIGHT_M = 1.7;
const LOOK_AHEAD_M = 24;
const TREE_COUNT = 2500;

// Terrain colours, blended by relative height and slope
const MEADOW = new THREE.Color(0x7a9a52);
const FOREST = new THREE.Color(0x46663a);
const ROCK = new THREE.Color(0x8c8a80);

function buildTerrainMesh(field, random) {
  const { cols, rows, heights, originX, originZ, spacing } = field;
  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);

  let minH = Infinity;
  let maxH = -Infinity;
  for (const h of heights) {
    minH = Math.min(minH, h);
    maxH = Math.max(maxH, h);
  }
  const range = Math.max(1, maxH - minH);
  const color = new THREE.Color();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const h = heights[i];
      positions[i * 3] = originX + c * spacing;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = originZ + r * spacing;

      const hx = heights[r * cols + Math.min(cols - 1, c + 1)] - h;
      const hz = heights[Math.min(rows - 1, r + 1) * cols + c] - h;
      const slope = Math.hypot(hx, hz) / spacing;

      color.copy(MEADOW).lerp(FOREST, Math.min(1, (h - minH) / range * 1.5));
      color.lerp(ROCK, Math.min(1, Math.max(0, (slope - 0.25) * 3)));
      color.offsetHSL(0, 0, (random() - 0.5) * 0.04);
      colors.set([color.r, color.g, color.b], i * 3);
    }
  }

  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices.set([a, d, b, b, d, e], k);
      k += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

/** Triangle strip between two edge polylines, optionally only where include(i) is true. */
function ribbonMesh(left, right, material, lift = 0, include = () => true) {
  const positions = [];
  for (let i = 0; i < left.length - 1; i++) {
    if (!include(i)) continue;
    const l0 = left[i], r0 = right[i], l1 = left[i + 1], r1 = right[i + 1];
    positions.push(
      l0.x, l0.y + lift, l0.z, r0.x, r0.y + lift, r0.z, l1.x, l1.y + lift, l1.z,
      l1.x, l1.y + lift, l1.z, r0.x, r0.y + lift, r0.z, r1.x, r1.y + lift, r1.z,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function buildFinishArch(path) {
  const end = pointAt(path, path.length);
  const before = pointAt(path, path.length - 10);
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ color: 0x00d4ff, emissive: 0x003a46 });
  const postGeometry = new THREE.CylinderGeometry(0.25, 0.25, 6, 8);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeometry, material);
    post.position.set(side * (ROAD_HALF_WIDTH_M + 1), 3, 0);
    group.add(post);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry((ROAD_HALF_WIDTH_M + 1) * 2 + 0.5, 1, 0.3), material);
  banner.position.set(0, 5.6, 0);
  group.add(banner);
  group.position.set(end.x, end.y, end.z);
  group.rotation.y = Math.atan2(end.x - before.x, end.z - before.z);
  return group;
}

/**
 * First-person 3D view of a GPX route over real terrain.
 *
 * Elevation comes from the Open Ride backend's terrain tile proxy. The camera
 * follows the rider: between the 1 Hz distance updates it advances using the
 * current speed so motion stays smooth.
 *
 * @param {object[]} routePoints   parsed GPX points ({ lat, lng, ele, distanceFromStart })
 * @param {object}   distanceKmRef ref holding the distance ridden (km)
 * @param {object}   telemetryRef  ref holding live telemetry ({ speed } in km/h)
 * @param {boolean}  isRiding
 */
export default function Route3DView({ routePoints, distanceKmRef, telemetryRef, isRiding }) {
  const containerRef = useRef(null);
  const isRidingRef = useRef(isRiding);
  const [status, setStatus] = useState({ state: 'loading' });
  const [cameraMode, setCameraMode] = useState('rider');
  const cameraModeRef = useRef(cameraMode);
  useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode]);
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';

  useEffect(() => { isRidingRef.current = isRiding; }, [isRiding]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || routePoints.length < 2) return undefined;

    const abort = new AbortController();
    const disposables = [];
    let disposed = false;
    let frame = 0;
    let renderer = null;
    let resizeObserver = null;
    setStatus({ state: 'loading' });

    (async () => {
      let terrain;
      try {
        terrain = await loadTerrain(routePoints, { apiBase: apiBaseUrl, signal: abort.signal });
      } catch (err) {
        if (!abort.signal.aborted) setStatus({ state: 'error', message: 'Could not load terrain.' });
        return;
      }
      if (disposed) return;

      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      } catch {
        setStatus({ state: 'error', message: 'The 3D view needs WebGL, which is not available in this browser.' });
        return;
      }
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(SKY_COLOR);
      scene.fog = new THREE.Fog(SKY_COLOR, 450, 4500);
      const sky = new THREE.Mesh(new THREE.SphereGeometry(11000, 24, 16), new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { top: { value: new THREE.Color(0x4f91ce) }, horizon: { value: new THREE.Color(SKY_COLOR) } },
        vertexShader: 'varying vec3 direction; void main() { direction = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 direction; void main() { float h = max(normalize(direction).y, 0.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); }',
      }));
      scene.add(sky);
      scene.add(new THREE.HemisphereLight(0xdff0ff, 0x4a5a3a, 1.4));
      const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
      sun.position.set(-1, 1.2, 0.6);
      scene.add(sun);

      const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.3, 15000);

      const random = seededRandom(routePoints.length);
      const terrainMesh = buildTerrainMesh(terrain.field, random);
      scene.add(terrainMesh);

      const path = buildRoadPath(routePoints, terrain.projection, terrain.field);
      const roadMaterial = new THREE.MeshLambertMaterial({
        color: 0x3b3b3e, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const shoulder = roadRibbon(path, ROAD_HALF_WIDTH_M + 1.1);
      scene.add(ribbonMesh(shoulder.left, shoulder.right, new THREE.MeshLambertMaterial({ color: 0x9b947b }), -0.04));
      const edges = roadRibbon(path, ROAD_HALF_WIDTH_M);
      scene.add(ribbonMesh(edges.left, edges.right, roadMaterial));

      // Dashed centre line: 3 m dashes every 6 m (path points are 5 m apart)
      const lineMaterial = new THREE.MeshLambertMaterial({
        color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const centre = roadRibbon(path, 0.12);
      scene.add(ribbonMesh(centre.left, centre.right, lineMaterial, 0.02, i => i % 2 === 0));

      // Continuous edge markings give bends and gradients a clear visual reference.
      const inner = roadRibbon(path, ROAD_HALF_WIDTH_M - 0.22);
      const outer = roadRibbon(path, ROAD_HALF_WIDTH_M - 0.10);
      scene.add(ribbonMesh(inner.left, outer.left, lineMaterial, 0.025));
      scene.add(ribbonMesh(inner.right, outer.right, lineMaterial, 0.025));

      // Instanced reflector posts provide a sense of speed without extra draw calls per post.
      const postCount = Math.floor(path.length / 40);
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1, 0.15), new THREE.MeshLambertMaterial({ color: 0xeee9d9 }), postCount * 2);
      const reflectors = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.16, 0.17), new THREE.MeshLambertMaterial({ color: 0xffcb68 }), postCount * 2);
      const postMatrix = new THREE.Matrix4();
      for (let i = 0; i < postCount; i++) {
        const p = pointAt(path, i * 40 + 10);
        const next = pointAt(path, Math.min(path.length, i * 40 + 15));
        const length = Math.hypot(next.x - p.x, next.z - p.z) || 1;
        for (let side = 0; side < 2; side++) {
          const offset = (side ? 1 : -1) * (ROAD_HALF_WIDTH_M + 1.7);
          const x = p.x + (next.z - p.z) / length * offset;
          const z = p.z - (next.x - p.x) / length * offset;
          const y = heightAt(terrain.field, x, z);
          postMatrix.makeTranslation(x, y + 0.5, z);
          posts.setMatrixAt(i * 2 + side, postMatrix);
          postMatrix.makeTranslation(x, y + 0.85, z);
          reflectors.setMatrixAt(i * 2 + side, postMatrix);
        }
      }
      scene.add(posts, reflectors);

      const trees = scatterTrees(path, terrain.field, { count: TREE_COUNT, seed: routePoints.length });
      const treeGeometry = new THREE.ConeGeometry(2.7, 7, 8);
      treeGeometry.translate(0, 5.5, 0);
      const treeMesh = new THREE.InstancedMesh(treeGeometry, new THREE.MeshLambertMaterial({ color: 0x2f4f2a }), trees.length);
      const upperGeometry = new THREE.ConeGeometry(1.9, 5.5, 8);
      upperGeometry.translate(0, 8, 0);
      const upperTrees = new THREE.InstancedMesh(upperGeometry, new THREE.MeshLambertMaterial({ color: 0x426b35 }), trees.length);
      const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.32, 4, 5);
      trunkGeometry.translate(0, 2, 0);
      const trunks = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshLambertMaterial({ color: 0x6b5138 }), trees.length);
      const matrix = new THREE.Matrix4();
      const treeColor = new THREE.Color();
      trees.forEach((tree, i) => {
        matrix.makeScale(tree.scale, tree.scale, tree.scale);
        matrix.setPosition(tree.x, tree.y - 0.3, tree.z);
        treeMesh.setMatrixAt(i, matrix);
        upperTrees.setMatrixAt(i, matrix);
        trunks.setMatrixAt(i, matrix);
        treeColor.setHSL(0.27 + random() * 0.07, 0.25 + random() * 0.2, 0.22 + random() * 0.12);
        treeMesh.setColorAt(i, treeColor);
      });
      scene.add(treeMesh, upperTrees, trunks);

      scene.add(buildFinishArch(path));

      scene.traverse(object => {
        if (object.geometry) disposables.push(object.geometry);
        if (object.material) disposables.push(object.material);
      });

      resizeObserver = new ResizeObserver(() => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
      resizeObserver.observe(container);

      setStatus({
        state: 'ready',
        tilesLoaded: terrain.tilesLoaded,
        tilesTotal: terrain.tilesTotal,
        attribution: terrain.provider.attribution,
      });

      // Follow the rider
      let shownM = (distanceKmRef.current || 0) * 1000;
      let last = performance.now();
      const lookDirection = new THREE.Vector3();
      const lookTarget = new THREE.Vector3();
      const desiredLook = new THREE.Vector3();
      let firstFrame = true;

      const tick = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const targetM = (distanceKmRef.current || 0) * 1000;
        if (isRidingRef.current) {
          // Advance with current speed, and ease towards the reported distance
          shownM += ((telemetryRef.current?.speed || 0) / 3.6) * dt;
          shownM += (targetM - shownM) * (1 - Math.exp(-dt * 2));
          shownM = Math.min(shownM, targetM + Math.max(0, telemetryRef.current?.speed || 0) / 3.6);
          if (Math.abs(targetM - shownM) > 25) shownM = targetM;
        } else {
          shownM = targetM;
        }
        shownM = Math.max(0, Math.min(path.length, shownM));

        const eye = pointAt(path, shownM);
        const lookAheadM = LOOK_AHEAD_M + Math.min(20, (telemetryRef.current?.speed || 0) / 3.6);
        const ahead = pointAt(path, Math.min(path.length, shownM + lookAheadM));
        const eyeHeight = cameraModeRef.current === 'rider' ? EYE_HEIGHT_M : 5.5;
        const desiredY = eye.y + eyeHeight;
        const smoothY = firstFrame ? desiredY : THREE.MathUtils.lerp(camera.position.y, desiredY, 1 - Math.exp(-dt * 7));
        camera.position.set(eye.x, Math.max(eye.y + 1.2, smoothY), eye.z);
        sky.position.copy(camera.position);
        if (shownM >= path.length - 1) {
          // At the finish keep looking along the final stretch
          const back = pointAt(path, path.length - LOOK_AHEAD_M);
          desiredLook.set(eye.x * 2 - back.x, eye.y + EYE_HEIGHT_M - 0.3, eye.z * 2 - back.z);
        } else {
          desiredLook.set(ahead.x, ahead.y + EYE_HEIGHT_M - 0.3, ahead.z);
        }
        // Smooth a direction, rather than a world-space target that falls behind on tight turns.
        desiredLook.sub(camera.position).normalize();
        if (firstFrame) lookDirection.copy(desiredLook);
        else lookDirection.lerp(desiredLook, 1 - Math.exp(-dt * 6)).normalize();
        lookTarget.copy(camera.position).add(lookDirection);
        firstFrame = false;
        camera.lookAt(lookTarget);

        renderer.render(scene, camera);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    })();

    return () => {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      new Set(disposables).forEach(item => item.dispose());
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [routePoints, apiBaseUrl, distanceKmRef, telemetryRef]);

  return (
    <div className="route-3d" ref={containerRef}>
      <div className="route-camera-controls" role="group" aria-label="3D camera">
        <button type="button" aria-pressed={cameraMode === 'rider'} onClick={() => setCameraMode('rider')}>Rider</button>
        <button type="button" aria-pressed={cameraMode === 'scenic'} onClick={() => setCameraMode('scenic')}>Scenic</button>
      </div>
      {status.state === 'loading' && (
        <div className="route-3d-status">Loading terrain…</div>
      )}
      {status.state === 'error' && (
        <div className="route-3d-status route-3d-error">{status.message}</div>
      )}
      {status.state === 'ready' && status.tilesLoaded < status.tilesTotal && (
        <div className="route-3d-warning">
          Some terrain could not be loaded ({status.tilesLoaded}/{status.tilesTotal} tiles) and is shown flat.
        </div>
      )}
      {status.attribution && <div className="route-3d-attribution">Elevation: {status.attribution}</div>}
    </div>
  );
}
