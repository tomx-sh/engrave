const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  if (!request.body) {
    return Response.json({ detail: "Choose a photo first." }, { status: 400 });
  }
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES) {
    return Response.json(
      { detail: "Choose a photo smaller than 15 MiB." },
      { status: 413 },
    );
  }

  const core = process.env.ENGRAVE_CORE_URL || "http://127.0.0.1:8000";
  const options: RequestInit & { duplex: "half" } = {
    method: "POST",
    body: request.body,
    duplex: "half",
    headers: {
      "Content-Type": request.headers.get("content-type") || "application/octet-stream",
    },
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(300_000)]),
  };

  try {
    const upstream = await fetch(new URL("/mesh", core), options);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return Response.json({ detail: "Mesh generation timed out." }, { status: 504 });
    }
    return Response.json({ detail: "Could not reach the Engrave core." }, { status: 502 });
  }
}
