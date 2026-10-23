import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadTerrain } from '../services/terrain';
import { buildRoadPath, pointAt, roadRibbon, scatterTrees, seededRandom } from '../services/routeScene';

const SKY_COLOR = 0xa9cde8;
const ROAD_HALF_WIDTH_M = 3;
const EYE_HEIGHT_M = 1.7;
const LOOK_AHEAD_M = 30;
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(SKY_COLOR);
      scene.fog = new THREE.Fog(SKY_COLOR, 600, 6000);
      scene.add(new THREE.HemisphereLight(0xdff0ff, 0x4a5a3a, 1.4));
      const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
      sun.position.set(-1, 1.2, 0.6);
      scene.add(sun);

      const camera = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, 0.3, 15000);

      const random = seededRandom(routePoints.length);
      const terrainMesh = buildTerrainMesh(terrain.field, random);
      scene.add(terrainMesh);

      const path = buildRoadPath(routePoints, terrain.projection, terrain.field);
      const roadMaterial = new THREE.MeshLambertMaterial({
        color: 0x3b3b3e, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const edges = roadRibbon(path, ROAD_HALF_WIDTH_M);
      scene.add(ribbonMesh(edges.left, edges.right, roadMaterial));

      // Dashed centre line: 3 m dashes every 6 m (path points are 5 m apart)
      const lineMaterial = new THREE.MeshLambertMaterial({
        color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const centre = roadRibbon(path, 0.12);
      scene.add(ribbonMesh(centre.left, centre.right, lineMaterial, 0.02, i => i % 2 === 0));

      const trees = scatterTrees(path, terrain.field, { count: TREE_COUNT, seed: routePoints.length });
      const treeGeometry = new THREE.ConeGeometry(2.2, 8, 7);
      treeGeometry.translate(0, 4, 0);
      const treeMesh = new THREE.InstancedMesh(treeGeometry, new THREE.MeshLambertMaterial({ color: 0x2f4f2a }), trees.length);
      const matrix = new THREE.Matrix4();
      trees.forEach((tree, i) => {
        matrix.makeScale(tree.scale, tree.scale, tree.scale);
        matrix.setPosition(tree.x, tree.y - 0.3, tree.z);
        treeMesh.setMatrixAt(i, matrix);
      });
      scene.add(treeMesh);

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

      setStatus({ state: 'ready', tilesLoaded: terrain.tilesLoaded, tilesTotal: terrain.tilesTotal });

      // Follow the rider
      let shownM = (distanceKmRef.current || 0) * 1000;
      let last = performance.now();
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
          shownM += (targetM - shownM) * Math.min(1, dt * 1.5);
        } else {
          shownM = targetM;
        }
        shownM = Math.max(0, Math.min(path.length, shownM));

        const eye = pointAt(path, shownM);
        const ahead = pointAt(path, Math.min(path.length, shownM + LOOK_AHEAD_M));
        camera.position.set(eye.x, eye.y + EYE_HEIGHT_M, eye.z);
        if (shownM >= path.length - 1) {
          // At the finish keep looking along the final stretch
          const back = pointAt(path, path.length - LOOK_AHEAD_M);
          desiredLook.set(eye.x * 2 - back.x, eye.y + EYE_HEIGHT_M - 0.3, eye.z * 2 - back.z);
        } else {
          desiredLook.set(ahead.x, ahead.y + EYE_HEIGHT_M - 0.3, ahead.z);
        }
        if (firstFrame) lookTarget.copy(desiredLook);
        else lookTarget.lerp(desiredLook, Math.min(1, dt * 4));
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
      disposables.forEach(item => item.dispose());
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [routePoints, apiBaseUrl, distanceKmRef, telemetryRef]);

  return (
    <div className="route-3d" ref={containerRef}>
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
      <div className="route-3d-attribution">Elevation: Terrain Tiles (Mapzen, AWS Open Data)</div>
    </div>
  );
}
