import Link from "next/link";

import { Button } from "@/components/ui/button";

/** App-wide 404 page. Rendered inside the root layout (<html>/<body> provided). */
export default function NotFound() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 bg-background px-6 py-24 text-center text-foreground">
      <p className="text-3xl font-semibold text-ink">404</p>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-ink">Page not found</h1>
        <p className="max-w-md text-sm text-ink-soft">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
      </div>
      <Button render={<Link href="/dashboard" />} className="mt-1">
        Back to dashboard
      </Button>
    </main>
  );
}
