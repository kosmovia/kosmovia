export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <>
      <h1>Comunidad: {slug}</h1>
      <p className="muted">Aquí estará el chat de la comunidad.</p>
    </>
  );
}
