export default function DealsLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  // Parallel route slot for the intercepted deal modal. Renders `null`
  // (see @modal/default.tsx) unless a deal route is intercepted.
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
