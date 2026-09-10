// Small, simplified brand glyphs for the lead-source picker. lucide-react
// (the only icon package in this project) dropped brand/logo icons, so these
// are minimal hand-drawn stand-ins rather than a new dependency for four
// icons.

export function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="#E1306C" />
      <rect x="6.5" y="6.5" width="11" height="11" rx="3.5" fill="none" stroke="#fff" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="#fff" strokeWidth="1.6" />
      <circle cx="16.6" cy="7.4" r="1.1" fill="#fff" />
    </svg>
  );
}

export function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="#1877F2" />
      <path
        d="M13.5 21v-6.6h2.2l.3-2.6h-2.5V10c0-.75.2-1.26 1.28-1.26H16V6.4A17 17 0 0 0 14.1 6.3c-1.9 0-3.2 1.16-3.2 3.3v1.8H8.7v2.6h2.2V21h2.6Z"
        fill="#fff"
      />
    </svg>
  );
}

export function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="#25D366" />
      <path
        d="M8.3 15.9 7.6 18.4l2.6-.7c.9.5 1.9.8 2.9.8h.01c3.3 0 5.9-2.6 5.9-5.9S16.5 6.7 13.1 6.7 7.2 9.3 7.2 12.6c0 1.1.3 2.1.9 3l.2.3Z"
        fill="#fff"
      />
      <path
        d="M10.9 9.9c-.15-.34-.31-.35-.45-.35h-.38c-.13 0-.34.05-.52.25s-.68.66-.68 1.62.7 1.88.8 2.01c.1.13 1.36 2.06 3.32 2.81 1.64.63 1.97.51 2.33.47.36-.03 1.15-.47 1.31-.92.16-.46.16-.85.11-.93-.05-.08-.18-.13-.38-.23s-1.15-.57-1.33-.63c-.18-.06-.31-.09-.44.09s-.5.63-.62.76c-.11.13-.23.14-.42.05-.19-.1-.83-.31-1.58-.98-.58-.52-.98-1.16-1.09-1.35-.11-.19-.01-.3.09-.4.09-.09.19-.23.29-.35.1-.11.13-.19.2-.32.06-.13.03-.24-.02-.34-.05-.1-.42-1.05-.6-1.44Z"
        fill="#25D366"
      />
    </svg>
  );
}

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M21.6 12.23c0-.72-.06-1.4-.19-2.05H12v3.87h5.4a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 3-4.32 3-7.34Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.75-5.59-4.11H3.06v2.58A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.41 13.92a6 6 0 0 1 0-3.84V7.5H3.06a10 10 0 0 0 0 9l3.35-2.58Z"
        fill="#FBBC05"
      />
      <path
        d="M12 6.05c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.5l3.35 2.58C7.2 7.8 9.4 6.05 12 6.05Z"
        fill="#EA4335"
      />
    </svg>
  );
}
