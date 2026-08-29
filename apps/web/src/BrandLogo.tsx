export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`ar-logo ${compact ? "ar-logo-compact" : ""}`} aria-label="AgentRelay">
      <svg className="ar-logo-mark" viewBox="0 0 64 48" role="img" aria-hidden="true">
        <path d="M8 39 24 8a5 5 0 0 1 9 0l17 31" fill="none" stroke="#ACC6AA" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M31 9h11c10 0 15 5 15 12s-5 12-15 12h-7M43 32l12 10" fill="none" stroke="#5D4A7D" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 40c13 0 17-4 24-13 7-9 13-10 25-10" fill="none" stroke="#71A0A5" strokeWidth="4" strokeLinecap="round" />
        <circle cx="5" cy="40" r="5" fill="#71A0A5" />
        <circle cx="54" cy="17" r="5" fill="#D7B98A" stroke="#fff" strokeWidth="2" />
      </svg>
      {!compact && <span className="ar-logo-word"><strong>Agent</strong><b>Relay</b></span>}
    </div>
  );
}
