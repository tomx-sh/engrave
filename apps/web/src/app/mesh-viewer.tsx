"use client";

import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DEFAULT_SPAN, makeRelief } from "./relief";

function disposeMesh(root: Object3D) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof MeshBasicMaterial && material.map) {
        const image = material.map.image;
        if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
        material.map.dispose();
      }
      material.dispose();
    }
  });
}

function getModelFrame(mesh: Mesh) {
  const positions = mesh.geometry.getAttribute("position");
  let halfWidth = 0;
  let halfHeight = 0;
  let nearest = Infinity;
  let farthest = 0;
  let imageCenterDistance = Infinity;
  let focusDepth = 0;

  for (let index = 0; index < positions.count; index += 1) {
    const depth = -positions.getZ(index);
    if (depth <= 0) continue;
    const x = Math.abs(positions.getX(index) / depth);
    const y = Math.abs(positions.getY(index) / depth);
    halfWidth = Math.max(halfWidth, x);
    halfHeight = Math.max(halfHeight, y);
    nearest = Math.min(nearest, depth);
    farthest = Math.max(farthest, depth);
    const distance = x * x + y * y;
    if (distance < imageCenterDistance) {
      imageCenterDistance = distance;
      focusDepth = depth;
    }
  }

  return { halfWidth, halfHeight, nearest, farthest, focusDepth };
}

export function MeshViewer({
  model,
  pending,
}: {
  model?: { url: string; filename: string };
  pending: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const preview = useRef<(ReturnType<typeof makeRelief> & { render: () => void }) | null>(null);
  const [postProcess, setPostProcess] = useState<"none" | "relief">("none");
  const isRelief = postProcess === "relief";
  const [span, setSpan] = useState(DEFAULT_SPAN);
  const spanRef = useRef(DEFAULT_SPAN);
  const [status, setStatus] = useState("Loading preview…");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const url = model?.url;

  useEffect(() => {
    const element = container.current;
    if (!element || !url) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true });
    } catch {
      setStatus("This browser could not start the 3D preview.");
      return;
    }

    const scene = new Scene();
    const camera = new PerspectiveCamera(42, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    let active = true;
    let dispose: (() => void) | undefined;
    let modelFrame: ReturnType<typeof getModelFrame> | undefined;

    renderer.setClearColor(0x151413);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.setAttribute("aria-label", "Interactive 3D preview of the photo");
    element.appendChild(renderer.domElement);

    function render() {
      renderer.render(scene, camera);
    }

    function resize() {
      const width = renderer.domElement.parentElement?.clientWidth ?? 1;
      const height = renderer.domElement.parentElement?.clientHeight ?? 1;
      camera.aspect = Math.max(1, width) / Math.max(1, height);
      if (modelFrame) {
        const halfHeight = Math.max(modelFrame.halfHeight, modelFrame.halfWidth / camera.aspect);
        camera.fov = Math.atan(halfHeight * 1.05) * 360 / Math.PI;
      }
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      render();
    }

    controls.addEventListener("change", render);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    new GLTFLoader().loadAsync(url).then(({ scene: model }) => {
      if (!active) {
        disposeMesh(model);
        return;
      }
      const front = model.getObjectByProperty("type", "Mesh");
      if (!(front instanceof Mesh) || !(front.material instanceof MeshBasicMaterial)) {
        disposeMesh(model);
        throw new Error("The GLB is missing the photo surface.");
      }
      if (!isRelief) {
        dispose = () => disposeMesh(model);
        modelFrame = getModelFrame(front);
        camera.position.set(0, 0, 0);
        camera.near = modelFrame.nearest / 100;
        camera.far = modelFrame.farthest * 3;
        controls.target.set(0, 0, -modelFrame.focusDepth);
        controls.update();
        scene.add(model);
        resize();
        setStatus("");
        return;
      }

      let relief: ReturnType<typeof makeRelief>;
      try {
        relief = makeRelief(front);
      } catch (error) {
        disposeMesh(model);
        throw error;
      }
      dispose = relief.dispose;
      preview.current = { ...relief, render };
      relief.setSpan(spanRef.current);
      const keyLight = new DirectionalLight(0xffffff, 2.3);
      keyLight.position.set(-1, 1.5, 1.5);
      scene.add(keyLight, new AmbientLight(0xffffff, 1.2));
      scene.add(relief.group);
      const { center, radius } = new Box3().setFromObject(relief.group, true).getBoundingSphere(new Sphere());
      const halfVertical = (camera.fov * Math.PI) / 360;
      const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
      const distance = (radius * 1.04) / Math.sin(Math.min(halfHorizontal, halfVertical));
      const angle = new Vector3(-0.28, 0.22, 1).normalize();
      camera.position.copy(center).addScaledVector(angle, distance);
      camera.near = Math.max(radius / 1000, 0.00001);
      camera.far = distance + radius * 100;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
      render();
      setStatus("");
    }).catch(() => {
      if (active) setStatus(isRelief ? "The 3D preview could not build the bas-relief." : "The model depth could not be displayed.");
    });

    return () => {
      active = false;
      observer.disconnect();
      controls.dispose();
      dispose?.();
      preview.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url, isRelief]);

  function changeSpan(value: number) {
    spanRef.current = value;
    setSpan(value);
    preview.current?.setSpan(value);
    preview.current?.render();
  }

  async function download() {
    if (!preview.current || !model) return;
    setSaving(true);
    setSaveError("");
    try {
      const data = await new GLTFExporter().parseAsync(preview.current.group, { binary: true });
      if (!(data instanceof ArrayBuffer)) throw new Error("Expected a binary GLB.");
      const href = URL.createObjectURL(new Blob([data], { type: "model/gltf-binary" }));
      const link = document.createElement("a");
      link.href = href;
      link.download = `${model.filename}-relief.glb`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
    } catch {
      setSaveError("The bas-relief could not be exported.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="preview-title" className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-stone-900">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-white/10 px-5 py-2">
        <h2 id="preview-title" className="text-sm font-semibold">{isRelief ? "Bas-relief preview" : "Model depth preview"}</h2>
        {model && !isRelief && (
          <a href={model.url} download={`${model.filename}-depth.glb`} className="text-sm text-amber-300 hover:underline">Download GLB</a>
        )}
        {url && isRelief && (
          <button type="button" onClick={download} disabled={!!status || saving || pending} className="text-sm text-amber-300 enabled:cursor-pointer enabled:hover:underline disabled:opacity-45">
            {saving ? "Exporting…" : "Download GLB"}
          </button>
        )}
      </div>
      <div className="relative h-[clamp(22rem,65vh,55rem)] bg-stone-950">
        <div ref={container} className="absolute inset-0 overflow-hidden" />
        {(!url || status) && (
          <p role="status" className="pointer-events-none absolute inset-0 grid place-items-center px-5 text-center text-sm text-stone-400">
            {url ? status : pending ? "Estimating depth…" : "Choose a photo to preview its depth."}
          </p>
        )}
      </div>
      <div className="grid gap-3 border-t border-white/10 px-5 py-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <label htmlFor="post-process" className="font-semibold">Post-process</label>
          <select id="post-process" value={postProcess} disabled={!url || saving || pending}
            onChange={(event) => {
              setStatus("Loading preview…");
              setSaveError("");
              setPostProcess(event.target.value === "relief" ? "relief" : "none");
            }}
            className="rounded-md border border-white/10 bg-stone-950 px-3 py-1.5 text-stone-100 disabled:opacity-60">
            <option value="none">None</option>
            <option value="relief">Bas-relief</option>
          </select>
        </div>
        {isRelief && (
          <>
            <div className="flex items-center justify-between gap-3 text-sm">
              <label htmlFor="depth-span" className="font-semibold">Depth span</label>
              <output htmlFor="depth-span" className="font-mono text-stone-300">{span}%</output>
            </div>
            <input id="depth-span" type="range" min="0" max="25" step="1" value={span}
              aria-describedby="span-help" aria-valuetext={`${span}%`} disabled={!!status || saving}
              onChange={(event) => changeSpan(event.target.valueAsNumber)} className="w-full accent-amber-300 disabled:opacity-45" />
            <p id="span-help" className="text-xs text-stone-400">Maximum rise as a percentage of the longest edge.</p>
          </>
        )}
        {url && !status && <p className="text-xs text-stone-400">Drag to orbit · Scroll or pinch to zoom</p>}
        {saveError && <p role="alert" className="text-sm text-rose-300">{saveError}</p>}
      </div>
    </section>
  );
}
