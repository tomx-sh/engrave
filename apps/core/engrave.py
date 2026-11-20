import logging
import os
from functools import cache
from io import BytesIO
from numbers import Real
from threading import Lock

import numpy as np
import torch
from depth_pro_2 import create_model_and_transforms
from depth_pro_2.utils import fpx_from_f35
from fastapi import FastAPI, HTTPException, Request, Response
from PIL import ExifTags, Image, ImageOps
from starlette.concurrency import run_in_threadpool

from mesh import depth_to_glb

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_IMAGE_PIXELS = 50_000_000
MAX_INFERENCE_SIDE = 768
FORMATS = ("JPEG", "PNG", "WEBP")

app = FastAPI()
inference = Lock()
logger = logging.getLogger(__name__)


@cache
def get_model():
    preset = os.environ.get("ENGRAVE_DEPTH_MODEL", "depthpro2-b")
    device = os.environ.get("ENGRAVE_DEPTH_DEVICE") or None
    return create_model_and_transforms(preset, device=device)


def reconstruct(data: bytearray) -> bytes:
    try:
        with Image.open(BytesIO(data), formats=FORMATS) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise ValueError("The photo exceeds 50 megapixels.")
            exif = source.getexif().get_ifd(ExifTags.IFD.Exif)
            focal_35mm = exif.get(ExifTags.Base.FocalLengthIn35mmFilm)
            source.thumbnail((MAX_INFERENCE_SIDE, MAX_INFERENCE_SIDE), Image.Resampling.LANCZOS)
            photo = ImageOps.exif_transpose(source).convert("RGB")
    except (OSError, SyntaxError, TypeError, Image.DecompressionBombError) as exc:
        raise HTTPException(422, "Upload a readable JPEG, PNG, or WebP photo.") from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    if min(photo.size) < 16:
        raise HTTPException(422, "The photo is too narrow or short to reconstruct.")

    focal_px = None
    if isinstance(focal_35mm, Real) and np.isfinite(float(focal_35mm)) and focal_35mm > 0:
        focal_px = fpx_from_f35(*photo.size, focal_35mm)
    with torch.inference_mode():
        model, transform = get_model()
        prediction = model.infer(transform(np.array(photo)), f_px=focal_px)

    try:
        return depth_to_glb(
            photo,
            prediction["depth"].float().cpu().numpy(),
            prediction["focallength_px"].item(),
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/mesh")
async def create_mesh(request: Request) -> Response:
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Choose a photo smaller than 15 MiB.")
        data.extend(chunk)
    if not data:
        raise HTTPException(400, "Choose a photo first.")

    def run_inference() -> bytes:
        if not inference.acquire(blocking=False):
            raise HTTPException(503, "The core is processing another photo. Try again shortly.")
        try:
            return reconstruct(data)
        finally:
            inference.release()

    try:
        glb = await run_in_threadpool(run_inference)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Could not generate a mesh")
        raise HTTPException(500, "Depth Pro 2 could not process the photo. Check the core logs.") from exc

    return Response(glb, media_type="model/gltf-binary", headers={"Cache-Control": "no-store"})
