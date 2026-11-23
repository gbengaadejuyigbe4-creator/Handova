/** The Handova mark: a flat scrub-green square with the letter H. */
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Handova" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="8" fill="#0E5A49" />
      <path d="M13 12h5v10h12V12h5v24h-5V27H18v9h-5V12z" fill="#FFFFFF" />
    </svg>
  );
}
