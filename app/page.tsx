export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-4 py-12 sm:px-8">
      <p className="text-base font-semibold tracking-tight text-brand">followthrough</p>
      <h1 className="text-4xl font-semibold tracking-tight text-balance text-ink sm:text-5xl">
        Meetings end. <span className="whitespace-nowrap">Follow-through</span> starts.
      </h1>
      <p className="text-lg text-ink-muted">
        A workspace that turns meeting notes into clear, owned actions people can actually follow.
      </p>
    </main>
  );
}
