"use client";

export function PreviewForm({ className, children, describedBy }: { className?: string; children: React.ReactNode; describedBy?: string }) {
  return <form className={className} aria-describedby={describedBy} onSubmit={(event) => event.preventDefault()}>{children}</form>;
}
