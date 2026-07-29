import './globals.css';

export const metadata = {
  title: 'The Desk',
  description: 'Director / EA execution workspace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
