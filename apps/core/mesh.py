import numpy as np
import trimesh
from PIL import Image


def depth_to_glb(photo: Image.Image, depth: np.ndarray, focal_px: float) -> bytes:
    """Back-project image samples into glTF coordinates, preserving meter units."""
    height, width = depth.shape
    if not np.isfinite(focal_px) or focal_px <= 0:
        raise ValueError("The model could not estimate the camera focal length.")

    columns, rows = np.meshgrid(
        np.linspace(0, width - 1, min(width, 384), dtype=int),
        np.linspace(0, height - 1, min(height, 384), dtype=int),
    )
    z = depth[rows, columns]
    valid = np.isfinite(z) & (z > 0)

    grid = np.arange(z.size).reshape(z.shape)
    top_left = grid[:-1, :-1].ravel()
    top_right = grid[:-1, 1:].ravel()
    bottom_left = grid[1:, :-1].ravel()
    bottom_right = grid[1:, 1:].ravel()
    faces = np.concatenate((
        np.column_stack((top_left, bottom_left, top_right)),
        np.column_stack((top_right, bottom_left, bottom_right)),
    ))
    faces = faces[valid.ravel()[faces].all(axis=1)]
    if not len(faces):
        raise ValueError("The photo has no connected surface with finite depth.")
    x_px = columns.ravel() + 0.5
    y_px = rows.ravel() + 0.5
    # Keep grid slots for the optional relief. Invalid slots have no faces in the model mesh.
    distance = np.where(valid, z, 0).ravel()
    vertices = np.column_stack((
        (x_px - width / 2) * distance / focal_px,
        (height / 2 - y_px) * distance / focal_px,
        -distance,
    ))
    uv = np.column_stack((x_px / width, 1 - y_px / height))
    material = trimesh.visual.material.PBRMaterial(baseColorTexture=photo, doubleSided=True)
    mesh = trimesh.Trimesh(
        vertices=vertices,
        faces=faces,
        visual=trimesh.visual.TextureVisuals(uv=uv, material=material),
        process=False,
    )

    def use_photo_colors(tree: dict) -> None:
        tree.setdefault("extensionsUsed", []).append("KHR_materials_unlit")
        tree["materials"][0].setdefault("extensions", {})["KHR_materials_unlit"] = {}

    return trimesh.exchange.gltf.export_glb(mesh.scene(), tree_postprocessor=use_photo_colors)
