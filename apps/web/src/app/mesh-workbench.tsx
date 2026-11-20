"use client";

import { type FormEvent, useEffect, useState } from "react";
import { MeshViewer } from "./mesh-viewer";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function MeshWorkbench() {
  const [photo, setPhoto] = useState<File>();
  const [model, setModel] = useState<{ url: string; filename: string }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (model) return () => URL.revokeObjectURL(model.url);
  }, [model]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo || pending) return;
    if (photo.size > MAX_UPLOAD_BYTES) {
      setError("Choose a photo smaller than 15 MiB.");
      return;
    }

    setModel(undefined);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/mesh", {
        method: "POST",
        headers: { "Content-Type": photo.type || "application/octet-stream" },
        body: photo,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || "The photo could not be processed.");
      }

      const blob = await response.blob();
      setModel({
        url: URL.createObjectURL(blob),
        filename: photo.name.replace(/\.[^.]+$/, "") || "engrave",
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "The photo could not be processed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <form onSubmit={generate} className="flex flex-col gap-5 rounded-xl border border-white/10 bg-stone-900 p-5">
        <div>
          <label htmlFor="photo" className="text-sm font-semibold">Input photo</label>
          <input
            id="photo"
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby="photo-formats"
            disabled={pending}
            onChange={(event) => {
              setPhoto(event.target.files?.[0]);
              setModel(undefined);
              setError("");
            }}
            className="mt-3 block w-full truncate rounded-md bg-stone-950 text-sm text-stone-400 file:mr-2 file:cursor-pointer file:border-0 file:bg-stone-800 file:px-3 file:py-2.5 file:text-stone-100 disabled:opacity-60"
          />
          <p id="photo-formats" className="mt-2 text-xs text-stone-400">JPEG, PNG, or WebP · up to 15 MiB</p>
        </div>

        <button
          type="submit"
          disabled={!photo || pending}
          className="rounded-md bg-amber-300 px-4 py-2.5 text-sm font-semibold text-stone-950 enabled:cursor-pointer enabled:hover:bg-amber-200 disabled:opacity-45"
        >
          {pending ? "Generating…" : "Generate mesh"}
        </button>
        {error && <p role="alert" className="text-sm leading-5 text-rose-300">{error}</p>}
      </form>

      <MeshViewer key={model?.url} model={model} pending={pending} />
    </div>
  );
}
