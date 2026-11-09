import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry/options";

// Error reporting in the browser. Does nothing without NEXT_PUBLIC_SENTRY_DSN.
Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN));
