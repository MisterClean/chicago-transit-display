# Security

Please report exploitable security issues privately using GitHub's private vulnerability reporting on the repository, if enabled. If it is unavailable, contact the maintainer through the contact method on their GitHub profile before posting exploit details. Do not include working credentials or private board locations in public issues.

Only the latest release is supported during the MVP stage. The repository has no hosted account system, but deployments must still protect provider credentials, enforce request bounds, configure HTTPS and reverse-proxy rate limits, and keep dependencies patched.

Vite environment variables are public browser configuration. Use only the public Protomaps key there and restrict allowed origins in Protomaps. Server-only CTA and Geocodio keys belong in the process environment. Environment files and build output are ignored by Git. Backend logs must not include provider request URLs with query-string credentials, geocoding bodies, or full configurations.

A display link reveals coordinates and pinned stops. Anyone who has it can import an independent copy. The fragment is not encryption or access control. Physical kiosk control and wake locks are also not security boundaries.
