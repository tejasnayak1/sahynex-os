'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en-IN">
      <body style={{ fontFamily: 'system-ui', padding: 32 }}>
        <h1>Sahynex OS hit an unexpected error</h1>
        <p>Your last change may not have been saved. Reload to try again.</p>
        <button onClick={reset}>Reload</button>
      </body>
    </html>
  );
}
