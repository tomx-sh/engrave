# Engrave

Engrave turns one photo into a textured 3D surface. Depth Pro 2 estimates metric depth and camera focal length. The core projects a regular grid of samples into 3D and embeds the photo in a GLB. The web app can also turn that surface into a relief with a flat backing.

## Run locally

With [Bun](https://bun.com/), [Node.js](https://nodejs.org/), and [uv](https://docs.astral.sh/uv/) installed, run these commands from the repository root.

```sh
bun install
bun dev
```

Run `bun install` on the first checkout and when JavaScript dependencies change. `bun dev` starts Next.js and the Python core in one terminal. `uv` syncs the Python environment as needed. Press Ctrl+C to stop both services.

Open `http://127.0.0.1:3000`, choose a JPEG, PNG, or WebP, and generate the mesh. **Post-process → None** displays and downloads the model's sampled metric depth mesh. Drag to orbit away from the original camera view and see the geometry. Select **Bas-relief** to make a flat-backed plaque and adjust **Depth span** from 0% to 25% of the longest edge. The download reflects the selected mode.

`apps/core` uses Python 3.12, FastAPI, and Apple's PyTorch implementation. It defaults to `depthpro2-b` and uses CUDA, MPS, or CPU through Apple's device selection. Photos keep their aspect ratio and are resized to at most 768 pixels on the longest side for inference. The first valid request downloads the depth and focal-length weights from Hugging Face (about 480 MB). Set `ENGRAVE_DEPTH_MODEL` to `depthpro2-s`, `depthpro2-l`, or `depthpro2-h` to change the model, or set `ENGRAVE_DEPTH_DEVICE=cpu` to force CPU inference.

`apps/web` streams the uploaded photo from `/api/mesh` to the core at `http://127.0.0.1:8000`. Set `ENGRAVE_CORE_URL` in the web process to change that origin. Photos are processed in memory. You can call the core directly to get the depth surface before the relief transformation.

```sh
curl --fail-with-body --data-binary @photo.jpg -H 'Content-Type: image/jpeg' \
  http://127.0.0.1:8000/mesh -o photo.glb
```

Apple restricts the model weights to non-commercial scientific research and academic development. [Model license](https://github.com/apple-aiml-research/ml-depth-pro-2/blob/main/LICENSE_MODEL)
