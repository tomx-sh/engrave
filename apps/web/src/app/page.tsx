import { MeshWorkbench } from "./mesh-workbench";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[100rem] px-5 py-8 sm:px-10 sm:py-12">
      <header className="mb-9 max-w-xl">
        <p className="mb-4 font-mono text-xs font-semibold tracking-[0.22em] text-amber-300">
          ENGRAVE
        </p>
        <h1 className="text-4xl font-medium tracking-tight sm:text-5xl">Photo to 3D</h1>
        <p className="mt-3 text-sm leading-6 text-stone-400 sm:text-base">
          Explore the depth of a photo or turn it into a bas-relief.
        </p>
      </header>
      <MeshWorkbench />
    </main>
  );
}
